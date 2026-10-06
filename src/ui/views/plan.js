// 2 weeks tab: the rolling 14-day plan (today + 13) with logged workouts, plus last week.
import { h } from '../dom.js';
import { fmtWeekday, fmtMonthDay, fmtDay } from '../../engine/dates.js';
import { ic, typeStyle, typeMark } from './common.js';

const DRAG = 'application/x-wk-plan';

function chipFor(ctx, p, { compact }) {
  const type = ctx.type(p.type);
  return h('button.cal-chip', {
    type: 'button',
    style: typeStyle(type),
    class: `is-${p.status}`,
    draggable: p.status === 'planned' ? 'true' : 'false',
    title: `${p.title} · ${p.status}`,
    ondragstart: (e) => {
      e.dataTransfer.setData(DRAG, p.id);
      e.dataTransfer.setData('text/plain', p.id);
      e.dataTransfer.effectAllowed = 'move';
    },
    onclick: () => ctx.openPlan(p.id),
  }, h('i.catdot', { style: typeStyle(type) }), h('span', p.title), !compact && p.items.length ? h('span.cal-chip-n', String(p.items.length)) : null);
}

function doneChip(ctx, w) {
  const type = ctx.type(w.type);
  const prs = ctx.vm.prs.get(w.id) ?? [];
  return h('button.cal-chip.is-logged', { type: 'button', style: typeStyle(type), title: `${w.title} (logged)`, onclick: () => ctx.openWorkout(w.id) },
    ic(ctx, 'check'), h('span', w.title), prs.length ? h('span.cal-chip-pr', '★') : null);
}

function dayCell(ctx, day, { compact }) {
  const plans = day.plans.filter((p) => p.status !== 'done');
  const items = [...day.workouts.map((w) => doneChip(ctx, w)), ...plans.map((p) => chipFor(ctx, p, { compact }))];
  const cell = h('div.cal-day', {
    class: [day.isToday ? 'is-today' : '', day.isPast ? 'is-past' : '', day.isWeekend ? 'is-weekend' : '', items.length ? '' : 'is-empty'].join(' '),
    ondragover: (e) => {
      if (![...(e.dataTransfer?.types ?? [])].includes(DRAG)) return;
      e.preventDefault();
      cell.classList.add('is-drop');
    },
    ondragleave: () => cell.classList.remove('is-drop'),
    ondrop: (e) => {
      cell.classList.remove('is-drop');
      const id = e.dataTransfer.getData(DRAG);
      if (!id) return;
      e.preventDefault();
      ctx.act('movePlan', { id, to: day.d }, { toast: `Moved to ${fmtDay(day.d)}` });
    },
  },
    h('div.cal-day-head',
      h('span.tape', { class: day.isToday ? 'is-hot' : '' }, day.isToday ? `TODAY ${fmtMonthDay(day.d)}` : `${fmtWeekday(day.d)} ${fmtMonthDay(day.d)}`.toUpperCase()),
      h('button.cal-add', { type: 'button', 'aria-label': `Plan a workout on ${fmtDay(day.d)}`, onclick: () => ctx.newPlan(day.d) }, ic(ctx, 'plus')),
    ),
    h('div.cal-items', items.length ? items : h('span.cal-rest', day.isPast ? '—' : 'rest')),
  );
  return cell;
}

/** The 14 days from today. compact = overview strip. */
export function renderStrip(ctx, { compact = false } = {}) {
  return h('div.cal-grid', { class: compact ? 'is-compact' : '' }, ctx.vm.cal.map((day) => dayCell(ctx, day, { compact })));
}

export function renderPlan(ctx) {
  const up = ctx.vm.upcoming;
  return h('div.plan',
    h('section.panel.is-cyan',
      h('header.panel-head',
        h('h2', h('span.slash', '//'), 'Next 2 weeks'),
        h('span.label.is-bracket', `${up.length} planned`),
      ),
      h('div.panel-body',
        h('p.plan-hint.muted', 'Tap + on a day to plan it, drag a plan to move it, or tell Claude: "plan pull day wed, legs fri".'),
        renderStrip(ctx),
      ),
    ),
    h('section.panel',
      h('header.panel-head', h('h2', h('span.slash', '//'), 'Last 7 days')),
      h('div.panel-body', h('div.cal-grid.is-week', ctx.vm.past.map((day) => dayCell(ctx, day, { compact: true })))),
    ),
    up.length ? h('section.panel',
      h('header.panel-head', h('h2', h('span.slash', '//'), 'Planned')),
      h('div.panel-body.stack', up.map((p) => {
        const type = ctx.type(p.type);
        return h('button.plan-list-row', { type: 'button', style: typeStyle(type), onclick: () => ctx.openPlan(p.id) },
          typeMark(type), h('span.plan-list-day.num', fmtDay(p.d)), h('span.plan-list-title', p.title),
          h('span.faint', p.items.map((i) => ctx.ex(i.ex).name).join(', ')));
      })),
    ) : null,
  );
}
