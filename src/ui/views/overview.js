// Today tab: today's panel, Claude's note, the 2-week strip, recent workouts, heatmap.
import { h } from '../dom.js';
import { fmtDay, fmtRelative, fmtWeekday } from '../../engine/dates.js';
import { ic, typeMark, typeStyle, itemsList, prList, agoLabel, dayLabel, fmtMin, goTab } from './common.js';
import { renderStrip } from './plan.js';
import { heatGrid, streakBlock } from './lifts.js';

export function renderOverview(ctx) {
  if (!ctx.loaded) {
    return h('div.ov', ['Today', 'Claude says', 'Next 2 weeks', 'Recent'].map((t) => h('section.panel.is-skel', h('header.panel-head', h('h2', h('span.slash', '//'), t)), h('div.panel-body', h('p.label.skel', 'LOADING…')))));
  }
  return h('div.ov',
    todayPanel(ctx),
    h('div.ov-brief', renderBrief(ctx)),
    h('section.panel.ov-cal', h('header.panel-head', h('h2', h('span.slash', '//'), 'Next 2 weeks'), h('button.btn.btn-sm', { type: 'button', onclick: () => goTab(ctx, 'plan') }, 'Open', ic(ctx, 'arrow-right'))), h('div.panel-body', renderStrip(ctx, { compact: true }))),
    recentPanel(ctx),
    h('section.panel.is-acid.ov-heat', h('header.panel-head', h('h2', h('span.slash', '//'), 'Streak')), h('div.panel-body', streakBlock(ctx), heatGrid(ctx))),
  );
}

function todayPanel(ctx) {
  const tv = ctx.vm.today;
  const rows = [];
  if (tv.missed.length) {
    rows.push(h('div.sec-head.is-warn', h('span.label', 'Planned, not logged: did it happen?'), h('span.label', String(tv.missed.length))));
    for (const p of tv.missed) rows.push(missedRow(ctx, p));
  }
  if (tv.workouts.length) {
    rows.push(h('div.sec-head', h('span.label', 'Logged today'), h('span.label', String(tv.workouts.length))));
    for (const w of tv.workouts) rows.push(workoutCard(ctx, w, { compact: false }));
  }
  if (tv.planned.length) {
    rows.push(h('div.sec-head', h('span.label', 'Planned today')));
    for (const p of tv.planned) rows.push(planRow(ctx, p));
  }
  if (!rows.length) {
    rows.push(h('div.empty',
      h('p.scrawl', 'Nothing logged today.'),
      h('p', 'Type what you did in the terminal above, or tell Claude. Rest days count too.'),
      h('button.btn.btn-sm', { type: 'button', onclick: () => ctx.newPlan(ctx.today) }, ic(ctx, 'plus'), 'Plan today'),
    ));
  }
  return h('section.panel.is-pink.ov-today',
    h('header.panel-head', h('h2', h('span.slash', '//'), 'Today'), h('span.tape', fmtDay(ctx.today))),
    h('div.panel-body.stack', rows),
  );
}

export function planRow(ctx, p) {
  const type = ctx.type(p.type);
  return h('div.plan-row', { style: typeStyle(type), 'data-plan-id': p.id },
    typeMark(type),
    h('button.plan-row-main', { type: 'button', onclick: () => ctx.openPlan(p.id) },
      h('span.plan-row-title', p.title),
      h('span.plan-row-meta', [p.time ? p.time : null, p.items.length ? `${p.items.length} exercises` : null, p.notes || null].filter(Boolean).join(' · ') || type.name),
    ),
    h('div.plan-row-btns',
      h('button.btn.btn-acid.btn-sm', {
        type: 'button',
        onclick: (e) => {
          const row = e.currentTarget.closest('.plan-row');
          ctx.act('completePlan', { id: p.id }, { toast: (x) => `Logged ${p.title}${x.prs?.length ? ` · ★ ${x.prs.length} PR` : ''}` }).then((x) => {
            if (x?.writes?.length) {
              ctx.fx.burst(row, 'var(--acid)');
              ctx.fx.stamp(row, 'DONE');
            }
          });
        },
      }, ic(ctx, 'check'), 'Did it'),
    ),
  );
}

function missedRow(ctx, p) {
  const type = ctx.type(p.type);
  return h('div.plan-row.is-missed', { style: typeStyle(type) },
    typeMark(type),
    h('button.plan-row-main', { type: 'button', onclick: () => ctx.openPlan(p.id) },
      h('span.plan-row-title', p.title),
      h('span.plan-row-meta', `${fmtDay(p.d)} · ${fmtRelative(p.d, ctx.today)}`),
    ),
    h('div.plan-row-btns',
      h('button.btn.btn-acid.btn-sm', { type: 'button', onclick: () => ctx.act('completePlan', { id: p.id }, { toast: `Logged ${p.title} on ${fmtDay(p.d)}` }) }, ic(ctx, 'check'), 'Yes'),
      h('button.btn.btn-sm', { type: 'button', onclick: () => ctx.openPlan(p.id) }, 'Move'),
      h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => ctx.act('skipPlan', { id: p.id }, { toast: 'Skipped. No big deal.', kind: 'info', undo: () => ctx.act('unskipPlan', { id: p.id }) }) }, 'Skip'),
    ),
  );
}

/** A logged workout: tape day, type mark, title, minutes, items, PRs. Click opens the editor. */
export function workoutCard(ctx, w, { compact = false, showDay = false } = {}) {
  const type = ctx.type(w.type);
  const prs = ctx.vm.prs.get(w.id) ?? [];
  return h('article.wk-card', { style: typeStyle(type), class: prs.length ? 'has-pr' : '', 'data-workout-id': w.id },
    h('button.wk-card-head', { type: 'button', onclick: () => ctx.openWorkout(w.id), 'aria-label': `Edit ${w.title}` },
      typeMark(type),
      h('span.wk-card-title', w.title),
      showDay ? h('span.wk-card-day', dayLabel(w.d, ctx.today)) : null,
      w.min ? h('span.chip', fmtMin(w.min)) : null,
      prs.length ? h('span.chip.chip-acid', `★ ${prs.length} PR`) : null,
      h('span.wk-card-edit', ic(ctx, 'edit')),
    ),
    itemsList(ctx, w.items, { compact }),
    compact ? null : prList(ctx, prs),
    w.notes && !compact ? h('p.wk-notes', w.notes) : null,
    !w.items.length && !compact ? h('button.wk-add-items', { type: 'button', onclick: () => ctx.openWorkout(w.id) }, ic(ctx, 'plus'), 'Add exercises / numbers') : null,
  );
}

function recentPanel(ctx) {
  const list = ctx.vm.log.filter((r) => r.workout.d < ctx.today).slice(0, 5);
  return h('section.panel.ov-recent',
    h('header.panel-head', h('h2', h('span.slash', '//'), 'Recent'), h('button.btn.btn-sm', { type: 'button', onclick: () => goTab(ctx, 'log') }, 'Full log', ic(ctx, 'arrow-right'))),
    h('div.panel-body.stack',
      list.length ? list.map((r) => workoutCard(ctx, r.workout, { compact: true, showDay: true })) : h('div.empty', h('p.scrawl', 'Day one.'), h('p', 'Older workouts show up here.')),
    ),
  );
}

export function renderBrief(ctx) {
  const b = ctx.state.brief;
  if (!b) {
    return h('div.brief', h('div.sticker.brief-card.is-empty',
      h('div.brief-top', h('span.brief-label', ic(ctx, 'chat'), 'Claude says')),
      h('p.brief-headline.scrawl', 'No check-in yet.'),
      h('p.brief-empty', 'Message Claude: ', h('b', 'did legs: squat 5x5 @225')),
    ));
  }
  return h('div.brief', h('div.sticker.brief-card',
    h('div.brief-top', h('span.brief-label', ic(ctx, 'chat'), 'Claude says'), h('span.brief-when', `updated ${agoLabel(b.at, ctx.now)}`)),
    h('p.brief-headline.scrawl', b.headline),
    b.lines.length ? h('ul.brief-lines', b.lines.map((l) => h('li', l))) : null,
    b.asks.length ? h('ul.brief-asks', b.asks.map((a) => h('li', h('span.brief-q', '?'), h('span', a)))) : null,
  ));
}

export { fmtWeekday };
