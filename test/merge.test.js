import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTexts } from '../bin/wk-merge.mjs';
import { serializeState } from '../src/engine/model.js';
import { OPS } from '../src/engine/ops.js';
import { seeded, ctx } from './helpers.js';

test('merge driver keeps both sides and reports same-field clashes', () => {
  const base = OPS.logWorkout(seeded(), { d: '2026-10-05', type: 'push', title: 'Push day' }, ctx()).state;
  const id = Object.keys(base.workouts)[0];
  const web = OPS.planWorkout(base, { d: '2026-10-07', type: 'pull', title: 'Pull day' }, ctx({ src: 'dash' })).state;
  const web2 = OPS.editWorkout(web, { id, patch: { min: 40 } }, ctx({ src: 'dash' })).state;
  const chat = OPS.logBody(base, { d: '2026-10-05', w: 172 }, ctx()).state;
  const chat2 = OPS.editWorkout(chat, { id, patch: { min: 45 } }, ctx()).state;
  const { text, notes } = mergeTexts(serializeState(base), serializeState(web2), serializeState(chat2));
  const m = JSON.parse(text);
  assert.equal(Object.keys(m.plans).length, 1);
  assert.equal(Object.keys(m.body).length, 1);
  assert.equal(m.workouts[id].min, 45);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].field, 'min');
});
