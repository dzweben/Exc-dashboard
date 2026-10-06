// PRs tab: weekly volume + frequency, recent records, every exercise with its bests and trend.
// Also exports the streak block + heatmap the overview uses.
import { h, s } from '../dom.js';
import { fmtDay, fmtMonthDay } from '../../engine/dates.js';
import { fmtItem, fmtPace, trimNum } from '../../engine/parse.js';
import { fmtPR, chronological } from '../../engine/stats.js';
import { ic, typeStyle, kfmt, goTab } from './common.js';
import { renderDue } from './due.js';

export function streakBlock(ctx) {
  const st = ctx.vm.streak;
  const target = ctx.state.settings?.target;
  return h('div.streak',
    h('div.streak-main', h('span.streak-n.shout', String(st.days.current)), h('span.label', st.days.current === 1 ? 'day streak' : 'day streak')),
    h('div.streak-side',
      h('span.label', `best ${st.days.best}d`),
      h('span.label', `${st.weeks.current} wk${st.weeks.current === 1 ? '' : 's'} at ${target ?? 1}+ / wk`),
      h('span.label', `best ${st.weeks.best} wks`),
    ),
  );
}

/** 7 rows (Mon–Sun) × N weeks, colored by the first workout type that day. */
export function heatGrid(ctx) {
  const cells = ctx.vm.heat;
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return h('div.heat', { role: 'img', 'aria-label': `${cells.filter((c) => c.count).length} workout days in the last ${weeks.length} weeks` },
    h('div.heat-days', ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => h('span', d))),
    h('div.heat-cols', weeks.map((wk) => h('div.heat-col', wk.map((c) => {
      const type = c.types.length ? ctx.type(c.types[0]) : null;
      return h('span.heat-cell', {
        class: [c.count ? 'is-on' : '', c.d === ctx.today ? 'is-today' : '', c.future ? 'is-future' : '', c.count > 1 ? 'is-double' : ''].join(' '),
        style: type ? typeStyle(type) : null,
        title: `${fmtDay(c.d)}${c.count ? `: ${c.types.map((t) => ctx.type(t).name).join(' + ')}` : ''}`,
      });
    })))),
  );
}

function weekBars(ctx) {
  const ws = ctx.vm.weeks;
  const maxS = Math.max(1, ...ws.map((w) => w.sessions), ctx.state.settings?.target ?? 0);
  const maxV = Math.max(1, ...ws.map((w) => w.volume));
  const target = ctx.state.settings?.target;
  return h('div.wbars',
    ws.map((w, i) => h('div.wbar', { class: i === ws.length - 1 ? 'is-now' : '', title: `Week of ${fmtDay(w.start)}: ${w.sessions} workouts, ${w.volume} ${ctx.state.settings?.unit ?? 'lb'}` },
      h('span.wbar-n.num', String(w.sessions)),
      h('div.wbar-track',
        target ? h('i.wbar-target', { style: { bottom: `${(target / maxS) * 100}%` } }) : null,
        h('i.wbar-fill', { style: { height: `${(w.sessions / maxS) * 100}%` } }),
        h('i.wbar-vol', { style: { height: `${(w.volume / maxV) * 100}%` } }),
      ),
      h('span.wbar-l.num', fmtMonthDay(w.start).replace(/^(\w{3}) /, '$1 ')),
    )),
  );
}

function spark(values) {
  if (values.length < 2) return null;
  const W = 96;
  const H = 26;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (W - 4) + 2).toFixed(1)},${(H - 3 - ((v - min) / span) * (H - 6)).toFixed(1)}`).join(' ');
  const last = pts.split(' ').pop().split(',');
  return s('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' },
    s('polyline', { points: pts, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }),
    s('rect', { x: Number(last[0]) - 2.5, y: Number(last[1]) - 2.5, width: 5, height: 5, fill: 'var(--acid)' }),
  );
}

function bestLine(ctx, r) {
  const u = ctx.state.settings?.unit ?? 'lb';
  const d = ctx.state.settings?.dist ?? 'mi';
  const b = r.best;
  const parts = [];
  if (b.weight) parts.push(`${trimNum(b.weight.value)} ${u}`);
  if (b.e1rm) parts.push(`e1RM ${Math.round(b.e1rm.value)}`);
  if (b.reps) parts.push(`${b.reps.value} reps`);
  if (b.distance) parts.push(`${trimNum(b.distance.value)} ${d}`);
  if (b.pace) parts.push(`${fmtPace(b.pace.value)}/${d}`);
  if (b.hold) parts.push(`${b.hold.value}s`);
  return parts.join(' · ') || '—';
}

export function renderLifts(ctx) {
  const f = ctx.ui.filters ?? {};
  const allPrs = chronological(ctx.state).reverse().flatMap((w) => (ctx.vm.prs.get(w.id) ?? []).map((p) => ({ ...p, d: w.d, wid: w.id })));
  let rows = ctx.vm.exercises;
  if (f.exType) rows = rows.filter((r) => (ctx.state.exercises?.[r.ex]?.type ?? 'other') === f.exType);
  const types = [...new Set(ctx.vm.exercises.map((r) => ctx.state.exercises?.[r.ex]?.type ?? 'other'))];
  return h('div.lifts',
    h('section.panel.is-cyan.lifts-due',
      h('header.panel-head', h('h2', h('span.slash', '//'), 'Rotation'), h('span.label.is-bracket', 'every exercise · longest since last hit first')),
      h('div.panel-body', renderDue(ctx)),
    ),
    h('section.panel.is-acid.lifts-weeks',
      h('header.panel-head', h('h2', h('span.slash', '//'), 'Weekly'), h('span.label.is-bracket', 'bars: workouts · ghost: volume')),
      h('div.panel-body', weekBars(ctx)),
    ),
    h('section.panel.is-pink.lifts-prs',
      h('header.panel-head', h('h2', h('span.slash', '//'), 'Recent PRs'), h('span.label.is-bracket', `${allPrs.length} total`)),
      h('div.panel-body',
        allPrs.length
          ? h('ul.pr-list', allPrs.slice(0, 12).map((p) => h('li.pr-row', h('span.pr-star.shout', '★'), h('button.pr-text', { type: 'button', onclick: () => ctx.openWorkout(p.wid) }, fmtPR(p, ctx.state.settings)), h('span.pr-day.num', fmtDay(p.d)))))
          : h('div.empty', h('p.scrawl', 'No PRs yet.'), h('p', 'A PR is any session that beats every earlier one on that exercise: heavier, more reps, farther or faster.')),
      ),
    ),
    h('section.panel.lifts-table',
      h('header.panel-head', h('h2', h('span.slash', '//'), 'Exercises'),
        h('div.log-chips',
          h('button.chip', { type: 'button', class: !f.exType ? 'chip-hot' : '', onclick: () => ctx.setUI({ filters: { ...f, exType: null } }) }, 'ALL'),
          types.map((t) => h('button.chip.type-chip', { type: 'button', style: typeStyle(ctx.type(t)), class: f.exType === t ? 'is-on' : '', onclick: () => ctx.setUI({ filters: { ...f, exType: f.exType === t ? null : t } }) }, ctx.type(t).name.toUpperCase())),
        ),
      ),
      h('div.panel-body',
        rows.length
          ? h('div.ex-rows', rows.map((r) => h('div.ex-row', { style: typeStyle(ctx.type(ctx.state.exercises?.[r.ex]?.type ?? 'other')) },
            h('div.ex-name', h('i.catdot'), h('b', r.name), h('span.faint', ` ${r.sessions}×`)),
            h('div.ex-last', h('span.label', `last · ${fmtDay(r.last.d)}`), h('span.num', fmtItem(r.last.item, ctx.state.settings) || '—')),
            h('div.ex-best', h('span.label', 'best'), h('span.num', bestLine(ctx, r))),
            h('div.ex-spark', spark(r.trend.map((t) => t.value))),
          )))
          : h('div.empty', h('p.scrawl', 'Log some lifts.'), h('p', 'Each exercise gets its last session, bests and a trend line here.'), h('button.btn.btn-sm', { type: 'button', onclick: () => goTab(ctx, 'overview') }, 'Go log one')),
      ),
    ),
  );
}

export { kfmt, ic };
