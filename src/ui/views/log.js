// Log tab: every workout, newest first, grouped by week, filterable by type and exercise.
import { h } from '../dom.js';
import { fmtDay, startOfWeek, addDays } from '../../engine/dates.js';
import { workoutVolume, workoutDist } from '../../engine/stats.js';
import { ic, typeStyle, keepFocus, draftGet, draftSet, kfmt } from './common.js';
import { workoutCard } from './overview.js';

export function renderLog(ctx) {
  const restore = keepFocus();
  const f = ctx.ui.filters ?? {};
  const q = String(draftGet(ctx, 'log.q', '')).trim().toLowerCase();
  let rows = ctx.vm.log;
  if (f.type) rows = rows.filter((r) => r.workout.type === f.type);
  if (f.pr) rows = rows.filter((r) => r.prs.length);
  if (q) {
    rows = rows.filter((r) => {
      const w = r.workout;
      const hay = `${w.title} ${w.notes} ${w.items.map((i) => ctx.ex(i.ex).name).join(' ')}`.toLowerCase();
      return q.split(/\s+/).every((x) => hay.includes(x));
    });
  }
  const usedTypes = [...new Set(ctx.vm.log.map((r) => r.workout.type))];
  const weeks = new Map();
  for (const r of rows) {
    const k = startOfWeek(r.workout.d, ctx.state.settings?.weekStart ?? 'mon');
    if (!weeks.has(k)) weeks.set(k, []);
    weeks.get(k).push(r);
  }
  const setFilter = (patch) => ctx.setUI({ filters: { ...f, ...patch } });

  const root = h('div.log',
    h('div.log-bar.panel',
      h('label.log-search',
        ic(ctx, 'search'),
        h('input.field#log-search', {
          type: 'search', placeholder: 'search: bench, legs, notes…', value: draftGet(ctx, 'log.q', ''),
          'aria-label': 'Search workouts',
          oninput: (e) => {
            draftSet(ctx, 'log.q', e.currentTarget.value);
            ctx.rerender();
          },
        }),
      ),
      h('div.log-chips',
        h('button.chip', { type: 'button', class: !f.type && !f.pr ? 'chip-hot' : '', onclick: () => setFilter({ type: null, pr: false }) }, 'ALL'),
        h('button.chip', { type: 'button', class: f.pr ? 'chip-acid' : '', onclick: () => setFilter({ pr: !f.pr }) }, '★ PRS'),
        usedTypes.map((t) => {
          const type = ctx.type(t);
          return h('button.chip.type-chip', { type: 'button', style: typeStyle(type), class: f.type === t ? 'is-on' : '', onclick: () => setFilter({ type: f.type === t ? null : t }) }, type.name.toUpperCase());
        }),
      ),
      h('button.btn.btn-sm', { type: 'button', onclick: () => ctx.newWorkout(ctx.today) }, ic(ctx, 'plus'), 'Add past workout'),
    ),
    rows.length
      ? [...weeks.entries()].map(([start, list]) => {
        const vol = list.reduce((a, r) => a + workoutVolume(r.workout), 0);
        const dist = list.reduce((a, r) => a + workoutDist(r.workout), 0);
        return h('section.log-week',
          h('header.log-week-head',
            h('span.tape', `WEEK OF ${fmtDay(start).toUpperCase()}`),
            h('span.label', `${list.length} workout${list.length === 1 ? '' : 's'}${vol ? ` · ${kfmt(vol)} ${ctx.state.settings?.unit ?? 'lb'}` : ''}${dist ? ` · ${Math.round(dist * 100) / 100} ${ctx.state.settings?.dist ?? 'mi'}` : ''}`),
          ),
          h('div.log-grid', list.map((r) => workoutCard(ctx, r.workout, { showDay: true }))),
        );
      })
      : h('div.empty', h('p.scrawl', ctx.vm.log.length ? 'No matches.' : 'Nothing logged yet.'), h('p', ctx.vm.log.length ? 'Clear the filters.' : 'Type your first workout in the terminal above.')),
  );
  restore(root);
  return root;
}

export { addDays };
