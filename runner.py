#!/usr/bin/env python3
import argparse
import base64
import glob
import hashlib
import json5
import math
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import Helpers

def hash(s):
    return base64.b64encode(hashlib.sha1(s.encode('UTF-8')).digest(), b'xx').decode('UTF-8').rstrip('=')

parser = argparse.ArgumentParser(prog='runner.py', description='Regression test runner')
#parser.add_argument('-l', '--list', action='store_true', help='List usable tests and corpora')
parser.add_argument('-P', '--proc', action='store', help='Number of parallel processes; defaults to max(3,num_cores/4)', default=int(max(3, os.cpu_count()/4)))
parser.add_argument('-f', '--folder', action='store', help='Folder with regtest.json5; defaults to looking in ./, regtest/, or test/', default='')
parser.add_argument('-c', '--corp', action='append', help='Restricts the test to the named corpora; can be given multiple times and/or pass a comma separated list', default=[])
parser.add_argument('-D', '--debug', action='store_true', help='Enable Python stack traces and other debugging', default=False)
parser.add_argument('test', nargs='?', help='Which test to run; defaults to first defined', default='')
args = parser.parse_args()

if not args.debug:
	sys.tracebacklimit = 0

root = Helpers.find_root(args.folder)

procs = int(args.proc)

timeout = Helpers.timeout()
timeout_sec = 1800 # Half an hour

config = Helpers.load_config(root)

# Determine which test to run
tkey, test = Helpers.resolve_test(config, args.test)

# Determine which corpora to run
corps = Helpers.resolve_corps(root, config, test, args.corp)

if os.path.exists(f'{root}/output/{tkey}/_tmp/lock'):
	pid = Path(f'{root}/output/{tkey}/_tmp/lock').read_text(encoding='UTF-8')
	ps = subprocess.run(['ps', '-p', pid], capture_output=True, encoding='UTF-8').stdout
	if re.search(rf'\n{pid}.*(python|runner)', ps):
		raise RuntimeError(f'{root}/output/{tkey}/_tmp/lock exists from PID {pid} - potential double-run! Remove _tmp folder or lock file if remnant from a crash.')
	else:
		print(f'Removing stale lock from PID {pid}')

shutil.rmtree(f'{root}/output/{tkey}/_tmp', ignore_errors=True)
os.makedirs(f'{root}/output/{tkey}/_tmp/', exist_ok=True)
Path(f'{root}/output/{tkey}/_tmp/lock').write_text(str(os.getpid()))

steps, _ = Helpers.resolve_steps(config, test)

pipe = ''
for p,s in steps.items():
	# Every step gets its own timeout watcher, to avoid runaway background processes
	pipe += f' | {timeout} {timeout_sec} {s["cmd"]}'
	if 'trace' in s:
		pipe += f' {s["trace"]} 2>{root}/output/{tkey}/_tmp/step-{p}.NNN.err | tee {root}/output/{tkey}/_tmp/step-{p}.trace.NNN'
	elif s['type'] == 'cg':
		pipe += f' --trace 2>{root}/output/{tkey}/_tmp/step-{p}.NNN.err | cg-sort | tee {root}/output/{tkey}/_tmp/step-{p}.trace.NNN | cg-untrace | cg-sort'
	else:
		pipe += f' 2>{root}/output/{tkey}/_tmp/step-{p}.NNN.err'
	pipe += f' | tee {root}/output/{tkey}/_tmp/step-{p}.NNN'
pipe = pipe.replace(' --trace --trace ', ' --trace ')
pipe = pipe.replace(' cg3-autobin.pl ', ' vislcg3 ')
pipe = pipe[3:]

inputs = {}
uniq_inputs = {}
for c,f in corps.items():
	inputs[c] = {}
	with open(f, 'r', encoding='UTF-8') as fd:
		ln = 0
		while l := fd.readline():
			ln += 1
			start = ln
			l = l.rstrip()

			# Read in <s>...</s> segments as a literal block
			if l.startswith('<s ') or l.startswith('<s>'):
				l += '\n'
				while e := fd.readline():
					ln += 1
					l += e
					if e.startswith('</s>'):
						break
				l = re.sub(r'[ \t]+\n', '\n', l)
				l = re.sub(r'\n\n\n+', '\n\n', l)
				l = l.strip()
			else:
				l = re.sub(r'#.*', '', l) # Strip comments
				l = re.sub(r'\s\s+', ' ', l)
				l = re.sub(r'\\n', '\n', l) # Convert literal \n to newline
				l = re.sub(r'[ \t]+\n', '\n', l)
				l = l.strip()
				# Other tag-looking lines are skipped (backwards compat)
				if l.startswith('<'):
					continue

			if not l or l == '':
				continue

			h = hash(l)
			if h not in inputs[c]:
				inputs[c][h] = start
			if h not in uniq_inputs:
				uniq_inputs[h] = l

# Just in case there are fewer inputs than CPU cores
procs = min(procs, len(uniq_inputs))

for c,hs in inputs.items():
	with open(f'{root}/output/{tkey}/corp-{c}.ids', 'w', encoding='UTF-8') as fd:
		for k,v in hs.items():
			fd.write(f'{k}\t{v}\n')

fds = []
for i in range(procs):
	fds.append(open(f'{root}/output/{tkey}/_tmp/input.{i}', 'w', encoding='UTF-8'))

chunk = int(len(uniq_inputs)/procs)+1
for i,k in enumerate(sorted(uniq_inputs.keys())):
	t = uniq_inputs[k]
	if t.startswith('<s'):
		t = re.sub(r'^<s', f'<s id="{k}"', t)
	else:
		t = f'<s id="{k}">\n{t}\n</s>'
	fds[min(int(math.floor(i/chunk)), procs-1)].write(f'{t}\n\n<STREAMCMD:FLUSH>\n\n')

bash = ''
for e in test['env']:
	bash += f'export "{e}"\n'

outs = []
for i in range(procs):
	fds[i].close()
	np = re.sub(r'\.NNN', f'.{i}', pipe)
	Path(f'{root}/output/{tkey}/_tmp/sh.{i}').write_text(np)
	# Race prevention: Create and open the output files for reading, so the script can append to existing files
	Path(f'{root}/output/{tkey}/_tmp/out.{i}').touch()
	outs.append(open(f'{root}/output/{tkey}/_tmp/out.{i}', 'r', encoding='UTF-8'))
	bash += f'cat {root}/output/{tkey}/_tmp/input.{i} | bash {root}/output/{tkey}/_tmp/sh.{i} >>{root}/output/{tkey}/_tmp/out.{i} 2>{root}/output/{tkey}/_tmp/err.{i} &\n'

bash += f'''
for job in `jobs -p`
do
	#echo "Waiting for $job"
	wait $job
done

echo "Done" > {root}/output/{tkey}/_tmp/done
'''

Path(f'{root}/output/{tkey}/_tmp/sh').write_text(bash)
seen = set()
proc = subprocess.Popen([timeout, str(timeout_sec), 'nice', '-n20', 'bash', f'{root}/output/{tkey}/_tmp/sh'])

print('Running: %s -P %s -f %s -c %s %s' % (os.path.relpath(__file__), str(procs), root, ','.join(sorted(corps.keys())), tkey))
print('Progress: 0%', end='\r', flush=True)
while not proc.poll():
	time.sleep(1)
	did = False
	for i in range(procs):
		while l := outs[i].readline():
			if m := re.search(r'^<s id="([^"]+)"', l):
				seen.add(m[1])
				did = True
	if did:
		print('Progress: {}%'.format(int(len(seen) / len(uniq_inputs) * 100)), end='\r', flush=True)

	if os.path.exists(f'{root}/output/{tkey}/_tmp/done'):
		break

print('Progress: 100%', end='\r', flush=True)

for i in range(procs):
	outs[i].close()

if len(seen) != len(uniq_inputs):
	# Check again, because sometimes the above loop skips an ID
	seen = set()
	for i in range(procs):
		seen |= set(re.findall(r'(?:^|\n)<s id="([^"]+)"', Path(f'{root}/output/{tkey}/_tmp/out.{i}').read_text()))
	if len(seen) != len(uniq_inputs):
		missing = set(uniq_inputs.keys()) - set(seen)
		print('Warning: Missing outputs - got {0} of {1}! Example missing ID: {2}'.format(len(seen), len(uniq_inputs), list(missing)[0]))

for c in inputs.keys():
	shutil.rmtree(f'{root}/output/{tkey}/{c}', ignore_errors=True)
	os.makedirs(f'{root}/output/{tkey}/{c}/', exist_ok=True)

def split_to_corps(s, f):
	global procs, inputs, root, test

	cfs = {}
	for c in inputs.keys():
		cfs[c] = open(f'{root}/output/{tkey}/{c}/output-{c}-{s}.txt', 'w')

	for i in range(procs):
		with open(f'{f}.{i}', 'r', encoding='UTF-8') as fd:
			while l := fd.readline():
				if l.startswith('<s '):
					while e := fd.readline():
						l += e
						if e.startswith('</s>'):
							break
					l = re.sub(r'[ \t]+\n', '\n', l)
					l = re.sub(r'\n\n\n+', '\n\n', l)
					m = re.search(r'^<s id="([^"]+)"', l)
					for c in inputs.keys():
						if m[1] in inputs[c]:
							cfs[c].write(l + '\n')

	for c in inputs.keys():
		cfs[c].close()

split_to_corps('010', f'{root}/output/{tkey}/_tmp/input')

for p,s in steps.items():
	t = 'auto'
	if 'type' in s:
		t = s['type']
	if 'trace' in s or t == 'cg':
		split_to_corps(f'{p}-trace', f'{root}/output/{tkey}/_tmp/step-{p}.trace')
	split_to_corps(p, f'{root}/output/{tkey}/_tmp/step-{p}')

os.remove(f'{root}/output/{tkey}/_tmp/lock')
print('Done           ')
