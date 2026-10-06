// Edit sheets: a logged workout (or a new past one), and a planned workout.
// Fields save on change. Each exercise line is plain text ("3x8 @185") re-read by the
// same parser chat uses, so the website and Claude agree on what numbers mean.
import { h, mount, isSaneDate } from '../dom.js';
import { fmtDay } from '../../engine/dates.js';
import { parseNumbers, parseWorkout, fmtItem, trimNum } from '../../engine/parse.js';
import { fmtPR, lastSeen } from '../../engine/stats.js';
import { ic, typeMark, typeStyle, keepFocus } from './common.js';

/** "3x8 @185" for an item's sets, the way a person would type them back. */
export function itemText(item) {
  const sets = item.sets ?? [];
  const parts = [];
  const groups = [];
  for (const s of sets) {
    const g = groups[groups.length - 1];
    if (g && g.r === s.r && g.w === s.w && (g.s ?? null) === (s.s ?? null)) g.n++;
    else groups.push({ n: 1, r: s.r, w: s.w, s: s.s ?? null });
  }
  for (const g of groups) {
    if (g.s) parts.push(`${g.n}x${g.s}s`);
    else if (g.r != null && g.w != null) parts.push(g.n > 1 ? `${g.n}x${g.r} @${trimNum(g.w)}` : `${trimNum(g.w)}x${g.r}`);
    else if (g.r != null) parts.push(g.n > 1 ? `${g.n}x${g.r}` : `${g.r} reps`);
    else if (g.w != null) parts.push(`@${trimNum(g.w)}`);
  }
  if (item.dist != null) parts.push(`${trimNum(item.dist)} mi`);
  if (item.min != null) parts.push(`${trimNum(item.min)} min`);
  return parts.join(', ');
}

/** Item numbers from a typed line; null when nothing readable. */
export function readItemLine(text, ctx, prev) {
  const t = String(text ?? '').trim();
  if (!t) return { ...prev, sets: [], dist: null, min: null };
  // several comma-separated chunks are all sets of this one exercise
  const sets = [];
  let dist = null;
  let min = null;
  for (const chunk of t.split(/\s*[,;]\s*/)) {
    const n = parseNumbers(chunk, { unit: ctx.state.settings?.unit, dist: ctx.state.settings?.dist });
    sets.push(...n.sets);
    if (n.dist != null) dist = n.dist;
    if (n.min != null) min = n.min;
  }
  if (!sets.length && dist == null && min == null) return null;
  return { ...prev, sets, dist, min };
}

function shell(ctx, { key, tone, type, title, chips, body, foot }) {
  return h('div.overlay-root', { 'data-key': key },
    h('button.overlay-backdrop', { type: 'button', 'aria-label': 'Close', onclick: () => ctx.closeOverlay() }),
    h('div.sheet.is-side', { class: tone ? `tone-${tone}` : '', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.sheet-head', { style: typeStyle(type) },
        typeMark(type),
        h('div.sheet-head-main', h('h2.sheet-title', title), chips?.length ? h('div.sheet-head-chips', chips) : null),
        h('button.btn.btn-icon.sheet-close', { type: 'button', 'aria-label': 'Close', onclick: () => ctx.closeOverlay() }, ic(ctx, 'x')),
      ),
      h('div.sheet-body', body),
      foot ? h('div.sheet-foot', foot) : null,
    ),
  );
}

function typeSelect(ctx, id, value, onchange) {
  const types = Object.values(ctx.state.types ?? {}).filter((t) => !t.archived || t.id === value).sort((a, b) => a.order - b.order);
  return h(`select.field#${id}`, { onchange: (e) => onchange(e.currentTarget.value) },
    types.map((t) => h('option', { value: t.id, selected: t.id === value }, t.name)));
}

function field(label, forId, control, hint) {
  return h('label.dr-field.field-row', { for: forId }, h('span.label', label), control, hint ? h('span.dr-hint', hint) : null);
}

function itemsSection(ctx, { items, onItems, idPrefix, d }) {
  const draftKey = `${idPrefix}-new`;
  const rows = items.map((it, i) => {
    const ex = ctx.ex(it.ex);
    const prev = lastSeen(ctx.state, it.ex, d);
    const inputId = `${idPrefix}-it-${it.id}`;
    return h('li.it-row',
      h('div.it-head',
        h('b.it-name', ex.name),
        h('span.label', ex.kind),
        h('button.btn.btn-icon.btn-sm.it-del', { type: 'button', 'aria-label': `Remove ${ex.name}`, onclick: () => onItems(items.filter((x) => x.id !== it.id)) }, ic(ctx, 'x')),
      ),
      h(`input.field.it-input#${inputId}`, {
        value: itemText(it),
        placeholder: ex.kind === 'cardio' ? '3 mi in 27 min' : ex.kind === 'time' ? '3x45s' : '3x8 @185  or  185x8, 195x6',
        'aria-label': `${ex.name} sets`,
        onchange: (e) => {
          const next = readItemLine(e.currentTarget.value, ctx, it);
          if (!next) {
            ctx.toast(`Couldn't read "${e.currentTarget.value}". Try 3x8 @185.`, { kind: 'error' });
            return;
          }
          onItems(items.map((x) => (x.id === it.id ? next : x)));
        },
      }),
      h('span.it-read.num', fmtItem(it, ctx.state.settings) || 'no numbers yet'),
      prev ? h('span.dr-hint', `last time ${fmtDay(prev.d)}: ${fmtItem(prev.item, ctx.state.settings)}`) : null,
    );
  });
  const addInput = h(`input.field#${draftKey}`, {
    placeholder: 'add: lat pulldown 3x10 @140',
    value: ctx.ui.sheetDraft?.[draftKey] ?? '',
    oninput: (e) => {
      ctx.ui.sheetDraft = { ...(ctx.ui.sheetDraft ?? {}), [draftKey]: e.currentTarget.value };
    },
    onkeydown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        add();
      }
    },
  });
  function add() {
    const text = addInput.value.trim();
    if (!text) return;
    const p = parseWorkout(text, { today: ctx.today, state: ctx.state });
    if (!p.items.length) {
      ctx.toast(`Couldn't find an exercise in "${text}".`, { kind: 'error' });
      return;
    }
    let n = items.length;
    const used = new Set(items.map((x) => x.id));
    const extra = p.items.map((it) => {
      let id;
      do id = `i${++n}`; while (used.has(id));
      used.add(id);
      return { ...it, id };
    });
    ctx.ui.sheetDraft = { ...(ctx.ui.sheetDraft ?? {}), [draftKey]: '' };
    onItems([...items, ...extra]);
  }
  return h('div.dr-sec',
    h('div.dr-sec-head', h('span.label', 'Exercises'), h('span.label', String(items.length))),
    items.length ? h('ul.it-list', rows) : h('p.dr-hint', 'No exercises yet. Add them below, one per line, like you would tell Claude.'),
    h('div.dr-inline', addInput, h('button.btn', { type: 'button', onclick: add }, ic(ctx, 'plus'), 'Add')),
  );
}

// ------------------------------------------------------------------ workout

export function renderWorkoutSheet(ctx) {
  const restore = keepFocus();
  const sh = ctx.ui.sheet;
  const w = sh.id ? ctx.state.workouts?.[sh.id] : null;
  if (sh.id && !w) return null;
  if (!w) return newWorkoutSheet(ctx, sh);
  const type = ctx.type(w.type);
  const prs = ctx.vm.prs.get(w.id) ?? [];
  const edit = (patch, toast) => ctx.act('editWorkout', { id: w.id, patch }, { toast });
  const confirm = ctx.ui.sheetConfirm === w.id;
  const node = shell(ctx, {
    key: `w:${w.id}`, tone: 'acid', type, title: w.title,
    chips: [h('span.chip.dr-cat-chip', type.name.toUpperCase()), h('span.chip', fmtDay(w.d)), prs.length ? h('span.chip.chip-acid', `★ ${prs.length} PR`) : null],
    body: [
      field('Title', 'ws-title', h('input.field#ws-title', { value: w.title, onchange: (e) => e.currentTarget.value.trim() && edit({ title: e.currentTarget.value.trim() }) })),
      h('div.dr-grid.cols-3',
        field('Day', 'ws-d', h('input.field#ws-d', { type: 'date', value: w.d, max: ctx.today, onchange: (e) => isSaneDate(e.currentTarget.value, { required: true }) && edit({ d: e.currentTarget.value }, `Moved to ${fmtDay(e.currentTarget.value)}`) })),
        field('Type', 'ws-type', typeSelect(ctx, 'ws-type', w.type, (v) => edit({ type: v }))),
        field('Minutes', 'ws-min', h('input.field#ws-min', { inputmode: 'numeric', value: w.min ?? '', placeholder: '—', onchange: (e) => edit({ min: e.currentTarget.value.trim() ? Number(e.currentTarget.value) || null : null }) })),
      ),
      itemsSection(ctx, { items: w.items, d: w.d, idPrefix: 'ws', onItems: (items) => edit({ items }) }),
      prs.length ? h('div.dr-sec.is-pr', h('div.dr-sec-head', h('span.label', '★ Personal records')), h('ul.wk-prs', prs.map((p) => h('li.wk-pr', fmtPR(p, ctx.state.settings))))) : null,
      field('Notes', 'ws-notes', h('textarea.field#ws-notes', { rows: 3, placeholder: 'how it felt, what to change next time', value: w.notes, onchange: (e) => edit({ notes: e.currentTarget.value }) })),
      h('div.dr-field', h('span.label', 'Felt'),
        h('div.seg', [1, 2, 3, 4, 5].map((n) => h('button.seg-btn', { type: 'button', 'aria-pressed': String(w.feel === n), onclick: () => edit({ feel: w.feel === n ? null : n }) }, ['rough', 'meh', 'ok', 'good', 'great'][n - 1])))),
      h('p.dr-meta', `logged from ${w.src === 'dash' ? 'the website' : w.src === 'chat' ? 'chat' : 'import'}${w.plan ? ' · checks off a plan' : ''}`),
    ],
    foot: [
      h('button.btn.dr-delete', {
        type: 'button', class: confirm ? 'is-confirm' : '',
        onclick: () => {
          if (!confirm) return ctx.setUI({ sheetConfirm: w.id });
          ctx.closeOverlay();
          ctx.act('deleteWorkout', { id: w.id }, { toast: `Deleted ${w.title}`, kind: 'info' });
        },
      }, ic(ctx, 'trash'), confirm ? 'Really delete?' : 'Delete'),
      h('button.btn.btn-ghost', { type: 'button', onclick: () => ctx.closeOverlay() }, 'Done'),
    ],
  });
  restore(node);
  return node;
}

function newWorkoutSheet(ctx, sh) {
  const key = 'new-workout';
  const draft = ctx.ui.sheetDraft ?? {};
  const set = (k, v) => {
    ctx.ui.sheetDraft = { ...(ctx.ui.sheetDraft ?? {}), [k]: v };
  };
  const preview = h('div.nw-preview');
  const showPreview = () => {
    const text = String(ctx.ui.sheetDraft?.text ?? '').trim();
    if (!text) return mount(preview, h('p.dr-hint', 'Same words you would tell Claude: legs: squat 5x5 @225, rdl 3x8 @185, 50 min'));
    const p = parseWorkout(text, { today: ctx.today, state: ctx.state });
    mount(preview, h('p.dr-hint', `${p.title} · ${ctx.type(p.type).name}${p.min ? ` · ${p.min} min` : ''}`), h('ul.wk-items', p.items.map((it) => h('li.wk-item', h('span.wk-item-name', it.name), h('span.wk-item-sets.num', fmtItem(it, ctx.state.settings))))));
  };
  const node = shell(ctx, {
    key, tone: 'acid', type: ctx.type('other'), title: 'Add a past workout',
    body: [
      field('What you did', 'nw-text', h('textarea.field#nw-text', { rows: 3, value: draft.text ?? '', placeholder: 'push day: bench 3x8 @185, ohp 3x10 @95', oninput: (e) => { set('text', e.currentTarget.value); showPreview(); } })),
      field('Day', 'nw-d', h('input.field#nw-d', { type: 'date', value: draft.d ?? sh.d ?? ctx.today, max: ctx.today, onchange: (e) => set('d', e.currentTarget.value) })),
      preview,
    ],
    foot: [
      h('button.btn.btn-hot', {
        type: 'button',
        onclick: async () => {
          const text = String(ctx.ui.sheetDraft?.text ?? '').trim();
          if (!text) return ctx.toast('Type what you did first.', { kind: 'error' });
          const p = parseWorkout(text, { today: ctx.today, state: ctx.state });
          const d = ctx.ui.sheetDraft?.d || sh.d || ctx.today;
          if (isSaneDate(d, { required: true })) p.d = d;
          const res = await ctx.act('logWorkout', p, { toast: (x) => `Logged ${p.title} · ${fmtDay(p.d)}${x.prs?.length ? ` · ★ ${x.prs.length} PR` : ''}` });
          if (res?.writes?.length) ctx.closeOverlay();
        },
      }, ic(ctx, 'check'), 'Log it'),
      h('button.btn.btn-ghost', { type: 'button', onclick: () => ctx.closeOverlay() }, 'Cancel'),
    ],
  });
  showPreview();
  return node;
}

// ------------------------------------------------------------------ plan

export function renderPlanSheet(ctx) {
  const restore = keepFocus();
  const sh = ctx.ui.sheet;
  const p = sh.id ? ctx.state.plans?.[sh.id] : null;
  if (sh.id && !p) return null;
  if (!p) return newPlanSheet(ctx, sh);
  const type = ctx.type(p.type);
  const edit = (patch, toast) => ctx.act('editPlan', { id: p.id, patch }, { toast });
  const confirm = ctx.ui.sheetConfirm === p.id;
  const done = p.status === 'done' && p.workout && ctx.state.workouts?.[p.workout];
  const node = shell(ctx, {
    key: `p:${p.id}`, tone: null, type, title: p.title,
    chips: [h('span.chip.dr-cat-chip', type.name.toUpperCase()), h('span.chip', fmtDay(p.d)), h('span.chip', { class: p.status === 'done' ? 'chip-acid' : p.status === 'skipped' ? 'chip-warn' : 'chip-cyan' }, p.status.toUpperCase())],
    body: [
      done ? h('button.btn.btn-acid', { type: 'button', onclick: () => ctx.openWorkout(p.workout) }, ic(ctx, 'check'), 'Logged: open the workout') : null,
      field('Title', 'ps-title', h('input.field#ps-title', { value: p.title, onchange: (e) => e.currentTarget.value.trim() && edit({ title: e.currentTarget.value.trim() }) })),
      h('div.dr-grid.cols-2',
        field('Day', 'ps-d', h('input.field#ps-d', { type: 'date', value: p.d, onchange: (e) => isSaneDate(e.currentTarget.value, { required: true }) && edit({ d: e.currentTarget.value }, `Moved to ${fmtDay(e.currentTarget.value)}`) })),
        field('Type', 'ps-type', typeSelect(ctx, 'ps-type', p.type, (v) => edit({ type: v }))),
      ),
      itemsSection(ctx, { items: p.items, d: p.d, idPrefix: 'ps', onItems: (items) => edit({ items }) }),
      field('Notes', 'ps-notes', h('textarea.field#ps-notes', { rows: 2, value: p.notes, placeholder: 'focus, targets, where', onchange: (e) => edit({ notes: e.currentTarget.value }) })),
    ],
    foot: [
      p.status === 'planned' ? h('button.btn.btn-acid', {
        type: 'button',
        onclick: async () => {
          const res = await ctx.act('completePlan', { id: p.id }, { toast: (x) => `Logged ${p.title}${x.prs?.length ? ` · ★ ${x.prs.length} PR` : ''}` });
          if (res?.writes?.length) ctx.openWorkout(res.id);
        },
      }, ic(ctx, 'check'), 'Did it') : null,
      p.status === 'planned' ? h('button.btn', { type: 'button', onclick: () => ctx.act('skipPlan', { id: p.id }, { toast: 'Skipped.', kind: 'info', undo: () => ctx.act('unskipPlan', { id: p.id }) }) }, 'Skip') : null,
      p.status === 'skipped' ? h('button.btn', { type: 'button', onclick: () => ctx.act('unskipPlan', { id: p.id }, { toast: 'Back on the plan.' }) }, 'Unskip') : null,
      h('button.btn.dr-delete', {
        type: 'button', class: confirm ? 'is-confirm' : '',
        onclick: () => {
          if (!confirm) return ctx.setUI({ sheetConfirm: p.id });
          ctx.closeOverlay();
          ctx.act('deletePlan', { id: p.id }, { toast: 'Plan removed.', kind: 'info' });
        },
      }, ic(ctx, 'trash'), confirm ? 'Really?' : 'Delete'),
      h('button.btn.btn-ghost', { type: 'button', onclick: () => ctx.closeOverlay() }, 'Done'),
    ],
  });
  restore(node);
  return node;
}

function newPlanSheet(ctx, sh) {
  const draft = ctx.ui.sheetDraft ?? {};
  const set = (k, v) => {
    ctx.ui.sheetDraft = { ...(ctx.ui.sheetDraft ?? {}), [k]: v };
  };
  const types = Object.values(ctx.state.types ?? {}).filter((t) => !t.archived).sort((a, b) => a.order - b.order);
  const chosen = draft.type ?? null;
  const node = shell(ctx, {
    key: 'new-plan', tone: null, type: chosen ? ctx.type(chosen) : ctx.type('other'), title: `Plan ${fmtDay(draft.d ?? sh.d ?? ctx.today)}`,
    body: [
      h('div.dr-field', h('span.label', 'Type'),
        h('div.type-pick', types.map((t) => h('button.type-pick-btn', {
          type: 'button', style: typeStyle(t), 'aria-pressed': String(chosen === t.id),
          onclick: () => ctx.setUI({ sheetDraft: { ...(ctx.ui.sheetDraft ?? {}), type: t.id } }),
        }, typeMark(t), t.name)))),
      field('Day', 'np-d', h('input.field#np-d', { type: 'date', value: draft.d ?? sh.d ?? ctx.today, min: ctx.today, onchange: (e) => ctx.setUI({ sheetDraft: { ...(ctx.ui.sheetDraft ?? {}), d: e.currentTarget.value } }) })),
      field('Exercises (optional)', 'np-text', h('textarea.field#np-text', { rows: 2, value: draft.text ?? '', placeholder: 'squat 5x5 @235, rdl 3x8 @195', oninput: (e) => set('text', e.currentTarget.value) })),
    ],
    foot: [
      h('button.btn.btn-hot', {
        type: 'button',
        onclick: async () => {
          const d = ctx.ui.sheetDraft?.d || sh.d || ctx.today;
          const text = String(ctx.ui.sheetDraft?.text ?? '').trim();
          const p = text ? parseWorkout(text, { today: ctx.today, state: ctx.state, mode: 'plan' }) : { items: [] };
          const type = ctx.ui.sheetDraft?.type ?? (text ? p.type : 'other');
          const t = ctx.type(type);
          const title = t.kind === 'lift' ? (t.id === 'full' ? 'Full body' : `${t.name.replace(/s$/, '')} day`) : t.name;
          const res = await ctx.act('planWorkout', { d, type, title, items: p.items ?? [] }, { toast: `Planned ${title} · ${fmtDay(d)}` });
          if (res?.writes?.length) ctx.closeOverlay();
        },
      }, ic(ctx, 'plus'), 'Plan it'),
      h('button.btn.btn-ghost', { type: 'button', onclick: () => ctx.closeOverlay() }, 'Cancel'),
    ],
  });
  return node;
}
