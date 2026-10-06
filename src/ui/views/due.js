// Due next: Danny's rotation, not a routine. Every exercise by how long since it was
// last hit, with what to beat and his goal for it, plus the areas (types) by gap.
import { h } from '../dom.js';
import { fmtItem, trimNum, fmtPace } from '../../engine/parse.js';
import { sinceLabel } from '../../engine/stats.js';
import { ic, typeStyle, goTab } from './common.js';

function bestText(ctx, best) {
  const u = ctx.state.settings?.unit ?? 'lb';
  const d = ctx.state.settings?.dist ?? 'mi';
  const parts = [];
  if (best.weight) parts.push(`${trimNum(best.weight.value)} ${u}`);
  if (best.reps) parts.push(`${best.reps.value} reps`);
  if (best.hold) parts.push(`${best.hold.value}s`);
  if (best.distance) parts.push(`${trimNum(best.distance.value)} ${d}`);
  if (best.pace) parts.push(`${fmtPace(best.pace.value)}/${d}`);
  return parts.join(' · ');
}

/** Put "<exercise> " in the log terminal so the numbers are all that's left to type. */
function startLog(ctx, name) {
  const input = document.getElementById('wk-term');
  if (!input) return;
  input.value = `${name.toLowerCase()} `;
  input.dispatchEvent(new Event('input'));
  input.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function dueTile(ctx, r, { hero = false } = {}) {
  const type = ctx.type(r.area);
  const stale = r.daysSince == null ? 'is-never' : r.daysSince >= 14 ? 'is-stale' : r.daysSince >= 7 ? 'is-warm' : r.daysSince === 0 ? 'is-today' : '';
  return h('div.due', { style: typeStyle(type), class: `${stale}${hero ? ' is-hero' : ''}` },
    h('div.due-top',
      h('span.due-area', type.name.toUpperCase()),
      h('span.due-since.num', sinceLabel(r.daysSince).toUpperCase()),
    ),
    h('b.due-name', r.name),
    r.last ? h('span.due-line', h('span.label', 'last'), h('span.num', fmtItem(r.last.item, ctx.state.settings) || '—')) : h('span.due-line', h('span.label', 'not logged yet')),
    r.sessions > 1 && bestText(ctx, r.best) ? h('span.due-line', h('span.label', 'best'), h('span.num.is-acid', bestText(ctx, r.best))) : null,
    r.goal ? h('span.due-goal', `goal: ${r.goal}`) : null,
    r.daysSince === 0 ? null : h('button.btn.btn-sm.due-log', { type: 'button', onclick: () => startLog(ctx, r.name) }, ic(ctx, 'plus'), 'Log it'),
  );
}

export function renderDue(ctx, { compact = false } = {}) {
  const rot = ctx.vm.rotation;
  if (!rot.length) {
    return h('div.empty', h('p.scrawl', 'Nothing in the rotation yet.'), h('p', 'Everything you log joins it. Tell Claude "add tib raises to the rotation" for things you want to start.'));
  }
  const shown = compact ? rot.filter((r) => r.daysSince !== 0).slice(0, 6) : rot;
  return h('div.due-wrap',
    h('div.due-areas', ctx.vm.areas.map((a) => {
      const t = ctx.type(a.area);
      return h('span.due-area-chip', { style: typeStyle(t), class: a.daysSince == null || a.daysSince >= 10 ? 'is-stale' : '' }, h('i.catdot'), t.name, h('b.num', a.daysSince == null ? 'never' : a.daysSince === 0 ? 'today' : `${a.daysSince}d`));
    })),
    shown.length ? h('div.due-grid', shown.map((r) => dueTile(ctx, r))) : h('p.muted', 'Everything in the rotation got hit today.'),
    compact && rot.length > shown.length ? h('button.btn.btn-sm', { type: 'button', onclick: () => goTab(ctx, 'lifts') }, `All ${rot.length} exercises`, ic(ctx, 'arrow-right')) : null,
  );
}
