import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded, run, TODAY } from './helpers.js';
import { rotation, suggestions, areaGaps } from '../src/engine/stats.js';
import { parseWorkout } from '../src/engine/parse.js';
import { buildBrief } from '../src/engine/brief.js';
import { OPS } from '../src/engine/ops.js';

test("Danny's dictated lines parse into notes, per-side and weighted holds", () => {
  const w = parseWorkout('smith calf raises one leg 2x2 @90 (half reps, bottom only) per side, weighted soleus stretch on smith 90 lbs 35 secs per side, lat pulldown 130x3', { today: TODAY, state: seeded() });
  assert.deepEqual(w.items.map((i) => i.ex), ['sl-calf-raise', 'soleus-stretch', 'lat-pulldown']);
  assert.deepEqual(w.items[0].sets, [{ r: 2, w: 90 }, { r: 2, w: 90 }]);
  assert.match(w.items[0].notes, /half reps.*bottom only.*per side/);
  assert.deepEqual(w.items[1].sets, [{ r: null, w: 90, s: 35 }]);
  assert.deepEqual(w.items[2].sets, [{ r: 3, w: 130 }]);
  assert.equal(w.type, 'other', 'a mixed session is not forced into one split');
});

test('rotation: most overdue first, never-done flagged ones on top; suggestions one per area', () => {
  let s = run(seeded(), [
    ['logWorkout', { d: '2026-09-20', type: 'pull', items: [{ ex: 'lat-pulldown', sets: [{ r: 3, w: 130 }] }] }],
    ['logWorkout', { d: '2026-10-01', type: 'pull', items: [{ ex: 'row', sets: [{ r: 8, w: 95 }] }] }],
    ['logWorkout', { d: '2026-10-03', type: 'other', items: [{ ex: 'soleus-stretch', sets: [{ r: null, w: 90, s: 35 }] }] }],
    ['logWorkout', { d: TODAY, type: 'feet', items: [{ ex: 'sl-calf-raise', sets: [{ r: 2, w: 90 }] }] }],
  ]).state;
  s = OPS.editExercise(s, { id: 'tib-raise', patch: { rotation: true } }, { now: 'x', today: TODAY, src: 'chat' }).state;
  const rot = rotation(s, TODAY);
  assert.deepEqual(rot.map((r) => r.ex), ['tib-raise', 'lat-pulldown', 'row', 'soleus-stretch', 'sl-calf-raise']);
  assert.equal(rot[1].daysSince, 15);
  const sug = suggestions(s, TODAY, 2);
  assert.deepEqual(sug.map((r) => r.ex), ['tib-raise', 'lat-pulldown'], 'one per area, skips today');
  const gaps = areaGaps(s, TODAY);
  assert.equal(gaps.find((a) => a.area === 'pull').daysSince, 4);
  const b = buildBrief(s, { today: TODAY });
  assert.match(b.lines.join('\n'), /Next time: Tib raise \(never\) or Lat pulldown \(15 days ago; last 130×3\)/);
});
