import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded, run } from './helpers.js';
import { prsIndex, e1rm, weekStats, streak, heatmap, exerciseStats, fmtPR } from '../src/engine/stats.js';
import { buildBrief, changesBetween, commitMessage } from '../src/engine/brief.js';

const log = (d, type, items, extra = {}) => ['logWorkout', { d, type, items, ...extra }];
const bench = (w, r = 8, n = 3) => ({ ex: 'bench', sets: Array(n).fill({ r, w }) });

test('PRs: heavier beats earlier; first session is not a PR; ties are not PRs', () => {
  const { state, results } = run(seeded(), [
    log('2026-09-28', 'push', [bench(185)]),
    log('2026-10-01', 'push', [bench(185)]),
    log('2026-10-05', 'push', [bench(195)]),
  ]);
  const idx = prsIndex(state);
  assert.deepEqual(idx.get(results[0].id), []);
  assert.deepEqual(idx.get(results[1].id), []);
  const pr = idx.get(results[2].id);
  assert.equal(pr.length, 1);
  assert.equal(pr[0].mark, 'weight');
  assert.equal(fmtPR(pr[0]), 'Bench press: heaviest 195 lb (was 185 lb)');
  assert.deepEqual(results[2].prs, pr, 'logWorkout reports the PRs');
});

test('PRs: more reps at the same weight is an e1RM PR; backdated sessions reorder', () => {
  const { state, results } = run(seeded(), [
    log('2026-10-05', 'push', [bench(185, 10)]),
    log('2026-09-28', 'push', [bench(185, 8)]),
  ]);
  const idx = prsIndex(state);
  assert.equal(idx.get(results[0].id)[0].mark, 'e1rm');
  assert.deepEqual(idx.get(results[1].id), []);
  assert.equal(e1rm(185, 1), 185);
});

test('cardio PRs: distance and pace', () => {
  const run1 = (d, dist, min) => log(d, 'cardio', [{ ex: 'run', dist, min }]);
  const { state, results } = run(seeded(), [run1('2026-09-28', 3, 27), run1('2026-10-05', 3.1, 26)]);
  const marks = prsIndex(state).get(results[1].id).map((p) => p.mark).sort();
  assert.deepEqual(marks, ['distance', 'pace']);
});

test('week stats, streaks and heatmap', () => {
  const { state } = run(seeded(), [
    log('2026-09-28', 'push', [bench(185)]),
    log('2026-09-30', 'cardio', [{ ex: 'run', dist: 3, min: 27 }]),
    log('2026-10-03', 'legs', []),
    log('2026-10-04', 'pull', []),
    log('2026-10-05', 'push', [bench(195)]),
  ]);
  const w = weekStats(state, '2026-10-05');
  assert.equal(w.sessions, 1);
  assert.equal(w.volume, 195 * 8 * 3);
  const last = weekStats(state, '2026-10-05', '2026-09-28');
  assert.equal(last.sessions, 4);
  assert.equal(last.dist, 3);
  const st = streak(state, '2026-10-05');
  assert.equal(st.days.current, 3);
  assert.equal(st.weeks.current, 2);
  const s2 = { ...state, settings: { ...state.settings, target: 4 } };
  assert.equal(streak(s2, '2026-10-05').weeks.current, 1, 'last week hit 4; this week is still in progress');
  const heat = heatmap(state, '2026-10-05', 2);
  assert.equal(heat.length, 14);
  assert.equal(heat.filter((c) => c.count).length, 5);
  assert.equal(exerciseStats(state)[0].ex, 'bench');
});

test('brief: a record, not a coach; asks about missed plans', () => {
  const { state } = run(seeded(), [
    ['planWorkout', { d: '2026-10-03', type: 'legs', title: 'Leg day' }],
    log('2026-10-05', 'push', [bench(185)]),
  ]);
  const b = buildBrief(state, { today: '2026-10-05' });
  assert.match(b.headline, /Logged today: Push day/);
  assert.equal(b.asks.length, 1);
  assert.match(b.asks[0], /Leg day/);
});

test('changesBetween reports website activity by id; commitMessage summarizes', () => {
  const base = seeded();
  const { state } = run(base, [['logWorkout', { d: '2026-10-05', type: 'push', title: 'Push day' }, { src: 'dash' }]]);
  const ch = changesBetween(base, state);
  assert.equal(ch.count, 1);
  assert.match(commitMessage(ch.entries), /^dash: ✓ Push day \(Mon 10\/5\)/);
});
