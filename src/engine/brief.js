// Claude's check-in, website-change reports and commit messages. Pure.
import { addDays, fmtDay, fmtRelative, localDateOf } from './dates.js';
import { weekStats, streak, prsIndex, fmtPR, chronological, bodyTrend, suggestions, sinceLabel } from './stats.js';
import { fmtItem } from './parse.js';
import { todayView, upcomingPlans } from './views.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * buildBrief(state, { today, now }) → { headline, lines, asks, text }
 * A record, not a coach: what got done, PRs, what's planned. No nudges unless
 * settings.reminders is on.
 */
export function buildBrief(state, { today }) {
  const week = weekStats(state, today);
  const st = streak(state, today);
  const tv = todayView(state, today);
  const idx = prsIndex(state);
  const lines = [];
  const asks = [];

  const doneToday = tv.workouts;
  let headline;
  if (doneToday.length) headline = `Logged today: ${doneToday.map((w) => w.title).join(' + ')}.`;
  else if (tv.planned.length) headline = `On the plan today: ${tv.planned.map((p) => p.title).join(' + ')}.`;
  else {
    const sug = state.settings?.reminders !== false ? suggestions(state, today, 2) : [];
    headline = sug.length ? `Today could be ${sug.map((r) => r.name.toLowerCase()).join(' or ')}.` : week.sessions ? `${plural(week.sessions, 'workout')} this week.` : 'Fresh week.';
  }

  const target = state.settings?.target;
  lines.push(`This week: ${week.sessions}${target ? `/${target}` : ''} workout${week.sessions === 1 && !target ? '' : 's'}${week.volume ? ` · ${week.volume.toLocaleString('en-US')} ${state.settings?.unit ?? 'lb'} volume` : ''}${week.dist ? ` · ${week.dist} ${state.settings?.dist ?? 'mi'}` : ''}${week.minutes ? ` · ${week.minutes} min` : ''}.`);
  const weekPRs = week.workouts.flatMap((w) => idx.get(w.id) ?? []);
  if (weekPRs.length) lines.push(`PRs this week: ${weekPRs.slice(0, 3).map((p) => fmtPR(p, state.settings)).join('; ')}${weekPRs.length > 3 ? ` +${weekPRs.length - 3} more` : ''}.`);
  if (st.days.current >= 2) lines.push(`${st.days.current}-day streak.`);
  if (st.weeks.current >= 2) lines.push(`${st.weeks.current} weeks in a row${target ? ` at ${target}+` : ''}.`);

  const upcoming = upcomingPlans(state, addDays(today, 1), 7).slice(0, 4);
  if (upcoming.length) lines.push(`Planned: ${upcoming.map((p) => `${p.title} ${fmtDay(p.d)}`).join(', ')}.`);

  if (state.settings?.reminders !== false) {
    const sug = suggestions(state, today, 2);
    if (sug.length) {
      lines.push(`${doneToday.length ? 'Next time' : 'Could hit today'}: ${sug.map((r) => `${r.name} (${sinceLabel(r.daysSince)}${r.last ? `; last ${fmtItem(r.last.item, state.settings)}` : ''})`).join(' or ')}.`);
    }
  }

  const bt = bodyTrend(state, today, 30);
  if (bt.last && bt.last.d >= addDays(today, -7)) lines.push(`Body weight ${bt.last.w}${bt.change7 != null ? ` (${bt.change7 > 0 ? '+' : ''}${bt.change7} vs a week ago)` : ''}.`);

  for (const p of tv.missed.slice(0, 2)) asks.push(`Did ${p.title} (${fmtDay(p.d)}) happen? Log it, move it, or skip it.`);

  const text = [headline, ...lines.map((l) => `- ${l}`), ...asks.map((a) => `? ${a}`)].join('\n');
  return { headline, lines, asks, text };
}

/** Activity entries from `src` (default 'dash') in `after` but not in `before`, oldest first. */
export function changesBetween(before, after, { src = 'dash' } = {}) {
  const seen = before?.activity ?? {};
  const entries = Object.values(after?.activity ?? {})
    .filter((a) => !seen[a.id] && (src === 'any' || a.src === src))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { entries, count: entries.length };
}

/** Website activity stamped after `sinceIso`. */
export function changesSince(state, sinceIso) {
  const entries = Object.values(state.activity ?? {})
    .filter((a) => a.src === 'dash' && (!sinceIso || a.at > sinceIso))
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  return { entries, count: entries.length };
}

const SYM = { log: '✓', edit: '✎', delete: '✕', plan: '+', unplan: '✕', move: '→', skip: '↷', unskip: '↺', body: '⚖', ex: '#', type: '#', settings: '⚙', scrub: '⌫' };

export function fmtEntry(a) {
  return `${SYM[a.type] ?? '·'} ${a.title}${a.to && /^\d{4}-\d{2}-\d{2}$/.test(a.to) ? ` (${fmtDay(a.to)})` : ''}`;
}

/** One-line subject + bullet body for a git commit (website side prefixes "dash:"). */
export function commitMessage(activity = [], prefix = 'dash') {
  const list = activity.slice().sort((a, b) => (a.at < b.at ? -1 : 1));
  if (!list.length) return '';
  const parts = list.map(fmtEntry);
  let subject = `${prefix}: ${parts.slice(0, 3).join(' · ')}${parts.length > 3 ? ` · +${parts.length - 3} more` : ''}`;
  if (subject.length > 72) subject = subject.slice(0, 69) + '...';
  return `${subject}\n\n${list.map((a) => `- ${a.type}: ${a.title}${a.to ? ` → ${a.to}` : ''}`).join('\n')}`;
}

/** "Mon 10/5 · Push day · 45 min" */
export function workoutLine(w, today) {
  return `${fmtDay(w.d)}${today ? ` (${fmtRelative(w.d, today)})` : ''} · ${w.title}${w.min ? ` · ${w.min} min` : ''}`;
}

export { chronological, localDateOf };
