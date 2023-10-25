'use strict';

let g_state = {
	steps: [],
	binary: '',
	};

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

function toast(title, body, delay) {
	let h = new Date().getHours();
	let m = new Date().getMinutes();
	let stamp = (h < 10 ? ('0'+h) : h)+':'+(m < 10 ? ('0'+m) : m);
	let id = 'toast-'+Date.now()+'-'+(''+Math.random()).replace(/[^\d]+/g, '');
	let html = '<div class="toast" id="'+id+'"><div class="toast-header"><strong class="mr-auto">'+title+'</strong> <small>'+stamp+'</small><button tabindex="-1" type="button" class="ml-2 mb-1 btn-close" data-bs-dismiss="toast" aria-label="Close"></button></div><div class="toast-body">'+body+'</div></div>';
	$('#toasts').append(html);
	id = '#'+id;
	$(id).on('hidden.bs.toast', function() { console.log('Toasted '+$(this).attr('id')); $(this).remove(); });
	if (delay) {
		$(id).toast({animation: false, delay: delay});
	}
	else {
		$(id).toast({animation: false, autohide: false});
	}
	$(id).toast('show');

	return id;
}

function dep2svg(where, cg) {
	let rx = /^(.+?)>"\n\s+(".+)(\n|$)/;
	let wx = /("[^"]+"\S*)/;
	let dx = / #(\d+)->(\d+)/;

	let height = 20;
	let svg = d3.select(where)
		.append('svg')
			.attr('width', 300)
			.attr('height', height)
		;
	svg.append('style').text('@import url(/static/svg.css);');
	svg.append('defs')
		.append('marker')
		.attr('id', 'arrowhead').attr('markerWidth', 10).attr('markerHeight', 7).attr('refX', 0).attr('refY', 3.5).attr('orient', 'auto')
		.append('polygon').attr('points', '0 0, 10 3.5, 0 7')
		;
	let arcs = svg.append('g').classed('arcs', true);
	let nodes = svg.append('g').classed('nodes', true).attr('transform', 'translate(0, 200)');

	let selves = {};
	let x = 20;
	let lines = cg.replace(/^"</, '').split(/\n"</);
	for (let i=0 ; i<lines.length ; ++i) {
		let m = lines[i].match(rx);
		if (!m) {
			console.log('Did not match: '+lines[i]);
			continue;
		}

		let g = nodes.append('g')
			.classed('word', true)
			;

		let rect = g.append('rect')
			.attr('x', x)
			.attr('y', 20)
			.attr('rx', 3)
			.attr('ry', 3)
			;

		let dep = m[2].match(dx);
		if (dep) {
			let ds = parseInt(dep[1]);
			let dp = parseInt(dep[2]);
			rect.classed('ds'+ds, true);
			rect.attr('data-ds', ds);
			rect.attr('data-dp', dp);
			selves[ds] = rect;
		}

		let txts = [];
		txts.push(g.append('text')
			.classed('wform', true)
			.text(m[1]));

		let ts = m[2];
		ts = ts.replace(/("[^"]+"\S*) /g, '\n$1\n');
		ts = ts.replace(/ (#\d+->\d+)/, '\n$1');
		ts = ts.replace(/ ([A-Z]{2,})/g, '\n$1');
		ts = ts.replace(/ (@)/, '\n$1');
		ts = $.trim(ts).split(/\n+/);
		for (let j=0 ; j<ts.length ; ++j) {
			let text = g.append('text')
				.text(ts[j])
				;
			if (wx.test(ts[j])) {
				text.classed('bform', true);
				text.text(ts[j].substring(1, ts[j].length - 1));
			}
			else if (/^#\d+->\d+$/.test(ts[j])) {
				text.classed('dep', true);
			}
			else {
				text.classed('tags', true);
			}
			if (!text.node()) {
				console.log('No text: '+ts[j]);
				continue;
			}
			txts.push(text);
		}

		let mw = 0;
		let mh = 0;
		for (let j=0 ; j<txts.length ; ++j) {
			if (!txts[j].node()) {
				console.log('No text 2: '+j);
				continue;
			}
			let bbox = txts[j].node().getBBox();
			mw = Math.max(mw, bbox.width);
			mh = Math.max(mh, bbox.height);
		}

		height = Math.max(height, txts.length*mh + txts.length*5 + 60);
		rect
			.attr('width', mw + 20)
			.attr('height', txts.length*mh + txts.length*5 + 20)
			;
		for (let j=0 ; j<txts.length ; ++j) {
			txts[j]
				.attr('x', x + 10 + mw/2)
				.attr('y', 20 + 10 + j*(mh+5))
				;
		}

		x += mw + 30;
	}

	let mh = 2;
	let ars = [];
	for (let i in selves) {
		let node = selves[i];
		let start = node.attr('x')*1 + node.attr('width')/2;
		let end = node.attr('x')*1 + node.attr('width')/2;

		let dp = node.attr('data-dp')*1;
		if (dp && selves.hasOwnProperty(dp)) {
			let ne = selves[dp];
			end = ne.attr('x')*1 + ne.attr('width')/2;
		}

		if (node.attr('data-ds') && !dp) {
			arcs.append('line')
				.classed('arc', true)
				.attr('x1', start)
				.attr('y1', 220)
				.attr('x2', start)
				.attr('y2', 20)
				.attr('marker-end', 'url(#arrowhead)')
				;
			continue;
		}
		if (start == end) {
			continue;
		}

		let m = ['M', start, 220, 'A',
			(start - end)/2, ',',
			(start - end)/mh, 0, 0, ',',
			start < end ? 1 : 0, end, ',', 220]
			.join(' ');

		let arc = arcs.append('path').classed('arc', true).attr('d', m).attr('data-mh', start - end).attr('data-dir', start < end ? 'right' : 'left');

		while (arc.node().getBBox().height > 180) {
			mh += 0.25;
			m = ['M', start, 220, 'A',
				(start - end)/2, ',',
				(start - end)/mh, 0, 0, ',',
				start < end ? 1 : 0, end, ',', 220]
				.join(' ');
			arc.attr('d', m);
		}
		ars.push(arc);
	}

	console.log(mh);
	for (let j=0 ; j<ars.length ; ++j) {
		let d = ars[j].attr('d');
		d = d.replace(/ , (\S+)/, ' , '+(ars[j].attr('data-mh')/mh));
		ars[j].attr('d', d);

		let len = ars[j].node().getTotalLength();
		let p = ars[j].node().getPointAtLength(len/2);
		p = arcs.append('polygon')
			.attr('transform', 'translate('+(p.x - 5)+', '+(p.y - 3.5)+')')
			;

		if (ars[j].attr('data-dir') == 'left') {
			p.attr('points', '0 3.5, 10 0, 10 7').classed('dir-left', true);
		}
		else {
			p.attr('points', '0 0, 10 3.5, 0 7').classed('dir-right', true);
		}
	}

	svg.attr('width', x + 10);
	svg.attr('height', height + 200);
}

function btn_inspect() {
	$('code,svg').html('');

	let t = $('#input').val();
	let tid = toast('Running pipe', 'Launching pipe.<br>Check your terminal for progress.');
	post({a: 'inspect', t: t}).done(function(rv) { $(tid).toast('hide'); return cb_inspect(rv); });
	return false;
}

function cb_inspect(rv) {
	if (!rv.hasOwnProperty('output')) {
		toast('Run failed', '<b>Error</b>');
		return false;
	}

	let shown = $('.collapse.show');

	if (!$('#txt-'+g_state.steps[0]).length) {
		let html = '';
		for (let step of g_state.steps) {
			html = `
<span id="graph-${step}">
<hr>

<div class="row">
<div class="col-sm-2 my-3">
	<a class="btn btn-sm btn-primary" data-bs-toggle="collapse" href="#tree-${step}" role="button" aria-expanded="false" aria-controls="txt-0">Toggle ${step} (graph)</a>
</div>
<div class="col-sm-10 my-3">
	<div class="collapse" id="tree-${step}">
		<div><h3>${step} (graph)</h3><span id="svg-${step}"></span></div>
	</div>
</div>
</div>
</span>

<hr>

<div class="row">
<div class="col-sm-2 my-3">
	<a class="btn btn-sm btn-primary" data-bs-toggle="collapse" href="#txt-${step}" role="button" aria-expanded="false" aria-controls="txt-0">Toggle ${step} (text)</a>
</div>
<div class="col-sm-10 my-3">
	<div class="collapse" id="txt-${step}">
		<div><h3>${step} (text)</h3><code></code></div>
	</div>
</div>
</div>
` + html;
		}
		$('#output').html(html);
	}

	$('#output').show();
	$('.collapse').addClass('show');

	for (let step of g_state.steps) {
		let t = rv.output[step];
		$('#txt-'+step).find('code').text(t);
		$('#svg-'+step).text('');

		if (!/-trace$/.test(step) && / #\d+->\d+/.test(t)) {
			try {
				$('#graph-'+step).show();
				dep2svg('#svg-'+step, t);
			}
			catch(e) {
				$('#graph-'+step).hide();
			}
		}
		else {
			$('#graph-'+step).hide();
		}
	}

	$('.collapse').removeClass('show');
	shown.addClass('show');
	if (!$('.collapse.show').length) {
		$('#tree-'+g_state.steps.slice(-1)).addClass('show');
	}
}

$(function() {
	$('#output').hide();
	$('#btnInspect').click(btn_inspect);

	post({a: 'init'}).done(function(rv) {
		g_state.steps = rv.steps;
		g_state.binary = rv.binary;
		$('title,#title').text(g_state.binary + ' pipe inspector');
	});
});
