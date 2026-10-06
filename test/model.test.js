import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWrites, diffWrites, normalizeState, serializeState, emptyState } from '../src/engine/model.js';
import { OPS } from '../src/engine/ops.js';
import { seeded, run, ctx } from './helpers.js';

test('every op: applyWrites(base, writes) reproduces the result', () => {
  const s0 = seeded();
  const steps = [
    ['logWorkout', { d: '2026-10-05', type: 'push', title: 'Push day', items: [{ ex: 'bench', sets: [{ r: 8, w: 185 }] }] }],
    ['planWorkout', { d: '2026-10-07', type: 'pull', title: 'Pull day', items: [] }],
    ['logBody', { d: '2026-10-05', w: 172.4 }],
    ['addExercise', { name: 'Cable crossover', kind: 'lift', type: 'push' }],
    ['editSettings', { patch: { target: 4 } }],
  ];
  let s = s0;
  for (const [name, args] of steps) {
    const res = OPS[name](s, args, ctx());
    assert.ok(res.writes.length, name);
    assert.deepEqual(applyWrites(s, res.writes), res.state, name);
    s = res.state;
  }
});

test('3-way merge: both sides add items to one workout; both survive', () => {
  const { state: base, results } = run(seeded(), [['logWorkout', { d: '2026-10-05', type: 'push', items: [{ ex: 'bench', sets: [{ r: 8, w: 185 }] }] }]]);
  const id = results[0].id;
  const w = base.workouts[id];
  const web = OPS.editWorkout(base, { id, patch: { items: [...w.items, { id: 'i2', ex: 'ohp', sets: [{ r: 10, w: 95 }] }] } }, ctx({ src: 'dash' })).state;
  const chat = OPS.editWorkout(base, { id, patch: { items: [...w.items, { id: 'i2', ex: 'dips', sets: [{ r: 12, w: null }] }], min: 45 } }, ctx()).state;
  const merged = applyWrites(web, diffWrites(base, chat));
  assert.deepEqual(merged.workouts[id].items.map((i) => i.ex), ['bench', 'ohp', 'dips']);
  assert.equal(merged.workouts[id].items[2].id, 'i3');
  assert.equal(merged.workouts[id].min, 45);
});

test('serialize is stable and round-trips', () => {
  const s = run(seeded(), [['logWorkout', { d: '2026-10-05', type: 'other', title: 'Workout' }]]).state;
  const text = serializeState(s);
  assert.equal(serializeState(normalizeState(JSON.parse(text))), text);
  assert.equal(serializeState(normalizeState({})), serializeState(emptyState()));
});
