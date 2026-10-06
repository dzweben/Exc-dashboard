// Small helpers every view shares.
import { h, isReplacing } from '../dom.js';
import { icon as iconFallback } from '../icons.js';
import { fmtItem, fmtMin } from '../../engine/parse.js';
import { fmtPR } from '../../engine/stats.js';
import { fmtDay, fmtRelative } from '../../engine/dates.js';

export function ic(ctx, name) {
  try {
    return (typeof ctx?.icon === 'function' ? ctx.icon : iconFallback)(name) ?? null;
  } catch {
    return null;
  }
}

/** Colored square with the type's glyph. */
export function typeMark(type, title) {
  return h('span.catmark', { style: { '--c': type?.color ?? '#7a776f' }, title: title ?? type?.name ?? '', 'aria-hidden': 'true' }, type?.glyph ?? '··');
}

export const typeStyle = (type) => ({ '--c': type?.color ?? '#7a776f' });

/** Keep the caret on the element with the same id across a full re-render. */
export function keepFocus() {
  if (typeof document === 'undefined') return () => {};
  const a = document.activeElement;
  if (!a || !a.id || a === document.body || !a.closest?.('#wk-main, #wk-overlay')) return () => {};
  const id = a.id;
  let sel = null;
  try {
    if (typeof a.selectionStart === 'number') sel = [a.selectionStart, a.selectionEnd, a.selectionDirection || 'none'];
  } catch {
    sel = null;
  }
  return (root) => {
    const run = () => {
      const el = document.getElementById(id);
      if (!el || el === document.activeElement) return;
      if (root && typeof root.contains === 'function' && !root.contains(el)) return;
      try { el.focus({ preventScroll: true }); } catch { /* detached */ }
      if (sel) {
        try { el.setSelectionRange(sel[0], sel[1], sel[2]); } catch { /* not a text field */ }
      }
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
  };
}

export function draftGet(ctx, key, fallback = '') {
  const d = ctx?.ui?.drafts;
  return d && typeof d === 'object' && Object.prototype.hasOwnProperty.call(d, key) ? d[key] : fallback;
}
export function draftSet(ctx, key, value) {
  if (!ctx?.ui || typeof ctx.ui !== 'object') return;
  if (!ctx.ui.drafts || typeof ctx.ui.drafts !== 'object') ctx.ui.drafts = {};
  ctx.ui.drafts[key] = value;
}
export function draftClear(ctx, ...keys) {
  const d = ctx?.ui?.drafts;
  if (!d || typeof d !== 'object') return;
  for (const k of keys) delete d[k];
}

/** Props for a text field that edits a stored value and saves on change (draft survives re-renders). */
export function editField(ctx, key, stored, commit) {
  return {
    value: draftGet(ctx, key, stored ?? ''),
    oninput: (e) => draftSet(ctx, key, e.currentTarget.value),
    onchange: (e) => {
      const el = e.currentTarget;
      if (isReplacing(el)) return;
      draftClear(ctx, key);
      commit(el.value, el);
    },
    onblur: (e) => {
      if (!isReplacing(e.currentTarget) && e.currentTarget.value === String(stored ?? '')) draftClear(ctx, key);
    },
  };
}

export function goTab(ctx, tab) {
  if (typeof ctx?.setTab === 'function') ctx.setTab(tab);
}

export function agoLabel(atIso, nowIso) {
  const a = Date.parse(atIso);
  const b = Date.parse(nowIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
  const s = Math.max(0, Math.round((b - a) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** "Mon 10/5" + relative ("today", "3d ago"). */
export function dayLabel(d, today) {
  const rel = fmtRelative(d, today);
  return `${fmtDay(d)}${rel && !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(rel) ? ` · ${rel}` : ''}`;
}

/** 7290 → "7.3k". */
export function kfmt(n) {
  if (n == null) return '0';
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(Math.round(n / 100) / 10).toString()}k`;
  return String(Math.round(n));
}

/** A workout as a compact card body: items + PR lines. */
export function itemsList(ctx, items, { compact = false } = {}) {
  if (!items?.length) return null;
  const shown = compact ? items.slice(0, 4) : items;
  return h('ul.wk-items',
    shown.map((it) => h('li.wk-item',
      h('span.wk-item-name', ctx.ex(it.ex).name),
      h('span.wk-item-sets.num', fmtItem(it, ctx.state.settings) || '—'),
    )),
    compact && items.length > shown.length ? h('li.wk-item.is-more', h('span.faint', `+${items.length - shown.length} more`)) : null,
  );
}

export function prList(ctx, prs) {
  if (!prs?.length) return null;
  return h('ul.wk-prs', prs.map((p) => h('li.wk-pr', h('span.wk-pr-star', '★ PR'), h('span', fmtPR(p, ctx.state.settings)))));
}

export { fmtMin };
