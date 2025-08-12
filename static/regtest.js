'use strict';

let g_state = {
	t: '',
	c: [],
	cs: {},
	g: '',
	s: '*',
	z: 250,
	nonce: '',
};
let state = {};
let all_corpora = [];

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

// From https://gist.github.com/victornpb/7736865
function occurrences(string, subString, allowOverlapping) {
	if (subString.length <= 0) {
		return string.length + 1;
	}

	let n = 0;
	let pos = 0;
	let step = allowOverlapping ? 1 : subString.length;

	while (true) {
		pos = string.indexOf(subString, pos);
		if (pos >= 0) {
			++n;
			pos += step;
		}
		else {
			break;
		}
	}
	return n;
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

function init() {
	let tid = toast('Initializing', 'Loading meta-data...');
	post({a: 'init-regtest', t: g_state.t}).done(function(rv) { $(tid).toast('hide'); return cb_init(rv); });
}

function load(p) {
	let tid = toast('Loading', 'Loading page '+(p+1)+'...');
	post({n: g_state.nonce, a: 'load', t: g_state.t, c: g_state.c.join(','), g: g_state.g, p: p, z: g_state.z}).done(function(rv) { $(tid).toast('hide'); $('#toasts').text(''); return cb_load(rv); });
}

function apply_filters() {
	$('.rt-entry').removeClass('rt-show').addClass('rt-hide');

	let shown = [];
	$('.chkFilterCorp').each(function() {
		if ($(this).prop('checked')) {
			let c = $(this).attr('data-which');
			shown.push('.rt-entry.corp-'+c);
		}
	});

	if (!shown.length || shown.length == all_corpora.length) {
		$('.rt-entry').removeClass('rt-hide').addClass('rt-show');
	}
	else {
		$(shown.join(',')).removeClass('rt-hide').addClass('rt-show');
	}

	let gold = $('.btnFilterGold.active').attr('data-which');
	if (gold !== '*') {
		$('.rt-show').each(function() {
			let e = $(this);
			e.removeClass('rt-show').addClass('rt-hide');
			if (e.hasClass('rt-filter-gold-'+gold)) {
				e.removeClass('rt-hide').addClass('rt-show');
			}
		});
	}

	if (!$('.bucket-changed_final .rt-show').length) {
		$('.chkShowUnchanged').prop('checked', true);
	}

	if ($('.chkShowUnchanged').prop('checked')) {
		['changed_any', 'golden', 'unchanged'].forEach(function(b) {
			$(`.bucket-${b} .rt-show`).removeClass('rt-hide').addClass('rt-show');
		});
	}
	else {
		['changed_any', 'golden', 'unchanged'].forEach(function(b) {
			$(`.bucket-${b} .rt-show`).removeClass('rt-show').addClass('rt-hide');
		});
	}

	['changed_final', 'changed_any', 'golden', 'unchanged'].forEach(function(b) {
		$(`.bucket-${b}`).hide();
		if ($(`.bucket-${b} .rt-show`).length) {
			$(`.bucket-${b}`).show();
		}
		$('.rt-filtered-warn').hide();
		if (!$('.bucket:visible').length) {
			$('.rt-filtered-warn').show();
		}
	});

	update_counts();
	setTimeout(event_scroll, 100);
}

function chk_filter_corp() {
	g_state.c = [];
	let shown = [];
	let reload = false;
	$('.chkFilterCorp').each(function() {
		if ($(this).prop('checked')) {
			let c = $(this).attr('data-which');
			g_state.c.push(c);
			shown.push('.corp-'+c);
			if (!g_state.cs.hasOwnProperty(c)) {
				reload = true;
			}
		}
	});

	let url = new URL(window.location);
	if (!shown.length || shown.length == all_corpora.length) {
		url.searchParams.delete('c');
		$('.corp').removeClass('rt-hide').addClass('rt-show');
		if (Object.keys(g_state.cs).length != all_corpora.length) {
			reload = true;
		}
	}
	else {
		url.searchParams.set('c', g_state.c.join(','));
		$('.corp').removeClass('rt-show').addClass('rt-hide');
		$(shown.join(',')).removeClass('rt-hide').addClass('rt-show');
	}

	window.history.pushState({}, '', url.toString().replace(/%2C/g, ','));

	if (reload) {
		load(state.counts.page);
	}
	else {
		apply_filters();
	}
}

function btn_filter_corp_invert() {
	$('.chkFilterCorp').each(function() {
		$(this).prop('checked', !$(this).prop('checked'));
	});
	chk_filter_corp();
}

function btn_filter_gold() {
	$('.btnFilterGold').removeClass('active');
	$(this).addClass('active');
	let url = new URL(window.location);
	g_state.g = $('.btnFilterGold.active').attr('data-which');
	url.searchParams.set('g', g_state.g);
	if (g_state.g === '*') {
		url.searchParams.delete('g');
	}
	window.history.pushState({}, '', url.toString().replace(/%2C/g, ','));
	apply_filters();
}

function btn_run() {
	let c = g_state.c.join(',');
	let tid = toast('Running Test', 'Launching regression test for: '+(c ? c : '*')+'<br>Check your terminal for progress.');
	post({n: g_state.nonce, a: 'run', t: g_state.t, c: c}).done(function(rv) { $(tid).toast('hide'); return cb_run(rv); });
}

function accept_multiple(hs, s) {
	let tid = toast('Accepting Multiple', 'Sentences '+hs.join(' '));
	post({n: g_state.nonce, a: 'accept', t: g_state.t, s: s, hs: hs.join(';')}).done(function(rv) { $(tid).toast('hide'); cb_accept(rv); });
}

function _diff_toggle(where, show, hide) {
	let div = $(where).closest('tr').find('.tab-pane:visible');
	div.find('ins,del');
	div.find(show).show();
	if (hide) {
		div.find(hide).hide();
	}
}

function select_diff() {
	let div = $(this).closest('tr').find('.tab-pane:visible');
	div.find('ins,del').hide();
	div.find($(this).val()).show();
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
	let h = $(this).closest('tr').attr('data-hash');
	let tid = toast('Replacing Gold', 'Sentence '+h);
	post({n: g_state.nonce, a: 'gold-replace', t: g_state.t, hs: h}).done(function(rv) { $(tid).toast('hide'); cb_accept(rv); });
}

function btn_gold_add() {
	let h = $(this).closest('tr').attr('data-hash');
	let tid = toast('Adding Gold', 'Sentence '+h);
	post({n: g_state.nonce, a: 'gold-add', t: g_state.t, hs: h}).done(function(rv) { $(tid).toast('hide'); cb_accept(rv); });
}

function btn_gold_edit() {
	let tr = $(this).closest('tr');
	let h = tr.attr('data-hash');

	$('#geTitle').text('Editing golds for: '+$(`#t${h}-input`).text()).attr('data-hash', h);

	let body = '<div id="geEntries">';
	tr.find('.rt-gold-entry').each(function() {
		let g = $(this).attr('data-gold');
		let size = Math.max(occurrences(g, '\n')+1, 2);
		body += '<div class="row mb-3"><div class="col"><textarea class="form-control" rows="'+size+'">'+esc_html(g)+'</textarea></div><div class="col-1"><button class="btn btn-sm btn-danger">X</button></div></div>';
	});
	body += '</div><div class="mt-3 text-center"><button class="btn btn-sm btn-success">+</button></div>';
	$('#geBody').html(body);

	$('#geBody .btn-success').off().click(function() {
		$('#geEntries').append('<div class="row mb-3"><div class="col"><textarea class="form-control"></textarea></div><div class="col-1"><button class="btn btn-sm btn-danger">X</button></div></div>');
		$('#geEntries .btn-danger').off().click(function() {
			$(this).closest('.row').remove();
		});
	});
	$('#geEntries .btn-danger').off().click(function() {
		$(this).closest('.row').remove();
	});

	g_state.modal.show();
}

function btn_gold_save() {
	let h = $('#geTitle').attr('data-hash');
	let gs = [];
	$('#geEntries textarea').each(function() {
		let g = $.trim($(this).val());
		if (g) {
			gs.push(g);
		}
	});
	gs = JSON.stringify(gs);
	let tid = toast('Setting Golds', 'Sentence '+h);
	post({n: g_state.nonce, a: 'gold-set', t: g_state.t, hs: h, gs: gs}).done(function(rv) { $(tid).toast('hide'); g_state.modal.hide(); cb_accept(rv); });
}

function btn_accept() {
	let tr = $(this).closest('tr');
	let h = tr.attr('data-hash');
	let tid = toast('Accepting Single', 'Sentence '+h);
	post({n: g_state.nonce, a: 'accept', t: g_state.t, hs: [h].join(';')}).done(function(rv) { $(tid).toast('hide'); cb_accept(rv); });
}

function btn_accept_until() {
	let tr = $(this).closest('tr');
	let s = tr.find('a.nav-link.active').text();
	let h = tr.attr('data-hash');
	let tid = toast('Accepting Partial', 'Step '+s+', sentence '+h);
	post({n: g_state.nonce, a: 'accept', t: g_state.t, s: s, hs: [h].join(';')}).done(function(rv) { $(tid).toast('hide'); cb_accept(rv); });
}

function btn_accept_all() {
	$('.rt-changes').find('table').filter(':visible').each(function() {
		let hs = [];
		$(this).find('tr').each(function() {
			hs.push($(this).attr('data-hash'));
		});
		accept_multiple(hs);
	});
}

function btn_accept_all_until() {
	let step = $(this).attr('data-step');
	$('.rt-changes').find('table').filter(':visible').each(function() {
		let hs = [];
		$(this).find('tr').each(function() {
			hs.push($(this).attr('data-hash'));
		});
		accept_multiple(hs, step);
	});
}

function btn_accept_unchanged() {
	$('.rt-changes').find('table').filter(':visible').each(function() {
		let hs = [];
		$(this).find('tr').not('.rt-changed-result').each(function() {
			hs.push($(this).attr('data-hash'));
		});
		accept_multiple(hs);
	});
}

function btn_accept_nd() {
	let c = $(this).attr('data-corp');
	let tid = toast('Accepting Added/Deleted', 'Corpus '+c);
	post({n: g_state.nonce, a: 'accept-nd', t: g_state.t, c: c}).done(function(rv) { $(tid).toast('hide'); cb_accept_nd(rv); });
}

function btn_checked_gold_replace() {
	$('.rt-changes').find('table').filter(':visible').each(function() {
		let hs = [];
		$(this).find('.rt-change-tick:checked').filter(':visible').each(function() {
			hs.push($(this).closest('tr').attr('data-hash'));
		});
		let tid = toast('Replacing Golds', 'Sentences '+hs.join(' '));
		post({n: g_state.nonce, a: 'gold-replace', t: g_state.t, hs: hs.join(';')}).done(function(rv) { $(tid).toast('hide'); cb_accept(rv); });
	});
}

function btn_checked_gold_add() {
	$('.rt-changes').find('table').filter(':visible').each(function() {
		let hs = [];
		$(this).find('.rt-change-tick:checked').filter(':visible').each(function() {
			hs.push($(this).closest('tr').attr('data-hash'));
		});
		let tid = toast('Adding Golds', 'Sentences '+hs.join(' '));
		post({n: g_state.nonce, a: 'gold-add', t: g_state.t, hs: hs.join(';')}).done(function(rv) { $(tid).toast('hide'); cb_accept(rv); });
	});
}

function btn_checked_accept() {
	$('.rt-changes').find('table').filter(':visible').each(function() {
		let hs = [];
		$(this).find('.rt-change-tick:checked').filter(':visible').each(function() {
			hs.push($(this).closest('tr').attr('data-hash'));
		});
		accept_multiple(hs);
	});
}

function btn_checked_accept_until() {
	let step = $(this).attr('data-step');
	$('.rt-changes').find('table').filter(':visible').each(function() {
		let hs = [];
		$(this).find('.rt-change-tick:checked').filter(':visible').each(function() {
			hs.push($(this).closest('tr').attr('data-hash'));
		});
		accept_multiple(hs, step);
	});
}

function btn_checked_invert() {
	$('.rt-change-tick').filter(':visible').each(function() {
		$(this).prop('checked', !$(this).prop('checked'));
	});
}

function btn_show_tab() {
	// Set text and en-/disable partial accept button
	let tr = $(this).closest('tr');
	let btn = tr.find('.btnAcceptUntil');
	btn.text('Accept: '+$(this).text());
	if ($(this).hasClass('rt-changed')) {
		tr.find('.btnAcceptUntil,.selectDiffMode').removeClass('disabled btn-outline-secondary').addClass('btn-outline-success').prop('disabled', false);
	}
	else {
		tr.find('.btnAcceptUntil,.selectDiffMode').removeClass('btn-outline-success').addClass('disabled btn-outline-secondary').prop('disabled', true);
	}
	if ($(this).hasClass('rt-last-tab')) {
		tr.find('.btnAcceptUntil').removeClass('btn-outline-success').addClass('disabled btn-outline-secondary').prop('disabled', true);
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
		let diff = null;
		if (occurrences(expect, '\n') >= 100) {
			diff = Diff.diffLines(expect, text);
		}
		else {
			diff = Diff.diffWordsWithSpace(expect, text);
		}
		let output = '';
		for (let d=0 ; d<diff.length ; ++d) {
			if (diff[d].added) {
				output += '<ins>'+maybe_ws(esc_html(diff[d].value))+'</ins>';
			}
			else if (diff[d].removed) {
				output += '<del>'+maybe_ws(esc_html(diff[d].value))+'</del>';
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

	if ($(this).hasClass('rt-last-tab')) {
		let input = div.attr('id').substr(0, div.attr('id').lastIndexOf('-'));
		input = $('#'+input+'-input');
		div.prepend('<div class="rt-input">'+esc_html(input.text())+'</div>');
	}

	$(this).attr('data-hilite', true);
}

function click_and_show(e) {
	e.click();
	bootstrap.Tab.getOrCreateInstance(e.get(0)).show();
}

function btn_select_tab() {
	let which = $(this).attr('data-which');
	if (which === '*FIRST') {
		$('.rt-changes').find('tr').filter(':visible').each(function() {
			click_and_show($(this).find('a.rt-changed').first());
		});
	}
	else if (which === '*LAST') {
		$('.rt-changes').find('tr').filter(':visible').each(function() {
			click_and_show($(this).find('a.rt-changed').last());
		});
	}
	else {
		$('.rt-tab-'+which).filter(':visible').each(function() {
			click_and_show($(this));
		});
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

function btn_page() {
	let p = $(this).attr('data-which');
	if (p === 'prev') {
		load(Math.max(0, state.counts.page-1));
	}
	else if (p === 'next') {
		load(Math.min(state.counts.pages-1, state.counts.page+1));
	}
	else {
		load(parseInt(p));
	}
	return false;
}

function update_counts() {
	for (let b in state.results) {
		$('.bucket-'+b+' .rt-count').text('('+state.results[b].length+' of '+state.counts.total+' ; '+Math.round(state.results[b].length*1000.0/state.counts.total)/10.0+'%)');
	}
}

function cb_init(rv) {
	g_state.nonce = rv.nonce;
	g_state.test = rv.test;
	$('title,#title').text(`Regtest ${g_state.t}: ${rv.test.desc}`);

	$('.lnkInspect').attr('href', './inspect?t='+g_state.t);

	let html = '';
	for (let i=0 ; i<rv.tests.length ; ++i) {
		let cls = 'btn-outline-primary';
		if (rv.tests[i][0] == g_state.t) {
			cls = 'btn-primary';
		}
		html += ' <a class="btn btn-sm '+cls+'" href="/regtest?t='+esc_html(rv.tests[i][0])+'" title="'+esc_html(rv.tests[i][1])+'">'+esc_html(rv.tests[i][0])+'</a>';
	}
	$('#rt-tests').html(html);

	html = '';
	all_corpora = Object.keys(g_state.test.all_corpora).sort();
	for (let i=0 ; i<all_corpora.length ; ++i) {
		html += ' <div class="form-check-inline m-1 mx-0"><label class="form-check-label btn btn-sm btn-outline-primary"><input type="checkbox" tabindex="-1" class="form-check-input chkFilterCorp" data-which="'+esc_html(all_corpora[i])+'"> '+esc_html(all_corpora[i])+'</label></div>';
	}
	$('#rt-corpora-filter').html(html);

	for (let i=0 ; i<g_state.c.length ; ++i) {
		$('.chkFilterCorp[data-which="'+g_state.c[i]+'"]').prop('checked', true);
	}

	html = '';
	for (let i=0 ; i<g_state.test.step_order.length ; ++i) {
		let k = g_state.test.step_order[i];
		let s = g_state.test.steps[k];
		html += '<button tabindex="-1" type="button" class="btn btn-sm btn-outline-primary my-1 btnSelectTab" data-which="'+k+'" title="'+esc_html(s.cmd)+'">'+k+'</button>\n';
		/*
		if (s.type === 'cg' || s.hasOwnProperty('trace')) {
			html += '<button tabindex="-1" type="button" class="btn btn-sm btn-outline-primary my-1 btnSelectTab" data-which="'+k+'-trace" title="'+k+' --trace">-trace</button>\n';
		}
		//*/
	}
	$('#rt-steps').html(html);

	$('.chkFilterCorp').off().click(chk_filter_corp);
	$('.btnFilterCorpInvert').off().click(btn_filter_corp_invert);
	$('.btnRun').off().click(btn_run);
	$('.btnFilterGold').off().click(btn_filter_gold);

	if (!g_state.test.gold) {
		$('.rt-gold').hide();
	}

	load(0);
}

function cb_load(rv) {
	$('.rt-added,.rt-deleted,.rt-missing,.rt-add-del-warn,.rt-missing-warn').hide();
	$('#rt-changes').text('');

	let tabs = {};
	let tabs_html = '';
	let nd_corps = {};

	state = rv;
	g_state.cs = {};
	state.corpora.forEach(function(c) { g_state.cs[c] = true; });

	let pages = '';
	if (state.counts.pages > 1) {
		pages += '<ul class="pagination"><li class="page-item"><a class="page-link rt-page rt-page-prev" href="#" data-which="prev">&laquo;</a></li>';
		for (let p=0 ; p<state.counts.pages ; ++p) {
			let cur = '';
			if (p === state.counts.page) {
				cur = ' active';
			}
			pages += '<li class="page-item'+cur+'"><a class="page-link rt-page rt-page-'+p+'" href="#" data-which="'+p+'">'+(p+1)+'</a></li>';
		}
		pages += '<li class="page-item"><a class="page-link rt-page rt-page-next" href="#" data-which="next">&raquo;</a></li></ul>';
	}
	$('.rt-pages').html(pages);
	$('.rt-page').click(btn_page);

	$('#rt-added').html('');
	for (let i=0 ; i<state.results.added.length ; ++i) {
		let e = state.results.added[i];

		let cs = [];
		let lns = [];
		for (let c in e.c) {
			lns.push(`${c}:${e.c[c]}`);
			cs.push(`corp-${c}`);
			nd_corps[c] = true;
		}

		let html = '<tr class="corp '+cs.join(' ')+' hash-'+e.h+'" data-hash="'+e.h+'"><th><tt>'+lns.join('; ')+'</tt></th><td>'+esc_html(to_plain(e.i))+'</td></tr>';
		$('#rt-added').append(html);
		$('.rt-added,.rt-add-del-warn').show();
	}

	$('#rt-deleted').html('');
	for (let i=0 ; i<state.results.deleted.length ; ++i) {
		let e = state.results.deleted[i];

		let cs = [];
		for (let c in e.c) {
			cs.push(`corp-${c}`);
			nd_corps[c] = true;
		}

		let html = '<tr class="corp '+cs.join(' ')+' hash-'+e.h+'" data-hash="'+e.h+'"><th><tt>'+Object.keys(e.c).sort().join('; ')+'</tt></th><td>'+esc_html(to_plain(e.e[0]))+'</td></tr>';
		$('#rt-deleted').append(html);
		$('.rt-deleted,.rt-add-del-warn').show();
	}

	$('#rt-missing').html('');
	for (let i=0 ; i<state.results.missing.length && i<10 ; ++i) {
		let e = state.results.missing[i];

		let cs = [];
		let lns = [];
		for (let c in e.c) {
			lns.push(`${c}:${e.c[c]}`);
			cs.push(`corp-${c}`);
			nd_corps[c] = true;
		}

		let html = '<tr class="corp '+cs.join(' ')+' hash-'+e.h+'" data-hash="'+e.h+'"><th><tt>'+lns.join('; ')+'</tt></th><td>'+esc_html(to_plain(e.i))+'</td></tr>';
		$('#rt-missing').append(html);
		$('.rt-missing,.rt-missing-warn').show();
	}

	let buckets = {
		changed_final: '[<span class="text-danger">!</span>] Changed Result',
		changed_any: '[<span class="text-warning">?</span>] Intermediary Changes',
		golden: '[<span class="text-success">✓</span>] Matched Gold',
		unchanged: '[<span class="text-success">✓</span>] Unchanged',
		};
	let html = '';
	for (let b in buckets) {
		if (!state.results.hasOwnProperty(b) || !state.results[b].length) {
			continue;
		}
		html += '<div class="bucket bucket-'+b+' mb-5"><h3>'+buckets[b]+' <span class="rt-count">'+state.counts[b]+'</span></h3><table class="table table-bordered table-sm my-1">';
		state.results[b].forEach(function(e) {
			let cs = [];
			let lns = [];
			for (let c in e.c) {
				lns.push(`${c}:${e.c[c]}`);
				cs.push(`corp-${c}`);
			}

			let nav = '<ul class="nav nav-tabs" role="tablist">';
			let body = '<div class="tab-content">';
			let classes = ['rt-entry'];

			let id = 't'+e.h+'-input';
			nav += '<li class="nav-item"><a tabindex="-1" class="nav-link rt-tab-input" id="'+id+'-tab" data-bs-toggle="tab" href="#'+id+'" role="tab" title="'+esc_html(e.i)+'">Input</a></li>';
			body += '<pre class="tab-pane rt-output p-1" id="'+id+'" role="tabpanel">'+esc_html(e.i)+'</pre>';

			let changed = false;
			let changed_result = 'rt-unchanged';
			for (let i=0 ; i<g_state.test.all_steps.length ; ++i) {
				let k = g_state.test.all_steps[i];
				let s = g_state.test.steps[k];

				let output = esc_html(e.o[i]);
				if (k.endsWith('-trace')) {
					s = g_state.test.steps[g_state.test.all_steps[i-1]];
					let id = 't'+e.h+'-'+k;
					nav += '<li class="nav-item"><a tabindex="-1" class="nav-link" id="'+id+'-tab" data-bs-toggle="tab" href="#'+id+'" role="tab">-trace</a></li>';
					body += '<pre class="tab-pane rt-output p-1" id="'+id+'" role="tabpanel" data-type="'+s.type+'">'+output+'</pre>';
					continue;
				}

				let style = '';
				let expect = '';
				if (e.o[i] !== e.e[i]) {
					if (!changed) {
						style += ' show active';
					}
					style += ' rt-changed';
					changed = true;
					if (i == g_state.test.all_steps.length-1) {
						changed_result = 'rt-changed-result';
					}

					expect = ' data-expect="'+esc_html(e.e[i])+'"';
				}
				if (i == g_state.test.all_steps.length-1) {
					style += ' rt-last-tab';
					if (!changed) {
						style += ' show active';
					}
				}

				let id = 't'+e.h+'-'+k;
				nav += '<li class="nav-item"><a tabindex="-1" class="nav-link rt-tab-'+k+style+'" id="'+id+'-tab" data-bs-toggle="tab" href="#'+id+'" role="tab">'+k+'</a></li>';
				body += '<pre class="tab-pane'+style+' rt-output p-1" id="'+id+'" role="tabpanel" data-type="'+s.type+'"'+expect+' data-output="'+output+'">'+output+'</pre>';
			}

			if (e.g.length) {
				let id = 't'+e.h+'-gold';
				let ul = '<b class="user-select-none">Input:</b><p class="mb-4">'+esc_html(e.i)+'</p><b class="user-select-none">Output:</b><p class="mb-4">'+esc_html(e.o[e.o.length-1])+'</p><b class="user-select-none">Golds:</b><ul class="list-group rt-golds">';
				for (let g=0 ; g<e.g.length ; ++g) {
					ul += '<li class="list-group-item rt-gold-entry" data-gold="'+esc_html(e.g[g])+'">'+esc_html(e.g[g])+'</li>';
					if (changed_result == 'rt-changed-result') {
						if (e.o[e.o.length-1] == e.g[g]) {
							changed_result = 'rt-filter-gold-m';
						}
						else {
							classes.push('rt-filter-gold-u');
						}
					}
				}
				ul += '</ul>';
				nav += '<li class="nav-item"><a tabindex="-1" class="nav-link rt-tab-gold" id="'+id+'-tab" data-bs-toggle="tab" href="#'+id+'" role="tab">Gold</a></li>';
				body += '<pre class="tab-pane rt-output p-1" id="'+id+'" role="tabpanel" data-type="'+g_state.test.steps[g_state.test.all_steps[g_state.test.all_steps.length-1]].type+'">'+ul+'</pre>';
			}
			else {
				classes.push('rt-filter-gold-w');
			}

			body += '</div>';
			nav += '</ul>';

			let btn_types = [
				// class, label, trailing space, hover text
				['success btnAcceptUntil', '…', ' <span class="rt-gold">&nbsp; ', 'Accept changes of current and prior steps'],
				['warning btnGoldReplace', 'Replace as Gold', ' ', 'Remove existing gold entries and replace with current result'],
				['warning btnGoldAdd', 'Add as Gold', ' ', 'Add current result to gold entries'],
				['warning btnGoldEdit', 'Edit Gold', '</span> &nbsp; ', 'Edit gold entries'],
				['success btnAccept', 'Accept Result', ' ', 'Accept all steps']
			];

			html += '<tr data-hash="'+e.h+'" class="'+changed_result+' hash-'+e.h+' corp '+cs.join(' ')+' '+classes.join(' ')+'"><td>'+nav+body+'<div class="text-right my-1">';
			html += '<select class="form-select form-select-sm btn btn-sm btn-outline-success rt-select selectDiffMode" title="Hide insertions or deletions in diff"><option selected value="ins,del">Diff</option><option value="ins">Inserted</option><option value="del">Deleted</option></select> &nbsp; ';
			html += btn_types.map(function(b) {
				return '<button tabindex="-1" type="button" class="btn btn-sm btn-outline-'+b[0]+'" title="'+b[3]+'">'+b[1]+'</button>'+b[2];
			}).join('');
			html += '<input type="checkbox" class="mx-2 align-middle rt-change-tick"> [<tt>'+lns.join(' ')+'</tt>]</div></td></tr>'+"\n";
		});
		html += '</table></div>';
	}

	let nd_btns = '';
	Object.keys(nd_corps).forEach(function(c) {
		nd_btns += '<button class="btn btn-outline-success btnAcceptND" data-corp="'+c+'">Accept added/deleted: '+c+'</button> ';
	});
	if (nd_btns) {
		$('#rt-nd-btns').html(nd_btns);
		$('.btnAcceptND').click(btn_accept_nd);
	}

	$('#rt-changes').html(html);
	$('.rt-changes').show();

	$('.btnSelectTab').off().click(btn_select_tab);
	$('.btnDiffBoth').off().click(btn_diff_both);
	$('.btnDiffIns').off().click(btn_diff_ins);
	$('.btnDiffDel').off().click(btn_diff_del);
	$('.selectDiffMode').off().change(select_diff);
	$('.btnGoldReplace').off().click(btn_gold_replace);
	$('.btnGoldAdd').off().click(btn_gold_add);
	$('.btnGoldEdit').off().click(btn_gold_edit);
	$('.btnAcceptUntil').off().click(btn_accept_until);
	$('.btnAccept').off().click(btn_accept);
	$('.nav-link').off().click(btn_show_tab);

	if (!g_state.test.gold) {
		$('.rt-gold').hide();
	}

	let nchange = $('.rt-changed-result:visible').length;
	let tab = null;

	if (g_state.s && g_state.s !== '*') {
		let tabs = $('#rt-steps').find('.btnSelectTab');
		let pt = null;
		for (let i=0 ; i<tabs.length ; ++i) {
			if (tabs.eq(i).text() === g_state.s) {
				tab = tabs.eq(i);
				break;
			}
			if (!pt && tabs.eq(i).text().indexOf(g_state.s) === 0) {
				pt = tabs.eq(i);
			}
		}
		if (!tab) {
			tab = pt;
		}
	}
	if (!tab && nchange) {
		tab = $('#rt-steps').find('.btnSelectTab').last();
	}
	if (tab) {
		tab.click();
	}

	apply_filters();
}

function cb_run(rv) {
	if (rv.good) {
		toast('Run Output', '<b>Success</b><br><b>Command:</b><br><code>'+esc_html(rv.cmd).replace(/\n/g, '<br>')+'</code>', 7000);
		load(0);
	}
	else {
		toast('Run Output', '<b>Error</b><br><b>Command:</b><br><code>'+esc_html(rv.cmd).replace(/\n/g, '<br>')+'</code>');
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

function cb_accept_nd(rv) {
	let s = ['#rt-added', '#rt-deleted'];
	for (let i=0 ; i<s.length ; ++i) {
		// ToDo: Technically you could add/delete the same thing in multiple corpora, but only accept it in one, and this does not handle that unlikely scenario
		$(s[i]).find('.corp-'+rv.c).remove();
		if (!$(s[i]).find('tbody').length) {
			$(s[i]).hide();
		}
	}

	if (!$('#rt-added,#rt-deleted').find('tbody').length) {
		$('.rt-added,.rt-deleted,.rt-add-del-warn').hide();
	}
}

function event_scroll() {
	$('.nav-link.active').each(function() {
		if (!$(this).attr('data-hilite') && $(this).isInViewport()) {
			$(this).click();
		}
	});
}

$(function() {
	$('.rt-added,.rt-deleted,.rt-add-del-warn,.rt-missing,.rt-missing-warn,.rt-filtered-warn,.rt-changes').hide();

	let url = new URL(window.location);
	g_state.t = get(url.searchParams, 't', '');
	g_state.c = get(url.searchParams, 'c', '').split(',');
	g_state.g = get(url.searchParams, 'g', '*');
	g_state.s = get(url.searchParams, 's', '*');
	g_state.z = get(url.searchParams, 'z', 250);

	g_state.modal = new bootstrap.Modal('#geModal');

	$('.btnFilterGold').removeClass('active');
	$('.btnFilterGold[data-which="'+g_state.g+'"]').addClass('active');

	init();

	$('.btnAcceptAll').off().click(btn_accept_all);
	$('.btnAcceptAllUntil').hide().off().click(btn_accept_all_until);
	$('.btnAcceptUnchanged').off().click(btn_accept_unchanged);
	$('.chkShowUnchanged').off().click(apply_filters);

	$('.btnCheckedGoldReplace').off().click(btn_checked_gold_replace);
	$('.btnCheckedGoldAdd').off().click(btn_checked_gold_add);
	$('.btnCheckedAcceptUntil').off().click(btn_checked_accept_until);
	$('.btnCheckedAccept').off().click(btn_checked_accept);
	$('.btnCheckedInvert').off().click(btn_checked_invert);
	$('.btnGoldSave').off().click(btn_gold_save);

	$('#selectDiffModeAll').change(function() {
		$('.selectDiffMode').val(this.value).change();
	});

	$('#lnkReload').click(function(e) { e.preventDefault(); window.location.reload(); return false; });

	$(window).on('resize scroll', event_scroll);
});
