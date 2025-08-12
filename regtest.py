#!/usr/bin/env python3
import argparse
import glob
import http.server
import json
import math
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import traceback
import time
import urllib.parse
import urllib.request
import zlib
from collections import defaultdict
from functools import partial
from http import HTTPStatus
from pathlib import Path

import Helpers

parser = argparse.ArgumentParser(prog='regtest.py', description='Regression test interface')
parser.add_argument('-P', '--proc', action='store', help='Number of parallel processes; defaults to max(3,num_cores/4)', default=int(max(3, os.cpu_count()/4)))
parser.add_argument('-f', '--folder', action='store', help='Folder with regtest.json5; defaults to looking in ./, regtest/, or test/', default='')
parser.add_argument('-c', '--corp', action='append', help='Restricts the test to the named corpora; can be given multiple times and/or pass a comma separated list', default=[])
parser.add_argument('-p', '--port', action='store', help='Port to listen on; default to 3000', default=3000)
parser.add_argument('-r', '--run', action='store_true', help='Run the test before starting the interface server', default=False)
parser.add_argument('-s', '--step', action='store', help='Which step to focus on at launch; default depends on result state', default='')
parser.add_argument('-g', '--gold', action='store', help='Whether to only show entries with specific gold status (*, w, u, m); defaults to ignoring gold', default='*')
parser.add_argument('-z', '--pagesize', action='store', help='Page size; default to 250', default=250)
parser.add_argument('-v', '--view', action='store', help='Which tool to show (regtest or inspect); defaults to regtest', default='regtest')
parser.add_argument('-D', '--debug', action='store_true', help='Enable Python stack traces and other debugging', default=False)
parser.add_argument('test', nargs='?', help='Which test to run; defaults to first defined', default='')
cmdargs = parser.parse_args()

if not cmdargs.debug:
	sys.tracebacklimit = 0

g_nonce = secrets.token_urlsafe(8)
g_dir = os.path.dirname(os.path.abspath(__file__))
g_procs = int(cmdargs.proc)
g_root = Helpers.find_root(cmdargs.folder)
g_config = Helpers.load_config(g_root)
g_tkey, g_test = Helpers.resolve_test(g_config, cmdargs.test)
g_corps = Helpers.resolve_corps(g_root, g_config, g_test, cmdargs.corp)

timeout = Helpers.timeout()
timeout_sec = 1800 # Half an hour

Tests = {}
Tests[g_tkey] = g_test

Locks = {}
Locks[g_tkey] = threading.Lock()

State = defaultdict(lambda: {
	'corps': {},
	'added': {},
	'deleted': {},
	'missing': {},
	'changed_final': {},
	'changed_any': {},
	'golden': {},
	'unchanged': {},
	})

def test_run(test, corps=[]):
	tkey = test['test']

	if not len(corps) or corps[0] == '' or corps[0] == '*':
		corps = list(test['all_corpora'].keys())

	cmd = [f'{g_dir}/runner.py', '-P', str(g_procs), '-f', g_root, '-c', ','.join(corps), tkey]
	#print('Running %s' % (' '.join(cmd)))
	start = time.time()
	good = False
	try:
		run = subprocess.run(cmd, timeout=1800, check=True)
		good = True
		if tkey in State:
			del State[tkey]
	except Exception as e:
		traceback.print_exception(e)
	print('Run took %.2f seconds' % (time.time() - start))

	return good, ' '.join(cmd)

def cb_load(test, corps=[], gold='*', page=0, pagesize=250):
	tkey = test['test']
	state = State[tkey]
	if not gold or gold == '':
		gold = '*'

	if not len(corps) or corps[0] == '' or corps[0] == '*':
		corps = list(test['all_corpora'].keys())

	data = defaultdict(lambda: {
		'h': '',
		'i': '',
		'o': ['']*len(test['all_steps']),
		'e': ['']*len(test['all_steps']),
		'g': [],
		'gs': '*',
		'c': {},
		})
	needs_cleanup = False

	for s in ['changed_final', 'changed_any', 'golden', 'unchanged']:
		for k,v in state[s].items():
			data[k] = v

	greps = set()

	for c in corps:
		if c in state['corps']:
			continue

		local = ''
		if '/local/' in test['all_corpora'][c]:
			local = '/local'

		print(f'Loading {c}')

		ids = {}
		with open(f'{g_root}/output/{tkey}/corp-{c}.ids', 'r') as fd:
			while l := fd.readline():
				l = l.strip().split('\t')
				ids[l[0]] = l[1]
		state['corps'][c] = ids

		ins = Helpers.load_output(f'{g_root}/output/{tkey}/{c}/output-{c}-010.txt')
		for id,e in ins.items():
			data[id]['c'][c] = ids[id]
			data[id]['h'] = id
			data[id]['i'] = e['t']
			data[id]['a'] = e['a']

		for i,k in enumerate(test['all_steps']):
			outs = Helpers.load_output(f'{g_root}/output/{tkey}/{c}/output-{c}-{k}.txt')
			for id,e in outs.items():
				data[id]['o'][i] = e['t']
				if test['grep'] and re.search(test['grep'], e['t']):
					greps.add(id)

			if k.endswith('-trace'):
				continue

			if not os.path.exists(f'{g_root}{local}/expected/{tkey}/{c}/expected-{c}-{k}.txt'):
				os.makedirs(f'{g_root}{local}/expected/{tkey}/{c}/', exist_ok=True)
				shutil.copy2(f'{g_root}/output/{tkey}/{c}/output-{c}-{k}.txt', f'{g_root}{local}/expected/{tkey}/{c}/expected-{c}-{k}.txt')
				print(f'{c}-{k} was new - copied output to expected')
				needs_cleanup = True

			exps = Helpers.load_output(f'{g_root}{local}/expected/{tkey}/{c}/expected-{c}-{k}.txt')
			for id,e in exps.items():
				data[id]['e'][i] = e['t']
				if test['grep'] and re.search(test['grep'], e['t']):
					greps.add(id)
				if i == 0 and not data[id]['i']:
					data[id]['c'][c] = 0
					data[id]['h'] = id
					data[id]['a'] = e['a']
					state['deleted'][id] = data[id]
				if i == len(test['all_steps'])-1 and not data[id]['o'][i] and id not in state['deleted']:
					state['missing'][id] = data[id]

		if os.path.exists(f'{g_root}{local}/expected/{tkey}/{c}/gold-{c}.txt'):
			golds = Helpers.load_gold(f'{g_root}{local}/expected/{tkey}/{c}/gold-{c}.txt')
			for id,e in golds.items():
				if id in data:
					data[id]['g'] = e

		for id in ids.keys():
			if not data[id]['e'][0]:
				state['added'][id] = data[id]
				continue
			if not data[id]['o'][-1]:
				continue
			if not data[id]['g']:
				data[id]['gs'] = 'w'

			change = 0
			for i in range(len(data[id]['o'])):
				if data[id]['e'][i] and data[id]['o'][i] != data[id]['e'][i]:
					change = i+1

			if data[id]['g']:
				if data[id]['o'][-1] in set(data[id]['g']):
					data[id]['gs'] = 'm'
					state['golden'][id] = data[id]
					continue
				else:
					data[id]['gs'] = 'u'

			if change == len(data[id]['o']):
				state['changed_final'][id] = data[id]
			elif change:
				state['changed_any'][id] = data[id]
			else:
				state['unchanged'][id] = data[id]

	if greps:
		greps = set(data.keys()) - greps
		for id in greps:
			if id in data:
				del data[id]
			for s in ['added', 'deleted', 'missing', 'changed_final', 'changed_any', 'golden', 'unchanged']:
				if id in state[s]:
					del state[s][id]
		if needs_cleanup:
			for c in state['corps'].keys():
				Helpers.save_expected(g_root, test, c, state)

	rv = {
		'corpora': corps,
		'counts': {
			'total': len(data),
			'changed_final': len(state['changed_final']),
			'changed_any': len(state['changed_any']),
			'golden': len(state['golden']),
			'unchanged': len(state['unchanged']),
			'page': page,
			'pages': math.ceil(len(data) / pagesize),
		},
		'results': {
			'added': [],
			'deleted': [],
			'missing': [],
			'changed_final': [],
			'changed_any': [],
			'golden': [],
			'unchanged': [],
		},
	}

	for s in ['added', 'deleted', 'missing']:
		for k,v in state[s].items():
			rv['results'][s].append(v)

	corps = set(corps)
	i = 0
	for s in ['changed_final', 'changed_any', 'golden', 'unchanged']:
		for k,v in state[s].items():
			if not corps & set(v['c'].keys()):
				continue
			if gold != '*' and v['gs'] != gold:
				continue
			i += 1
			if i < page*pagesize:
				continue
			if i >= page*pagesize + pagesize:
				break
			rv['results'][s].append(v)

	if needs_cleanup:
		do_cleanup(test)

	return rv

def cb_accept_nd(test, c):
	tkey = test['test']
	state = State[tkey]
	rv = []

	if c not in state['corps']:
		cb_load(test, [c])

	for id,e in state['added'].items():
		if c not in e['c']:
			continue
		for i in range(len(e['o'])):
			e['e'][i] = e['o'][i]
		state['unchanged'][id] = e
		rv.append(id)

	for id,e in state['deleted'].items():
		if c not in e['c']:
			continue
		rv.append(id)

	for id in rv:
		if id in state['added']:
			del state['added'][id]
		if id in state['deleted']:
			del state['deleted'][id]

	Helpers.save_expected(g_root, test, c, state)
	do_cleanup(test)

	return rv

def cb_accept(test, hs, step):
	tkey = test['test']
	state = State[tkey]
	rv = []

	if not step or step == '':
		step = test['all_steps'][-1]

	cs = set()
	for id in hs:
		e = None
		for s in ['changed_final', 'changed_any', 'golden', 'unchanged']:
			if id not in state[s]:
				continue
			rv.append(id)
			e = state[s][id]
			cs |= set(e['c'].keys())

			for i,k in enumerate(test['all_steps']):
				if k.endswith('-trace'):
					continue
				e['e'][i] = e['o'][i]
				if k == step:
					break

		if not e:
			continue

		if step == test['all_steps'][-1]:
			for s in ['changed_final', 'changed_any', 'golden']:
				if id not in state[s]:
					continue
				del state[s][id]
			state[s][id] = e

	for c in cs:
		Helpers.save_expected(g_root, test, c, state)
	if cs:
		do_cleanup(test)

	return rv

def cb_gold(test, hs, a='add', gs=[]):
	tkey = test['test']
	state = State[tkey]
	rv = []

	cs = set()
	for id in hs:
		e = None
		for s in ['changed_final', 'changed_any', 'golden', 'unchanged']:
			if id not in state[s]:
				continue
			rv.append(id)
			e = state[s][id]
			cs |= set(e['c'].keys())

		if not e:
			continue

		if a == 'add':
			e['g'] = sorted(list(set(e['g']).add(e['o'][-1])))
		elif a == 'set':
			e['g'] = sorted(list(set(gs)))
		else:
			e['g'] = [e['o'][-1]]

	for c in cs:
		Helpers.save_gold(g_root, test, c, state)
	if cs:
		do_cleanup(test)

	return rv

def do_inspect(test, input):
	tkey = test['test']
	tdir = tempfile.gettempdir()

	pipe = ''
	for p,s in test['steps'].items():
		# Every step gets its own timeout watcher, to avoid runaway background processes
		pipe += f' | {timeout} {timeout_sec} {s["cmd"]}'
		if 'trace' in s:
			pipe += f' {s["trace"]} | tee {tdir}/inspect-{tkey}-{p}-trace.txt'
		elif s['type'] == 'cg':
			pipe += f' --trace | cg-sort | tee {tdir}/inspect-{tkey}-{p}-trace.txt | cg-untrace | cg-sort'
		pipe += f' | tee {tdir}/inspect-{tkey}-{p}.txt'
	pipe = pipe.replace(' --trace --trace ', ' --trace ')
	pipe = pipe.replace(' cg3-autobin.pl ', ' vislcg3 ')
	pipe = pipe[3:]

	Path(f'{tdir}/inspect-{tkey}.sh').write_text(f"cat '{tdir}/inspect-{tkey}.input' | {pipe} >/dev/null")
	Path(f'{tdir}/inspect-{tkey}.input').write_text(input)
	subprocess.run([timeout, str(timeout_sec), 'nice', '-n20', 'bash', f'{tdir}/inspect-{tkey}.sh'])

	rv = {}
	for p,s in test['steps'].items():
		rv[p] = Path(f'{tdir}/inspect-{tkey}-{p}.txt').read_text()
		if 'trace' in s or s['type'] == 'cg':
			rv[f'{p}-trace'] = Path(f'{tdir}/inspect-{tkey}-{p}-trace.txt').read_text()

	return rv

def do_cleanup(test):
	tkey = test['test']

	# Find all managed files that currently exist
	all = set()
	all |= set(glob.glob(f'{g_root}/expected/{tkey}/*/expected-*.txt'))
	all |= set(glob.glob(f'{g_root}/expected/{tkey}/*/gold-*.txt'))
	for p in test['all_corpora'].values():
		if '/local/' not in p:
			all.add(p)

	# Determine which files are allowed to exist, even if they don't right now
	keep = set()
	for c,fn in test['all_corpora'].items():
		keep.add(fn)
		for s in test['steps'].keys():
			keep.add(f'{g_root}/expected/{tkey}/{c}/expected-{c}-{s}.txt')
		keep.add(f'{g_root}/expected/{tkey}/{c}/gold-{c}.txt')

	# The difference is what we want to delete
	rem = all - keep
	# And of the files we don't delete, add the allowed ones that actually exist
	add = keep & (all - rem)

	for fn in rem:
		print(f'Removing {fn}')
		os.remove(fn)
		if test['git']:
			subprocess.run(['git', 'rm', '-f', '--cached', '--', fn], capture_output=True)

	if add and test['git']:
		subprocess.run(['git', 'add', '--'] + list(add))

def Get(params, p, df=''):
	return params.get(p, [df])[0]

def compress(s):
	step = 2 << 17
	producer = zlib.compressobj(level=9, wbits=15)
	idx = 0
	while idx < len(s):
		yield producer.compress(s[idx:idx+step])
		idx += step
	yield producer.flush()

class CallbackRequestHandler(http.server.SimpleHTTPRequestHandler):
	protocol_version = 'HTTP/1.1'

	def __init__(self, request, client_address, server, directory=None, page_size=250):
		self.page_size = page_size
		super().__init__(request, client_address, server, directory=directory)

	def log_message(self, format, *args):
		if cmdargs.debug:
			super().log_message(format, *args)

	def do_GET(self):
		parts = urllib.parse.urlsplit(self.path)
		if not parts.path or parts.path == '/':
			self.close_connection = True # Firefox doesn't navigate otherwise
			self.send_response(HTTPStatus.FOUND)
			if cmdargs.view == 'regtest':
				if cmdargs.corp:
					self.send_header('Location', '/regtest?t=%s&c=%s' % (g_tkey, ','.join(sorted(g_corps.keys()))))
				else:
					self.send_header('Location', '/regtest?t=%s' % (g_tkey))
			else:
				self.send_header('Location', '/inspect?t=%s' % (g_tkey))
			self.end_headers()
		elif m := re.match(r'^/(regtest|inspect)$', parts.path):
			self.send_html(f'{g_dir}/static/{m[1]}.html')
		elif parts.path.strip('/') == 'callback':
			params = urllib.parse.parse_qs(parts.query)
			self.do_callback(params)
		else:
			return super().do_GET()

	def do_POST(self):
		ln = int(self.headers['Content-Length'])
		data = self.rfile.read(ln)
		self.do_callback(urllib.parse.parse_qs(data.decode('utf-8')))

	def send_compressed(self, status, ctype, blob):
		# based on https://github.com/PierreQuentel/httpcompressionserver/blob/master/httpcompressionserver.py (BSD license)
		self.send_response(status)
		self.send_header('Content-type', ctype)
		self.send_header('Content-Encoding', 'deflate')
		if len(blob) < (2 << 18):
			# don't bother chunking shorter messages
			dt = b''.join(compress(blob))
			self.send_header('Content-Length', len(dt))
			self.end_headers()
			self.wfile.write(dt)
		else:
			self.send_header('Transfer-Encoding', 'chunked')
			self.end_headers()
			for data in compress(blob):
				if data:
					ln = hex(len(data))[2:].upper().encode('utf-8')
					self.wfile.write(ln + b'\r\n' + data + b'\r\n')
			self.wfile.write(b'0\r\n\r\n')

	def send_html(self, fname):
		self.send_compressed(HTTPStatus.OK, 'text/html', Path(fname).read_bytes())

	def do_callback(self, params):
		if 'n' in params and Get(params, 'n') != g_nonce:
			resp = 'Nonce did not match running server - reload the page!'
			self.send_response(HTTPStatus.BAD_REQUEST)
			self.send_header("Content-type", 'text/plain')
			self.send_header("Content-Length", len(resp))
			self.end_headers()
			self.wfile.write(resp.encode('utf-8'))
			return

		if 'a' not in params:
			resp = 'Parameter a must be passed!'
			self.send_response(HTTPStatus.BAD_REQUEST)
			self.send_header("Content-type", 'text/plain')
			self.send_header("Content-Length", len(resp))
			self.end_headers()
			self.wfile.write(resp.encode('utf-8'))
			return

		status = HTTPStatus.OK
		resp = {}

		tkey = None
		test = None
		if 't' in params:
			tkey = Get(params, 't')
			if tkey not in Tests:
				_, Tests[tkey] = Helpers.resolve_test(g_config, tkey)
				Locks[tkey] = threading.Lock()
			test = Tests[tkey]
			Locks[tkey].acquire()

		# REGTEST
		if Get(params, 'a') == 'init-regtest':
			resp['nonce'] = g_nonce
			resp['test'] = test
			resp['tests'] = []
			for k,t in g_config['tests'].items():
				resp['tests'].append([k, t['desc']])
			resp['pagesize'] = cmdargs.pagesize
			if cmdargs.step:
				resp['step'] = cmdargs.step
			test['steps'], test['all_steps'] = Helpers.resolve_steps(g_config, test)
			test['step_order'] = list(test['steps'].keys())

			test['all_corpora'] = Helpers.resolve_corps(g_root, g_config, test)

		elif Get(params, 'a') == 'load':
			try:
				resp = cb_load(test, Get(params, 'c').split(','), Get(params, 'g'), int(Get(params, 'p')), int(Get(params, 'z')))
			except Exception as e:
				traceback.print_exception(e)
				status = HTTPStatus.PRECONDITION_FAILED
				resp = {'error': 'Current state is missing or invalid. You will need to run the regression test for all corpora. This can be done with the button at the top of the page, or by passing -r to regtest.py'}

		elif Get(params, 'a') == 'run':
			good, cmd = test_run(test, Get(params, 'c', '*').split(','))
			resp['good'] = good
			resp['cmd'] = cmd

		elif Get(params, 'a') == 'accept-nd':
			try:
				resp['c'] = Get(params, 'c')
				resp['hs'] = cb_accept_nd(test, resp['c'])
			except Exception as e:
				traceback.print_exception(e)
				status = HTTPStatus.PRECONDITION_FAILED
				resp = {'error': 'Current state is missing or invalid. You will need to run the regression test for all corpora. This can be done with the button at the top of the page, or by passing -r to regtest.py'}

		elif Get(params, 'a') == 'accept':
			s = Get(params, 's', None)
			hs = Get(params, 'hs', '').split(';')
			resp['hs'] = cb_accept(test, hs, s)

		elif Get(params, 'a') == 'gold-replace':
			hs = Get(params, 'hs').split(';')
			cb_gold(test, hs, 'replace')
			resp['hs'] = hs

		elif Get(params, 'a') == 'gold-add':
			hs = Get(params, 'hs').split(';')
			cb_gold(test, hs, 'add')
			resp['hs'] = hs

		elif Get(params, 'a') == 'gold-set':
			hs = Get(params, 'hs').split(';')
			gs = json.loads(Get(params, 'gs'))
			cb_gold(test, hs, 'set', gs)
			resp['hs'] = hs

		# INSPECT
		elif Get(params, 'a') == 'init-inspect':
			resp['nonce'] = g_nonce
			resp['test'] = test
			resp['tests'] = []
			for k,t in g_config['tests'].items():
				resp['tests'].append([k, t['desc']])
			test['steps'], test['all_steps'] = Helpers.resolve_steps(g_config, test)

		elif Get(params, 'a') == 'inspect':
			resp['output'] = do_inspect(test, Get(params, 'txt'))

		else:
			resp['error'] = 'Unknown value for parameter "a"'

		rstr = json.dumps(resp, ensure_ascii=False, indent=1).encode('utf-8')
		self.send_compressed(status, 'application/json', rstr)

		if test:
			Locks[tkey].release()

def start_server(port, page_size=250):
	handle = partial(CallbackRequestHandler, directory=g_dir, page_size=page_size)
	print('Starting server')
	print('Open http://localhost:%d in your browser' % port)

	with http.server.ThreadingHTTPServer(('', port), handle) as httpd:
		try:
			httpd.serve_forever()
		except KeyboardInterrupt:
			print('')
			# the exception raised by sys.exit() gets caught by the
			# server, so we need to be a bit more drastic
			os._exit(0)

if cmdargs.run:
	good, cmd = test_run(g_test, list(g_corps.keys()))

start_server(int(cmdargs.port), int(cmdargs.pagesize))
