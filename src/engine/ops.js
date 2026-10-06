// Every mutation: (state, args, ctx) → { state, writes, activity, ...extra }. Pure; never
// throws on a missing id (returns no writes). ctx = { now, today, src }.
import {
  makeId, slugify, clone, diffWrites, bodyId,
  normalizeWorkout, normalizePlan, normalizeExercise, normalizeType, normalizeBody,
  normalizeSettings, normalizeBrief, normalizeItem,
} from './model.js';
import { DEFAULT_TYPES, DEFAULT_EXERCISES } from './defaults.js';
import { typeTitle } from './parse.js';

export { typeTitle };
import { prsForWorkout } from './stats.js';

const NONE = (state) => ({ state, writes: [], activity: [] });


function activityEntry(ctx, type, ref, title, extra = {}) {
  return { id: makeId('a_'), at: ctx.now, src: ctx.src ?? 'chat', type, ref: ref ?? null, title: String(title ?? ''), from: extra.from ?? null, to: extra.to ?? null };
}

/** Turn `next` into the op result: writes = diff + activity; creates of named docs are ifAbsent. */
function finish(state, next, acts, extra = {}) {
  const withActs = { ...next, activity: { ...next.activity } };
  for (const a of acts) withActs.activity[a.id] = a;
  const writes = diffWrites(state, withActs).map((w) =>
    w.op === 'set' && (w.col === 'exercises' || w.col === 'types') && !state[w.col]?.[w.id] ? { ...w, ifAbsent: true } : w);
  return { state: withActs, writes, activity: acts, ...extra };
}

const put = (state, col, doc) => ({ ...state, [col]: { ...state[col], [doc.id]: doc } });
const drop = (state, col, id) => {
  const c = { ...state[col] };
  delete c[id];
  return { ...state, [col]: c };
};

/** Items from parse output or loose input → stored items (ids i1, i2…), creating unknown exercises. */
function prepareItems(state, items, ctx) {
  let next = state;
  const out = [];
  (items ?? []).forEach((raw, i) => {
    let ex = raw.ex ? String(raw.ex) : slugify(raw.name ?? 'exercise');
    if (!next.exercises?.[ex]) {
      const doc = normalizeExercise({ id: ex, name: raw.name || ex, kind: raw.kind ?? 'lift', type: raw.type ?? null }, ctx);
      next = put(next, 'exercises', doc);
      ex = doc.id;
    }
    out.push(normalizeItem({ ...raw, id: raw.id ?? `i${i + 1}`, ex }, i));
  });
  return { state: next, items: out };
}

/** Add the starter types + exercises that are missing (never overwrites). */
export function seedDefaults(state, _args, ctx) {
  let next = state;
  for (const t of DEFAULT_TYPES) if (!next.types?.[t.id]) next = put(next, 'types', normalizeType(t, ctx));
  for (const e of DEFAULT_EXERCISES) if (!next.exercises?.[e.id]) next = put(next, 'exercises', normalizeExercise(e, ctx));
  if (next === state) return NONE(state);
  return finish(state, next, []);
}

/**
 * Log a workout. args: { d, type, title, min, items, notes, feel, time, plan? }.
 * A planned workout on the same day (same type first) is marked done and linked.
 * Extra: { id, prs } (personal records this workout set).
 */
export function logWorkout(state, args = {}, ctx) {
  const prep = prepareItems(state, args.items, ctx);
  let next = prep.state;
  const type = next.types?.[args.type] ? args.type : 'other';
  const w = normalizeWorkout({ ...args, title: args.title || typeTitle(next.types?.[type]), id: args.id ?? makeId('w_'), type, items: prep.items, created: ctx.now, updated: ctx.now, src: ctx.src }, ctx);
  // link a plan
  let plan = args.plan ? next.plans?.[args.plan] : null;
  if (!plan && args.plan !== false) {
    const open = Object.values(next.plans ?? {}).filter((p) => p.d === w.d && p.status === 'planned');
    plan = open.find((p) => p.type === w.type) ?? (open.length === 1 ? open[0] : null);
  }
  if (plan) {
    w.plan = plan.id;
    next = put(next, 'plans', { ...plan, status: 'done', workout: w.id, updated: ctx.now });
  }
  next = put(next, 'workouts', w);
  const prs = prsForWorkout(next, w.id);
  const acts = [activityEntry(ctx, 'log', w.id, w.title, { to: w.d })];
  return finish(state, next, acts, { id: w.id, prs, plan: plan?.id ?? null });
}

/** patch: any of d, type, title, min, notes, feel, time, items (full new list). */
export function editWorkout(state, { id, patch = {} } = {}, ctx) {
  const cur = state.workouts?.[id];
  if (!cur) return NONE(state);
  let next = state;
  const p = { ...patch };
  if (Array.isArray(p.items)) {
    const prep = prepareItems(next, p.items, ctx);
    next = prep.state;
    p.items = prep.items;
  }
  if (p.type && !next.types?.[p.type]) delete p.type;
  const doc = normalizeWorkout({ ...cur, ...p, id, updated: ctx.now }, ctx);
  if (JSON.stringify({ ...doc, updated: 0 }) === JSON.stringify({ ...cur, updated: 0 })) return NONE(state);
  next = put(next, 'workouts', doc);
  const acts = [activityEntry(ctx, 'edit', id, doc.title, { to: p.d && p.d !== cur.d ? p.d : null })];
  return finish(state, next, acts, { id, prs: prsForWorkout(next, id) });
}

export function deleteWorkout(state, { id } = {}, ctx) {
  const cur = state.workouts?.[id];
  if (!cur) return NONE(state);
  let next = drop(state, 'workouts', id);
  const plan = cur.plan ? next.plans?.[cur.plan] : null;
  if (plan && plan.workout === id) next = put(next, 'plans', { ...plan, status: 'planned', workout: null, updated: ctx.now });
  return finish(state, next, [activityEntry(ctx, 'delete', id, cur.title, { from: cur.d })]);
}

// ---------------------------------------------------------------- plans

/** args: { d, type, title, notes, items, time }. Extra: { id }. */
export function planWorkout(state, args = {}, ctx) {
  const prep = prepareItems(state, args.items, ctx);
  let next = prep.state;
  const type = next.types?.[args.type] ? args.type : 'other';
  const title = args.title || typeTitle(next.types?.[type]);
  const p = normalizePlan({ ...args, id: args.id ?? makeId('pl_'), type, title, items: prep.items, status: 'planned', created: ctx.now, updated: ctx.now, src: ctx.src }, ctx);
  next = put(next, 'plans', p);
  return finish(state, next, [activityEntry(ctx, 'plan', p.id, p.title, { to: p.d })], { id: p.id });
}

export function editPlan(state, { id, patch = {} } = {}, ctx) {
  const cur = state.plans?.[id];
  if (!cur) return NONE(state);
  let next = state;
  const p = { ...patch };
  if (Array.isArray(p.items)) {
    const prep = prepareItems(next, p.items, ctx);
    next = prep.state;
    p.items = prep.items;
  }
  if (p.type && !next.types?.[p.type]) delete p.type;
  const doc = normalizePlan({ ...cur, ...p, id, updated: ctx.now }, ctx);
  if (JSON.stringify({ ...doc, updated: 0 }) === JSON.stringify({ ...cur, updated: 0 })) return NONE(state);
  next = put(next, 'plans', doc);
  const moved = p.d && p.d !== cur.d;
  return finish(state, next, [activityEntry(ctx, moved ? 'move' : 'edit', id, doc.title, { from: moved ? cur.d : null, to: moved ? p.d : null })]);
}

export function movePlan(state, { id, to } = {}, ctx) {
  return editPlan(state, { id, patch: { d: to } }, ctx);
}

export function skipPlan(state, { id } = {}, ctx) {
  const cur = state.plans?.[id];
  if (!cur || cur.status === 'skipped') return NONE(state);
  const next = put(state, 'plans', { ...cur, status: 'skipped', updated: ctx.now });
  return finish(state, next, [activityEntry(ctx, 'skip', id, cur.title, { to: cur.d })]);
}

/** Back to planned (undo a skip; a done plan keeps its workout). */
export function unskipPlan(state, { id } = {}, ctx) {
  const cur = state.plans?.[id];
  if (!cur || cur.status !== 'skipped') return NONE(state);
  const next = put(state, 'plans', { ...cur, status: 'planned', updated: ctx.now });
  return finish(state, next, [activityEntry(ctx, 'unskip', id, cur.title, { to: cur.d })]);
}

export function deletePlan(state, { id } = {}, ctx) {
  const cur = state.plans?.[id];
  if (!cur) return NONE(state);
  return finish(state, drop(state, 'plans', id), [activityEntry(ctx, 'unplan', id, cur.title, { from: cur.d })]);
}

/** "Did it": log the plan as a workout (its items as done), on its day or `date`. */
export function completePlan(state, { id, date = null, min = null } = {}, ctx) {
  const cur = state.plans?.[id];
  if (!cur || cur.status === 'done') return NONE(state);
  return logWorkout(state, { d: date ?? cur.d, type: cur.type, title: cur.title, items: clone(cur.items), notes: cur.notes, min, plan: id }, ctx);
}

// ---------------------------------------------------------------- body weight

export function logBody(state, { d, w, notes } = {}, ctx) {
  const day = d ?? ctx.today;
  const cur = state.body?.[bodyId(day)];
  const doc = normalizeBody({ d: day, w, notes: notes ?? cur?.notes ?? '', created: cur?.created ?? ctx.now }, ctx);
  if (doc.w == null) return NONE(state);
  if (cur && cur.w === doc.w && cur.notes === doc.notes) return NONE(state);
  return finish(state, put(state, 'body', doc), [activityEntry(ctx, 'body', doc.id, `Body weight ${doc.w} ${state.settings?.unit ?? 'lb'}`, { to: day })]);
}

export function deleteBody(state, { d } = {}, ctx) {
  const cur = state.body?.[bodyId(d)];
  if (!cur) return NONE(state);
  return finish(state, drop(state, 'body', cur.id), [activityEntry(ctx, 'delete', cur.id, `Body weight ${cur.w}`, { from: d })]);
}

// ---------------------------------------------------------------- exercises + types

export function addExercise(state, { name, kind, type, aliases } = {}, ctx) {
  if (!name || !String(name).trim()) return NONE(state);
  const id = slugify(name);
  if (state.exercises?.[id]) return NONE(state);
  const doc = normalizeExercise({ id, name, kind, type, aliases }, ctx);
  return finish(state, put(state, 'exercises', doc), [activityEntry(ctx, 'ex', id, doc.name)], { id });
}

/** patch: name, kind, type, aliases, notes, archived. */
export function editExercise(state, { id, patch = {} } = {}, ctx) {
  const cur = state.exercises?.[id];
  if (!cur) return NONE(state);
  const doc = normalizeExercise({ ...cur, ...patch, id }, ctx);
  if (JSON.stringify(doc) === JSON.stringify(cur)) return NONE(state);
  return finish(state, put(state, 'exercises', doc), [activityEntry(ctx, 'ex', id, doc.name)]);
}

/** Fold exercise `from` into `into`: every workout / plan item moves over, `from`'s names become aliases. */
export function mergeExercise(state, { from, into } = {}, ctx) {
  const a = state.exercises?.[from];
  const b = state.exercises?.[into];
  if (!a || !b || from === into) return NONE(state);
  let next = state;
  for (const col of ['workouts', 'plans']) {
    for (const doc of Object.values(next[col] ?? {})) {
      if (!doc.items.some((i) => i.ex === from)) continue;
      next = put(next, col, { ...doc, items: doc.items.map((i) => (i.ex === from ? { ...i, ex: into } : i)), updated: ctx.now });
    }
  }
  next = put(next, 'exercises', normalizeExercise({ ...b, aliases: [...b.aliases, a.name.toLowerCase(), ...a.aliases] }, ctx));
  next = drop(next, 'exercises', from);
  return finish(state, next, [activityEntry(ctx, 'ex', into, `${a.name} → ${b.name}`)]);
}

export function addType(state, { name, kind, color, aliases, glyph } = {}, ctx) {
  if (!name || !String(name).trim()) return NONE(state);
  const id = slugify(name);
  if (state.types?.[id]) return NONE(state);
  const doc = normalizeType({ id, name, kind, color: color ?? pickColor(state), aliases, glyph }, ctx);
  return finish(state, put(state, 'types', doc), [activityEntry(ctx, 'type', id, doc.name)], { id });
}

export function editType(state, { id, patch = {} } = {}, ctx) {
  const cur = state.types?.[id];
  if (!cur) return NONE(state);
  const doc = normalizeType({ ...cur, ...patch, id }, ctx);
  if (JSON.stringify(doc) === JSON.stringify(cur)) return NONE(state);
  return finish(state, put(state, 'types', doc), [activityEntry(ctx, 'type', id, doc.name)]);
}

const PALETTE = ['#ff5fa2', '#6fc3ff', '#c6f432', '#ff9f43', '#b48cff', '#ffd23f', '#3ff0c8', '#ff7b7b', '#9fe870', '#a3b8cc', '#f78fb3', '#7bed9f'];
function pickColor(state) {
  const used = new Set(Object.values(state.types ?? {}).map((t) => t.color));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[Object.keys(state.types ?? {}).length % PALETTE.length];
}

// ---------------------------------------------------------------- meta

export function setBrief(state, brief = {}, ctx) {
  const doc = normalizeBrief({ ...brief, at: ctx.now });
  return finish(state, { ...state, brief: doc }, []);
}

export function editSettings(state, { patch = {} } = {}, ctx) {
  const doc = normalizeSettings({ ...state.settings, ...patch });
  if (JSON.stringify(doc) === JSON.stringify(state.settings)) return NONE(state);
  return finish(state, { ...state, settings: doc }, [activityEntry(ctx, 'settings', 'settings', 'Settings')]);
}

/** Remove `find` (case-insensitive, literal) from every stored text. */
export function scrubText(state, { find, replace = '' } = {}, ctx) {
  const needle = String(find ?? '');
  if (needle.length < 2) return NONE(state);
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const fix = (v) => {
    if (typeof v === 'string') return v.replace(re, replace).replace(/\s{2,}/g, ' ');
    if (Array.isArray(v)) return v.map(fix);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'id' || k === 'at' || k === 'created' || k === 'updated' ? x : fix(x)]));
    return v;
  };
  const next = { ...state };
  for (const col of ['workouts', 'plans', 'exercises', 'types', 'body', 'activity']) next[col] = fix(state[col]);
  next.brief = fix(state.brief);
  const res = finish(state, next, [activityEntry(ctx, 'scrub', null, 'Removed a private detail')]);
  return res.writes.length > 1 ? res : NONE(state);
}

export const OPS = {
  seedDefaults, logWorkout, editWorkout, deleteWorkout,
  planWorkout, editPlan, movePlan, skipPlan, unskipPlan, deletePlan, completePlan,
  logBody, deleteBody,
  addExercise, editExercise, mergeExercise, addType, editType,
  setBrief, editSettings, scrubText,
};
