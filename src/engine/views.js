// Read-only shapes for the website and the CLI. Pure.
import { addDays, rangeDays, isWeekend } from './dates.js';
import { chronological, prsIndex } from './stats.js';

/**
 * calendarView(state, start, days = 14, today = start) →
 * [{ d, isToday, isPast, isWeekend, plans: Plan[] (planned/skipped/done), workouts: Workout[] }]
 */
export function calendarView(state, start, days = 14, today = start) {
  const plans = Object.values(state.plans ?? {});
  const workouts = Object.values(state.workouts ?? {});
  return rangeDays(start, days).map((d) => ({
    d,
    isToday: d === today,
    isPast: d < today,
    isWeekend: isWeekend(d),
    plans: plans.filter((p) => p.d === d).sort((a, b) => (a.time ?? '') < (b.time ?? '') ? -1 : 1),
    workouts: workouts.filter((w) => w.d === d).sort((a, b) => (a.created < b.created ? -1 : 1)),
  }));
}

/** Today: { workouts done today, plans for today still open, missed: open plans before today (last 7 days) } */
export function todayView(state, today) {
  const plans = Object.values(state.plans ?? {});
  return {
    workouts: Object.values(state.workouts ?? {}).filter((w) => w.d === today),
    planned: plans.filter((p) => p.d === today && p.status === 'planned'),
    missed: plans.filter((p) => p.status === 'planned' && p.d < today && p.d >= addDays(today, -7)).sort((a, b) => (a.d < b.d ? -1 : 1)),
    next: plans.filter((p) => p.status === 'planned' && p.d > today).sort((a, b) => (a.d < b.d ? -1 : 1))[0] ?? null,
  };
}

/** Newest first, with PRs attached: [{ workout, prs }]. */
export function logView(state, { limit = 50, type = null, ex = null } = {}) {
  const idx = prsIndex(state);
  let list = chronological(state).reverse();
  if (type) list = list.filter((w) => w.type === type);
  if (ex) list = list.filter((w) => w.items.some((i) => i.ex === ex));
  return list.slice(0, limit).map((w) => ({ workout: w, prs: idx.get(w.id) ?? [] }));
}

/** Upcoming plans (today on), soonest first. */
export function upcomingPlans(state, today, days = 14) {
  const end = addDays(today, days - 1);
  return Object.values(state.plans ?? {}).filter((p) => p.status === 'planned' && p.d >= today && p.d <= end).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}
