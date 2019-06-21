'use strict';

let state = {};

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

// From http://stackoverflow.com/a/41417072/4374566
$.fn.isInViewport = function() {
	let elementTop = $(this).offset().top;
	let elementBottom = elementTop + $(this).outerHeight();

	let viewportTop = $(window).scrollTop();
	let viewportBottom = viewportTop + $(window).height();

	return elementBottom > viewportTop && elementTop < viewportBottom;
};

// From https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
function esc_regex(t) {
	return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
	if (!f || f === 'auto') {
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
	let html = '<div class="toast" id="'+id+'"><div class="toast-header"><strong class="mr-auto">'+title+'</strong> <small>'+stamp+'</small><button tabindex="-1" type="button" class="ml-2 mb-1 close" data-dismiss="toast" aria-label="Close"><span aria-hidden="true">&times;</span></button></div><div class="toast-body">'+body+'</div></div>';
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

function accept_multiple(c, hs, s) {
	let tid = toast('Accepting Multiple', 'Corpus '+c+' sentence '+hs.join(" "));
	post({a: 'accept', c: c, s: s, hs: hs.join(';')}).done(function(rv) { $(tid).toast('hide'); cb_accept(rv); });
}

function _diff_toggle(where, show, hide) {
	let div = $(where).closest('tr').find('.tab-pane:visible');
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

function btn_collapse() {
	let div = $(this).closest('div');
	div.children('span').hide();
	$(this).hide();
	div.find('.btnExpand').show();
}

function btn_expand() {
	let div = $(this).closest('div');
	div.children('span').show();
	$(this).hide();
	div.find('.btnCollapse').show();
}

function btn_gold_replace() {
	let tr = $(this).closest('tr');
	let c = tr.attr('data-corp');
	let h = tr.attr('data-hash');
	let gs = [tr.find('pre.rt-last-tab').attr('data-output')];
	let tid = toast('Replacing Gold', 'Corpus '+c+' sentence '+h);
	post({a: 'gold', c: c, h: h, gs: JSON.stringify(gs)}).done(function(rv) { $(tid).toast('hide'); cb_accept(rv); });
}

function btn_gold_add() {
	let tr = $(this).closest('tr');
	let c = tr.attr('data-corp');
	let h = tr.attr('data-hash');
	let gs = [];
	if (state[c].gold.hasOwnProperty(h)) {
		gs = state[c].gold[h][1];
	}
	gs.push(tr.find('pre.rt-last-tab').attr('data-output'));
	let tid = toast('Adding Gold', 'Corpus '+c+' sentence '+h);
	post({a: 'gold', c: c, h: h, gs: JSON.stringify(gs)}).done(function(rv) { $(tid).toast('hide'); cb_accept(rv); });
}

function btn_accept() {
	let tr = $(this).closest('tr');
	let c = tr.attr('data-corp');
	let h = tr.attr('data-hash');
	let tid = toast('Accepting Single', 'Corpus '+c+' sentence '+h);
	post({a: 'accept', c: c, hs: [h].join(';')}).done(function(rv) { $(tid).toast('hide'); cb_accept(rv); });
}

function btn_accept_until() {
	let tr = $(this).closest('tr');
	let c = tr.attr('data-corp');
	let s = tr.find('a.nav-link.active').text();
	let h = tr.attr('data-hash');
	let tid = toast('Accepting Partial', 'Corpus '+c+', step '+s+', sentence '+h);
	post({a: 'accept', c: c, s: s, hs: [h].join(';')}).done(function(rv) { $(tid).toast('hide'); cb_accept(rv); });
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

function btn_accept_all_until() {
	let step = $(this).attr('data-step');
	$('.rt-changes').find('span.corp').filter(':visible').each(function() {
		let hs = [];
		$(this).find('tr').each(function() {
			hs.push($(this).attr('data-hash'));
		});
		accept_multiple($(this).attr('data-corp'), hs, step);
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

function btn_toggle_unchanged() {
	$('.rt-changes').find('tr').not('.rt-changed-result').each(function() {
		if ($(this).is(':visible')) {
			$(this).hide();
		}
		else {
			$(this).show();
		}
	});
	update_counts();
	event_scroll();
}

function btn_checked_gold_replace() {
	$('.rt-change-tick:checked').filter(':visible').each(btn_gold_replace);
}

function btn_checked_gold_add() {
	$('.rt-change-tick:checked').filter(':visible').each(btn_gold_add);
}

function btn_checked_accept() {
	$('.rt-changes').find('span.corp').filter(':visible').each(function() {
		let hs = [];
		$(this).find('.rt-change-tick:checked').filter(':visible').each(function() {
			hs.push($(this).closest('tr').attr('data-hash'));
		});
		accept_multiple($(this).attr('data-corp'), hs);
	});
}

function btn_checked_accept_until() {
	let step = $(this).attr('data-step');
	$('.rt-changes').find('span.corp').filter(':visible').each(function() {
		let hs = [];
		$(this).find('.rt-change-tick:checked').filter(':visible').each(function() {
			hs.push($(this).closest('tr').attr('data-hash'));
		});
		accept_multiple($(this).attr('data-corp'), hs, step);
	});
}

function btn_checked_invert() {
	$('.rt-change-tick').filter(':visible').each(function() {
		$(this).prop('checked', !$(this).prop('checked'));
	});
}

function btn_show_tab() {
	// Set text and en-/disable partial accept button
	let btn = $(this).closest('tr').find('.btnAcceptUntil');
	btn.text('Accept: '+$(this).text());
	if ($(this).hasClass('rt-changed')) {
		btn.removeClass('disabled').prop('disabled', false);
	}
	else {
		btn.addClass('disabled').prop('disabled', true);
	}

	// Highlight syntax, if in view and not already done
	if ($(this).attr('data-hilite') || !$(this).isInViewport()) {
		return;
	}
	let div = $($(this).attr('href'));

	let type = div.attr('data-type');
	let text = div.text();
	let expect = div.attr('data-expect');

	if ($(this).hasClass('rt-tab-gold')) {
		// Nothing
	}
	else if (expect) {
		let diff = Diff.diffWordsWithSpace(expect, text);
		let output = '';
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
					val = hilite_output(ls[0]+"\n"+ls[1]+"\n"+ls[2]+"\n", type);
					val += '<div class="rt-expansion"><span class="rt-expanded">'+hilite_output(ls.slice(3, -3).join("\n"), type)+'</span><button tabindex="-1" type="button" class="btn btn-outline-secondary btn-sm btnExpand">…</button><button tabindex="-1" type="button" class="btn btn-outline-secondary btn-sm btnCollapse">…</button></div>';
					val += hilite_output(ls[ls.length-3]+"\n"+ls[ls.length-2]+"\n"+ls[ls.length-1], type);
				}
				else {
					val = hilite_output(val, type);
				}
				output += val;
			}
		}
		div.html(output);
		div.removeAttr('data-expect');
		div.find('.rt-expanded').hide();
		div.find('.btnExpand').off().click(btn_expand);
		div.find('.btnCollapse').off().click(btn_collapse).hide();
	}
	else {
		div.html(hilite_output(esc_html(text), type));
	}

	$(this).attr('data-hilite', true);
}

function btn_select_tab() {
	let which = $(this).attr('data-which');
	if (which === '*FIRST') {
		$('.rt-changes').find('tr').filter(':visible').each(function() {
			$(this).find('a.rt-changed').first().click();
		});
	}
	else if (which === '*LAST') {
		$('.rt-changes').find('tr').filter(':visible').each(function() {
			$(this).find('a.rt-changed').last().click();
		});
	}
	else {
		$('.rt-tab-'+which).filter(':visible').click();
	}

	if (which === '*FIRST' || which === '*LAST' || which === 'gold') {
		$('.btnAcceptAllUntil,.btnCheckedAcceptUntil').addClass('disabled').prop('disabled', true);
	}
	else {
		$('.btnAcceptAllUntil,.btnCheckedAcceptUntil').show().removeClass('disabled').prop('disabled', false).attr('data-step', which);
		$('.btnAcceptAllUntil').text('Accept All: '+which);
		$('.btnCheckedAcceptUntil').text('Accept Checked: '+which);
	}

	$('.btnSelectTab').removeClass('active');
	$(this).addClass('active');
}

function update_counts() {
	let total = 0;
	let changed = 0;

	$('.rt-count-corp').each(function() {
		let s = $(this).closest('span.corp');
		let t = state[s.attr('data-corp')].count;
		let ch = s.find('tr:visible').length;
		$(this).text('('+ch+' of '+t+' ; '+Math.round(ch*1000.0/t)/10.0+'%)');

		total += t;
		changed += ch;
	});

	if (total) {
		$('.rt-count-total').text('('+changed+' of '+total+' ; '+Math.round(changed*1000.0/total)/10.0+'%)');
	}
}

function cb_init(rv) {
	let txt = 'Regtest: -b '+rv.binary+' -f '+rv.folder;
	if (rv.step) {
		txt += ' -s '+rv.step;
	}
	$('title,#title').text(txt);

	let html_filter = '';
	let html_run = '';
	for (let i=0 ; i<rv.corpora.length ; ++i) {
		html_filter += ' <button tabindex="-1" type="button" class="btn btn-sm btn-outline-primary my-1 btnFilter" data-which="'+esc_html(rv.corpora[i])+'">'+esc_html(rv.corpora[i])+'</button>';
		html_run += ' <button tabindex="-1" type="button" class="btn btn-sm btn-outline-info my-1 btnRun" data-which="'+esc_html(rv.corpora[i])+'">'+esc_html(rv.corpora[i])+'</button>';
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
	$('#rt-corpora-tabs').text('');

	let tabs = {};
	let tabs_html = '';

	state = rv.state;
	for (let c in state) {
		if (!state.hasOwnProperty(c)) {
			continue;
		}
		if (c.indexOf('_') === 0) {
			continue;
		}

		let cmds = state[c].cmds;
		let ins = state[c].inputs;
		let golds = state[c].gold;
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
		let html = '<span class="corp corp-'+c+'" data-corp="'+c+'"><h3>Corpus: '+c+' <span class="rt-count rt-count-corp"></span></h3><table class="table table-bordered table-sm my-1">';

		for (let ki=0 ; ki<ks.length ; ++ki) {
			let k = ks[ki];

			let changed = false;
			let changed_result = '';
			let nav = '<ul class="nav nav-tabs" role="tablist">';
			let body = '<div class="tab-content">';

			let id = c+'-'+k+'-input';
			nav += '<li class="nav-item"><a tabindex="-1" class="nav-link rt-tab-input" id="'+id+'-tab" data-toggle="tab" href="#'+id+'" role="tab" title="'+esc_html(ins[k][1])+'">Input</a></li>';
			body += '<pre class="tab-pane rt-output p-1" id="'+id+'" role="tabpanel">'+esc_html(ins[k][1])+'</pre>';

			for (let i=0 ; i<cmds.length ; ++i) {
				let cmd = cmds[i];
				if (!cmd.output.hasOwnProperty(k)) {
					continue;
				}
				if (!cmd.expect.hasOwnProperty(k)) {
					continue;
				}

				let output = esc_html(cmd.output[k][1]);
				let style = '';
				let expect = '';
				if (i == cmds.length-1) {
					style += ' rt-last-tab';
				}
				if (cmd.output[k][1] !== cmd.expect[k][1]) {
					if (!changed) {
						style = ' show active';
					}
					style += ' rt-changed';
					changed = true;
					if (i == cmds.length-1) {
						if (golds.hasOwnProperty(k) && golds[k][1].indexOf(cmd.output[k][1]) !== -1) {
							style += ' rt-gold';
						}
						else {
							changed_result = ' rt-changed-result';
						}
					}

					expect = ' data-expect="'+esc_html(cmd.expect[k][1])+'"';
				}

				if (!tabs.hasOwnProperty(cmd.opt)) {
					tabs[cmd.opt] = true;
					tabs_html += '<button tabindex="-1" type="button" class="btn btn-sm btn-outline-primary my-1 btnSelectTab" data-which="'+cmd.opt+'">'+cmd.opt+'</button>\n';
				}

				let id = c+'-'+k+'-'+cmd.opt;
				nav += '<li class="nav-item"><a tabindex="-1" class="nav-link rt-tab-'+cmd.opt+style+'" id="'+id+'-tab" data-toggle="tab" href="#'+id+'" role="tab" title="'+esc_html(cmd.cmd)+'">'+cmd.opt+'</a></li>';
				body += '<pre class="tab-pane'+style+' rt-output p-1" id="'+id+'" role="tabpanel" data-type="'+cmd.type+'"'+expect+' data-output="'+output+'">'+output+'</pre>';

				if (cmd.trace.hasOwnProperty(k)) {
					let id = c+'-'+k+'-'+cmd.opt+'-trace';
					nav += '<li class="nav-item"><a tabindex="-1" class="nav-link" id="'+id+'-tab" data-toggle="tab" href="#'+id+'" role="tab" title="'+esc_html(cmd.cmd)+'">'+cmd.opt+'-trace</a></li>';
					body += '<pre class="tab-pane rt-output p-1" id="'+id+'" role="tabpanel" data-type="'+cmd.type+'">'+esc_html(cmd.trace[k][1])+'</pre>';
				}
			}

			if (golds.hasOwnProperty(k)) {
				let id = c+'-'+k+'-gold';
				let ul = 'Input:<p class="ml-4">'+esc_html(ins[k][1])+'</p>Golds:<ul class="list-group">';
				for (let g=0 ; g<golds[k][1].length ; ++g) {
					ul += '<li class="list-group-item">'+esc_html(golds[k][1][g])+'</li>';
				}
				ul += '</ul>';
				nav += '<li class="nav-item"><a tabindex="-1" class="nav-link rt-tab-gold" id="'+id+'-tab" data-toggle="tab" href="#'+id+'" role="tab">Gold</a></li>';
				body += '<pre class="tab-pane rt-output p-1" id="'+id+'" role="tabpanel" data-type="'+cmds[cmds.length-1].type+'">'+ul+'</pre>';
			}

			body += '</div>';
			nav += '</ul>';
			if (changed) {
				changes = true;
				html += '<tr data-corp="'+c+'" data-hash="'+k+'" class="'+changed_result+' hash-'+k+'"><td>'+nav+body+'<div class="text-right my-1"><button tabindex="-1" type="button" class="btn btn-sm btn-outline-primary btnDiffBoth">Diff</button> <button tabindex="-1" type="button" class="btn btn-sm btn-outline-primary btnDiffIns">Inserted</button> <button tabindex="-1" type="button" class="btn btn-sm btn-outline-primary btnDiffDel">Deleted</button> &nbsp; <button tabindex="-1" type="button" class="btn btn-sm btn-outline-success btnAcceptUntil">…</button> &nbsp; <button tabindex="-1" type="button" class="btn btn-sm btn-outline-warning btnGoldReplace">Replace as Gold</button> <button tabindex="-1" type="button" class="btn btn-sm btn-outline-warning btnGoldAdd">Add as Gold</button> &nbsp; <button tabindex="-1" type="button" class="btn btn-sm btn-outline-success btnAccept">Accept Result</button> <input type="checkbox" class="mx-2 align-middle rt-change-tick"></div></td></tr>'+"\n";
			}
		}
		html += '</table></span>';

		if (changes) {
			$('#rt-changes').append(html);
			$('.rt-changes').show();
		}
	}

	$('#rt-corpora-tabs').html(tabs_html);
	$('.btnSelectTab').off().click(btn_select_tab);
	$('.btnDiffBoth').off().click(btn_diff_both);
	$('.btnDiffIns').off().click(btn_diff_ins);
	$('.btnDiffDel').off().click(btn_diff_del);
	$('.btnGoldReplace').off().click(btn_gold_replace);
	$('.btnGoldAdd').off().click(btn_gold_add);
	$('.btnAcceptUntil').off().click(btn_accept_until);
	$('.btnAccept').off().click(btn_accept);
	$('.nav-link').off().click(btn_show_tab);

	let nchange = $('.rt-changed-result').length;
	let tab = null;
	if (nchange) {
		btn_toggle_unchanged();
	}
	if (state['_step'] && state['_step'] !== '*') {
		let tabs = $('#rt-corpora-tabs').find('.btnSelectTab');
		let pt = null;
		for (let i=0 ; i<tabs.length ; ++i) {
			if (tabs.eq(i).text() === state['_step']) {
				tab = tabs.eq(i);
				break;
			}
			if (!pt && tabs.eq(i).text().indexOf(state['_step']) === 0) {
				pt = tabs.eq(i);
			}
		}
		if (!tab) {
			tab = pt;
		}
	}
	if (!tab && nchange) {
		tab = $('#rt-corpora-tabs').find('.btnSelectTab').last();
	}
	if (tab) {
		tab.click();
	}

	update_counts();
	setTimeout(event_scroll, 100);
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
		$('.hash-'+rv.hs[i]).fadeOut(500, function() { $(this).remove(); });
	}
	$('.rt-add-del-warn').hide();
	setTimeout(function() {
		update_counts();
		event_scroll();
		}, 600);
}

function event_scroll() {
	$('.nav-link.active').each(function() {
		if (!$(this).attr('data-hilite') && $(this).isInViewport()) {
			$(this).click();
		}
	});
}

$(function() {
	$('.rt-added,.rt-deleted,.rt-add-del-warn,.rt-changes').hide();

	init();
	load();

	$('.btnAcceptAll').off().click(btn_accept_all);
	$('.btnAcceptAllUntil').hide().off().click(btn_accept_all_until);
	$('.btnAcceptUnchanged').off().click(btn_accept_unchanged);
	$('.btnToggleUnchanged').off().click(btn_toggle_unchanged);

	$('.btnCheckedGoldReplace').off().click(btn_checked_gold_replace);
	$('.btnCheckedGoldAdd').off().click(btn_checked_gold_add);
	$('.btnCheckedAcceptUntil').off().click(btn_checked_accept_until);
	$('.btnCheckedAccept').off().click(btn_checked_accept);
	$('.btnCheckedInvert').off().click(btn_checked_invert);

	$(window).on('resize scroll', event_scroll);
});
