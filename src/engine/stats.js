// Records, volume, streaks and the heatmap. Pure.
import { addDays, diffDays, startOfWeek } from './dates.js';

/** Estimated one-rep max (Epley). Null without a weight or reps. */
export function e1rm(w, r) {
  if (!(w > 0) || !(r > 0)) return null;
  if (r === 1) return w;
  return Math.round(w * (1 + r / 30) * 10) / 10;
}

/** Σ reps × weight of an item (lifts only). */
export function itemVolume(item) {
  let v = 0;
  for (const s of item.sets ?? []) if (s.r > 0 && s.w > 0) v += s.r * s.w;
  return v;
}

export const workoutVolume = (w) => (w.items ?? []).reduce((a, i) => a + itemVolume(i), 0);
export const workoutDist = (w) => (w.items ?? []).reduce((a, i) => a + (i.dist ?? 0), 0);

/** Session minutes: the logged total, else the sum of the items' minutes. */
export function workoutMinutes(w) {
  if (w.min != null) return w.min;
  const m = (w.items ?? []).reduce((a, i) => a + (i.min ?? 0), 0);
  return m || null;
}

/** All workouts oldest first (day, then creation). */
export function chronological(state) {
  return Object.values(state.workouts ?? {}).sort((a, b) => (a.d !== b.d ? (a.d < b.d ? -1 : 1) : a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : 1));
}

/** The numbers a single item can set records on. */
function itemMarks(item, kind) {
  const m = {};
  const sets = item.sets ?? [];
  if (kind === 'cardio') {
    if (item.dist > 0) m.distance = item.dist;
    if (item.dist >= 1 && item.min > 0) m.pace = item.min / item.dist; // lower is better
    if (!item.dist && item.min > 0) m.duration = item.min;
    return m;
  }
  if (kind === 'time') {
    const hold = Math.max(0, ...sets.map((s) => s.s ?? 0));
    if (hold) m.hold = hold;
    if (item.min > 0) m.duration = item.min;
    return m;
  }
  const weights = sets.map((s) => s.w ?? 0);
  const maxW = Math.max(0, ...weights);
  if (maxW > 0) m.weight = maxW;
  const best1 = Math.max(0, ...sets.map((s) => e1rm(s.w, s.r) ?? 0));
  if (best1 > 0 && sets.some((s) => s.r > 1 && s.w > 0)) m.e1rm = best1;
  if (kind === 'bw' && !maxW) {
    const reps = Math.max(0, ...sets.map((s) => s.r ?? 0));
    if (reps) m.reps = reps;
  }
  return m;
}

const LOWER_BETTER = new Set(['pace']);
const PR_LABEL = { weight: 'heaviest', e1rm: 'est. 1RM', reps: 'most reps', distance: 'longest', pace: 'fastest pace', hold: 'longest hold', duration: 'longest' };

/**
 * Map workout id → PR[] for every workout, scanning oldest first. A PR beats every
 * earlier session of that exercise; a first-ever session sets no PR.
 * PR = { ex, name, mark, value, prev, label }
 */
export function prsIndex(state) {
  const best = new Map(); // `${ex}|${mark}` → value
  const out = new Map();
  for (const w of chronological(state)) {
    const prs = [];
    const fresh = new Map();
    for (const item of w.items ?? []) {
      const ex = state.exercises?.[item.ex];
      const kind = ex?.kind ?? 'lift';
      for (const [mark, value] of Object.entries(itemMarks(item, kind))) {
        const key = `${item.ex}|${mark}`;
        const prev = best.get(key);
        const better = prev == null ? false : LOWER_BETTER.has(mark) ? value < prev - 1e-9 : value > prev + 1e-9;
        if (better && !prs.some((p) => p.ex === item.ex && p.mark === mark)) prs.push({ ex: item.ex, name: ex?.name ?? item.ex, mark, value, prev, label: PR_LABEL[mark] });
        const cur = fresh.get(key);
        if (cur == null || (LOWER_BETTER.has(mark) ? value < cur : value > cur)) fresh.set(key, value);
      }
    }
    for (const [key, value] of fresh) {
      const prev = best.get(key);
      const mark = key.split('|')[1];
      if (prev == null || (LOWER_BETTER.has(mark) ? value < prev : value > prev)) best.set(key, value);
    }
    // e1RM PRs that only restate a weight PR on the same lift are noise
    out.set(w.id, prs.filter((p) => !(p.mark === 'e1rm' && prs.some((q) => q.ex === p.ex && q.mark === 'weight'))));
  }
  return out;
}

export function prsForWorkout(state, id) {
  return prsIndex(state).get(id) ?? [];
}

/** PR → "Bench press: heaviest 205 (was 195)". */
export function fmtPR(pr, settings = {}) {
  const unit = settings.unit ?? 'lb';
  const dist = settings.dist ?? 'mi';
  const f = (v) => {
    if (pr.mark === 'pace') {
      const s = Math.round(v * 60);
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/${dist}`;
    }
    if (pr.mark === 'distance') return `${Math.round(v * 100) / 100} ${dist}`;
    if (pr.mark === 'hold') return `${v}s`;
    if (pr.mark === 'duration') return `${Math.round(v)} min`;
    if (pr.mark === 'reps') return `${v} reps`;
    return `${Math.round(v * 10) / 10} ${unit}`;
  };
  return `${pr.name}: ${pr.label} ${f(pr.value)} (was ${f(pr.prev)})`;
}

/**
 * Per exercise, everything the Lifts view and planning need, most recently trained first:
 * { ex, sessions, first, last: { d, item, workout }, best: { weight, e1rm, reps, distance, pace, hold } (each { value, d }),
 *   trend: [{ d, value }] (top e1RM / weight / distance per session, last 12) }
 */
export function exerciseStats(state) {
  const rows = new Map();
  for (const w of chronological(state)) {
    for (const item of w.items ?? []) {
      const ex = state.exercises?.[item.ex];
      const kind = ex?.kind ?? 'lift';
      if (!rows.has(item.ex)) rows.set(item.ex, { ex: item.ex, name: ex?.name ?? item.ex, kind, sessions: 0, first: w.d, last: null, best: {}, trend: [] });
      const row = rows.get(item.ex);
      row.sessions++;
      row.last = { d: w.d, item, workout: w.id };
      const marks = itemMarks(item, kind);
      for (const [mark, value] of Object.entries(marks)) {
        const cur = row.best[mark];
        if (!cur || (LOWER_BETTER.has(mark) ? value < cur.value : value > cur.value)) row.best[mark] = { value, d: w.d };
      }
      const tv = marks.e1rm ?? marks.weight ?? marks.reps ?? marks.distance ?? marks.hold ?? marks.duration ?? null;
      if (tv != null) row.trend.push({ d: w.d, value: tv });
    }
  }
  const out = [...rows.values()];
  for (const r of out) r.trend = r.trend.slice(-12);
  return out.sort((a, b) => (a.last.d === b.last.d ? a.name.localeCompare(b.name) : a.last.d < b.last.d ? 1 : -1));
}

/** Last time each exercise was done before `beforeDay` (for "last time: 3×8 @185"). */
export function lastSeen(state, exId, beforeDay = '9999-12-31') {
  let hit = null;
  for (const w of chronological(state)) {
    if (w.d >= beforeDay) break;
    const item = (w.items ?? []).find((i) => i.ex === exId);
    if (item) hit = { d: w.d, item, workout: w.id };
  }
  return hit;
}

/** Workouts of one Mon-start week. */
export function weekStats(state, today, weekStartIso = null) {
  const start = weekStartIso ?? startOfWeek(today, state.settings?.weekStart ?? 'mon');
  const end = addDays(start, 6);
  const list = chronological(state).filter((w) => w.d >= start && w.d <= end);
  const byType = {};
  for (const w of list) byType[w.type] = (byType[w.type] ?? 0) + 1;
  const idx = prsIndex(state);
  const days = new Set(list.map((w) => w.d));
  return {
    start, end,
    sessions: list.length,
    days: days.size,
    target: state.settings?.target ?? null,
    volume: Math.round(list.reduce((a, w) => a + workoutVolume(w), 0)),
    minutes: Math.round(list.reduce((a, w) => a + (workoutMinutes(w) ?? 0), 0)),
    dist: Math.round(list.reduce((a, w) => a + workoutDist(w), 0) * 100) / 100,
    sets: list.reduce((a, w) => a + w.items.reduce((b, i) => b + (i.sets?.length ?? 0), 0), 0),
    byType,
    prs: list.reduce((a, w) => a + (idx.get(w.id)?.length ?? 0), 0),
    workouts: list,
  };
}

/** The last `n` weeks, oldest first, each a weekStats without the workout list. */
export function weeks(state, today, n = 8) {
  const thisWeek = startOfWeek(today, state.settings?.weekStart ?? 'mon');
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const { workouts, ...rest } = weekStats(state, today, addDays(thisWeek, -7 * i));
    out.push(rest);
  }
  return out;
}

/** [{ d, count, types: [typeId] }] for `weeks` full weeks ending with this one, oldest first. */
export function heatmap(state, today, nWeeks = 12) {
  const start = addDays(startOfWeek(today, state.settings?.weekStart ?? 'mon'), -7 * (nWeeks - 1));
  const byDay = new Map();
  for (const w of Object.values(state.workouts ?? {})) {
    if (w.d < start) continue;
    if (!byDay.has(w.d)) byDay.set(w.d, []);
    byDay.get(w.d).push(w.type);
  }
  const out = [];
  for (let i = 0; i < nWeeks * 7; i++) {
    const d = addDays(start, i);
    const types = byDay.get(d) ?? [];
    out.push({ d, count: types.length, types, future: d > today });
  }
  return out;
}

/**
 * Streaks. days: consecutive days with a workout (counting back from today, or from
 * yesterday when today is still empty). weeks: consecutive weeks that hit the weekly
 * target (≥1 workout without one); this week counts once it hits, and never breaks it.
 */
export function streak(state, today) {
  const days = new Set(Object.values(state.workouts ?? {}).map((w) => w.d));
  let cur = 0;
  let d = days.has(today) ? today : addDays(today, -1);
  while (days.has(d)) {
    cur++;
    d = addDays(d, -1);
  }
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const x of sorted) {
    run = prev && diffDays(prev, x) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = x;
  }
  const target = state.settings?.target ?? 1;
  const ws = state.settings?.weekStart ?? 'mon';
  const counts = new Map();
  for (const w of Object.values(state.workouts ?? {})) {
    const k = startOfWeek(w.d, ws);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const thisWeek = startOfWeek(today, ws);
  let wCur = (counts.get(thisWeek) ?? 0) >= target ? 1 : 0;
  let k = addDays(thisWeek, -7);
  while ((counts.get(k) ?? 0) >= target) {
    wCur++;
    k = addDays(k, -7);
  }
  let wBest = 0;
  if (counts.size) {
    const weeksSorted = [...counts.keys()].sort();
    let r = 0;
    for (let x = weeksSorted[0]; x <= thisWeek; x = addDays(x, 7)) {
      r = (counts.get(x) ?? 0) >= target ? r + 1 : 0;
      wBest = Math.max(wBest, r);
    }
  }
  return { days: { current: cur, best }, weeks: { current: wCur, best: wBest, target } };
}

/** Most recent workout of a type before a day (for planning "same as last pull day"). */
export function lastOfType(state, type, beforeDay = '9999-12-31') {
  const list = chronological(state).filter((w) => w.type === type && w.d < beforeDay);
  return list[list.length - 1] ?? null;
}

/** Body weight entries oldest first + simple deltas. */
export function bodyTrend(state, today, days = 90) {
  const from = addDays(today, -days);
  const list = Object.values(state.body ?? {}).filter((b) => b.w != null && b.d >= from).sort((a, b) => (a.d < b.d ? -1 : 1));
  const last = list[list.length - 1] ?? null;
  const weekAgo = [...list].reverse().find((b) => b.d <= addDays(today, -7)) ?? null;
  const first = list[0] ?? null;
  return { list, last, change7: last && weekAgo && weekAgo !== last ? Math.round((last.w - weekAgo.w) * 10) / 10 : null, changeAll: last && first && first !== last ? Math.round((last.w - first.w) * 10) / 10 : null };
}

// ---------------------------------------------------------------- rotation: what hasn't been hit

/**
 * Every exercise in Danny's rotation (logged at least once, or flagged `rotation`), with
 * how long since it was hit, most overdue first (never-done flagged ones first of all):
 * [{ ex, name, area, kind, goal, daysSince (null = never), last: { d, item } | null, best, sessions }]
 */
export function rotation(state, today) {
  const stats = new Map(exerciseStats(state).map((r) => [r.ex, r]));
  const out = [];
  for (const e of Object.values(state.exercises ?? {})) {
    if (e.archived) continue;
    const st = stats.get(e.id);
    if (!st && !e.rotation) continue;
    const last = st ? lastSeen(state, e.id, addDays(today, 1)) : null;
    out.push({
      ex: e.id, name: e.name, area: e.type ?? 'other', kind: e.kind, goal: e.notes ?? '',
      daysSince: last ? diffDays(last.d, today) : null,
      last, best: st?.best ?? {}, sessions: st?.sessions ?? 0,
    });
  }
  const key = (r) => (r.daysSince == null ? Infinity : r.daysSince);
  return out.sort((a, b) => key(b) - key(a) || a.name.localeCompare(b.name));
}

/** Per area (workout type): days since anything in it was hit. Most overdue first. */
export function areaGaps(state, today) {
  const rot = rotation(state, today);
  const byArea = new Map();
  for (const r of rot) {
    const cur = byArea.get(r.area);
    const d = r.daysSince == null ? Infinity : r.daysSince;
    if (!cur) byArea.set(r.area, { area: r.area, daysSince: d, count: 1 });
    else {
      cur.daysSince = Math.min(cur.daysSince, d);
      cur.count++;
    }
  }
  return [...byArea.values()].map((a) => ({ ...a, daysSince: a.daysSince === Infinity ? null : a.daysSince }))
    .sort((a, b) => (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity));
}

/**
 * Today's suggestions: the most overdue exercises, one per area, skipping what was
 * already done today. Each carries what to beat (`last`, `best`) and Danny's goal.
 */
export function suggestions(state, today, n = 2) {
  const out = [];
  const areas = new Set();
  for (const r of rotation(state, today)) {
    if (r.daysSince === 0) continue;
    if (areas.has(r.area)) continue;
    areas.add(r.area);
    out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

/** "never", "today", "yesterday", "12 days ago". */
export function sinceLabel(days) {
  if (days == null) return 'never';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
