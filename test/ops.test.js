import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded, run } from './helpers.js';

test('logging on a planned day checks the plan off', () => {
  const { state, results } = run(seeded(), [
    ['planWorkout', { d: '2026-10-05', type: 'legs', title: 'Leg day' }],
    ['logWorkout', { d: '2026-10-05', type: 'legs', items: [{ ex: 'squat', sets: [{ r: 5, w: 225 }] }] }],
  ]);
  const plan = state.plans[results[0].id];
  assert.equal(plan.status, 'done');
  assert.equal(plan.workout, results[1].id);
  assert.equal(state.workouts[results[1].id].plan, plan.id);
  const del = run(state, [['deleteWorkout', { id: results[1].id }]]).state;
  assert.equal(del.plans[plan.id].status, 'planned');
});

test('completePlan logs the plan items; skip / unskip', () => {
  const { state, results } = run(seeded(), [
    ['planWorkout', { d: '2026-10-07', type: 'push', title: 'Push day', items: [{ ex: 'bench', sets: [{ r: 8, w: 200 }] }] }],
    ['skipPlan', { id: null }],
  ]);
  const id = results[0].id;
  const done = run(state, [['completePlan', { id, date: '2026-10-07' }]]);
  const w = done.state.workouts[done.results[0].id];
  assert.equal(w.d, '2026-10-07');
  assert.equal(w.items[0].sets[0].w, 200);
  const sk = run(state, [['skipPlan', { id }], ['unskipPlan', { id }]]);
  assert.equal(sk.state.plans[id].status, 'planned');
});

test('unknown exercises are created; mergeExercise folds them in', () => {
  const { state, results } = run(seeded(), [['logWorkout', { d: '2026-10-05', type: 'push', items: [{ ex: 'flat-db', name: 'Flat DB', kind: 'lift', sets: [{ r: 10, w: 60 }] }] }]]);
  assert.equal(state.exercises['flat-db'].name, 'Flat DB');
  const m = run(state, [['mergeExercise', { from: 'flat-db', into: 'db-bench' }]]).state;
  assert.equal(m.workouts[results[0].id].items[0].ex, 'db-bench');
  assert.ok(m.exercises['db-bench'].aliases.includes('flat db'));
  assert.equal(m.exercises['flat-db'], undefined);
});

test('body weight: one entry per day, re-logging replaces it', () => {
  const s = run(seeded(), [['logBody', { d: '2026-10-05', w: 172 }], ['logBody', { d: '2026-10-05', w: 171.5 }]]).state;
  assert.deepEqual(Object.keys(s.body), ['b_2026-10-05']);
  assert.equal(s.body['b_2026-10-05'].w, 171.5);
});

test('scrubText removes a detail from every stored text', () => {
  const { state } = run(seeded(), [['logWorkout', { d: '2026-10-05', type: 'other', title: 'Gym with J.D.', notes: 'J.D. spotted' }]]);
  const s = run(state, [['scrubText', { find: 'J.D.', replace: 'a friend' }]]).state;
  assert.ok(!JSON.stringify(s).includes('J.D.'));
});
