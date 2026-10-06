// Body tab: optional body-weight log with a trend line.
import { h, s } from '../dom.js';
import { fmtDay, fmtMonthDay, isISODate } from '../../engine/dates.js';
import { ic, keepFocus, draftGet, draftSet, draftClear } from './common.js';

function chart(list) {
  if (list.length < 2) return null;
  const W = 640;
  const H = 180;
  const pad = 26;
  const ws = list.map((b) => b.w);
  const min = Math.floor(Math.min(...ws) - 1);
  const max = Math.ceil(Math.max(...ws) + 1);
  const t0 = Date.parse(list[0].d);
  const t1 = Date.parse(list[list.length - 1].d);
  const x = (d) => pad + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - pad * 2);
  const y = (w) => H - pad - ((w - min) / Math.max(1, max - min)) * (H - pad * 2);
  const pts = list.map((b) => `${x(b.d).toFixed(1)},${y(b.w).toFixed(1)}`).join(' ');
  return s('svg', { class: 'bw-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Body weight from ${list[0].w} to ${list[list.length - 1].w}` },
    s('line', { x1: pad, x2: W - pad, y1: y(max), y2: y(max), class: 'bw-grid' }),
    s('line', { x1: pad, x2: W - pad, y1: y(min), y2: y(min), class: 'bw-grid' }),
    s('text', { x: 2, y: y(max) + 4, class: 'bw-axis' }, String(max)),
    s('text', { x: 2, y: y(min) + 4, class: 'bw-axis' }, String(min)),
    s('text', { x: pad, y: H - 6, class: 'bw-axis' }, fmtMonthDay(list[0].d)),
    s('text', { x: W - pad, y: H - 6, class: 'bw-axis', 'text-anchor': 'end' }, fmtMonthDay(list[list.length - 1].d)),
    s('polyline', { points: pts, class: 'bw-line' }),
    ...list.map((b) => s('rect', { x: x(b.d) - 3, y: y(b.w) - 3, width: 6, height: 6, class: 'bw-dot' })),
  );
}

export function renderBody(ctx) {
  const restore = keepFocus();
  const bt = ctx.vm.body;
  const unit = ctx.state.settings?.unit ?? 'lb';
  const submit = (e) => {
    e.preventDefault();
    const w = Number(String(draftGet(ctx, 'bw.w', '')).replace(/[^\d.]/g, ''));
    const d = draftGet(ctx, 'bw.d', ctx.today) || ctx.today;
    if (!(w > 0) || !isISODate(d)) {
      ctx.toast('Type a weight like 172.4', { kind: 'error' });
      return;
    }
    draftClear(ctx, 'bw.w');
    ctx.act('logBody', { d, w }, { toast: `Body weight ${w} ${unit} · ${fmtDay(d)}` });
  };
  const root = h('div.body-view',
    h('section.panel.is-cyan',
      h('header.panel-head', h('h2', h('span.slash', '//'), 'Body weight'), h('span.label.is-bracket', 'optional')),
      h('div.panel-body.stack',
        h('form.bw-form', { onsubmit: submit },
          h('label.field-row', { for: 'bw-w' }, h('span.label', `weight (${unit})`),
            h('input.field.bw-input#bw-w', { inputmode: 'decimal', placeholder: bt.last ? String(bt.last.w) : '172.4', value: draftGet(ctx, 'bw.w', ''), oninput: (e) => draftSet(ctx, 'bw.w', e.currentTarget.value) })),
          h('label.field-row', { for: 'bw-d' }, h('span.label', 'day'),
            h('input.field#bw-d', { type: 'date', value: draftGet(ctx, 'bw.d', ctx.today), max: ctx.today, onchange: (e) => draftSet(ctx, 'bw.d', e.currentTarget.value) })),
          h('button.btn.btn-hot', { type: 'submit' }, ic(ctx, 'check'), 'Log'),
        ),
        bt.last
          ? h('div.bw-stats',
            h('div.bw-stat', h('span.label', 'latest'), h('span.shout.bw-big', String(bt.last.w)), h('span.faint', fmtDay(bt.last.d))),
            h('div.bw-stat', h('span.label', '7-day change'), h('span.shout.bw-big', bt.change7 == null ? '—' : `${bt.change7 > 0 ? '+' : ''}${bt.change7}`)),
            h('div.bw-stat', h('span.label', `since ${fmtDay(bt.list[0].d)}`), h('span.shout.bw-big', bt.changeAll == null ? '—' : `${bt.changeAll > 0 ? '+' : ''}${bt.changeAll}`)),
          )
          : h('div.empty', h('p.scrawl', 'No weigh-ins yet.'), h('p', 'Totally optional. Log here, or tell Claude "weighed 172.4".')),
        chart(bt.list),
      ),
    ),
    bt.list.length ? h('section.panel',
      h('header.panel-head', h('h2', h('span.slash', '//'), 'History')),
      h('div.panel-body', h('ul.bw-list', bt.list.slice().reverse().slice(0, 30).map((b) => h('li.bw-row',
        h('span.num', fmtDay(b.d)), h('b.num', `${b.w} ${unit}`),
        h('button.btn.btn-sm.btn-ghost', { type: 'button', 'aria-label': `Delete ${fmtDay(b.d)}`, onclick: () => ctx.act('deleteBody', { d: b.d }, { toast: 'Removed.', kind: 'info' }) }, ic(ctx, 'x')),
      )))),
    ) : null,
  );
  restore(root);
  return root;
}
