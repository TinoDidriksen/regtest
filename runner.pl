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
use POSIX;

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
   );

if (defined $opts{'binary'}) {
   if (!(-e $opts{'binary'} && -x $opts{'binary'})) {
      print "Error: $opts{'binary'} is not executable!\n";
      exit(1);
   }
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

if (defined $opts{'folder'}) {
   if (!(-e $opts{'folder'} && -d $opts{'folder'} && -w $opts{'folder'})) {
      print "Error: $opts{'folder'} is not a writable folder!\n";
      exit(1);
   }
}
else {
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

if (defined $opts{'help'}) {
   my @cns = ();
   my @fs = glob("$opts{'folder'}/input-*.txt");
   foreach my $f (@fs) {
      my ($bn) = ($f =~ m@\Q$opts{'folder'}\E/input-(\S+?).txt@);
      push(@cns, $bn);
   }

   print "analyse.pl\n";
   print "\t--help, -h, -?  Show this help\n";
   print "\t--binary, -b    Path to the binary to get regression test pipe from; defaults to the first found *.pl file in current working dir.\n";
   print "\t--folder, -f    Path to the folder containing the input files; defaults to ./regtest/ relative to the binary's folder.\n";
   print "\t--corpus, -c    Name of the corpus to run; defaults to all found corpora.\n";
   print "\n";
   print "Possible corpus names:\n\t".join("\n\t", @cns)."\n";
   exit(0);
}

$ENV{REGRESSION_TEST} = 1;

my $cmd_run_p = trim(`'$opts{'binary'}' --regtest`);
my $cmd_raw = trim(`'$opts{'binary'}' --regtest --raw`);

if ($cmd_run_p !~ / REGTEST_/ || $cmd_raw !~ / REGTEST_/) {
   print "Error: Binary did not return a usable regression test pipe!\n";
   exit(1);
}

my @fs = glob("$opts{'folder'}/input-*.txt");
foreach my $f (@fs) {
   my ($bn) = ($f =~ m@\Q$opts{'folder'}\E/input-(\S+?).txt@);

   if ($corpus && $bn !~ /^$corpus$/) {
      next;
   }

   print "Handling $bn ...\n";
   print "\tinput $f\n";
   `rm -rf '$opts{'folder'}/output-$bn-'*`;

   my $i = 0;
   my %uniq = ();
   my @sents = ();

   my $data = file_get_contents($f);
   $data =~ s@\x{feff}@@g; # Unicode BOM
   $data =~ s@<STREAMCMD:FLUSH>@@g;
   $data =~ s@[ \t]+\n@\n@g;
   $data =~ s@\r\n@\n@g;
   $data =~ s@\r@\n@g;

   my @ins = ();
   if ($data =~ m@(^|\n)<s[^>]*>(\n|$)@ && $data =~ m@\n"<[^\n]+>"@) {
      print "\tdelimiting by <s> tags\n";
      my @lns = split(/\n<\/s[^>]*>/, $data);
      foreach (@lns) {
         ++$i;
         s@(^|\n)<s[^>]*>@@g;
         s@\n\n+@\n\n@g;
         $_ = trim($_);
         if (!$_) {
            # Skip empty
            next;
         }
         push(@ins, [$i, $_]);
      }
   }
   else {
      print "\tdelimiting by lines\n";
      my @lns = split(/\n+/, $data);
      foreach (@lns) {
         ++$i;
         $_ =~ s/#[^\n]*//g;
         $_ = trim($_);
         $_ =~ s/\s\s+/ /g;
         $_ =~ s/\\n/\n/g;
         $_ =~ s/[ \t]+\n/\n/g;
         if (!$_ || /^</) {
            # Skip empty or commented lines
            next;
         }
         push(@ins, [$i, $_]);
      }
   }

   foreach (@ins) {
      my ($i, $s) = @$_;
      $_ = $s;
      utf8::encode($s); # sha1_base64() can't handle UTF-8 for some reason
      my $hash = sha1_base64($s);
      $hash =~ s/[^a-zA-Z0-9]/x/g;
      if (defined $uniq{$hash}) {
         # Skip duplicate inputs
         next;
      }
      $uniq{$hash} = 1;
      push(@sents, "<s$hash-$i>\n".$_."\n</s$hash-$i>\n\n<STREAMCMD:FLUSH>");
   }

   `rm -rf '$opts{'folder'}/cmd-$bn-'*`;

   @sents = sort(@sents);
   my $len = scalar @sents;
   for (my $i=0 ; $i<4 ; ++$i) {
      file_put_contents("$opts{'folder'}/output-$bn-010.txt.$i", join("\n\n", splice(@sents, 0, ceil($len/4))));

      my $cmd_run = $cmd_run_p;
      while ($cmd_run =~ / REGTEST_(\S+) (\S+)/) {
         my ($type,$opt) = ($1, $2);
         my $rpl = "| tee '$opts{'folder'}/output-$bn-$opt.txt.$i'";
         if ($type eq 'CG') {
            $rpl = "| cg-sort | tee '$opts{'folder'}/output-$bn-$opt-trace.txt.$i' | cg-untrace | cg-sort | tee '$opts{'folder'}/output-$bn-$opt.txt.$i'";
         }
         $cmd_run =~ s/\| REGTEST_\S+ \S+s*/$rpl/;
      }
      file_put_contents("$opts{'folder'}/cmd-$bn-run.$i", $cmd_run);
   }

   file_put_contents("$opts{'folder'}/cmd-$bn-raw", $cmd_raw);

   my $cmd_par = <<XCMD;
cat '$opts{'folder'}/output-$bn-010.txt.0' | bash '$opts{'folder'}/cmd-$bn-run.0' >'$opts{'folder'}/output-$bn.0' 2>'$opts{'folder'}/error-$bn' &
cat '$opts{'folder'}/output-$bn-010.txt.1' | bash '$opts{'folder'}/cmd-$bn-run.1' >'$opts{'folder'}/output-$bn.1' 2>'$opts{'folder'}/error-$bn' &
cat '$opts{'folder'}/output-$bn-010.txt.2' | bash '$opts{'folder'}/cmd-$bn-run.2' >'$opts{'folder'}/output-$bn.2' 2>'$opts{'folder'}/error-$bn' &
cat '$opts{'folder'}/output-$bn-010.txt.3' | bash '$opts{'folder'}/cmd-$bn-run.3' >'$opts{'folder'}/output-$bn.3' 2>'$opts{'folder'}/error-$bn' &

for job in `jobs -p`
do
	wait \$job
done

cat '$opts{'folder'}/output-$bn-010.txt.0' '$opts{'folder'}/output-$bn-010.txt.1' '$opts{'folder'}/output-$bn-010.txt.2' '$opts{'folder'}/output-$bn-010.txt.3' > '$opts{'folder'}/output-$bn-010.txt'

cat '$opts{'folder'}/output-$bn.0' '$opts{'folder'}/output-$bn.1' '$opts{'folder'}/output-$bn.2' '$opts{'folder'}/output-$bn.3'

rm -rf '$opts{'folder'}/output-$bn.'*
rm -rf '$opts{'folder'}/output-$bn-010.txt.'*

XCMD
   file_put_contents("$opts{'folder'}/cmd-$bn-run-parallel", $cmd_par);
   `nice -n20 bash '$opts{'folder'}/cmd-$bn-run-parallel'`;
   print "\n";

   for (my $i=0 ; $i<4 ; ++$i) {
      my $cmd_run = $cmd_run_p;
      while ($cmd_run =~ / REGTEST_(\S+) (\S+)/g) {
         my ($type,$opt) = ($1, $2);
         `cat '$opts{'folder'}/output-$bn-$opt.txt.$i' >> '$opts{'folder'}/output-$bn-$opt.txt'`;
         if ($type eq 'CG') {
            `cat '$opts{'folder'}/output-$bn-$opt-trace.txt.$i' >> '$opts{'folder'}/output-$bn-$opt-trace.txt'`;
         }
         unlink("$opts{'folder'}/output-$bn-$opt.txt.$i");
         unlink("$opts{'folder'}/output-$bn-$opt-trace.txt.$i");
      }
   }
}
