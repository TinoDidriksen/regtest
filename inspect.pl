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
   'binary|b=s',
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

my $cmd = `$opts{binary} --regtest --cmd`;
chomp($cmd);
if (!$cmd) {
   die "Could not call '$opts{binary} --regtest --cmd'!\n";
}

my @steps = ();
my $tmpdir = File::Spec->tmpdir();
while ($cmd =~ / REGTEST_(\S+) (\S+)/) {
   my ($type,$opt) = ($1, $2);
   push(@steps, $opt);
   my $rpl = "| tee '$tmpdir/ui-out-$opt.txt'";
   if ($type eq 'CG') {
      push(@steps, "$opt-trace");
      $rpl = "| cg-sort | tee '$tmpdir/ui-out-$opt-trace.txt' | cg-untrace | cg-sort | tee '$tmpdir/ui-out-$opt.txt'";
   }
   $cmd =~ s/\| REGTEST_\S+ \S+s*/$rpl/;
}

if (!defined $opts{'port'} || !$opts{'port'} || $opts{'port'} < 1) {
   $opts{'port'} = $ENV{'REGTEST_PORT'} || 3500;
}

use Plack::Runner;
use Plack::Builder;
use Plack::Request;
use JSON;

my $do_inspect = sub {
   my ($t) = @_;
   my %rv = ();

   utf8::decode($t);
   file_put_contents("$tmpdir/ui-in.txt", $t);
   file_put_contents("$tmpdir/ui-cmd.txt", $cmd);
   `cat $tmpdir/ui-in.txt | $cmd >/dev/null 2>$tmpdir/ui-err.txt`;
   for my $step (@steps) {
      my $out = file_get_contents("$tmpdir/ui-out-$step.txt");
      $rv{$step} = $out;
      if (-s "$tmpdir/ui-out-$step-trace.txt") {
         my $out = file_get_contents("$tmpdir/ui-out-$step-trace.txt");
         $rv{"$step-trace"} = $out;
      }
   }

   return \%rv;
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
      $rv{'steps'} = \@steps;
   }
   elsif ($req->parameters->{'a'} eq 'inspect') {
      if (!defined $req->parameters->{'t'}) {
         return [400, ['Content-Type' => 'text/plain'], ['Parameter t must be passed!']];
      }
      $rv{'output'} = $do_inspect->($req->parameters->{'t'});
   }

   $rv{'a'} = $req->parameters->{'a'};

   return [$status, ['Content-Type' => 'application/json'], [JSON->new->utf8(1)->pretty(1)->encode(\%rv)]];
};

my $app = sub {
   my $env = shift;
   my $req = Plack::Request->new($env);

   if (!$req->path_info || $req->path_info eq '/') {
      open my $fh, '<:raw', "$Bin/static/inspect.html" or die $!;
      return [200, ['Content-Type' => 'text/html; charset=UTF-8'], $fh];
   }
   elsif ($req->path_info eq '/callback') {
      return $handle_callback->($req);
   }
   return [404, ['Content-Type' => 'text/plain; charset=UTF-8'], ['File not found!']];
};

my $url = $ENV{'REGTEST_URL'} || "http://localhost:$opts{'port'}/";
print "Open your browser and navigate to $url\n";

my $builder = Plack::Builder->new;
$builder->add_middleware('Deflater');
$builder->add_middleware('Static', path => qr{^/static/}, root => "$Bin/");
$app = $builder->wrap($app);

`rm -f /tmp/access-ui-*.log`;

my $runner = Plack::Runner->new;
$runner->parse_options('--access-log', '/tmp/access-ui-'.$$.'.log', '-o', 'localhost', '-p', $opts{'port'});
$runner->run($app);
