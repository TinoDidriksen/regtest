#!/usr/bin/env perl
# -*- mode: cperl; indent-tabs-mode: nil; tab-width: 3; cperl-indent-level: 3; -*-
use strict;
use warnings;
use utf8;

BEGIN {
	$| = 1;
	binmode(STDIN, ':encoding(UTF-8)');
	binmode(STDOUT, ':encoding(UTF-8)');
}
use open qw( :encoding(UTF-8) :std );
use feature qw(unicode_strings current_sub);
use POSIX qw(ceil);
use Digest::SHA qw(sha1_base64);
use File::Basename;
use File::Spec;

if ((($ENV{LANGUAGE} || "").($ENV{LANG} || "").($ENV{LC_ALL} || "")) !~ /UTF-?8/i) {
   die "Locale is not UTF-8 - bailing out!\n";
}
if ($ENV{PERL_UNICODE} !~ /S/ || $ENV{PERL_UNICODE} !~ /D/ || $ENV{PERL_UNICODE} !~ /A/) {
   die "Envvar PERL_UNICODE must contain S and D and A!\n";
}

use FindBin qw($Bin);
use lib "$Bin/";
use Helpers;

use Getopt::Long;
Getopt::Long::Configure('no_ignore_case');
my %opts = ();
GetOptions(\%opts,
   'help|h|?',
   'binary|b=s',
   'folder|f=s',
   'corpus|c=s',
   'run|r',
   'port|p=i',
   'step|s=s',
   'pagesize|z=i',
   );

if (defined $opts{'binary'}) {
   if ($opts{'binary'} !~ m@^[./]@) {
      $opts{'binary'} = './'.$opts{'binary'};
   }
}
else {
   my @bins = glob('./*.pl');
   if (scalar(@bins)) {
      $opts{'binary'} = $bins[0];
   }
}

if (!defined $opts{'folder'}) {
   $opts{'folder'} = 'regtest';
}

if (defined $opts{'binary'} && substr($opts{'folder'}, 0, 1) ne '/') {
   $opts{'folder'} = dirname($opts{'binary'}).'/'.$opts{'folder'};
}

my $corpus = '';
if (defined $opts{'corpus'}) {
   $corpus = $opts{'corpus'};
}
elsif (defined $ARGV[0]) {
   $corpus = $ARGV[0];
}

my %corpora = ();
my @fs = glob("$opts{'folder'}/input-*.txt");
foreach my $f (@fs) {
   my ($bn) = ($f =~ m@\Q$opts{'folder'}\E/input-(\S+?).txt@);
   $corpora{$bn} = 1;
}

if (defined $opts{'help'}) {
   print "regtest.pl\n";
   print "   --help, -h, -?  Show this help\n";
   print "   --binary, -b    Path to the binary to get regression test pipe from; defaults to the first found *.pl file in current working dir.\n";
   print "   --folder, -f    Path to the folder containing the input files; defaults to ./regtest/ relative to the binary's folder.\n";
   print "   --corpus, -c    Name of the corpus to run; defaults to all found corpora.\n";
   print "   --run, -r       Rerun the test before launching the server.\n";
   print "   --port, -p      Port to listen on; defaults to 3000.\n";
   print "   --step, -s      Step of the pipe to focus on; defaults to last step.\n";
   print "\n";
   print "Possible corpus names:\n\t".join("\n\t", sort(keys(%corpora)))."\n";
   exit(0);
}

if (!defined $opts{'binary'}) {
   print "Error: No usable binary found or passed via -b!\n";
   exit(1);
}
if (!(-e $opts{'binary'} && -x $opts{'binary'})) {
   print "Error: $opts{'binary'} is not executable!\n";
   exit(1);
}

if (!defined $opts{'folder'}) {
   print "Error: No usable folder found or passed via -f!\n";
   exit(1);
}
if (!(-d $opts{'folder'} && -d $opts{'folder'} && -w $opts{'folder'})) {
   print "Error: $opts{'folder'} is not a writable folder!\n";
   exit(1);
}

if (!%corpora) {
   print "Error: No input-*.txt files found in $opts{'folder'}!\n";
   exit(1);
}

print "Binary: $opts{'binary'}\n";
print "Folder: $opts{'folder'}\n";

if (!defined $opts{'step'}) {
   $opts{'step'} = '*';
}
print "Step: $opts{'step'}\n";

if (!defined $opts{'pagesize'}) {
   $opts{'pagesize'} = 250;
}
$opts{'pagesize'} = 0+$opts{'pagesize'};

if (!defined $opts{'corpus'}) {
   $opts{'corpus'} = '';
   print "Corpus: *\n";
}
if ($opts{'corpus'}) {
   if (!defined $corpora{$opts{'corpus'}}) {
      print "Error: $opts{'corpus'} is not a valid corpus!\n";
      exit(1);
   }
   %corpora = ($opts{'corpus'} => 1);
   print "Corpus: $opts{'corpus'}\n";
}

my $tmpdir = File::Spec->tmpdir();
my %state = ();
my @pages = ();

my $test_run = sub {
   my ($c) = @_;

   my $cmd = "$Bin/runner.pl -b '$opts{'binary'}' -f '$opts{'folder'}'";
   my $out = '';
   my $good = 0;
   foreach my $corp (keys(%corpora)) {
      if ($c && $corp ne $c) {
         next;
      }
      print "Running: $cmd -c '$corp'\n";
      my $stamp = time();
      $out .= `$cmd -c '$corp' 2>&1`;
      $out .= "\n\n";
      print "Run took ".(time() - $stamp)." seconds\n";
      $good = ($? == 0);
      if (!$good) {
         last;
      }
   }
   if ($good) {
      %state = ();
      @pages = ();
   }
   $out =~ s/\n\n+/\n/g;
   return ($good, trim($out));
};

if (defined $opts{'run'}) {
   my ($rv, $out) = $test_run->($opts{'corpus'});
   if (!$rv) {
      print "Error: Regression test run failed:\n";
      print $out;
      print "\n";
      exit(1);
   }
}

if (!defined $opts{'port'} || !$opts{'port'} || $opts{'port'} < 1) {
   $opts{'port'} = $ENV{'REGTEST_PORT'} || 3000;
}

use Plack::Runner;
use Plack::Builder;
use Plack::Request;
use JSON;

my $cb_load = sub {
   my ($p) = @_;

   if (%state) {
      my %nstate = (
         '_step' => $opts{'step'},
         '_count' => $state{'_count'},
         '_pages' => $state{'_pages'},
         '_page' => 0+$p,
         );

      my @page = @{$state{'_ordered'}}[($p*$opts{'pagesize'}) .. (($p+1)*$opts{'pagesize'})-1];

      for my $c (keys(%corpora)) {
         $nstate{$c}{'count'} = $state{$c}{'count'};
         @{$nstate{$c}{'add'}} = @{$state{$c}{'add'}};
         @{$nstate{$c}{'del'}} = @{$state{$c}{'del'}};

         %{$nstate{$c}{'inputs'}} = ();
         %{$nstate{$c}{'gold'}} = ();
         @{$nstate{$c}{'cmds'}} = ();

         my $np = scalar(@{$state{$c}{'cmds'}});
         for (my $p=0 ; $p<$np ; ++$p) {
            foreach my $o (('cmd', 'type', 'opt')) {
               $nstate{$c}{'cmds'}[$p]->{$o} = $state{$c}{'cmds'}[$p]->{$o};
            }
            foreach my $o (('output', 'trace', 'expect')) {
               %{$nstate{$c}{'cmds'}[$p]->{$o}} = ();
            }
         }

         foreach my $h (@page) {
            if (! defined $h) {
               last;
            }
            foreach my $o (('inputs', 'gold')) {
               if (defined $state{$c}{$o}->{$h}) {
                  $nstate{$c}{$o}->{$h} = $state{$c}{$o}->{$h};
               }
            }

            for (my $p=0 ; $p<$np ; ++$p) {
               foreach my $o (('output', 'trace', 'expect')) {
                  if (defined $state{$c}{'cmds'}[$p]->{$o}->{$h}) {
                     $nstate{$c}{'cmds'}[$p]->{$o}->{$h} = $state{$c}{'cmds'}[$p]->{$o}->{$h};
                  }
               }
            }
         }
      }

      return ('state' => \%nstate);
   }

   my %changes = (
      'changed_final' => [],
      'changed_any' => [],
      'unchanged' => [],
      );

   my %nstate = (
      '_step' => $opts{'step'},
      '_count' => 0,
      '_ordered' => [],
      );
   for my $c (keys(%corpora)) {
      my @cmds = ();
      my $pipe = file_get_contents("$opts{'folder'}/cmd-$c-raw");
      while ($pipe =~ /^(.+?) \| REGTEST_(\S+) (\S+)/) {
         my ($cmd, $type, $opt) = ($1, $2, $3);
         push(@cmds, {cmd => $cmd, type => lc($type), opt => $opt});
         $pipe =~ s/^(.+?) \| REGTEST_(\S+) (\S+)//;
         $pipe =~ s/^\s*\|\s*//;
      }

      @{$nstate{$c}{'cmds'}} = @cmds;

      $nstate{$c}{'inputs'} = load_output("$opts{'folder'}/output-$c-010.txt");
      $nstate{$c}{'gold'} = load_gold("$opts{'folder'}/gold-$c.txt");
      for my $p (@{$nstate{$c}{'cmds'}}) {
         $p->{'output'} = load_output("$opts{'folder'}/output-$c-$p->{'opt'}.txt");
         $p->{'trace'} = load_output("$opts{'folder'}/output-$c-$p->{'opt'}-trace.txt");
         if (! -s "$opts{'folder'}/expected-$c-$p->{'opt'}.txt" && -s "$opts{'folder'}/output-$c-$p->{'opt'}.txt") {
            print "$c-$p->{'opt'} was new\n";
            save_expected("$opts{'folder'}/expected-$c-$p->{'opt'}.txt", $p->{'output'});
         }
         $p->{'expect'} = load_output("$opts{'folder'}/expected-$c-$p->{'opt'}.txt");
      }

      $nstate{$c}{'count'} = scalar(keys(%{$nstate{$c}{'inputs'}}));
      $nstate{'_count'} += $nstate{$c}{'count'};

      my $ins = $nstate{$c}{'inputs'};
      my $outs = $nstate{$c}{'cmds'}[0]->{'expect'};
      my @add = ();
      my @del = ();
      foreach my $h (keys(%{$outs})) {
         if (! defined $ins->{$h}) {
            push(@del, [$h, $outs->{$h}->[1]]);
         }
      }
      foreach my $h (keys(%{$ins})) {
         if (! defined $outs->{$h}) {
            push(@add, [$h, $ins->{$h}->[0], $ins->{$h}->[1]]);
         }
      }

      @{$nstate{$c}{'add'}} = sort {$ins->{$a->[0]}->[0] <=> $ins->{$b->[0]}->[0]} @add;
      @{$nstate{$c}{'del'}} = sort(@del);

      my $lstep = @{$nstate{$c}{'cmds'}}[-1];
      foreach my $h (keys(%{$ins})) {
         if (! defined $outs->{$h}) {
            next;
         }

         my $changed = 0;
         foreach my $p (@{$nstate{$c}{'cmds'}}) {
            if (!defined $p->{'output'}->{$h}) {
               next;
            }
            if (!defined $p->{'expect'}->{$h}) {
               next;
            }
            if ($p->{'output'}->{$h}->[1] ne $p->{'expect'}->{$h}->[1]) {
               $changed = 1;
               last;
            }
         }

         if (! defined $lstep->{'output'}->{$h}) {
            print STDERR "Error: Cannot find output for $h - probably crash in the pipe!\n";
            next;
         }
         if (! defined $lstep->{'expect'}->{$h}) {
            print STDERR "Error: Cannot find expected for $h!\n";
            next;
         }

         if ($lstep->{'output'}->{$h}->[1] ne $lstep->{'expect'}->{$h}->[1]) {
            push(@{$changes{'changed_final'}}, $h);
         }
         elsif ($changed) {
            push(@{$changes{'changed_any'}}, $h);
         }
         else {
            push(@{$changes{'unchanged'}}, $h);
         }
      }
   }

   foreach my $t (('changed_final', 'changed_any', 'unchanged')) {
      push(@{$nstate{'_ordered'}}, @{$changes{$t}});
   }

   $nstate{'_pages'} = ceil($nstate{'_count'}/$opts{'pagesize'}),

   %state = %nstate;
   return __SUB__->(0);
};

my $cb_accept_nd = sub {
   my ($c) = @_;

   my @rhs = ();

   if (scalar(@{$state{$c}{'add'}}) || scalar(@{$state{$c}{'del'}})) {
      foreach my $p (@{$state{$c}{'cmds'}}) {
         my $output = load_output("$opts{'folder'}/output-$c-$p->{'opt'}.txt");
         my $expect = load_output("$opts{'folder'}/expected-$c-$p->{'opt'}.txt");
         foreach my $h (@{$state{$c}{'add'}}) {
            if (!defined $expect->{$h->[0]}) {
               $expect->{$h->[0]} = [0, $output->{$h->[0]}->[1]];
               push(@rhs, $h->[0]);
            }
         }
         foreach my $h (@{$state{$c}{'del'}}) {
            if (defined $expect->{$h->[0]}) {
               delete $expect->{$h->[0]};
               push(@rhs, $h->[0]);
            }
         }
         save_expected("$opts{'folder'}/expected-$c-$p->{'opt'}.txt", $expect);
      }
      @{$state{$c}{'add'}} = ();
      @{$state{$c}{'del'}} = ();
   }

   return ('c' => $c, 'hs' => \@rhs);
};

my $cb_accept = sub {
   my ($c, $step, $hst) = @_;

   my @hs = split(/;/, $hst);

   my %rv = $cb_accept_nd->($c);
   my @rhs = $rv{'hs'};

   foreach my $p (@{$state{$c}{'cmds'}}) {
      my $output = load_output("$opts{'folder'}/output-$c-$p->{'opt'}.txt");
      my $expect = load_output("$opts{'folder'}/expected-$c-$p->{'opt'}.txt");
      my $did = 0;
      foreach my $h (@hs) {
         if ($expect->{$h}->[1] ne $output->{$h}->[1]) {
            $p->{'expect'}->{$h} = $p->{'output'}->{$h};
            $expect->{$h}->[1] = $output->{$h}->[1];
            push(@rhs, $h);
            $did = 1;
         }
      }
      if ($did) {
         save_expected("$opts{'folder'}/expected-$c-$p->{'opt'}.txt", $expect);
      }
      if ($step && $step eq $p->{'opt'}) {
         last;
      }
   }

   return ('c' => $c, 'hs' => \@rhs);
};

my $cb_gold = sub {
   my ($c, $h, $gst) = @_;

   my $gold = load_gold("$opts{'folder'}/gold-$c.txt");
   @{$gold->{$h}->[1]} = @{decode_json($gst)};
   save_gold("$opts{'folder'}/gold-$c.txt", $gold);

   return ('c' => $c, 'hs' => [$h]);
};

my $handle_callback = sub {
   my ($req) = @_;

   if (!defined $req->parameters->{'a'}) {
      return [400, ['Content-Type' => 'text/plain'], ['Parameter a must be passed!']];
   }

   my %rv = ();
   my $status = 200;

   if ($req->parameters->{'a'} eq 'init') {
      $rv{'binary'} = $opts{'binary'};
      $rv{'folder'} = $opts{'folder'};
      $rv{'step'} = $opts{'step'};
      @{$rv{'corpora'}} = sort(keys(%corpora));
   }
   elsif ($req->parameters->{'a'} eq 'load') {
      eval { %rv = $cb_load->($req->parameters->{'p'}); };
      if ($@) {
         print STDERR "$@\n";
         $status = 500;
         %rv = ('error' => 'Current state is missing or invalid. You will need to run the regression test for all corpora.');
      }
   }
   elsif ($req->parameters->{'a'} eq 'run') {
      my ($good, $out);
      if (!defined $req->parameters->{'c'} || $req->parameters->{'c'} eq '*') {
         ($good, $out) = $test_run->();
      }
      else {
         ($good, $out) = $test_run->($req->parameters->{'c'});
      }
      $rv{'good'} = $good;
      $rv{'output'} = $out;
   }
   elsif ($req->parameters->{'a'} eq 'accept-nd') {
      eval { %rv = $cb_accept_nd->($req->parameters->{'c'}); };
      if ($@) {
         print STDERR "$@\n";
         $status = 500;
         %rv = ('error' => 'Failed to accept added/deleted.');
      }
   }
   elsif ($req->parameters->{'a'} eq 'accept') {
      eval { %rv = $cb_accept->($req->parameters->{'c'}, $req->parameters->{'s'}, $req->parameters->{'hs'}); };
      if ($@) {
         print STDERR "$@\n";
         $status = 500;
         %rv = ('error' => 'Failed to accept outputs.');
      }
   }
   elsif ($req->parameters->{'a'} eq 'gold') {
      eval { %rv = $cb_gold->($req->parameters->{'c'}, $req->parameters->{'h'}, $req->parameters->{'gs'}); };
      if ($@) {
         print STDERR "$@\n";
         $status = 500;
         %rv = ('error' => 'Failed to save gold.');
      }
   }

   $rv{'a'} = $req->parameters->{'a'};

   return [$status, ['Content-Type' => 'application/json'], [JSON->new->utf8(1)->pretty(1)->encode(\%rv)]];
};

my $app = sub {
   my $env = shift;
   my $req = Plack::Request->new($env);

   if (!$req->path_info || $req->path_info eq '/') {
      open my $fh, '<:raw', "$Bin/static/index.html" or die $!;
      return [200, ['Content-Type' => 'text/html'], $fh];
   }
   elsif ($req->path_info eq '/callback') {
      return $handle_callback->($req);
   }
   elsif ($req->path_info =~ m@^/local\.(.+)$@) {
      if (-s "$opts{'folder'}/regtest.$1") {
         open my $fh, '<:raw', "$opts{'folder'}/regtest.$1" or die $!;
         if ($1 eq 'js') {
            return [200, ['Content-Type' => 'application/javascript'], $fh];
         }
         elsif ($1 eq 'css') {
            return [200, ['Content-Type' => 'text/css'], $fh];
         }
         return [200, [], $fh];
      }
   }
   return [404, ['Content-Type' => 'text/plain; charset=UTF-8'], ['File not found!']];
};

my $url = $ENV{'REGTEST_URL'} || "http://localhost:$opts{'port'}/";
print "Open your browser and navigate to $url\n";

my $builder = Plack::Builder->new;
$builder->add_middleware('Deflater');
$builder->add_middleware('Static', path => qr{^/static/}, root => "$Bin/");
$app = $builder->wrap($app);

`rm -f /tmp/access-regtest-*.log`;

my $runner = Plack::Runner->new;
$runner->parse_options('--access-log', '/tmp/access-regtest-'.$$.'.log', '-o', 'localhost', '-p', $opts{'port'});
$runner->run($app);
