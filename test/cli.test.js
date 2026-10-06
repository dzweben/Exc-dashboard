import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'wk-'));
const STATE = join(dir, 'state.json');
const wk = (args, input) => spawnSync('node', [join(ROOT, 'bin/wk.mjs'), ...args], {
  encoding: 'utf8', input, cwd: dir,
  env: { ...process.env, WK_STATE: STATE, WK_NOW: '2026-10-05T22:00:00.000Z' },
});

test('seed, log (stdin, backdated), plan, PRs, brief, check', () => {
  assert.equal(wk(['seed']).status, 0);
  let r = wk(['log', 'push day: bench 3x8 @185, 30 min', '--on', 'last mon']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Mon 9\/28 · Push day/);
  r = wk(['log', '-'], "bench 3x8 @195, ohp 3x10 @95 - felt good, didn't rush\n");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /★ PR Bench press: heaviest 195 lb \(was 185 lb\)/);
  r = wk(['plan', 'pull day wed']);
  assert.match(r.stdout, /Wed 10\/7 · Pull day/);
  assert.equal(wk(['plan', 'legs']).status, 1, 'a plan needs a day');
  r = wk(['plan', 'done', 'pull wed']);
  assert.equal(r.status, 0, r.stderr);
  r = wk(['body', '172.4']);
  assert.match(r.stdout, /172.4 lb/);
  r = wk(['brief', '--write']);
  assert.match(r.stdout, /This week/);
  r = wk(['check']);
  assert.equal(r.status, 0, r.stdout);
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  assert.equal(Object.keys(s.workouts).length, 3);
  assert.ok(s.brief.headline);
});

test('ambiguous / missing lookups exit 2 with candidates', () => {
  wk(['log', 'legs: squat 5x5 @225', '--on', 'sat']);
  wk(['log', 'run 3 mi', '--on', 'sat']);
  const r = wk(['edit', 'sat', '--min', '40']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /ambiguous workout/);
  assert.equal(wk(['edit', 'sat legs', '--min', '40']).status, 0);
  assert.equal(wk(['history', 'nonexistent lift']).status, 2);
});
