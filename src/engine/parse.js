// Chat / quick-add text → a workout. Pure.
//   "did push day: bench 3x8 @185, ohp 3x10 @95, 30 min"
//   "ran 3 miles in 27 min yesterday"
//   "squat 225x5, 245x5, 265x3 sat"
//   "yoga class 60 min"
import { addDays, diffDays, findDatePhrase, isISODate, parseDuration } from './dates.js';
import { slugify } from './model.js';

const KG_TO_LB = 2.20462;
const KM_TO_MI = 0.621371;

const round = (n, step = 0.5) => Math.round(n / step) * step;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Alias → id table sorted longest alias first (so "incline bench" beats "bench"). */
function aliasTable(map, nameKey = 'name') {
  const rows = [];
  for (const doc of Object.values(map ?? {})) {
    if (!doc || doc.archived) continue;
    const names = new Set([String(doc[nameKey] ?? '').toLowerCase(), String(doc.id).replace(/-/g, ' '), ...(doc.aliases ?? [])]);
    for (const a of names) if (a && a.length >= 2) rows.push({ alias: a, id: doc.id });
  }
  return rows.sort((a, b) => b.alias.length - a.alias.length);
}

function findAlias(text, table) {
  const lower = ` ${text.toLowerCase()} `;
  for (const row of table) {
    const re = new RegExp(`(^|[^a-z0-9])${esc(row.alias)}(?=$|[^a-z0-9])`);
    const m = lower.match(re);
    if (m) return { id: row.id, alias: row.alias, index: m.index + m[1].length - 1 };
  }
  return null;
}

/**
 * The day a workout happened (mode 'log') or is planned for (mode 'plan').
 * Log: bare weekdays mean the most recent one (today counts), "last night" is
 * yesterday, "N days ago" works. Plan: dates.js rules (weekday = next one).
 * Returns { date, consumed } or null.
 */
export function findDay(text, today, mode = 'log') {
  const lower = text.toLowerCase();
  let m = lower.match(/\b(last night|yesterday morning|yesterday afternoon|yesterday evening)\b/);
  if (m) return { date: addDays(today, -1), consumed: text.substr(m.index, m[0].length) };
  m = lower.match(/\b(\d+|a|one|two|three|four|five|six)\s+days?\s+ago\b/);
  if (m) {
    const words = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = words[m[1]] ?? parseInt(m[1], 10);
    return { date: addDays(today, -n), consumed: text.substr(m.index, m[0].length) };
  }
  if (mode === 'log') {
    m = lower.match(/\b(?:last|this past|on)\s+(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)[a-z]*\b/);
    if (m) {
      const idx = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].findIndex((k) => m[1].startsWith(k));
      const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
      let back = (todayDow - idx + 7) % 7;
      if (back === 0 && /^last/.test(m[0])) back = 7;
      return { date: addDays(today, -back), consumed: text.substr(m.index, m[0].length) };
    }
  }
  const hit = findDatePhrase(text, today);
  if (!hit || !isISODate(hit.date)) return null;
  if (/^\d+$/.test(hit.consumed.trim())) return null;
  let date = hit.date;
  if (mode === 'log' && date > today && !/next/i.test(hit.consumed)) {
    // a bare weekday / "the 3rd" means the one that just happened
    const back = diffDays(today, date);
    if (back <= 7) date = addDays(date, -7);
    else if (back > 300) date = addDays(date, -365);
  }
  return { date, consumed: hit.consumed };
}

// ---------------------------------------------------------------- numbers inside one item

const NUM = '(\\d+(?:\\.\\d+)?)';
const WUNIT = '\\s*(lbs?|pounds?|kgs?|kilos?|#)?';

function toUnit(w, unitText, unit) {
  if (w == null) return null;
  const kg = /^k/i.test(unitText ?? '');
  if (kg && unit === 'lb') return round(w * KG_TO_LB);
  if (!kg && unitText && unit === 'kg') return round(w / KG_TO_LB);
  return w;
}

/**
 * Pull set / cardio numbers out of one segment. Returns
 * { sets: Set[], dist, min, rest } where `rest` is the leftover words (the exercise name).
 */
export function parseNumbers(segment, { unit = 'lb', dist: distUnit = 'mi' } = {}) {
  let t = ` ${segment} `;
  const sets = [];
  let dist = null;
  let min = null;
  let defaultW = null;
  let added = false;
  const cut = (m) => {
    t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length);
  };
  const take = (re, fn) => {
    let m;
    while ((m = t.match(re))) {
      fn(m);
      cut(m);
    }
  };
  const push = (n, r, w, s = null) => {
    for (let i = 0; i < Math.min(n, 30); i++) sets.push(s ? { r: null, w: w ?? null, s } : { r, w: w ?? null });
  };

  // distance: 3 miles, 5k, 2.5 mi, 400m (meters only with "m " after 3+ digits)
  take(new RegExp(`(?<![\\w.])${NUM}\\s*(miles?|mi|kilometers?|km|k)(?![a-z])`, 'i'), (m) => {
    const v = parseFloat(m[1]);
    const km = /^k/i.test(m[2]);
    dist = round(km && distUnit === 'mi' ? v * KM_TO_MI : !km && distUnit === 'km' ? v / KM_TO_MI : v, 0.01);
  });
  take(/(?<![\w.])(\d{3,5})\s*(?:m|meters?)(?![a-z])/i, (m) => {
    const km = parseInt(m[1], 10) / 1000;
    dist = round(distUnit === 'mi' ? km * KM_TO_MI : km, 0.01);
  });
  // durations: "in 27:30", "27 min", "1h", "1h 10m", "for an hour", "45 minutes"
  take(/\b(?:for\s+)?(an|one)\s+hour\b/i, () => {
    min = 60;
  });
  take(/(?<![\w.:])(?:in\s+|for\s+|took\s+)?(\d+(?:\.\d+)?\s*(?:h|hr|hrs|hours?)(?:\s*\d+\s*(?:m|min|mins|minutes?))?)(?![a-z])/i, (m) => {
    min = parseDuration(m[1].replace(/\s+/g, ''));
  });
  take(/(?<![\w.:])(?:in\s+|for\s+|took\s+)?(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes?)(?![a-z])/i, (m) => {
    min = Math.round(parseFloat(m[1]) * 10) / 10;
  });
  // mm:ss only when it is a time ("in 27:30", or next to a distance)
  take(/(?<![\w.:])(?:in\s+)?(\d{1,3}):([0-5]\d)(?![\d:])/i, (m) => {
    min = Math.round((parseInt(m[1], 10) + parseInt(m[2], 10) / 60) * 100) / 100;
  });
  // "@185", "at 185 lbs", "+25" (added weight for bodyweight work), "bw"
  const wAt = t.match(new RegExp(`(?:@|\\bat\\s+|\\bw/\\s*)\\s*${NUM}${WUNIT}`, 'i'));
  if (wAt) {
    defaultW = toUnit(parseFloat(wAt[1]), wAt[2], unit);
    cut(wAt);
  }
  const plus = t.match(new RegExp(`(?<![\\w.])\\+\\s*${NUM}${WUNIT}`, 'i'));
  if (plus) {
    defaultW = toUnit(parseFloat(plus[1]), plus[2], unit);
    added = true;
    cut(plus);
  }
  take(/\b(?:bw|bodyweight|body weight)\b/i, () => {});
  if (defaultW == null) {
    const lone = t.match(new RegExp(`(?<![\\w.]|[x×*]\\s?)${NUM}\\s*(lbs?|pounds?|kgs?|kilos?)(?![\\w.])(?!\\s*[x×*])`, 'i'));
    if (lone) {
      defaultW = toUnit(parseFloat(lone[1]), lone[2], unit);
      cut(lone);
    }
  }

  // seconds for holds: 3x45s, 60 sec
  take(new RegExp(`(?<![\\w.])(\\d+)\\s*[x×*]\\s*(\\d+)\\s*(?:s|sec|secs|seconds)(?![a-z])`, 'i'), (m) => push(parseInt(m[1], 10), null, defaultW, parseInt(m[2], 10)));
  take(/(?<![\w.])(\d+)\s*(?:s|sec|secs|seconds)(?![a-z])/i, (m) => push(1, null, defaultW, parseInt(m[1], 10)));

  // "3 sets of 8", "3 sets of 8 reps"
  take(/(?<![\w.])(\d+)\s*sets?\s*(?:of|x)\s*(\d+)(?:\s*reps?)?/i, (m) => push(parseInt(m[1], 10), parseInt(m[2], 10), defaultW));
  // a x b x c
  take(new RegExp(`(?<![\\w.])${NUM}${WUNIT}\\s*[x×*]\\s*${NUM}\\s*[x×*]\\s*${NUM}${WUNIT}(?![\\w.])`, 'i'), (m) => {
    const a = parseFloat(m[1]);
    const b = parseFloat(m[3]);
    const c = parseFloat(m[4]);
    if (a >= 20 && c < 20) push(c, b, toUnit(a, m[2], unit)); // 185x8x3: weight × reps × sets
    else push(a, b, toUnit(c, m[5], unit)); // 3x8x185: sets × reps × weight
  });
  // reps list: 8/8/6 @185, 185 x 8/8/6
  take(new RegExp(`(?<![\\w.])(?:${NUM}${WUNIT}\\s*[x×*]\\s*)?(\\d+(?:\\s*/\\s*\\d+)+)(?![\\w.])`, 'i'), (m) => {
    const w = m[1] ? toUnit(parseFloat(m[1]), m[2], unit) : defaultW;
    for (const r of m[3].split('/')) push(1, parseInt(r, 10), w);
  });
  // a x b [weight]
  take(new RegExp(`(?<![\\w.])${NUM}${WUNIT}\\s*[x×*]\\s*${NUM}(?:\\s*(?:reps?))?(?:\\s+${NUM}${WUNIT})?(?![\\w.])`, 'i'), (m) => {
    const a = parseFloat(m[1]);
    const b = parseFloat(m[3]);
    const trailing = m[4] ? toUnit(parseFloat(m[4]), m[5], unit) : null;
    if (trailing != null) push(a, b, trailing); // 3x8 185
    else if (m[2] || (a >= 20 && b <= 30)) push(1, b, toUnit(a, m[2], unit)); // 185x8: one set
    else push(a, b, defaultW); // 3x8 (@185)
  });
  // "8 reps" / "20 pushups" style counts: a lone "N reps"
  take(/(?<![\w.])(\d+)\s*reps?\b/i, (m) => push(1, parseInt(m[1], 10), defaultW));
  // weight that came with no reps ("deadlift 315")
  if (!sets.length && defaultW == null) {
    take(new RegExp(`(?<![\\w.])${NUM}${WUNIT}(?![\\w.])`, 'i'), (m) => {
      const v = parseFloat(m[1]);
      if (m[2] || v >= 45) push(1, null, toUnit(v, m[2], unit));
      else if (v >= 1) push(1, Math.round(v), null); // "pullups 12": reps
    });
  } else if (defaultW != null && !sets.length && min == null) {
    push(1, null, defaultW);
  }
  return { sets, dist, min, added, rest: t.replace(/\s+/g, ' ').trim() };
}

// ---------------------------------------------------------------- whole line

const LEAD_RE = /^(?:(?:i|just|today|ok|so|also|and|then)\s+)*(?:(?:did|done|finished|hit|went to|went|got in|got|logged?|log|completed|crushed|smashed|knocked out|had|played|play|took|take)\s+)?(?:(?:a|an|my|the|some)\s+)?/i;
const FILLER_RE = /\b(?:did|done|finished|hit|went|played|play|took|to|the|gym|workout|session|day|today|tonight|this morning|this afternoon|this evening|and|then|with|of|for|my|a|an|some|felt|great|good|easy|hard|ok|reps?|sets?|plates?|total|about|around|~|ish|did|plus|at)\b/gi;

/**
 * parseWorkout(text, { today, state, mode }) →
 * { d, dateText, type, typeText, title, min, items: [{ ex, name, isNew, kind, sets, dist, min, notes }],
 *   notes, unknown: [segments it could not read] }
 * `mode` 'log' (default) backdates bare weekdays; 'plan' reads them forward.
 */
export function parseWorkout(text, { today, state = {}, mode = 'log' } = {}) {
  const settings = state.settings ?? {};
  let body = String(text ?? '').trim();
  const out = { d: today, dateText: null, type: null, typeText: null, title: null, min: null, items: [], notes: '', unknown: [] };

  // notes in quotes or after "notes:"
  const q = body.match(/(?:notes?:\s*)(.+)$/i) || body.match(/"([^"]+)"/);
  if (q) {
    out.notes = q[1].trim();
    body = body.replace(q[0], ' ');
  }

  const day = findDay(body, today, mode);
  if (day) {
    out.d = day.date;
    out.dateText = day.consumed;
    body = body.replace(day.consumed, ' ');
  }
  body = body.replace(/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/gi, ' ');

  // type: "<alias> day" or a type-only word (yoga, class, full body); not words that are also exercises
  const exTable = aliasTable(state.exercises);
  const exAliases = new Set(exTable.map((r) => r.alias));
  const typeTable = aliasTable(state.types).filter((r) => !exAliases.has(r.alias));
  const GENERIC = new Set(['class', 'workout', 'gym', 'lift', 'lifted', 'trained', 'exercise', 'full']);
  // words inside an exercise name ("soleus stretch") never count as a type ("stretch")
  const masked = () => {
    let m = ` ${body.toLowerCase().replace(/\([^)]*\)/g, (x) => '\u0000'.repeat(x.length))} `;
    for (const row of exTable) {
      const re = new RegExp(`(^|[^a-z0-9])(${esc(row.alias)})(?=$|[^a-z0-9])`, 'g');
      m = m.replace(re, (_, pre, w) => pre + '\u0000'.repeat(w.length));
    }
    return m.slice(1, -1);
  };
  for (let guard = 0; guard < 4; guard++) {
    const typeHit = findAlias(masked(), typeTable);
    if (!typeHit) break;
    if (!out.type) out.type = typeHit.id;
    if (!out.typeText || (GENERIC.has(out.typeText) && !GENERIC.has(typeHit.alias))) out.typeText = typeHit.alias;
    const after = body.slice(typeHit.index + typeHit.alias.length).match(/^\s+(?:day|session|workout|class)\b/i);
    body = `${body.slice(0, typeHit.index)} ${body.slice(typeHit.index + typeHit.alias.length + (after ? after[0].length : 0))}`;
  }
  body = body.replace(LEAD_RE, '');
  body = body.replace(/\(([^)]*)\)/g, (m) => m.replace(/[,;:]/g, ' /'));
  // segments: commas / semicolons / newlines / " and " / " then " / " + "
  const segments = body
    .split(/\s*(?:[,;\n]|\band then\b|\bthen\b|\band\b|\s\+\s|:(?!\d))\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);

  for (let seg of segments) {
    const itemNotes = [];
    seg = seg.replace(/\(([^)]*)\)/g, (_, n) => {
      if (n.trim()) itemNotes.push(n.trim());
      return ' ';
    });
    seg = seg.replace(/\b(?:per|each|a|on each)\s+(side|leg|arm)\b/gi, (_, w) => {
      itemNotes.push(`per ${w.toLowerCase()}`);
      return ' ';
    });
    seg = seg.replace(/\bhalf[- ]reps?\b/gi, () => {
      itemNotes.push('half reps');
      return ' reps ';
    });
    const nums = parseNumbers(seg, { unit: settings.unit ?? 'lb', dist: settings.dist ?? 'mi' });
    const words = nums.rest.replace(LEAD_RE, '').trim();
    const hit = words ? findAlias(words, exTable) : null;
    const hasNumbers = nums.sets.length || nums.dist != null || nums.min != null;
    if (hit) {
      const doc = state.exercises?.[hit.id];
      out.items.push({ ex: hit.id, name: doc?.name ?? hit.id, isNew: false, kind: doc?.kind ?? 'lift', sets: nums.sets, dist: nums.dist, min: nums.min, notes: itemNotes.join(', '), added: nums.added });
      continue;
    }
    const nameWords = words.replace(FILLER_RE, ' ').replace(/[^a-z0-9' -]/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!nameWords) {
      if (!hasNumbers) continue;
      const prev = out.items[out.items.length - 1];
      if (nums.sets.length && prev && (prev.kind === 'lift' || prev.kind === 'bw' || prev.kind === 'time')) {
        prev.sets.push(...nums.sets); // "bench 185x8, 195x6": more sets of the same lift
      } else if (prev && (prev.kind === 'cardio' || prev.kind === 'time') && prev.min == null && nums.min != null && !nums.sets.length) {
        prev.min = nums.min; // "ran 3 miles, 27 min"
        if (nums.dist != null && prev.dist == null) prev.dist = nums.dist;
      } else if (nums.min != null && !nums.sets.length && nums.dist == null) {
        out.min = nums.min; // "30 min": the whole session
      } else if (nums.dist != null) {
        out.items.push({ ex: 'run', name: state.exercises?.run?.name ?? 'Run', isNew: !state.exercises?.run, kind: 'cardio', sets: [], dist: nums.dist, min: nums.min, notes: '' });
      } else {
        out.unknown.push(seg);
      }
      continue;
    }
    if (!hasNumbers && nameWords.split(' ').length > 4) {
      out.unknown.push(seg); // prose, not an exercise
      continue;
    }
    const name = nameWords.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/^(.)/, (c) => c.toUpperCase());
    const kind = nums.dist != null ? 'cardio' : nums.sets.some((s) => s.w != null) ? 'lift' : nums.sets.some((s) => s.s) ? 'time' : nums.sets.length ? 'bw' : nums.min != null ? 'time' : 'lift';
    out.items.push({ ex: slugify(name), name, isNew: !state.exercises?.[slugify(name)], kind, sets: nums.sets, dist: nums.dist, min: nums.min, notes: itemNotes.join(', '), added: nums.added });
  }

  // a bodyweight item's "@25" / "+25" is added weight; a lift item with bare reps keeps w null
  for (const it of out.items) delete it.added;

  if (!out.type) out.type = inferType(out.items, state);
  if (out.type === 'cardio' && out.min == null && out.items.length === 1 && out.items[0].min != null) out.min = out.items[0].min;
  out.title = titleFor(out, state);
  return out;
}

/** Most common split among the items' exercises; cardio when all cardio; else 'other'. */
export function inferType(items, state = {}) {
  if (!items.length) return 'other';
  const kinds = items.map((i) => state.exercises?.[i.ex]?.kind ?? i.kind);
  if (kinds.every((k) => k === 'cardio')) return state.types?.cardio ? 'cardio' : 'other';
  const counts = new Map();
  for (const it of items) {
    const t = state.exercises?.[it.ex]?.type;
    if (t && t !== 'cardio' && state.types?.[t]) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return 'other';
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1] && ranked[0][1] === 1) return 'other'; // a mixed session
  if (ranked.length >= 2 && ranked[1][1] >= 2 && state.types?.full) {
    const top = new Set(ranked.slice(0, 2).map(([t]) => t));
    if (top.has('push') && top.has('pull') && state.types?.upper) return 'upper';
    return 'full';
  }
  return ranked[0][0];
}

function titleFor(w, state) {
  const type = state.types?.[w.type];
  if (type && type.kind === 'lift') return typeTitle(type);
  if (w.items.length === 1 && w.items[0].kind === 'cardio') {
    const it = w.items[0];
    const unit = state.settings?.dist ?? 'mi';
    return it.dist != null ? `${trimNum(it.dist)} ${unit} ${it.name.toLowerCase()}` : it.name;
  }
  if (w.typeText && type && !['workout', 'gym', 'lift', 'lifted', 'trained', 'exercise'].includes(w.typeText)) return w.typeText.replace(/^./, (c) => c.toUpperCase());
  if (type && type.id !== 'other') return type.name;
  if (w.items.length === 1) return w.items[0].name;
  if (w.items.length && w.items.length <= 3) return w.items.map((i, k) => (k ? i.name.toLowerCase() : i.name)).join(' + ');
  return w.items.length ? 'Mixed session' : 'Workout';
}

/** "Push day", "Leg day", "Full body", "Feet & calves", "Cardio". */
export function typeTitle(type) {
  if (!type) return 'Workout';
  if (type.kind !== 'lift' || /[\s&]/.test(type.name)) return type.name;
  return `${type.name.replace(/s$/, '')} day`;
}

export const trimNum = (n) => (n == null ? '' : String(Math.round(n * 100) / 100));

/** "3×8 @185", "185×8, 195×6", "3 mi · 27:00", "3×45s" for one item. */
export function fmtItem(item, settings = {}) {
  const unit = settings.unit ?? 'lb';
  const parts = [];
  const sets = item.sets ?? [];
  if (sets.length) {
    const groups = [];
    for (const s of sets) {
      const last = groups[groups.length - 1];
      if (last && last.r === s.r && last.w === s.w && (last.s ?? null) === (s.s ?? null)) last.n++;
      else groups.push({ n: 1, r: s.r, w: s.w, s: s.s ?? null });
    }
    parts.push(groups.map((g) => {
      if (g.s) return `${g.n > 1 ? `${g.n}×` : ''}${g.s}s${g.w != null ? ` @${trimNum(g.w)}` : ''}`;
      const reps = g.r == null ? '' : g.n > 1 ? `${g.n}×${g.r}` : `${g.r}`;
      const w = g.w == null ? '' : `${trimNum(g.w)}`;
      if (!reps) return `${g.n > 1 ? `${g.n}×` : ''}${w}${w ? ` ${unit}` : ''}`;
      if (!w) return g.n > 1 ? reps : `${reps} reps`;
      return g.n > 1 ? `${reps} @${w}` : `${w}×${reps}`;
    }).join(', '));
  }
  if (item.dist != null) parts.push(`${trimNum(item.dist)} ${settings.dist ?? 'mi'}`);
  if (item.min != null) parts.push(fmtMin(item.min));
  if (item.dist != null && item.min) parts.push(`${fmtPace(item.min / item.dist)}/${settings.dist ?? 'mi'}`);
  return parts.join(' · ');
}

/** 27 → "27 min", 27.5 → "27:30", 75 → "1h 15m". */
export function fmtMin(m) {
  if (m == null) return '';
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const r = Math.round(m - h * 60);
    return r ? `${h}h ${r}m` : `${h}h`;
  }
  if (Math.abs(m - Math.round(m)) > 0.01) return fmtPace(m);
  return `${Math.round(m)} min`;
}

export function fmtPace(minutes) {
  const total = Math.round(minutes * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
