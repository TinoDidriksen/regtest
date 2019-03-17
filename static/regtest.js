'use strict';

function esc_html(t) {
	return t.
		replace(/&/g, '&amp;').
		replace(/</g, '&lt;').
		replace(/>/g, '&gt;').
		replace(/"/g, '&quot;').
		replace(/'/g, '&apos;');
}

function dec_html(t) {
	return t.
		replace(/&lt;/g, '<').
		replace(/&gt;/g, '>').
		replace(/&quot;/g, '"').
		replace(/&apos;/g, "'").
		replace(/&amp;/g, '&');
}

// From https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
function esc_regex(t) {
	return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expand(e) {
	$(e).replaceWith($(e).attr('data-html'));
}

function detect_format(t) {
	let f = 'plain';
	if (/(^|\n)"<[^\n\t]+>"/.test(t) && /(^|\n);?\t"[^\n\t]+"/.test(t)) {
		f = 'cg';
	}
	else if (/(^|\n)&quot;&lt;[^\n\t]+&gt;&quot;/.test(t) && /(^|\n);?\t&quot;[^\n\t]+&quot;/.test(t)) {
		f = 'cg';
	}
	else if (/\S+\t[^+\s]+\+[^+\s]+/.test(t)) {
		f = 'fst';
	}
	return f;
}

function to_plain(t, f) {
	if (!f) {
		f = detect_format(t);
	}

	let plain = '';
	if (f === 'fst') {
		let last = '';
		let lines = t.split("\n");
		for (let i=0 ; i<lines.length ; ++i) {
			let ws = /^(\S+)\t/.exec(lines[i]);
			if (ws && ws[1]) {
				if (ws[1] !== last) {
					plain += ws[1]+' ';
				}
				last = ws[1];
			}
		}
	}
	else if (f === 'cg') {
		let lines = t.split("\n");
		for (let i=0 ; i<lines.length ; ++i) {
			let w = /^"<(.*)>"/.exec(lines[i]);
			if (w) {
				plain += w[1]+' ';
			}
		}
	}
	else {
		plain = t;
	}

	return $.trim(plain);
}

function hilite_output(t, f) {
	if (!f) {
		f = detect_format(t);
	}

	if (f === 'fst') {
		t = t.replace(/\t([^+\n]+)(?=\+|\n|$)/g, '\t<span class="c-fst-b">$1</span>');
		t = t.replace(/\+([^\/+\n]+)(?=\+|\n|$)/g, '+<span class="c-fst-p">$1</span>');
		t = t.replace(/\+([^\/+\n]+\/[^+\n]+)(?=\+|\n|$)/g, '+<span class="c-fst-s">$1</span>');
		t = t.replace(/\+/g, '<span class="c-fst-pl">+</span>');
	}
	else if (f === 'cg') {
		let ls = t.split("\n");
		for (let i=0 ; i<ls.length ; ++i) {
			let ln = ls[i];
			if (/^(;?\t)(&quot;\S*[^&]+\S*&quot;)/.test(ln)) {
				ln = ln.replace(/ /g, '\t');
				let b = /^(;?\t)(&quot;\S*[^&]+\S*&quot;)(.*)$/.exec(ln);

				b[3] = b[3].replace(/(\t)(&lt;[^\s:]*:[^&:]+[^\s:]*&gt;)(?=\t|\n|$)/g, '$1<span class="c-cg-sc">$2</span>');
				b[3] = b[3].replace(/(\t)(&lt;\S*[^&]+\S*&gt;)(?=\t|\n|$)/g, '$1<span class="c-cg-s">$2</span>');
				b[3] = b[3].replace(/(\t)([@§£][^\s]+)(?=\t|\n|$)/g, '$1<span class="c-cg-m">$2</span>');
				b[3] = b[3].replace(/(\t)([-A-Z]+:\d+\S*)(?=\t|\n|$)/g, '$1<span class="c-cg-t">$2</span>');
				b[3] = b[3].replace(/(\t)((?![&@])[^\/\s]+\/[^\s]+)(?=\t|\n|$)/g, '$1<span class="c-cg-ps">$2</span>');
				b[3] = b[3].replace(/(\t)((?![&@])[^\/\s]+)(?=\t|\n|$)/g, '$1<span class="c-cg-p">$2</span>');

				ln = b[1]+'<span class="c-cg-b">'+b[2]+'</span>'+b[3];
				ln = ln.replace(/\t/g, ' ').replace(' ', '\t');
			}
			ls[i] = ln;
		}
		t = ls.join("\n");
	}
	else if (f === 'transfer') {
		t = t.replace(/(\[[^\n]+?\] \.\.\. [^\n]+)/g, '<span class="c-t-t">$1</span>');
	}

	return t;
}

function ajax_fail(e) {
	console.log(e);
	if (e.hasOwnProperty('responseJSON')) {
		toast('<span class="text-danger">Error '+e.status+'</span>', e.responseJSON.error);
		return;
	}
	toast('<span class="text-danger">Error '+e.status+'</span>', e.responseText);
}

function post(data) {
	return $.post('callback', data).fail(ajax_fail);
}

function init() {
	let tid = toast('Initializing', 'Loading meta-data...');
	post({a: 'init'}).done(function(rv) { $(tid).toast('hide'); return cb_init(rv); });
}

function load() {
	let tid = toast('Loading', 'Loading all available data...');
	post({a: 'load'}).done(function(rv) { $(tid).toast('hide'); return cb_load(rv); });
}

function toast(title, body, delay) {
	let h = new Date().getHours();
	let m = new Date().getMinutes();
	let stamp = (h < 10 ? ('0'+h) : h)+':'+(m < 10 ? ('0'+m) : m);
	let id = 'toast-'+Date.now()+'-'+(''+Math.random()).replace(/[^\d]+/g, '');
	let html = '<div class="toast" id="'+id+'"><div class="toast-header"><strong class="mr-auto">'+title+'</strong> <small>'+stamp+'</small><button type="button" class="ml-2 mb-1 close" data-dismiss="toast" aria-label="Close"><span aria-hidden="true">&times;</span></button></div><div class="toast-body">'+body+'</div></div>';
	$('#toasts').append(html);
	id = '#'+id;
	$(id).on('hidden.bs.toast', function() { console.log('Toasted '+$(this).attr('id')); $(this).remove(); });
	if (delay) {
		$(id).toast({animation: false, delay: delay})
	}
	else {
		$(id).toast({animation: false, autohide: false})
	}
	$(id).toast('show');

	return id;
}

function btn_filter() {
	let which = $(this).attr('data-which');
	console.log('Filtering for corpus '+which);
	if (which === '*') {
		$('.corp').show();
	}
	else {
		$('.corp').hide();
		$('.corp-'+which).show();
	}
	$('.btnFilter').removeClass('active');
	$(this).addClass('active');
}

function btn_run() {
	let c = $(this).attr('data-which');
	let tid = toast('Running Test', 'Launching regression test for: '+c+'<br>Check your terminal for progress.');
	post({a: 'run', c: c}).done(function(rv) { $(tid).toast('hide'); return cb_run(rv); });
}

function accept_multiple(c, hs) {
	let tid = toast('Accepting Multiple', 'Corpus '+c+' sentence '+hs.join(" "));
	post({a: 'accept', c: c, hs: hs.join(';')}).done(function(rv) { $(tid).toast('hide'); cb_accept(rv); });
}

function _diff_toggle(where, show, hide) {
	let div = $(where).closest('table').find('div.tab-pane');
	div.find('ins,del');
	div.find(show).show();
	if (hide) {
		div.find(hide).hide();
	}
}

function btn_diff_both() {
	return _diff_toggle(this, 'ins,del');
}

function btn_diff_ins() {
	return _diff_toggle(this, 'ins', 'del');
}

function btn_diff_del() {
	return _diff_toggle(this, 'del', 'ins');
}

function btn_accept() {
	let tr = $(this).closest('tr');
	let c = tr.attr('data-corp');
	let h = tr.attr('data-hash');
	let tid = toast('Accepting Single', 'Corpus '+c+' sentence '+h);
	post({a: 'accept', c: c, hs: [h].join(';')}).done(function(rv) { $(tid).toast('hide'); cb_accept(rv); });
}

function btn_accept_all() {
	$('.rt-changes').find('span.corp').filter(':visible').each(function() {
		let hs = [];
		$(this).find('tr').each(function() {
			hs.push($(this).attr('data-hash'));
		});
		accept_multiple($(this).attr('data-corp'), hs);
	});
}

function btn_accept_unchanged() {
	$('.rt-changes').find('span.corp').filter(':visible').each(function() {
		let hs = [];
		$(this).find('tr').not('.rt-changed-result').each(function() {
			hs.push($(this).attr('data-hash'));
		});
		accept_multiple($(this).attr('data-corp'), hs);
	});
}

function cb_init(rv) {
	$('title,#title').text('Regtest: -b '+rv.binary+' -f '+rv.folder);

	let html_filter = '';
	let html_run = '';
	for (let i=0 ; i<rv.corpora.length ; ++i) {
		html_filter += ' <button type="button" class="btn btn-outline-primary btnFilter" data-which="'+esc_html(rv.corpora[i])+'">'+esc_html(rv.corpora[i])+'</button>';
		html_run += ' <button type="button" class="btn btn-outline-info btnRun" data-which="'+esc_html(rv.corpora[i])+'">'+esc_html(rv.corpora[i])+'</button>';
	}
	$('#rt-corpora-filter').replaceWith(html_filter);
	$('#rt-corpora-run').replaceWith(html_run);

	$('.btnFilter').off().click(btn_filter);
	$('.btnRun').off().click(btn_run);
}

function cb_load(rv) {
	$('.rt-added,.rt-deleted,.rt-add-del-warn,.rt-deleted').hide();
	$('#rt-added,#rt-deleted').find('tbody').remove();
	$('#rt-changes').text('');

	let state = rv.state;
	for (let c in state) {
		if (!state.hasOwnProperty(c)) {
			continue;
		}

		let cmds = state[c].cmds;
		let ins = state[c].inputs;
		let outs = cmds[0].expect;
		let add = state[c].add;
		let del = state[c].del;

		if (add.length) {
			let html = '<tbody class="corp corp-'+c+'"><tr><th colspan="2">Corpus: '+c+'</th></tr>';
			for (let i=0 ; i<add.length ; ++i) {
				html += '<tr class="hash-'+add[i][0]+'"><td>'+add[i][1]+'</td><td>'+esc_html(to_plain(add[i][2]))+'</td></tr>';
			}
			html += '</tbody>';
			$('#rt-added').append(html);
			$('.rt-added,.rt-add-del-warn').show();
		}

		if (del.length) {
			let html = '<tbody class="corp corp-'+c+'"><tr><th>Corpus: '+c+'</th></tr>';
			for (let i=0 ; i<del.length ; ++i) {
				html += '<tr class="hash-'+del[i][0]+'"><td>'+esc_html(to_plain(del[i][1], cmds[0].type))+'</td></tr>';
			}
			html += '</tbody>';
			$('#rt-deleted').append(html);
			$('.rt-deleted,.rt-add-del-warn').show();
		}

		let ks = [];
		for (let k in ins) {
			if (outs.hasOwnProperty(k)) {
				ks.push(k);
			}
		}
		ks.sort(function(a, b) {
			return ins[a][0] - ins[b][0];
		});

		let changes = false;
		let html = '<span class="corp corp-'+c+'" data-corp="'+c+'"><h3>Corpus: '+c+'</h3><table class="table table-bordered table-sm my-1">';

		for (let ki=0 ; ki<ks.length ; ++ki) {
			let k = ks[ki];

			let changed = false;
			let changed_result = '';
			let nav = '<ul class="nav nav-tabs" role="tablist">';
			let body = '<div class="tab-content">';

			let id = c+'-'+k+'-input';
			nav += '<li class="nav-item"><a class="nav-link" id="'+id+'-tab" data-toggle="tab" href="#'+id+'" role="tab">Input</a></li>';
			body += '<div class="tab-pane rt-output p-1" id="'+id+'" role="tabpanel" aria-labelledby="'+id+'-tab">'+esc_html(ins[k][1])+'</div>';

			for (let i=0 ; i<cmds.length ; ++i) {
				let cmd = cmds[i];
				if (!cmd.output.hasOwnProperty(k)) {
					continue;
				}
				if (!cmd.expect.hasOwnProperty(k)) {
					continue;
				}

				let output = '';
				let style = '';
				if (cmd.output[k][1] !== cmd.expect[k][1]) {
					if (!changed) {
						style = ' show active';
					}
					style += ' rt-changed';
					changed = true;
					if (i == cmds.length-1) {
						changed_result = ' rt-changed-result';
					}

					let diff = Diff.diffWordsWithSpace(cmd.expect[k][1], cmd.output[k][1]);
					for (let d=0 ; d<diff.length ; ++d) {
						if (diff[d].added) {
							output += '<ins>'+esc_html(diff[d].value)+'</ins>';
						}
						else if (diff[d].removed) {
							output += '<del>'+esc_html(diff[d].value)+'</del>';
						}
						else {
							let val = esc_html(diff[d].value);
							if (/\n([^\n]+\n){6}/.test(val)) {
								let ls = val.split("\n");
								val = hilite_output(ls[0]+"\n"+ls[1]+"\n"+ls[2]+"\n", cmd.type);
								val += '<button type="button" class="btn btn-outline-secondary btn-sm" onclick="expand(this);" data-html="'+esc_html(hilite_output(ls.slice(3, -3).join("\n"), cmd.type))+'">…</button>'+"\n";
								val += hilite_output(ls[ls.length-3]+"\n"+ls[ls.length-2]+"\n"+ls[ls.length-1], cmd.type);
							}
							else {
								val = hilite_output(val, cmd.type);
							}
							output += val;
						}
					}
				}
				else {
					output = hilite_output(esc_html(cmd.output[k][1]), cmd.type);
				}

				let id = c+'-'+k+'-'+cmd.opt;
				nav += '<li class="nav-item"><a class="nav-link'+style+'" id="'+id+'-tab" data-toggle="tab" href="#'+id+'" role="tab" title="'+esc_html(cmd.cmd)+'">'+esc_html(cmd.opt)+'</a></li>';
				body += '<div class="tab-pane'+style+' rt-output p-1" id="'+id+'" role="tabpanel" aria-labelledby="'+id+'-tab">'+output+'</div>';

				if (cmd.trace.hasOwnProperty(k)) {
					let id = c+'-'+k+'-'+cmd.opt+'-trace';
					nav += '<li class="nav-item"><a class="nav-link" id="'+id+'-tab" data-toggle="tab" href="#'+id+'" role="tab" title="'+esc_html(cmd.cmd)+'">'+esc_html(cmd.opt)+'-trace</a></li>';
					body += '<div class="tab-pane rt-output p-1" id="'+id+'" role="tabpanel" aria-labelledby="'+id+'-tab">'+hilite_output(esc_html(cmd.trace[k][1]), cmd.type)+'</div>';
				}
			}
			body += '</div>';
			nav += '</ul>';
			if (changed) {
				changes = true;
				html += '<tr data-corp="'+c+'" data-hash="'+k+'" class="'+changed_result+' hash-'+k+'"><td>'+nav+body+'<div class="text-right my-1"><button type="button" class="btn btn-outline-primary btnDiffBoth">Diff</button> <button type="button" class="btn btn-outline-primary btnDiffIns">Inserted</button> <button type="button" class="btn btn-outline-primary btnDiffDel">Deleted</button> &nbsp; <button type="button" class="btn btn-outline-success btnAccept">Accept Change</button></div></td></tr>'+"\n";
			}
		}
		html += '</table></span>';

		if (changes) {
			$('#rt-changes').append(html);
			$('.rt-changes').show();
		}
	}

	$('.btnDiffBoth').off().click(btn_diff_both);
	$('.btnDiffIns').off().click(btn_diff_ins);
	$('.btnDiffDel').off().click(btn_diff_del);
	$('.btnAccept').off().click(btn_accept);
}

function cb_run(rv) {
	if (rv.good) {
		toast('Run Output', '<b>Success</b><br><b>Output:</b><br><code>'+esc_html(rv.output).replace(/\n/g, '<br>')+'</code>', 7000);
		load();
	}
	else {
		toast('Run Output', '<b>Error</b><br><b>Output:</b><br><code>'+esc_html(rv.output).replace(/\n/g, '<br>')+'</code>');
	}
}

function cb_accept(rv) {
	for (let i=0 ; i<rv.hs.length ; ++i) {
		$('.hash-'+rv.hs[i]).fadeOut(750, function() { $(this).remove() });
	}
	$('.rt-add-del-warn').hide();
}

$(function() {
	$('.rt-added,.rt-deleted,.rt-add-del-warn,.rt-changes').hide();

	init();
	load();

	$('.btnAcceptAll').off().click(btn_accept_all);
	$('.btnAcceptUnchanged').off().click(btn_accept_unchanged);
});
