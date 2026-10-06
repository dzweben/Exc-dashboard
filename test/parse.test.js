import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkout, parseNumbers, findDay, fmtItem } from '../src/engine/parse.js';
import { seeded, TODAY } from './helpers.js';

const state = seeded();
const p = (t, mode) => parseWorkout(t, { today: TODAY, state, mode });

test('push day with sets, weights and a session length', () => {
  const w = p('did push day: bench 3x8 @185, ohp 3x10 @95, 30 min');
  assert.equal(w.d, TODAY);
  assert.equal(w.type, 'push');
  assert.equal(w.title, 'Push day');
  assert.equal(w.min, 30);
  assert.deepEqual(w.items.map((i) => i.ex), ['bench', 'ohp']);
  assert.deepEqual(w.items[0].sets, Array(3).fill({ r: 8, w: 185 }));
  assert.deepEqual(w.items[1].sets, Array(3).fill({ r: 10, w: 95 }));
});

test('cardio: distance, time, pace, backdated', () => {
  const w = p('ran 3 miles in 27 min yesterday');
  assert.equal(w.d, '2026-10-04');
  assert.equal(w.type, 'cardio');
  assert.equal(w.items[0].ex, 'run');
  assert.equal(w.items[0].dist, 3);
  assert.equal(w.items[0].min, 27);
  assert.equal(fmtItem(w.items[0]), '3 mi · 27 min · 9:00/mi');
  const k = p('5k run 25:30');
  assert.equal(k.items[0].dist, 3.11);
  assert.equal(k.items[0].min, 25.5);
});

test('set notations', () => {
  const n = (t) => parseNumbers(t).sets;
  assert.deepEqual(n('185x8x3'), Array(3).fill({ r: 8, w: 185 }));
  assert.deepEqual(n('3x8x185'), Array(3).fill({ r: 8, w: 185 }));
  assert.deepEqual(n('3x8 185'), Array(3).fill({ r: 8, w: 185 }));
  assert.deepEqual(n('3 sets of 10'), Array(3).fill({ r: 10, w: null }));
  assert.deepEqual(n('8/8/6 @185'), [{ r: 8, w: 185 }, { r: 8, w: 185 }, { r: 6, w: 185 }]);
  assert.deepEqual(n('3x45s'), Array(3).fill({ r: null, w: null, s: 45 }));
  assert.deepEqual(n('100kg 5x5')[0], { r: 5, w: 220.5 });
  const sq = p('squat 225x5, 245x5, 265x3 sat');
  assert.deepEqual(sq.items[0].sets, [{ r: 5, w: 225 }, { r: 5, w: 245 }, { r: 3, w: 265 }]);
  assert.equal(sq.d, '2026-10-03');
  assert.equal(sq.title, 'Leg day');
});

test('log mode backdates weekdays, plan mode reads them forward', () => {
  assert.equal(findDay('legs thursday', TODAY, 'log').date, '2026-10-01');
  assert.equal(findDay('legs thursday', TODAY, 'plan').date, '2026-10-08');
  assert.equal(findDay('last mon', TODAY, 'log').date, '2026-09-28');
  assert.equal(findDay('on mon', TODAY, 'log').date, TODAY);
  assert.equal(findDay('2 days ago', TODAY).date, '2026-10-03');
  assert.equal(findDay('last night', TODAY).date, '2026-10-04');
  assert.equal(findDay('bench 3x8 @185', TODAY), null);
});

test('classes and sports: type + minutes, no fake exercise', () => {
  const y = p('yoga class 60 min');
  assert.equal(y.type, 'class');
  assert.equal(y.title, 'Yoga');
  assert.equal(y.min, 60);
  assert.equal(y.items.length, 0);
  const b = p('played basketball for an hour');
  assert.equal(b.type, 'sport');
  assert.equal(b.min, 60);
  assert.equal(b.items.length, 0);
});

test('unknown exercises become new ones; inferred type from the lifts', () => {
  const w = p('cable crossovers 3x12 @40');
  assert.equal(w.items[0].isNew, true);
  assert.equal(w.items[0].ex, 'cable-crossovers');
  assert.equal(w.items[0].kind, 'lift');
  const pull = p('pullups 3x10, curls 3x12 @30, lat pulldown 3x10 @140');
  assert.equal(pull.type, 'pull');
  assert.equal(pull.items[0].sets[0].w, null);
});

test('plan text: "pull day wed" has no items and a future day', () => {
  const w = p('pull day wed', 'plan');
  assert.equal(w.type, 'pull');
  assert.equal(w.d, '2026-10-07');
  assert.equal(w.items.length, 0);
});
