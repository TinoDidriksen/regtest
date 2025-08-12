import glob
import html
import json5
import os
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

def timeout():
	timeout = shutil.which('timeout')
	if not timeout:
		timeout = shutil.which('gtimeout')
	if not timeout:
		raise RuntimeError('Utility "timeout" or "gtimeout" not found - install coreutils!')
	return timeout

def find_root(folder=None):
	root = '.'
	if folder:
		root = folder
		if not os.path.exists(f'{root}/regtest.json5'):
			raise RuntimeError(f'regtest.json5 not found in {root}!')
	elif os.path.exists('regtest.json5'):
		pass
	elif os.path.exists('regtest/regtest.json5'):
		root = 'regtest'
	elif os.path.exists('test/regtest.json5'):
		root = 'test'
	else:
		raise RuntimeError('regtest.json5 not found in ./, regtest/, or test/!')
	return root

def load_config(root='.'):
	config = json5.loads(Path(f'{root}/regtest.json5').read_text(encoding='UTF-8'))

	if 'tests' not in config:
		raise RuntimeError('No tests defined in config!')
	if 'pipes' not in config:
		raise RuntimeError('No pipes defined in config!')
	if 'corpora' not in config:
		raise RuntimeError('No corpora defined in config!')

	# Set defaults
	defaults = {
		'pipe': next(iter(config['pipes'])),
		'test': next(iter(config['tests'])),
		'corpora': [next(iter(config['corpora']))],
		'env': [],
		'stream_prefix': '',
		'gold': False,
		'git': True,
		'desc': '',
		'grep': '',
	}
	if 'defaults' not in config:
		config['defaults'] = defaults
	for k,v in defaults.items():
		if k not in config['defaults']:
			config['defaults'][k] = v

	for tkey in config['tests']:
		config['tests'][tkey]['test'] = tkey
		# Fill in missing test details from defaults
		for k,v in config['defaults'].items():
			if k not in config['tests'][tkey]:
				config['tests'][tkey][k] = v
		# Turn single corpus into list
		if isinstance(config['tests'][tkey], str):
			config['tests'][tkey] = [config['tests'][tkey]]

	return config

def resolve_test(config, arg=None):
	tkey = config['defaults']['test']
	if arg:
		tkey = arg
	if tkey not in config['tests']:
		raise RuntimeError(f'Test "{tkey}" is not defined!')
	test = config['tests'][tkey]
	return tkey, test

def resolve_corps(root, config, test, arg=None):
	acorps = set()
	if arg:
		for acs in arg:
			acorps |= set(acs.split(','))

	corps = {}
	for tc in test['corpora']:
		for cc in config['corpora'][tc]:
			fs = glob.glob(f'{root}/corpora/{cc}.txt')
			for p in fs:
				c = os.path.basename(p)[0:-4]
				if not acorps or c in acorps:
					corps[c] = p
			fs = glob.glob(f'{root}/local/{cc}.txt')
			for p in fs:
				c = os.path.basename(p)[0:-4]
				if not acorps or c in acorps:
					corps[c] = p

	return dict(sorted(corps.items()))

def resolve_steps(config, test):
	# If the pipe is a string, call it to determine steps and pipe
	if isinstance(config['pipes'][test['pipe']], str):
		p = subprocess.run(config['pipes'][test['pipe']], shell=True, capture_output=True, encoding='UTF-8')
		config['pipes'][test['pipe']] = {}
		steps = re.split(r'\s*\|\s*REGTEST_(\S+)\s+(\S+)\s*\|?\s*', p.stdout)
		for i in range(0, len(steps), 3):
			if i+2 < len(steps):
				config['pipes'][test['pipe']][steps[i+2]] = {'cmd': steps[i], 'type': steps[i+1].lower()}

	if isinstance(config['pipes'][test['pipe']], list):
		ns = {}
		for s in config['pipes'][test['pipe']]:
			ns[s] = config['steps'][s]
		config['pipes'][test['pipe']] = ns

	all_steps = []
	for k,s in config['pipes'][test['pipe']].items():
		if k == 'input' or k == 'gold' or k.endswith('-trace'):
			raise RuntimeError(f'Step name may not be "input" or "gold" or end in "-trace"!')
		if 'type' not in s:
			config['pipes'][test['pipe']][k]['type'] = 'auto'

		all_steps.append(k)
		if s['type'] == 'cg' or 'trace' in s:
			all_steps.append(f'{k}-trace')

	return config['pipes'][test['pipe']], all_steps

def load_output(fname):
	rv = {}
	with open(fname, 'r', encoding='UTF-8') as fd:
		while l := fd.readline():
			if (m := re.match(r'^<s([a-zA-Z0-9]+)-\d+>\n', l)) or l.startswith('<s id="'):
				seg = ''
				while e := fd.readline():
					if e.startswith('</s>'):
						break
					seg += e

				seg = re.sub(r'[ \t]+\n', '\n', seg)
				seg = re.sub(r'\n\n\n+', '\n\n', seg)
				seg = seg.strip()

				if m:
					h = m[1]
					rv[h] = {'t': seg, 'a': {}}
				else:
					h = re.search(r' id="([^"]+)"', l)[1]
					l = re.sub(r' id="([^"]+)"', '', l)
					tag = ET.fromstring(l+'</s>')
					rv[h] = {'t': seg, 'a': tag.attrib}
	return rv

def load_gold(fname):
	rv = {}
	with open(fname, 'r', encoding='UTF-8') as fd:
		while l := fd.readline():
			if (m := re.match(r'^<s([a-zA-Z0-9]+)-\d+>\n', l)) or l.startswith('<s id="'):
				seg = ''
				while e := fd.readline():
					if e.startswith('</s>'):
						break
					seg += e

				h = ''
				if m:
					h = m[1]
				else:
					h = re.search(r' id="([^"]+)"', l)[1]

				rv[h] = set()
				seg = re.sub(r'(^|\n)<gold>(\n|$)', '\n', seg)
				seg = seg.split('\n</gold>')
				for s in seg:
					s = re.sub(r'[ \t]+\n', '\n', s)
					s = re.sub(r'\n\n\n+', '\n\n', s)
					s = s.strip()
					if s:
						rv[h].add(s)
				rv[h] = sorted(list(rv[h]))
	return rv

def save_expected(root, test, c, state):
	tkey = test['test']
	data = {}
	for s in ['changed_final', 'changed_any', 'golden', 'unchanged']:
		for k,v in state[s].items():
			if c in v['c'] and v['c'][c] != 0:
				data[k] = v

	local = ''
	if '/local/' in test['all_corpora'][c]:
		local = '/local'

	data = dict(sorted(data.items()))
	os.makedirs(f'{root}{local}/expected/{tkey}/{c}/', exist_ok=True)

	for i,k in enumerate(test['all_steps']):
		if k.endswith('-trace'):
			continue
		out = ''
		for id,v in data.items():
			t = v['e'][i]
			a = ''
			for ak,av in v['a'].items():
				av = html.escape(av, quote=True)
				a += f' {ak}="{av}"'
			out += f'<s id="{id}"{a}>\n{t}\n</s>\n\n'
		fn = f'{root}{local}/expected/{tkey}/{c}/expected-{c}-{k}.txt'
		Path(fn).write_text(out)

def save_gold(root, test, c, state):
	tkey = test['test']
	data = {}
	for s in ['changed_final', 'changed_any', 'golden', 'unchanged']:
		for k,v in state[s].items():
			if not v['g']:
				continue
			if c in v['c']:
				data[k] = v

	local = ''
	if '/local/' in test['all_corpora'][c]:
		local = '/local'

	data = dict(sorted(data.items()))
	os.makedirs(f'{root}{local}/expected/{tkey}/{c}/', exist_ok=True)

	out = ''
	for id,v in data.items():
		t = '\n</gold>\n<gold>\n'.join(v['g'])
		out += f'<s id="{id}">\n<gold>\n{t}\n</gold>\n</s>\n\n'
	fn = f'{root}{local}/expected/{tkey}/{c}/gold-{c}.txt'

	if out:
		Path(fn).write_text(out)
	else:
		try:
			os.remove(fn)
		except Exception as e:
			pass
