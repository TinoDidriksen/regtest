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
use feature 'unicode_strings';
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

if (defined $opts{'binary'}) {
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
   my ($bn) = ($f =~ m@\Q$opts{'folder'}\E/input-(\w+).txt@);
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
   $opts{'port'} = 3000;
}

use Plack::Runner;
use Plack::Builder;
use Plack::Request;
use JSON;

my $cb_load = sub {
   if (%state) {
      return ('state' => \%state);
   }

   my %nstate = ();
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
      for my $p (@{$nstate{$c}{'cmds'}}) {
         $p->{'output'} = load_output("$opts{'folder'}/output-$c-$p->{'opt'}.txt");
         $p->{'trace'} = load_output("$opts{'folder'}/output-$c-$p->{'opt'}-trace.txt");
         if (! -s "$opts{'folder'}/expected-$c-$p->{'opt'}.txt" && -s "$opts{'folder'}/output-$c-$p->{'opt'}.txt") {
            print "$c-$p->{'opt'} was new\n";
            save_expected("$opts{'folder'}/expected-$c-$p->{'opt'}.txt", $p->{'output'});
         }
         $p->{'expect'} = load_output("$opts{'folder'}/expected-$c-$p->{'opt'}.txt");
      }

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

      my @to_del = ();
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

         if (!$changed) {
            push(@to_del, $h);
         }
      }

      foreach my $h (@to_del) {
         delete $nstate{$c}{'inputs'}->{'inputs'}->{$h};
         foreach my $p (@{$nstate{$c}{'cmds'}}) {
            delete $p->{'output'}->{$h};
            delete $p->{'trace'}->{$h};
            delete $p->{'expect'}->{$h};
         }
      }
   }

   %state = %nstate;
   return ('state' => \%state);
};

my $cb_accept = sub {
   my ($c, $hst) = @_;

   my @hs = split(/;/, $hst);
   my @rhs = ();

   foreach my $p (@{$state{$c}{'cmds'}}) {
      my $output = load_output("$opts{'folder'}/output-$c-$p->{'opt'}.txt");
      my $expect = load_output("$opts{'folder'}/expected-$c-$p->{'opt'}.txt");
      my $did = 0;
      foreach my $h (@{$state{$c}{'add'}}) {
         if (!defined $expect->{$h->[0]}) {
            $expect->{$h->[0]} = [0, $output->{$h->[0]}->[1]];
            push(@rhs, $h->[0]);
            $did = 1;
         }
      }
      foreach my $h (@{$state{$c}{'del'}}) {
         if (defined $expect->{$h->[0]}) {
            delete $expect->{$h->[0]};
            push(@rhs, $h->[0]);
            $did = 1;
         }
      }
      foreach my $h (@hs) {
         if ($expect->{$h}->[1] ne $output->{$h}->[1]) {
            delete $p->{'output'}->{$h};
            delete $p->{'trace'}->{$h};
            delete $p->{'expect'}->{$h};
            $expect->{$h}->[1] = $output->{$h}->[1];
            push(@rhs, $h);
            $did = 1;
         }
      }
      if ($did) {
         print "Writing $opts{'folder'}/expected-$c-$p->{'opt'}.txt\n";
         save_expected("$opts{'folder'}/expected-$c-$p->{'opt'}.txt", $expect);
      }
   }

   @{$state{$c}{'add'}} = ();
   @{$state{$c}{'del'}} = ();

   return ('c' => $c, 'hs' => \@rhs);
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
      @{$rv{'corpora'}} = sort(keys(%corpora));
   }
   elsif ($req->parameters->{'a'} eq 'load') {
      eval { %rv = $cb_load->(); };
      if ($@) {
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
   elsif ($req->parameters->{'a'} eq 'accept') {
      eval { %rv = $cb_accept->($req->parameters->{'c'}, $req->parameters->{'hs'}); };
      if ($@) {
         $status = 500;
         %rv = ('error' => 'Failed to accept outputs.');
      }
   }

   $rv{'a'} = $req->parameters->{'a'};

   return [$status, ['Content-Type' => 'application/json'], [encode_json(\%rv)]];
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
   return [404, ['Content-Type' => 'text/plain; charset=UTF-8'], ['File not found!']];
};

my $builder = Plack::Builder->new;
$builder->add_middleware('Deflater');
$builder->add_middleware('Static', path => qr{^/static/}, root => "$Bin/");
$app = $builder->wrap($app);

my $runner = Plack::Runner->new;
$runner->parse_options('--access-log', '/tmp/access-regtest.log', '-o', 'localhost', '-p', $opts{'port'});
$runner->run($app);
