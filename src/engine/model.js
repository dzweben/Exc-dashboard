// Core shapes, defaults and converters. Pure: no DOM, no Node APIs.
// See docs/ARCHITECTURE.md for the contract.

export const SCHEMA_VERSION = 1;

/** Exercise kinds: how an item's numbers read. */
export const EX_KINDS = ['lift', 'bw', 'cardio', 'time'];
/** Split / workout type kinds. */
export const TYPE_KINDS = ['lift', 'cardio', 'other'];
export const PLAN_STATUSES = ['planned', 'done', 'skipped'];

export const COLLECTIONS = ['workouts', 'plans', 'exercises', 'types', 'body', 'activity'];
export const META_DOCS = ['settings', 'brief', 'sync'];

export const DEFAULT_SETTINGS = Object.freeze({
  tz: 'America/New_York',
  owner: 'Danny',
  weekStart: 'mon',
  unit: 'lb', // weight unit
  dist: 'mi', // distance unit
  target: null, // workouts per week goal, or null (no goal)
  horizon: 14,
  reminders: true, // suggest what hasn't been hit lately (Danny asked for these)
  plates: true, // barbell / Smith weights are plates only; the bar is never counted
});

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** `prefix` + 8 random base36 chars. */
export function makeId(prefix = 'x_') {
  let out = '';
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const buf = new Uint8Array(8);
    cryptoObj.getRandomValues(buf);
    for (const b of buf) out += ID_ALPHABET[b % 36];
  } else {
    for (let i = 0; i < 8; i++) out += ID_ALPHABET[Math.floor(Math.random() * 36)];
  }
  return prefix + out;
}

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, d = '') => (typeof v === 'string' ? v : d);
const num = (v, d = null) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const dateOrNull = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const timeOrNull = (v) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);
const pos = (v) => {
  const n = num(v, null);
  return n === null || n < 0 ? null : Math.round(n * 100) / 100;
};
const aliasList = (v) => (Array.isArray(v) ? [...new Set(v.map((a) => String(a).toLowerCase().trim()).filter(Boolean))] : []);

const SLUG_RE = /[^a-z0-9]+/g;
export function slugify(name) {
  return String(name ?? '').toLowerCase().replace(SLUG_RE, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'x';
}

export function normalizeSettings(partial = {}) {
  const p = isObj(partial) ? partial : {};
  const target = num(p.target, null);
  return {
    tz: str(p.tz, DEFAULT_SETTINGS.tz) || DEFAULT_SETTINGS.tz,
    owner: str(p.owner, DEFAULT_SETTINGS.owner) || DEFAULT_SETTINGS.owner,
    weekStart: p.weekStart === 'sun' ? 'sun' : 'mon',
    unit: p.unit === 'kg' ? 'kg' : 'lb',
    dist: p.dist === 'km' ? 'km' : 'mi',
    target: target === null || target <= 0 ? null : Math.min(14, Math.round(target)),
    horizon: Math.max(7, Math.min(42, Math.round(num(p.horizon, DEFAULT_SETTINGS.horizon)))),
    reminders: p.reminders !== false,
    plates: p.plates !== false,
  };
}

/** One set: reps `r`, weight `w` (settings unit; null = bodyweight), seconds `s` (holds). */
export function normalizeSet(raw) {
  const p = isObj(raw) ? raw : {};
  const out = { r: null, w: null };
  const r = num(p.r, null);
  if (r !== null && r >= 0) out.r = Math.round(r);
  out.w = pos(p.w);
  const s = num(p.s, null);
  if (s !== null && s > 0) out.s = Math.round(s);
  return out;
}

/** One exercise inside a workout or plan. */
export function normalizeItem(raw, i = 0) {
  const p = isObj(raw) ? raw : {};
  return {
    id: str(p.id) || `i${i + 1}`,
    ex: str(p.ex) || 'other',
    sets: Array.isArray(p.sets) ? p.sets.map(normalizeSet) : [],
    dist: pos(p.dist),
    min: pos(p.min),
    notes: str(p.notes),
  };
}

export function normalizeWorkout(partial = {}, ctx = {}) {
  const p = isObj(partial) ? partial : {};
  const now = ctx.now ?? new Date().toISOString();
  const feel = num(p.feel, null);
  return {
    id: str(p.id) || makeId('w_'),
    d: dateOrNull(p.d) ?? (ctx.today || now.slice(0, 10)),
    time: timeOrNull(p.time),
    type: str(p.type) || 'other',
    title: str(p.title).trim() || 'Workout',
    min: pos(p.min),
    items: Array.isArray(p.items) ? p.items.map(normalizeItem) : [],
    notes: str(p.notes),
    feel: feel === null ? null : Math.max(1, Math.min(5, Math.round(feel))),
    plan: str(p.plan) || null,
    created: str(p.created) || now,
    updated: str(p.updated) || str(p.created) || now,
    src: ['chat', 'dash', 'import'].includes(p.src) ? p.src : 'chat',
  };
}

export function normalizePlan(partial = {}, ctx = {}) {
  const p = isObj(partial) ? partial : {};
  const now = ctx.now ?? new Date().toISOString();
  return {
    id: str(p.id) || makeId('pl_'),
    d: dateOrNull(p.d) ?? (ctx.today || now.slice(0, 10)),
    time: timeOrNull(p.time),
    type: str(p.type) || 'other',
    title: str(p.title).trim() || 'Workout',
    items: Array.isArray(p.items) ? p.items.map(normalizeItem) : [],
    notes: str(p.notes),
    status: PLAN_STATUSES.includes(p.status) ? p.status : 'planned',
    workout: str(p.workout) || null,
    created: str(p.created) || now,
    updated: str(p.updated) || str(p.created) || now,
    src: ['chat', 'dash', 'import'].includes(p.src) ? p.src : 'chat',
  };
}

export function normalizeExercise(partial = {}, ctx = {}) {
  const p = isObj(partial) ? partial : {};
  const now = ctx.now ?? new Date().toISOString();
  const name = str(p.name).trim() || 'Exercise';
  return {
    id: str(p.id) || slugify(name),
    name,
    kind: EX_KINDS.includes(p.kind) ? p.kind : 'lift',
    type: str(p.type) || null, // usual split (push/pull/legs…) or null
    aliases: aliasList(p.aliases),
    notes: str(p.notes), // Danny's goal for it ("stay at 90, grow the range")
    rotation: p.rotation === true, // on the "what's due" list even before it's logged
    archived: p.archived === true,
    created: str(p.created) || now,
  };
}

export function normalizeType(partial = {}, ctx = {}) {
  const p = isObj(partial) ? partial : {};
  const now = ctx.now ?? new Date().toISOString();
  const name = str(p.name).trim() || 'Workout';
  const color = typeof p.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color.toLowerCase() : '#b0b8c1';
  const glyph = str(p.glyph) || name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '··';
  return {
    id: str(p.id) || slugify(name),
    name,
    kind: TYPE_KINDS.includes(p.kind) ? p.kind : 'lift',
    color,
    glyph: glyph.slice(0, 3),
    aliases: aliasList(p.aliases),
    order: num(p.order, 500),
    archived: p.archived === true,
    created: str(p.created) || now,
  };
}

/** Body-weight entry. One per day: the id is `b_<date>`, so two logs of one day merge. */
export function normalizeBody(partial = {}, ctx = {}) {
  const p = isObj(partial) ? partial : {};
  const now = ctx.now ?? new Date().toISOString();
  const d = dateOrNull(p.d) ?? (ctx.today || now.slice(0, 10));
  return {
    id: `b_${d}`,
    d,
    w: pos(p.w),
    notes: str(p.notes),
    created: str(p.created) || now,
  };
}

export const bodyId = (d) => `b_${d}`;

export function normalizeBrief(partial) {
  if (!isObj(partial) || !str(partial.at)) return null;
  return {
    at: partial.at,
    headline: str(partial.headline),
    lines: Array.isArray(partial.lines) ? partial.lines.map(String) : [],
    asks: Array.isArray(partial.asks) ? partial.asks.map(String) : [],
  };
}

export function normalizeSync(partial) {
  const p = isObj(partial) ? partial : {};
  return {
    lastClaudeSync: str(p.lastClaudeSync) || null,
    lastActivitySeen: str(p.lastActivitySeen) || null,
  };
}

export function emptyState() {
  return {
    schema: SCHEMA_VERSION,
    settings: normalizeSettings({}),
    types: {},
    exercises: {},
    workouts: {},
    plans: {},
    body: {},
    activity: {},
    brief: null,
    sync: normalizeSync({}),
  };
}

/** Copy without `_`-prefixed bookkeeping keys. */
export function stripMeta(doc) {
  if (!isObj(doc)) return doc;
  const out = {};
  for (const [k, v] of Object.entries(doc)) if (!k.startsWith('_')) out[k] = v;
  return out;
}

const NORMALIZERS = {
  workouts: normalizeWorkout,
  plans: normalizePlan,
  exercises: normalizeExercise,
  types: normalizeType,
  body: normalizeBody,
  activity: (d) => ({ ...d }),
};

/** Normalize a raw parsed state.json into a full State. Unknown keys are dropped. */
export function normalizeState(raw = {}) {
  const r = isObj(raw) ? raw : {};
  const state = emptyState();
  for (const col of COLLECTIONS) {
    const src = r[col];
    const entries = Array.isArray(src) ? src.map((d) => [d?.id, d]) : isObj(src) ? Object.entries(src) : [];
    for (const [key, doc] of entries) {
      if (!isObj(doc)) continue;
      const withId = doc.id ? doc : { ...doc, id: key };
      if (!withId.id) continue;
      const norm = NORMALIZERS[col](withId, { now: withId.created });
      state[col][norm.id] = norm;
    }
  }
  state.settings = normalizeSettings(r.settings);
  state.brief = normalizeBrief(r.brief);
  state.sync = normalizeSync(r.sync);
  return state;
}

const TOP_ORDER = ['schema', 'settings', 'brief', 'sync', 'types', 'exercises', 'plans', 'workouts', 'body', 'activity'];

/** Stable, diff-friendly JSON for data/state.json (entries sorted by id, 2-space indent, trailing newline). */
export function serializeState(state) {
  const out = {};
  for (const k of TOP_ORDER) {
    const v = state[k];
    if (COLLECTIONS.includes(k)) {
      const sorted = {};
      for (const id of Object.keys(v ?? {}).sort()) sorted[id] = v[id];
      out[k] = sorted;
    } else if (k === 'schema') {
      out[k] = SCHEMA_VERSION;
    } else {
      out[k] = v ?? null;
    }
  }
  return JSON.stringify(out, null, 2) + '\n';
}

export function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

// ---------------------------------------------------------------- writes
//
// Write = { op: 'set'|'update'|'delete', col, id, data?, arr?, ifAbsent? }
// col is a collection, or 'meta' with id settings|brief|sync.
//  - set: create or replace a whole entry (ifAbsent: only create).
//  - update: shallow-merge `data` (meta settings: one level deep), then `arr`:
//      id arrays (workouts.items, plans.items): { remove, was, upsert, insert, patch, order }
//      value sets (aliases): { add, remove }
//  - delete: remove the entry (meta: reset to its default).
// diffWrites(base, next) emits the finest writes that reproduce `next`, so a replay
// onto a newer remote keeps the other side's concurrent edits:
//   applyWrites(remote, diffWrites(base, ours))

export const INC_FIELDS = Object.freeze({});
export const ID_ARRAY_FIELDS = Object.freeze({ workouts: Object.freeze(['items']), plans: Object.freeze(['items']) });
export const MULTISET_FIELDS = Object.freeze({});
export const SET_FIELDS = Object.freeze({ types: Object.freeze(['aliases']), exercises: Object.freeze(['aliases']) });

const fieldIn = (table, kind, field) => Array.isArray(table[kind]) && table[kind].includes(field);
const jsonKey = (v) => JSON.stringify(v ?? null);
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** JSON with sorted object keys, so equal elements compare equal whatever their key order. */
function stableKey(v) {
  if (Array.isArray(v)) return `[${v.map(stableKey).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableKey(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** An element id not used in `arr`: "i3" → the next free "iN"; else "<id>-2", "<id>-3"… */
function freeElementId(arr, id) {
  const used = new Set(arr.filter(isObj).map((x) => String(x.id)));
  const m = String(id).match(/^(.*?)(\d+)$/);
  if (m) {
    let n = Number(m[2]);
    while (used.has(`${m[1]}${n}`)) n++;
    return `${m[1]}${n}`;
  }
  let n = 2;
  while (used.has(`${id}-${n}`)) n++;
  return `${id}-${n}`;
}

/** Apply an id-array spec. `ren` maps renamed insert ids (so later writes follow them). */
function applyIdSpec(cur, spec, ren = new Map()) {
  let out = (Array.isArray(cur) ? cur : []).map((x) => x);
  const idOf = (id) => (ren.has(String(id)) ? ren.get(String(id)) : String(id));
  if (Array.isArray(spec.remove)) {
    for (const rid of spec.remove) {
      const id = idOf(rid);
      const i = out.findIndex((x) => isObj(x) && String(x.id) === id);
      if (i < 0) continue;
      const was = isObj(spec.was) ? spec.was[String(rid)] : undefined;
      // an element the other side changed since is kept: an edit beats a delete
      if (was !== undefined && stableKey(out[i]) !== stableKey({ ...was, id: out[i].id })) continue;
      out.splice(i, 1);
    }
  }
  if (Array.isArray(spec.upsert)) {
    for (const el of spec.upsert) {
      if (!isObj(el)) continue;
      const id = idOf(el.id);
      const i = out.findIndex((x) => isObj(x) && String(x.id) === id);
      const next = { ...clone(el), id };
      if (i >= 0) out[i] = next;
      else out.push(next);
    }
  }
  if (Array.isArray(spec.insert)) {
    for (const el of spec.insert) {
      if (!isObj(el)) continue;
      const clash = out.find((x) => isObj(x) && String(x.id) === String(el.id));
      if (clash && stableKey(clash) === stableKey(el)) continue; // already there (replayed)
      let id = el.id;
      if (clash) {
        id = freeElementId(out, el.id);
        ren.set(String(el.id), id);
      }
      out.push({ ...clone(el), id });
    }
  }
  if (isObj(spec.patch)) {
    for (const [pid, fields] of Object.entries(spec.patch)) {
      const id = idOf(pid);
      const i = out.findIndex((x) => isObj(x) && String(x.id) === id);
      if (i >= 0 && isObj(fields)) out[i] = { ...out[i], ...clone(fields), id: out[i].id };
    }
  }
  if (Array.isArray(spec.order)) {
    const want = spec.order.map(idOf);
    const byId = new Map(out.map((x) => [String(x.id), x]));
    const first = want.filter((id) => byId.has(id)).map((id) => byId.get(id));
    const firstIds = new Set(first.map((x) => String(x.id)));
    out = [...first, ...out.filter((x) => !firstIds.has(String(x.id)))];
  }
  return out;
}

function applySetSpec(cur, spec) {
  const out = (Array.isArray(cur) ? cur : []).slice();
  if (Array.isArray(spec.remove)) {
    for (const v of spec.remove) {
      const i = out.findIndex((x) => jsonKey(x) === jsonKey(v));
      if (i >= 0) out.splice(i, 1);
    }
  }
  if (Array.isArray(spec.add)) for (const v of spec.add) if (!out.some((x) => jsonKey(x) === jsonKey(v))) out.push(clone(v));
  return out;
}

function updateDoc(doc, w, kind, nested, renames) {
  let next = { ...doc };
  if (isObj(w.data)) {
    for (const [k, v] of Object.entries(w.data)) {
      if (nested && isObj(v) && isObj(next[k])) next[k] = { ...next[k], ...clone(v) };
      else next[k] = clone(v);
    }
  }
  if (isObj(w.arr)) {
    for (const [field, spec] of Object.entries(w.arr)) {
      if (!isObj(spec)) continue;
      if (fieldIn(ID_ARRAY_FIELDS, kind, field) || (!fieldIn(SET_FIELDS, kind, field) && !Array.isArray(spec.add) && !Array.isArray(spec.remove))) {
        const key = `${kind}|${doc.id ?? ''}|${field}`;
        if (!renames.has(key)) renames.set(key, new Map());
        next[field] = applyIdSpec(next[field], spec, renames.get(key));
      } else {
        next[field] = applySetSpec(next[field], spec);
      }
    }
  }
  return next;
}

const resetMeta = (id) => (id === 'brief' ? null : id === 'sync' ? normalizeSync({}) : normalizeSettings({}));

/** Apply writes to a state (pure). Unknown collections and updates to missing entries are ignored. */
export function applyWrites(state, writes = []) {
  const next = { ...state };
  const touched = new Set();
  const renames = new Map();
  for (const w of Array.isArray(writes) ? writes : []) {
    if (!w || !w.op || !w.col) continue;
    if (w.col === 'meta') {
      if (!META_DOCS.includes(w.id)) continue;
      if (w.op === 'delete') next[w.id] = resetMeta(w.id);
      else if (w.op === 'set') next[w.id] = clone(w.data);
      else if (w.op === 'update' && isObj(next[w.id])) next[w.id] = updateDoc(next[w.id], w, w.id, w.id === 'settings', renames);
      continue;
    }
    if (!COLLECTIONS.includes(w.col) || !w.id) continue;
    if (!touched.has(w.col)) {
      next[w.col] = { ...(next[w.col] ?? {}) };
      touched.add(w.col);
    }
    const coll = next[w.col];
    if (w.op === 'delete') delete coll[w.id];
    else if (w.op === 'set') {
      if (w.ifAbsent && isObj(coll[w.id])) continue;
      coll[w.id] = { ...clone(w.data), id: w.id };
    } else if (w.op === 'update' && coll[w.id]) {
      coll[w.id] = { ...updateDoc({ ...coll[w.id], id: w.id }, w, w.col, false, renames), id: w.id };
    }
  }
  return next;
}

function diffIdArray(a, b) {
  const ids = (arr) => {
    const seen = new Set();
    for (const x of arr) {
      if (!isObj(x) || x.id == null || seen.has(String(x.id))) return null;
      seen.add(String(x.id));
    }
    return arr.map((x) => String(x.id));
  };
  const ia = ids(a);
  const ib = ids(b);
  if (!ia || !ib) return null;
  const before = new Map(a.map((x) => [String(x.id), x]));
  const inB = new Set(ib);
  const spec = {};
  const insert = [];
  const upsert = [];
  const patch = {};
  for (const x of b) {
    const prev = before.get(String(x.id));
    if (!prev) {
      insert.push(clone(x));
      continue;
    }
    if (stableKey(prev) === stableKey(x)) continue;
    if (Object.keys(prev).some((k) => !(k in x))) {
      upsert.push(clone(x));
      continue;
    }
    const changed = {};
    for (const [k, v] of Object.entries(x)) if (k !== 'id' && stableKey(prev[k]) !== stableKey(v)) changed[k] = clone(v);
    patch[String(x.id)] = changed;
  }
  const removed = a.filter((x) => !inB.has(String(x.id)));
  if (removed.length) {
    spec.remove = removed.map((x) => x.id);
    spec.was = Object.fromEntries(removed.map((x) => [String(x.id), clone(x)]));
  }
  if (upsert.length) spec.upsert = upsert;
  if (insert.length) spec.insert = insert;
  if (Object.keys(patch).length) spec.patch = patch;
  const got = applyIdSpec(a, spec).map((x) => String(x.id));
  if (!sameJSON(got, ib)) spec.order = ib.slice();
  return spec;
}

function diffSet(a, b) {
  const ka = new Set(a.map(jsonKey));
  const kb = new Set(b.map(jsonKey));
  const spec = {};
  const add = b.filter((x) => !ka.has(jsonKey(x)));
  const remove = a.filter((x) => !kb.has(jsonKey(x)));
  if (add.length) spec.add = clone(add);
  if (remove.length) spec.remove = clone(remove);
  return spec;
}

/** Field-level update turning `prev` into `doc` ({ data, arr? }), null when equal, 'set' when it can't. */
function diffDoc(kind, prev, doc, nested = false) {
  const data = {};
  const arr = {};
  for (const k of new Set([...Object.keys(prev), ...Object.keys(doc)])) {
    if (k.startsWith('_')) continue;
    const a = prev[k];
    const b = doc[k];
    if (sameJSON(a, b)) continue;
    if (b === undefined) {
      data[k] = null;
      continue;
    }
    if (Array.isArray(b) && (a == null || Array.isArray(a))) {
      const from = Array.isArray(a) ? a : [];
      let spec = null;
      let ok = false;
      if (fieldIn(ID_ARRAY_FIELDS, kind, k)) {
        spec = diffIdArray(from, b);
        ok = !!spec && sameJSON(applyIdSpec(from, spec), b);
      } else if (fieldIn(SET_FIELDS, kind, k)) {
        spec = diffSet(from, b);
        ok = sameJSON(applySetSpec(from, spec), b);
      }
      if (ok && Object.keys(spec).length) {
        arr[k] = spec;
        continue;
      }
    }
    if (nested && isObj(a) && isObj(b)) {
      if (Object.keys(a).some((x) => !(x in b))) return 'set';
      const sub = {};
      for (const [x, v] of Object.entries(b)) if (!sameJSON(a[x], v)) sub[x] = clone(v);
      data[k] = sub;
      continue;
    }
    data[k] = clone(b);
  }
  if (!Object.keys(data).length && !Object.keys(arr).length) return null;
  const out = { data };
  if (Object.keys(arr).length) out.arr = arr;
  return out;
}

/** Writes turning `base` into `next`; applyWrites(base, diffWrites(base, next)) reproduces `next`. */
export function diffWrites(base, next) {
  const writes = [];
  for (const col of COLLECTIONS) {
    const a = isObj(base?.[col]) ? base[col] : {};
    const b = isObj(next?.[col]) ? next[col] : {};
    if (a === b) continue;
    for (const [id, doc] of Object.entries(b)) {
      const prev = a[id];
      if (prev === doc) continue;
      if (!isObj(prev) || !isObj(doc)) {
        if (!sameJSON(prev, doc) && isObj(doc)) writes.push({ op: 'set', col, id, data: clone(stripMeta(doc)) });
        continue;
      }
      const w = diffDoc(col, prev, doc);
      if (w === 'set') writes.push({ op: 'set', col, id, data: clone(stripMeta(doc)) });
      else if (w) writes.push({ op: 'update', col, id, ...w });
    }
    for (const id of Object.keys(a)) if (!(id in b)) writes.push({ op: 'delete', col, id });
  }
  for (const id of META_DOCS) {
    const a = base?.[id] ?? null;
    const b = next?.[id] ?? null;
    if (sameJSON(a, b)) continue;
    if (b == null) {
      writes.push({ op: 'delete', col: 'meta', id });
      continue;
    }
    if (id === 'settings' && isObj(a) && isObj(b)) {
      const w = diffDoc(id, a, b, true);
      if (w === null) continue;
      if (w !== 'set') {
        writes.push({ op: 'update', col: 'meta', id, ...w });
        continue;
      }
    }
    writes.push({ op: 'set', col: 'meta', id, data: clone(b) });
  }
  return writes;
}
