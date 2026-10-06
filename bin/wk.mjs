#!/usr/bin/env node
// wk: the command line Claude uses every chat turn to read and edit data/state.json.
// Run `node bin/wk.mjs help` for commands. All edits go through engine/ops.js so the
// website and the CLI change state the same way.
//
// Git: wk sync / wk push only ever run `git pull --rebase --autostash` and plain
// `git push` (never reset --hard). data/state.json merges through the wkstate merge
// driver (bin/wk-merge.mjs, a field-level 3-way JSON merge), which wk registers in
// the local git config on every run, so website and chat edits both survive.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeState, serializeState, emptyState, slugify, bodyId } from '../src/engine/model.js';
import { nowISO, todayISO, addDays, fmtDay, fmtRelative, isISODate, localDateOf, parseDatePhrase, startOfWeek } from '../src/engine/dates.js';
import { parseWorkout, findDay, fmtItem, fmtMin, fmtPace, trimNum } from '../src/engine/parse.js';
import { OPS } from '../src/engine/ops.js';
import { calendarView, todayView, logView, upcomingPlans } from '../src/engine/views.js';
import { weekStats, weeks, streak, prsIndex, fmtPR, exerciseStats, lastSeen, lastOfType, bodyTrend, chronological } from '../src/engine/stats.js';
import { buildBrief, changesSince, changesBetween, fmtEntry } from '../src/engine/brief.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_PATH = process.env.WK_STATE ? resolve(process.env.WK_STATE) : join(ROOT, 'data/state.json');
const AUTHOR = process.env.WK_AUTHOR || 'Danny Zweben <176344411+dzweben@users.noreply.github.com>';
const AUTHOR_NAME = AUTHOR.replace(/\s*<.*$/, '').trim() || 'Danny Zweben';
const AUTHOR_EMAIL = (AUTHOR.match(/<(.*)>/) || [])[1] || '';
const TRAILERS = (process.env.WK_TRAILERS ?? 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01BxEgisc2krbwjjSa5JPp9H').split('\\n').filter(Boolean);
const MERGE_DRIVER = 'node bin/wk-merge.mjs %O %A %B';
const MERGE_ATTR = 'data/state.json merge=wkstate';

// ------------------------------------------------------------------ io

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

const CONFLICT_MARKER = /^(<{7}|={7}|>{7})( |$)/m;

function brokenStateHelp(err, text) {
  return [
    `data/state.json is not valid JSON${CONFLICT_MARKER.test(text) ? ' (it contains git conflict markers)' : ''}: ${err.message}`,
    'Recover (keeps code edits and unpushed commits):',
    '  1. git status: if a rebase or merge is in progress, git rebase --abort (or git merge --abort)',
    '  2. git checkout HEAD -- data/state.json   (this turn\'s uncommitted wk edits are dropped; redo them)',
    '  3. node bin/wk.mjs sync, then redo this turn\'s wk commands',
  ].join('\n');
}

function load(path = STATE_PATH) {
  if (!existsSync(path)) return emptyState();
  const text = readFileSync(path, 'utf8');
  try {
    return normalizeState(JSON.parse(text));
  } catch (err) {
    return die(brokenStateHelp(err, text), 1);
  }
}

function save(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, serializeState(state));
}

function ctxFor(state) {
  const tz = state.settings?.tz || 'America/New_York';
  const now = process.env.WK_NOW || nowISO();
  const today = process.env.WK_TODAY || localDateOf(now, tz) || todayISO(tz);
  return { now, today, src: 'chat' };
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ------------------------------------------------------------------ git plumbing

const GIT_ENV = { ...process.env, GIT_COMMITTER_NAME: AUTHOR_NAME, GIT_COMMITTER_EMAIL: AUTHOR_EMAIL, GIT_EDITOR: 'true', GIT_TERMINAL_PROMPT: '0' };

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function gitRun(args, opts = {}) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { ok: r.status === 0, status: r.status, out: r.error ? `${out}${r.error.message}` : out };
}

const firstLine = (s) => String(s ?? '').split('\n').map((l) => l.trim()).find((l) => l && !/^hint:/.test(l)) ?? '';
const indent = (s) => String(s ?? '').trim().split('\n').map((l) => `    ${l}`).join('\n');

function isTransient(msg) {
  const s = String(msg ?? '');
  if (/error: 4\d\d|\b40[134]\b|Authentication failed|Permission denied|not found|couldn't find remote ref|rejected/i.test(s)) return false;
  return /Could not resolve host|Connection (reset|refused|timed out)|Operation timed out|timed out|early EOF|RPC failed|remote end hung up|returned error: 5\d\d|HTTP 5\d\d|Temporary failure|unable to access|Failed to connect|TLS|SSL_|gnutls/i.test(s);
}
function isHardReject(msg) {
  return /\[remote rejected\]|GH0\d\d|protected branch|pre-receive hook declined|push declined|secret|push protection|refusing to allow|denied to/i.test(String(msg ?? ''));
}
function isRace(msg) {
  return /! \[rejected\].*\((fetch first|non-fast-forward)\)|Updates were rejected because the (remote|tip)/i.test(String(msg ?? ''));
}

function gitPath(p) {
  const out = git(['rev-parse', '--git-path', p]).trim();
  return isAbsolute(out) ? out : join(ROOT, out);
}

let mergeDriverReady = null;
/** Register the wkstate merge driver in this clone (git config is not cloned, so every run checks). */
function ensureMergeDriver() {
  if (mergeDriverReady !== null) return mergeDriverReady;
  mergeDriverReady = false;
  try {
    const top = git(['rev-parse', '--show-toplevel']).trim();
    if (realpathSync(top) !== realpathSync(ROOT)) return false;
    const driver = () => gitRun(['config', '--local', '--get', 'merge.wkstate.driver']).out.trim();
    if (driver() !== MERGE_DRIVER) {
      gitRun(['config', '--local', 'merge.wkstate.name', 'Workout Console data/state.json 3-way JSON merge (bin/wk-merge.mjs)']);
      gitRun(['config', '--local', 'merge.wkstate.driver', MERGE_DRIVER]);
      if (driver() !== MERGE_DRIVER) return false;
    }
    const attrs = gitPath('info/attributes');
    const text = existsSync(attrs) ? readFileSync(attrs, 'utf8') : '';
    if (!text.split('\n').some((l) => l.trim() === MERGE_ATTR)) {
      mkdirSync(dirname(attrs), { recursive: true });
      writeFileSync(attrs, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${MERGE_ATTR}\n`);
    }
    mergeDriverReady = true;
  } catch { /* not a git checkout (WK_STATE, tests) */ }
  return mergeDriverReady;
}

function currentBranch() {
  return git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
}

function defaultBranch() {
  if (process.env.WK_BRANCH) return process.env.WK_BRANCH;
  const r = gitRun(['ls-remote', '--symref', 'origin', 'HEAD'], { env: GIT_ENV, timeout: 30000 });
  const m = r.ok ? r.out.match(/^ref:\s*refs\/heads\/(\S+)\s+HEAD/m) : null;
  if (m) return m[1];
  const s = gitRun(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  return s.ok ? s.out.trim().replace(/^origin\//, '') : null;
}

function branchWarning(branch) {
  const def = defaultBranch();
  if (!def || !branch || def === branch) return null;
  const bar = '!'.repeat(78);
  return [
    bar,
    `!!! WRONG BRANCH FOR DATA: checked out "${branch}", but the website reads and writes`,
    `!!! "${def}" (origin's default branch). Data committed here never reaches the website.`,
    `!!! Fix: commit or stash code work, then: git checkout ${def} && node bin/wk.mjs sync`,
    bar,
  ].join('\n');
}

function opInProgress() {
  for (const p of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD']) {
    try {
      if (existsSync(gitPath(p))) return p;
    } catch { /* not a repo */ }
  }
  return null;
}

class GitConflict extends Error {
  constructor(files, out) {
    super(`conflict in ${files.join(', ') || '(unknown files)'}`);
    this.files = files;
    this.out = out;
  }
}

/**
 * Origin changed code (anything outside data/) since our merge base. The website's
 * token can write the whole repo and wk runs pulled code (git even runs
 * bin/wk-merge.mjs during the pull), so code is never pulled silently.
 */
class CodeIncoming extends Error {
  constructor(branch, files, commits) {
    super(`origin/${branch} changed code: ${files.join(', ')}`);
    this.branch = branch;
    this.files = files;
    this.commits = commits;
  }
}

function incomingCode(branch) {
  let f = null;
  for (let i = 0; i < 4; i++) {
    f = gitRun(['fetch', 'origin', branch], { env: GIT_ENV });
    if (f.ok || !isTransient(f.out) || i === 3) break;
    sleepMs(2000 * 2 ** i);
  }
  if (!f.ok) throw new Error(firstLine(f.out) || 'git fetch failed');
  const remote = `origin/${branch}`;
  const base = gitRun(['merge-base', 'HEAD', remote]);
  const from = base.ok ? base.out.trim() : null;
  const d = from ? gitRun(['diff', '--name-only', from, remote]) : gitRun(['ls-tree', '-r', '--name-only', remote]);
  if (!d.ok) throw new Error(firstLine(d.out) || `could not compare with ${remote}`);
  const files = d.out.split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('data/'));
  if (!files.length) return null;
  const log = gitRun(['log', '--format=%h %an <%ae>: %s', from ? `${from}..${remote}` : remote, '--', ...files]);
  return new CodeIncoming(branch, files, log.ok ? log.out.trim().split('\n').filter(Boolean) : []);
}

function codeIncomingHelp(err, cmd) {
  const web = err.commits.filter((c) => /: dash: /.test(c));
  return [
    `!!! CODE CHANGED ON GITHUB: origin/${err.branch} has new commits that change code, not just data:`,
    ...err.files.slice(0, 12).map((f) => `!!!   ${f}`),
    '!!! in:',
    ...err.commits.slice(0, 10).map((c) => `!!!   ${c}`),
    '!!! wk did not pull it. Nothing was lost.',
    `!!! Review it: git log -p HEAD..origin/${err.branch} -- . ':(exclude)data'`,
    web.length
      ? '!!! A website ("dash:") commit changed code. The website only writes data/state.json, so Danny\'s website token may be leaked: do NOT pull; tell Danny to revoke it on GitHub.'
      : `!!! If it is Danny's or another Claude session's code work and the diff looks right: node bin/wk.mjs ${cmd} --allow-code`,
  ].join('\n');
}

function readNotes(path) {
  if (!existsSync(path)) return [];
  const notes = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      notes.push(JSON.parse(line));
    } catch { /* skip */ }
  }
  rmSync(path, { force: true });
  return notes;
}

/** git pull --rebase --autostash origin <branch>; data merges field by field. */
function pullRebase(branch, { allowCode = false } = {}) {
  const busy = opInProgress();
  if (busy) throw new Error(`a git ${busy.includes('rebase') ? 'rebase' : 'merge'} is already in progress; finish or abort it first`);
  ensureMergeDriver();
  if (!allowCode) {
    const code = incomingCode(branch);
    if (code) throw code;
  }
  const notesPath = gitPath('wk-merge-notes.jsonl');
  rmSync(notesPath, { force: true });
  const headBefore = git(['rev-parse', 'HEAD']).trim();
  let r = null;
  for (let i = 0; i < 4; i++) {
    r = gitRun(['pull', '--rebase', '--autostash', '--no-edit', 'origin', branch], { env: { ...GIT_ENV, WK_MERGE_NOTES: notesPath } });
    if (r.ok) break;
    if (opInProgress()) {
      const u = gitRun(['diff', '--name-only', '--diff-filter=U']);
      const files = u.out.split('\n').map((s) => s.trim()).filter(Boolean);
      gitRun(['rebase', '--abort'], { env: GIT_ENV });
      readNotes(notesPath);
      throw new GitConflict(files, r.out);
    }
    if (!isTransient(r.out) || i === 3) {
      readNotes(notesPath);
      throw new Error(firstLine(r.out) || `git pull exited ${r.status}`);
    }
    sleepMs(2000 * 2 ** i);
  }
  const notes = readNotes(notesPath);
  let stashConflicts = [];
  if (/autostash resulted in conflicts|changes are safe in the stash/i.test(r.out)) {
    const u = gitRun(['diff', '--name-only', '--diff-filter=U']);
    stashConflicts = u.out.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!stashConflicts.length) stashConflicts = ['(see git status)'];
  }
  return { changed: git(['rev-parse', 'HEAD']).trim() !== headBefore, notes, stashConflicts };
}

function conflictHelp(branch, err) {
  return [
    `git pull --rebase stopped on a conflict in: ${(err.files ?? []).join(', ') || '(unknown)'}.`,
    (err.files ?? []).includes('data/state.json')
      ? 'data/state.json should merge automatically through bin/wk-merge.mjs, but the driver failed (is node on PATH?).'
      : 'These are code files (data/state.json merges automatically).',
    'wk aborted the rebase, so nothing was lost.',
    `To finish by hand: git pull --rebase origin ${branch}, fix those files, git add them, git rebase --continue, then node bin/wk.mjs push. Never git reset --hard.`,
  ].join('\n');
}

function stashConflictHelp(files) {
  return `!!! Your uncommitted edits conflicted with incoming commits in: ${files.join(', ')}. They are kept in git stash ("autostash"); fix the markers, then git stash drop.`;
}

function fmtVal(v) {
  if (v === null || v === undefined) return 'none';
  if (typeof v === 'string') return isISODate(v) ? fmtDay(v) : `"${v.length > 50 ? v.slice(0, 47) + '...' : v}"`;
  const s = JSON.stringify(v);
  return s.length > 50 ? s.slice(0, 47) + '...' : s;
}

function printBothChanged(notes) {
  if (!notes?.length) return;
  const seen = new Set();
  const rows = [];
  for (const n of notes) {
    const k = `${n.col}|${n.id}|${n.field}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (n.kind === 'deleted') rows.push(n.by === 'other' ? `  ${n.title}: chat deleted it while the website edited it; it stays deleted` : `  ${n.title}: the website deleted it while chat edited it; chat's edit was dropped`);
    else rows.push(`  ${n.title} · ${n.field}: kept chat's ${fmtVal(n.kept)}, website had ${fmtVal(n.dropped)}`);
  }
  console.log(`\nBOTH SIDES CHANGED THE SAME FIELD (chat's version kept; tell Danny in one line, offer to switch):\n${rows.join('\n')}`);
}

const fmtActivity = (a) => `  ${String(a.at ?? '').slice(5, 16).replace('T', ' ')}  ${fmtEntry(a)}`;

function stateAt(ref) {
  try {
    return normalizeState(JSON.parse(git(['show', `${ref}:data/state.json`])));
  } catch {
    return emptyState();
  }
}

function commit(state, message) {
  const prev = stateAt('HEAD');
  const fresh = Object.values(state.activity ?? {}).filter((a) => !prev.activity?.[a.id]).sort((a, b) => (a.at < b.at ? -1 : 1));
  const parts = fresh.map(fmtEntry);
  let subject = message || (parts.length ? `chat: ${parts.slice(0, 3).join(' · ')}${parts.length > 3 ? ` · +${parts.length - 3} more` : ''}` : `chat: check-in ${fmtDay(ctxFor(state).today)}`);
  if (subject.length > 72) subject = subject.slice(0, 69) + '...';
  const body = fresh.map((a) => `- ${a.type}: ${a.title}${a.to ? ` → ${isISODate(a.to) ? fmtDay(a.to) : a.to}` : ''}`).join('\n');
  git(['add', 'data/']);
  if (!git(['diff', '--cached', '--name-only']).trim()) {
    console.log('nothing to commit');
    return false;
  }
  git(['commit', '-q', `--author=${AUTHOR}`, '-m', `${subject}\n\n${body ? body + '\n\n' : ''}${TRAILERS.join('\n')}`], { env: GIT_ENV });
  console.log(`committed: ${subject}`);
  return true;
}

function push({ allowCode = false } = {}) {
  if (!ensureMergeDriver()) die('wk push needs the git checkout wk lives in', 1);
  const branch = currentBranch();
  if (branch === 'HEAD') die('detached HEAD: check out a branch, then wk push', 1);
  const warn = branchWarning(branch);
  if (warn) console.log(warn);
  let seen = load();
  let last = '';
  for (let i = 0; i < 5; i++) {
    const r = gitRun(['push', '-u', 'origin', branch], { env: GIT_ENV });
    if (r.ok) {
      console.log(`pushed ${branch}`);
      return true;
    }
    last = r.out;
    if (isHardReject(r.out)) die(`push rejected by GitHub (a rule or permission), not retried:\n${indent(r.out)}\nYour commits are safe locally.`, 1);
    if (isRace(r.out)) {
      const f = gitRun(['fetch', 'origin', branch], { env: GIT_ENV });
      if (f.ok && gitRun(['merge-base', '--is-ancestor', `origin/${branch}`, 'HEAD']).ok) die(`push rejected, but origin/${branch} has nothing new. Not retrying:\n${indent(r.out)}`, 1);
      let res;
      try {
        res = pullRebase(branch, { allowCode });
      } catch (err) {
        if (err instanceof CodeIncoming) die(`push rejected (origin has new commits) and they change code, so wk did not merge them.\n${codeIncomingHelp(err, 'push')}`, 3);
        if (err instanceof GitConflict) die(`push rejected and merging hit a conflict.\n${conflictHelp(branch, err)}`, 3);
        die(`push rejected and pulling failed: ${err.message}\nYour commits are safe locally; run node bin/wk.mjs push again.`, 1);
      }
      console.log('merged our changes on top of new website commits (data/state.json merged field by field)');
      const now = load();
      const ch = changesBetween(seen, now);
      seen = now;
      if (ch.entries.length) {
        console.log('\nWEBSITE CHANGES MERGED DURING PUSH (Danny did these while you worked; mention them):');
        for (const a of ch.entries) console.log(fmtActivity(a));
      }
      printBothChanged(res.notes);
      if (res.stashConflicts.length) console.log(stashConflictHelp(res.stashConflicts));
      continue;
    }
    if (isTransient(r.out) && i < 4) {
      sleepMs(2000 * 2 ** i);
      continue;
    }
    die(`push failed (your commits are safe locally):\n${indent(r.out)}`, 1);
  }
  return die(`push failed after 5 attempts (your commits are safe locally):\n${indent(last)}`, 1);
}

// ------------------------------------------------------------------ args

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else if (a === '-m') {
      flags.m = i + 1 < argv.length ? argv[++i] : true;
    } else pos.push(a);
  }
  return { pos, flags };
}

let STDIN = null;
function stdinText() {
  if (STDIN === null) {
    try {
      STDIN = readFileSync(0, 'utf8');
    } catch {
      STDIN = '';
    }
  }
  return STDIN;
}

/** Text from positionals; a lone "-" reads stdin (quoted heredoc: nothing is shell-expanded). */
function textArg(pos) {
  if (pos.length === 1 && pos[0] === '-') return stdinText().trim();
  return pos.join(' ').trim();
}

function dateArg(text, today, mode = 'log') {
  if (!text || text === true) die('missing date');
  const t = String(text).trim();
  if (isISODate(t)) return t;
  const hit = findDay(t, today, mode) ?? (() => {
    const p = parseDatePhrase(t, today);
    return p ? { date: p.date } : null;
  })();
  if (!hit) die(`can't read the date "${t}"`);
  return hit.date;
}

function numArg(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n)) die(`bad ${label}: ${v}`);
  return n;
}

const words = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);

/** Find a doc in `map` by id, exact name/alias, or words. Exit 2 when ambiguous/none. */
function findDoc(map, query, label, nameOf = (d) => d.name ?? d.title) {
  const q = String(query ?? '').trim();
  if (!q) die(`missing ${label}`, 2);
  if (map[q]) return map[q];
  const docs = Object.values(map);
  const lower = q.toLowerCase();
  const exact = docs.filter((d) => String(nameOf(d)).toLowerCase() === lower || (d.aliases ?? []).includes(lower) || d.id === slugify(q));
  if (exact.length === 1) return exact[0];
  const qw = words(q);
  const hits = docs.filter((d) => {
    const hay = words(`${nameOf(d)} ${(d.aliases ?? []).join(' ')} ${d.id}`);
    return qw.every((w) => hay.some((h) => h.startsWith(w)));
  });
  if (hits.length === 1) return hits[0];
  die(`${hits.length ? 'ambiguous' : 'no'} ${label} "${q}"${hits.length ? `: ${hits.slice(0, 8).map((d) => `${d.id} (${nameOf(d)})`).join(', ')}` : ''}`, 2);
}

/** A workout by id, "last", a day ("sat", "10/3"), or day + words ("sat legs"). */
function findWorkout(state, query, today) {
  const q = String(query ?? '').trim();
  if (state.workouts[q]) return state.workouts[q];
  const all = chronological(state);
  if (!q || q === 'last' || q === 'latest') return all[all.length - 1] ?? die('no workouts yet', 2);
  const day = findDay(q, today, 'log');
  let pool = all;
  let rest = q;
  if (day) {
    pool = all.filter((w) => w.d === day.date);
    rest = q.replace(day.consumed, ' ').trim();
  }
  if (rest) {
    const qw = words(rest);
    pool = pool.filter((w) => {
      const hay = words(`${w.title} ${w.type} ${w.items.map((i) => state.exercises[i.ex]?.name ?? i.ex).join(' ')}`);
      return qw.every((x) => hay.some((h) => h.startsWith(x)));
    });
  }
  if (pool.length === 1) return pool[0];
  die(`${pool.length ? 'ambiguous' : 'no'} workout "${q}"${pool.length ? `:\n${pool.slice(-8).map((w) => `  ${w.id} ${fmtDay(w.d)} ${w.title}`).join('\n')}` : ''}`, 2);
}

function findPlan(state, query, today) {
  const q = String(query ?? '').trim();
  if (state.plans[q]) return state.plans[q];
  const open = Object.values(state.plans).filter((p) => p.status !== 'done').sort((a, b) => (a.d < b.d ? -1 : 1));
  const day = findDay(q, today, 'plan');
  let pool = open;
  let rest = q;
  if (day) {
    const back = findDay(q, today, 'log');
    pool = open.filter((p) => p.d === day.date || (back && p.d === back.date));
    rest = q.replace(day.consumed, ' ').trim();
  }
  if (rest) {
    const qw = words(rest);
    pool = pool.filter((p) => {
      const hay = words(`${p.title} ${p.type}`);
      return qw.every((x) => hay.some((h) => h.startsWith(x)));
    });
  }
  if (pool.length === 1) return pool[0];
  die(`${pool.length ? 'ambiguous' : 'no'} plan "${q}"${pool.length ? `:\n${pool.slice(0, 8).map((p) => `  ${p.id} ${fmtDay(p.d)} ${p.title} [${p.status}]`).join('\n')}` : ''}`, 2);
}

// ------------------------------------------------------------------ printing

let S = emptyState();
const unit = () => S.settings?.unit ?? 'lb';
const typeName = (id) => S.types?.[id]?.name ?? id;
const exName = (id) => S.exercises?.[id]?.name ?? id;

function printWorkout(w, prs = [], today = null) {
  console.log(`${fmtDay(w.d)}${today ? ` (${fmtRelative(w.d, today)})` : ''} · ${w.title} [${typeName(w.type)}]${w.min ? ` · ${fmtMin(w.min)}` : ''}  ${w.id}`);
  for (const it of w.items) console.log(`    ${exName(it.ex).padEnd(22)} ${fmtItem(it, S.settings)}${it.notes ? `  (${it.notes})` : ''}`);
  if (w.notes) console.log(`    notes: ${w.notes}`);
  for (const p of prs) console.log(`    ★ PR ${fmtPR(p, S.settings)}`);
}

function printPlan(p) {
  console.log(`${fmtDay(p.d)} · ${p.title} [${typeName(p.type)}]${p.time ? ` ${p.time}` : ''} · ${p.status.toUpperCase()}  ${p.id}`);
  for (const it of p.items) console.log(`    ${exName(it.ex).padEnd(22)} ${fmtItem(it, S.settings)}`);
  if (p.notes) console.log(`    notes: ${p.notes}`);
}

function printToday(state, today) {
  const tv = todayView(state, today);
  const week = weekStats(state, today);
  const st = streak(state, today);
  const idx = prsIndex(state);
  const target = state.settings.target;
  console.log(`TODAY ${fmtDay(today)} · this week ${week.sessions}${target ? `/${target}` : ''} workout${week.sessions === 1 && !target ? '' : 's'} · streak ${st.days.current}d (best ${st.days.best}) · ${st.weeks.current} wk`);
  if (tv.workouts.length) {
    console.log('\nLOGGED TODAY:');
    for (const w of tv.workouts) printWorkout(w, idx.get(w.id));
  }
  if (tv.planned.length) {
    console.log('\nPLANNED TODAY:');
    for (const p of tv.planned) printPlan(p);
  }
  if (tv.missed.length) {
    console.log('\nPLANNED, NOT LOGGED (ask: did it happen?):');
    for (const p of tv.missed) printPlan(p);
  }
  const up = upcomingPlans(state, addDays(today, 1), 13);
  console.log(`\nNEXT 2 WEEKS: ${up.length ? '' : 'nothing planned'}`);
  for (const p of up) console.log(`  ${fmtDay(p.d).padEnd(10)} ${p.title}${p.items.length ? ` (${p.items.length} exercises)` : ''}  ${p.id}`);
  const recent = chronological(state).filter((w) => w.d < today).slice(-3).reverse();
  if (recent.length) {
    console.log('\nRECENT:');
    for (const w of recent) console.log(`  ${fmtDay(w.d).padEnd(10)} ${w.title}${w.min ? ` · ${fmtMin(w.min)}` : ''}${(idx.get(w.id) ?? []).length ? ` · ★${idx.get(w.id).length} PR` : ''}`);
  }
}

function printParsed(p) {
  console.log(`  → ${fmtDay(p.d)} · ${p.title} [${typeName(p.type) ?? p.type}]${p.min ? ` · ${fmtMin(p.min)}` : ''}`);
  for (const it of p.items) console.log(`      ${(it.isNew ? `${it.name} (NEW exercise, ${it.kind})` : exName(it.ex)).padEnd(30)} ${fmtItem(it, S.settings) || '(no numbers)'}`);
  if (p.notes) console.log(`      notes: ${p.notes}`);
  if (p.unknown.length) console.log(`  !! could not read: ${p.unknown.map((u) => `"${u}"`).join(', ')} — fix with wk edit, or ask Danny`);
}

const HELP = `wk — Workout Console command line (edits data/state.json)

Every turn:   wk sync · <edits> · wk brief --write · wk commit && wk push

Log + plan
  wk log '<text>' [--on <day>] [--type t] [--title T] [--min N] [--notes T] [--dry] [--no-plan]
                  'push day: bench 3x8 @185, ohp 3x10 @95, 30 min'  'ran 3 mi in 27 min yesterday'
                  'squat 225x5, 245x5, 265x3 sat'  'yoga class 60 min'   (a lone - reads stdin)
  wk edit <workout> [--on day] [--type t] [--title T] [--min N|none] [--notes T] [--feel 1-5]
                    [--items '<text>' (replace)] [--add '<text>' (append)] [--drop <exercise>]
  wk delete <workout>            <workout> = id, last, a day (sat, 10/3), or day + words (sat legs)
  wk plan '<text>' [--on <day>]  'pull day wed'  'legs thu: squat 5x5 @235, rdl 3x8 @195'  'run 4 mi sat'
  wk plan move <plan> <day> | skip <plan> | unskip <plan> | done <plan> [--on day] [--min N]
          | delete <plan> | edit <plan> [--title] [--type] [--notes] [--items '<text>']
  wk body <weight> [--on day] [--notes T]   ·   wk body            (trend)

Read
  wk today | wk cal [--days 14] | wk list [--n 15] [--type t] [--ex q] | wk week [--weeks 8]
  wk prs [--ex q] | wk history '<exercise>' [--n 10] | wk last '<type or exercise>'

Catalog
  wk ex [list] | wk ex add 'Name' [--kind lift|bw|cardio|time] [--type split] [--alias a,b]
  wk ex edit <ex> [--name] [--kind] [--type] [--alias a,b (adds)] [--archive] | wk ex merge <from> <into>
  wk types | wk type add 'Name' [--kind lift|cardio|other] [--alias a,b] | wk type edit <t> ...
  wk seed                         (adds missing starter types + exercises)

Meta
  wk settings [--unit lb|kg] [--dist mi|km] [--target N|none] [--reminders on|off] [--tz Area/City]
  wk brief [--write] | wk scrub '<text>' [--with 'x'] | wk check [--fix] | wk changes
  wk sync [--allow-code] [--no-pull] | wk commit [-m msg] | wk push [--allow-code]

Exit codes: 1 = nothing changed / error, 2 = ambiguous or not found (candidates listed), 3 = git needs a human.`;

// ------------------------------------------------------------------ main

function main() {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return;
  }
  ensureMergeDriver();
  const { pos, flags } = parseArgs(rest);
  for (const k of Object.keys(flags)) if (flags[k] === '-') flags[k] = stdinText().trim();
  let state = load();
  S = state;
  const ctx = ctxFor(state);
  const today = ctx.today;
  let changed = false;
  const apply = (op, args) => {
    const res = OPS[op](state, args, ctx);
    if (res.writes.length) {
      state = res.state;
      S = state;
      changed = true;
    }
    return res;
  };
  const must = (res, why) => {
    if (!res.writes.length) die(why, 1);
    return res;
  };

  switch (cmd) {
    case 'sync': {
      const prePull = state;
      let pulled = false;
      let warn = null;
      if (!flags['no-pull']) {
        try {
          const branch = currentBranch();
          if (branch === 'HEAD') throw new Error('detached HEAD');
          warn = branchWarning(branch);
          if (warn) console.log(`${warn}\n`);
          const res = pullRebase(branch, { allowCode: !!flags['allow-code'] });
          pulled = true;
          console.log(res.changed ? `pulled origin/${branch}` : `origin/${branch}: up to date`);
          printBothChanged(res.notes);
          if (res.stashConflicts.length) console.log(stashConflictHelp(res.stashConflicts));
        } catch (err) {
          if (err instanceof CodeIncoming) console.log(`${codeIncomingHelp(err, 'sync')}\n— continuing with local data`);
          else if (err instanceof GitConflict) console.log(`!!! PULL DID NOT HAPPEN.\n${conflictHelp(currentBranch(), err)}\n— continuing with local data`);
          else console.log(`(pull failed: ${err.message}) — continuing with local data; wk push will merge later`);
        }
      }
      state = load();
      S = state;
      const since = state.sync?.lastClaudeSync;
      const ch = flags['no-pull'] ? changesSince(state, since) : changesBetween(prePull, state);
      console.log(`\nWHAT DANNY DID ON THE WEBSITE (${flags['no-pull'] ? `since ${since ?? 'ever'}, no pull` : 'new in this pull'}):`);
      if (!ch.entries.length) console.log('  nothing new from the website');
      for (const a of ch.entries) console.log(fmtActivity(a));
      // prune activity older than 45 days
      const cutoff = addDays(today, -45);
      const keep = {};
      let pruned = 0;
      for (const [id, a] of Object.entries(state.activity ?? {})) {
        if ((localDateOf(a.at, state.settings.tz) ?? today) >= cutoff) keep[id] = a;
        else pruned++;
      }
      if (pruned) state = { ...state, activity: keep };
      if (pulled || flags['no-pull']) state = { ...state, sync: { ...state.sync, lastClaudeSync: ctx.now, lastActivitySeen: ctx.now } };
      if (pruned || pulled || flags['no-pull']) save(state);
      console.log('');
      printToday(state, today);
      if (warn) console.log('\n!!! reminder: wrong branch for data (see the warning at the top)');
      return;
    }

    case 'changes':
      console.log(JSON.stringify(changesSince(state, flags.since || state.sync?.lastClaudeSync), null, 2));
      return;

    case 'today':
      printToday(state, flags.date ? dateArg(flags.date, today) : today);
      return;

    case 'seed': {
      const res = apply('seedDefaults', {});
      console.log(res.writes.length ? `seeded ${res.writes.length} starter types/exercises` : 'nothing to seed');
      break;
    }

    case 'log': {
      const text = textArg(pos);
      if (!text) die('wk log needs text: wk log \'bench 3x8 @185\'');
      const p = parseWorkout(text, { today, state, mode: 'log' });
      if (flags.on) p.d = dateArg(flags.on, today);
      if (flags.type) p.type = findDoc(state.types, flags.type, 'type').id;
      if (flags.title) p.title = String(flags.title);
      if (flags.min !== undefined) p.min = flags.min === 'none' ? null : numArg(flags.min, '--min');
      if (flags.notes) p.notes = String(flags.notes);
      if (flags.feel) p.feel = numArg(flags.feel, '--feel');
      if (p.d > today) console.log(`  (note: ${fmtDay(p.d)} is in the future; use wk plan for planned workouts)`);
      printParsed(p);
      if (flags.dry) return;
      const res = must(apply('logWorkout', { ...p, plan: flags['no-plan'] ? false : undefined }), 'not logged');
      const w = state.workouts[res.id];
      console.log(`logged ${w.id}${res.plan ? ` (checks off plan ${res.plan})` : ''}`);
      for (const pr of res.prs) console.log(`  ★ PR ${fmtPR(pr, state.settings)}`);
      for (const it of w.items) {
        const prev = lastSeen(state, it.ex, w.d);
        if (prev) console.log(`  last ${exName(it.ex)}: ${fmtDay(prev.d)} ${fmtItem(prev.item, state.settings)}`);
      }
      break;
    }

    case 'edit': {
      const w = findWorkout(state, textArg(pos), today);
      const patch = {};
      if (flags.on) patch.d = dateArg(flags.on, today);
      if (flags.type) patch.type = findDoc(state.types, flags.type, 'type').id;
      if (flags.title) patch.title = String(flags.title);
      if (flags.min !== undefined) patch.min = flags.min === 'none' ? null : numArg(flags.min, '--min');
      if (flags.notes !== undefined) patch.notes = flags.notes === true ? '' : String(flags.notes);
      if (flags.feel) patch.feel = numArg(flags.feel, '--feel');
      let items = null;
      if (flags.items) items = parseWorkout(String(flags.items), { today, state }).items;
      if (flags.add) {
        const extra = parseWorkout(String(flags.add), { today, state }).items;
        const base = items ?? w.items;
        items = [...base, ...extra.map((it, i) => ({ ...it, id: `i${base.length + i + 1}` }))];
      }
      if (flags.drop) {
        const ex = findDoc(state.exercises, flags.drop, 'exercise');
        items = (items ?? w.items).filter((i) => i.ex !== ex.id);
      }
      if (items) patch.items = items.map((it, i) => ({ ...it, id: it.id ?? `i${i + 1}` }));
      const res = must(apply('editWorkout', { id: w.id, patch }), 'nothing changed');
      printWorkout(state.workouts[w.id], res.prs);
      break;
    }

    case 'delete': {
      const w = findWorkout(state, textArg(pos), today);
      must(apply('deleteWorkout', { id: w.id }), 'not deleted');
      console.log(`deleted ${w.id}: ${fmtDay(w.d)} ${w.title}`);
      break;
    }

    case 'plan': {
      const sub = pos[0];
      const arg = pos.slice(1);
      if (sub === 'move') {
        const p = findPlan(state, arg.slice(0, -1).join(' '), today);
        const to = dateArg(arg[arg.length - 1], today, 'plan');
        must(apply('movePlan', { id: p.id, to }), 'not moved');
        console.log(`moved ${p.title} → ${fmtDay(to)}`);
      } else if (sub === 'skip' || sub === 'unskip' || sub === 'delete') {
        const p = findPlan(state, arg.join(' '), today);
        must(apply({ skip: 'skipPlan', unskip: 'unskipPlan', delete: 'deletePlan' }[sub], { id: p.id }), 'nothing changed');
        console.log(`${sub === 'delete' ? 'deleted' : sub === 'skip' ? 'skipped' : 'back on'}: ${fmtDay(p.d)} ${p.title}`);
      } else if (sub === 'done') {
        const p = findPlan(state, arg.join(' '), today);
        const res = must(apply('completePlan', { id: p.id, date: flags.on ? dateArg(flags.on, today) : null, min: flags.min ? numArg(flags.min, '--min') : null }), 'not logged');
        printWorkout(state.workouts[res.id], res.prs);
      } else if (sub === 'edit') {
        const p = findPlan(state, arg.join(' '), today);
        const patch = {};
        if (flags.title) patch.title = String(flags.title);
        if (flags.type) patch.type = findDoc(state.types, flags.type, 'type').id;
        if (flags.notes !== undefined) patch.notes = flags.notes === true ? '' : String(flags.notes);
        if (flags.on) patch.d = dateArg(flags.on, today, 'plan');
        if (flags.items) patch.items = parseWorkout(String(flags.items), { today, state }).items.map((it, i) => ({ ...it, id: `i${i + 1}` }));
        must(apply('editPlan', { id: p.id, patch }), 'nothing changed');
        printPlan(state.plans[p.id]);
      } else {
        const text = textArg(pos);
        if (!text) die('wk plan needs text: wk plan \'pull day wed\'');
        const p = parseWorkout(text, { today, state, mode: 'plan' });
        if (!p.dateText && !flags.on) die(`no day in "${text}": add one (wk plan '${text} wed') or --on <day>`);
        if (flags.on) p.d = dateArg(flags.on, today, 'plan');
        if (flags.type) p.type = findDoc(state.types, flags.type, 'type').id;
        if (flags.title) p.title = String(flags.title);
        if (flags.notes) p.notes = String(flags.notes);
        if (p.d < today) console.log(`  (note: ${fmtDay(p.d)} is in the past; use wk log for workouts that happened)`);
        const res = must(apply('planWorkout', p), 'not planned');
        printPlan(state.plans[res.id]);
        const prev = lastOfType(state, state.plans[res.id].type, today);
        if (prev && !p.items.length) console.log(`  last ${typeName(prev.type)}: ${fmtDay(prev.d)} · ${prev.items.map((i) => `${exName(i.ex)} ${fmtItem(i, state.settings)}`).join(' · ') || prev.title}`);
      }
      break;
    }

    case 'plans':
    case 'cal': {
      const days = flags.days ? numArg(flags.days, '--days') : 14;
      const idx = prsIndex(state);
      for (const day of calendarView(state, cmd === 'plans' ? today : addDays(today, -Math.min(6, days)), days + (cmd === 'plans' ? 0 : Math.min(6, days)), today)) {
        const bits = [
          ...day.workouts.map((w) => `✓ ${w.title}${(idx.get(w.id) ?? []).length ? ' ★' : ''}`),
          ...day.plans.filter((p) => p.status !== 'done').map((p) => `${p.status === 'skipped' ? '↷' : '○'} ${p.title}`),
        ];
        console.log(`${day.isToday ? '>' : ' '} ${fmtDay(day.d).padEnd(10)} ${bits.join(' · ') || '-'}`);
      }
      return;
    }

    case 'list': {
      const type = flags.type ? findDoc(state.types, flags.type, 'type').id : null;
      const ex = flags.ex ? findDoc(state.exercises, flags.ex, 'exercise').id : null;
      const rows = logView(state, { limit: flags.n ? numArg(flags.n, '--n') : 15, type, ex });
      if (!rows.length) console.log('no workouts yet');
      for (const r of rows) printWorkout(r.workout, r.prs, today);
      return;
    }

    case 'week': {
      const n = flags.weeks ? numArg(flags.weeks, '--weeks') : 8;
      const st = streak(state, today);
      console.log(`streak: ${st.days.current} days (best ${st.days.best}) · ${st.weeks.current} weeks at ${st.weeks.target}+ (best ${st.weeks.best})`);
      for (const w of weeks(state, today, n)) {
        const types = Object.entries(w.byType).map(([t, c]) => `${typeName(t)}${c > 1 ? `×${c}` : ''}`).join(' ');
        console.log(`  ${fmtDay(w.start).padEnd(10)} ${String(w.sessions).padStart(2)} workouts  ${String(w.volume).padStart(7)} ${unit()}  ${String(w.dist || '').padStart(5)}${w.dist ? ` ${state.settings.dist}` : '   '}  ${String(w.minutes || '').padStart(4)}${w.minutes ? ' min' : '    '}  ${w.prs ? `★${w.prs}  ` : ''}${types}`);
      }
      return;
    }

    case 'prs': {
      const ex = flags.ex ? findDoc(state.exercises, flags.ex, 'exercise').id : null;
      const idx = prsIndex(state);
      const list = chronological(state).reverse().flatMap((w) => (idx.get(w.id) ?? []).map((p) => ({ ...p, d: w.d }))).filter((p) => !ex || p.ex === ex);
      console.log('BESTS:');
      for (const r of exerciseStats(state).filter((r) => !ex || r.ex === ex)) {
        const b = r.best;
        const parts = [];
        if (b.weight) parts.push(`top ${trimNum(b.weight.value)} ${unit()} (${fmtDay(b.weight.d)})`);
        if (b.e1rm) parts.push(`e1RM ${trimNum(b.e1rm.value)}`);
        if (b.reps) parts.push(`${b.reps.value} reps`);
        if (b.distance) parts.push(`${trimNum(b.distance.value)} ${state.settings.dist}`);
        if (b.pace) parts.push(`pace ${fmtPace(b.pace.value)}/${state.settings.dist}`);
        if (b.hold) parts.push(`${b.hold.value}s hold`);
        console.log(`  ${r.name.padEnd(22)} ${parts.join(' · ') || '-'}  (${r.sessions}×, last ${fmtDay(r.last.d)})`);
      }
      console.log(`\nRECENT PRS:${list.length ? '' : ' none yet'}`);
      for (const p of list.slice(0, 15)) console.log(`  ${fmtDay(p.d).padEnd(10)} ${fmtPR(p, state.settings)}`);
      return;
    }

    case 'history': {
      const ex = findDoc(state.exercises, textArg(pos), 'exercise');
      const n = flags.n ? numArg(flags.n, '--n') : 10;
      const rows = chronological(state).filter((w) => w.items.some((i) => i.ex === ex.id)).slice(-n).reverse();
      console.log(`${ex.name} (${ex.kind}) — ${rows.length ? '' : 'never logged'}`);
      for (const w of rows) for (const it of w.items.filter((i) => i.ex === ex.id)) console.log(`  ${fmtDay(w.d).padEnd(10)} ${fmtItem(it, state.settings)}`);
      return;
    }

    case 'last': {
      const q = textArg(pos);
      const t = Object.values(state.types).find((x) => x.id === q.toLowerCase() || x.name.toLowerCase() === q.toLowerCase() || x.aliases.includes(q.toLowerCase()));
      if (t) {
        const w = lastOfType(state, t.id, addDays(today, 1));
        if (!w) die(`no ${t.name} workouts yet`, 1);
        printWorkout(w, prsIndex(state).get(w.id), today);
        return;
      }
      const ex = findDoc(state.exercises, q, 'exercise or type');
      const hit = lastSeen(state, ex.id, addDays(today, 1));
      if (!hit) die(`${ex.name}: never logged`, 1);
      console.log(`${ex.name}: ${fmtDay(hit.d)} (${fmtRelative(hit.d, today)}) ${fmtItem(hit.item, state.settings)}`);
      return;
    }

    case 'body': {
      if (!pos.length) {
        const bt = bodyTrend(state, today, 90);
        if (!bt.list.length) console.log('no body-weight entries yet');
        for (const b of bt.list.slice(-14)) console.log(`  ${fmtDay(b.d).padEnd(10)} ${b.w} ${unit()}${b.notes ? `  (${b.notes})` : ''}`);
        if (bt.change7 != null) console.log(`  7-day change: ${bt.change7 > 0 ? '+' : ''}${bt.change7}`);
        return;
      }
      const w = numArg(String(pos[0]).replace(/(lbs?|kg)$/i, ''), 'weight');
      const d = flags.on ? dateArg(flags.on, today) : today;
      must(apply('logBody', { d, w, notes: flags.notes ? String(flags.notes) : undefined }), 'nothing changed');
      console.log(`body weight ${w} ${unit()} on ${fmtDay(d)}`);
      break;
    }

    case 'ex': {
      const sub = pos[0] ?? 'list';
      if (sub === 'list') {
        const stats = new Map(exerciseStats(state).map((r) => [r.ex, r]));
        const byType = {};
        for (const e of Object.values(state.exercises).filter((x) => !x.archived)) (byType[e.type ?? 'other'] ??= []).push(e);
        for (const [t, list] of Object.entries(byType)) {
          console.log(`${typeName(t)}:`);
          for (const e of list.sort((a, b) => a.name.localeCompare(b.name))) console.log(`  ${e.id.padEnd(16)} ${e.name.padEnd(22)} ${e.kind.padEnd(6)} ${stats.get(e.id) ? `${stats.get(e.id).sessions}× · last ${fmtDay(stats.get(e.id).last.d)}` : ''}`);
        }
        return;
      }
      if (sub === 'add') {
        const name = pos.slice(1).join(' ');
        const res = must(apply('addExercise', { name, kind: flags.kind, type: flags.type ? findDoc(state.types, flags.type, 'type').id : null, aliases: flags.alias ? String(flags.alias).split(',') : [] }), `exercise "${name}" exists or name empty`);
        console.log(`added exercise ${res.id}: ${state.exercises[res.id].name}`);
      } else if (sub === 'edit') {
        const ex = findDoc(state.exercises, pos.slice(1).join(' '), 'exercise');
        const patch = {};
        if (flags.name) patch.name = String(flags.name);
        if (flags.kind) patch.kind = String(flags.kind);
        if (flags.type) patch.type = flags.type === 'none' ? null : findDoc(state.types, flags.type, 'type').id;
        if (flags.alias) patch.aliases = [...ex.aliases, ...String(flags.alias).split(',')];
        if (flags.archive) patch.archived = flags.archive !== 'off';
        must(apply('editExercise', { id: ex.id, patch }), 'nothing changed');
        console.log(`updated ${ex.id}: ${JSON.stringify(state.exercises[ex.id])}`);
      } else if (sub === 'merge') {
        const from = findDoc(state.exercises, pos[1], 'exercise');
        const into = findDoc(state.exercises, pos[2], 'exercise');
        must(apply('mergeExercise', { from: from.id, into: into.id }), 'not merged');
        console.log(`merged ${from.name} into ${into.name}`);
      } else die(`unknown: wk ex ${sub}`);
      break;
    }

    case 'types':
      for (const t of Object.values(state.types).sort((a, b) => a.order - b.order)) console.log(`  ${t.id.padEnd(10)} ${t.name.padEnd(12)} ${t.kind.padEnd(6)} ${t.color}  ${t.aliases.join(', ')}`);
      return;

    case 'type': {
      const sub = pos[0];
      if (sub === 'add') {
        const res = must(apply('addType', { name: pos.slice(1).join(' '), kind: flags.kind, color: flags.color, aliases: flags.alias ? String(flags.alias).split(',') : [] }), 'type exists or name empty');
        console.log(`added type ${res.id}`);
      } else if (sub === 'edit') {
        const t = findDoc(state.types, pos.slice(1).join(' '), 'type');
        const patch = {};
        if (flags.name) patch.name = String(flags.name);
        if (flags.kind) patch.kind = String(flags.kind);
        if (flags.color) patch.color = String(flags.color);
        if (flags.alias) patch.aliases = [...t.aliases, ...String(flags.alias).split(',')];
        if (flags.archive) patch.archived = flags.archive !== 'off';
        must(apply('editType', { id: t.id, patch }), 'nothing changed');
        console.log(`updated type ${t.id}`);
      } else die(`unknown: wk type ${sub}`);
      break;
    }

    case 'settings': {
      const patch = {};
      if (flags.unit) patch.unit = String(flags.unit);
      if (flags.dist) patch.dist = String(flags.dist);
      if (flags.target) patch.target = flags.target === 'none' ? null : numArg(flags.target, '--target');
      if (flags.reminders) patch.reminders = flags.reminders === 'on' || flags.reminders === true;
      if (flags.tz) patch.tz = String(flags.tz);
      if (Object.keys(patch).length) must(apply('editSettings', { patch }), 'nothing changed');
      console.log(JSON.stringify(state.settings, null, 2));
      break;
    }

    case 'brief': {
      const b = buildBrief(state, { today, now: ctx.now });
      console.log(b.text);
      if (flags.write) {
        apply('setBrief', { headline: b.headline, lines: b.lines, asks: b.asks });
        console.log('\n(brief written to the website)');
      }
      break;
    }

    case 'scrub': {
      const res = must(apply('scrubText', { find: textArg(pos), replace: flags.with ? String(flags.with) : '' }), 'not found anywhere');
      console.log(`scrubbed from ${res.writes.length - 1} entries. Git history and old commit messages still have it: only Danny can remove those.`);
      break;
    }

    case 'check': {
      const text = existsSync(STATE_PATH) ? readFileSync(STATE_PATH, 'utf8') : '';
      let raw;
      try {
        raw = JSON.parse(text);
      } catch (err) {
        die(brokenStateHelp(err, text), 1);
      }
      const n = normalizeState(raw);
      const problems = [];
      for (const w of [...Object.values(n.workouts), ...Object.values(n.plans)]) {
        if (!n.types[w.type]) problems.push(`${w.id} has unknown type ${w.type}`);
        for (const it of w.items) if (!n.exercises[it.ex]) problems.push(`${w.id} item ${it.id} has unknown exercise ${it.ex}`);
      }
      if (serializeState(n) !== text) problems.push('state.json is not in canonical form (wk check --fix)');
      if (flags.fix) save(n);
      if (problems.length) {
        console.log(problems.join('\n'));
        if (!flags.fix) process.exit(1);
      } else console.log(`ok · ${Object.keys(n.workouts).length} workouts · ${Object.keys(n.plans).length} plans · ${Buffer.byteLength(text)} bytes`);
      return;
    }

    case 'commit':
      commit(state, typeof flags.m === 'string' ? flags.m : null);
      return;

    case 'push':
      push({ allowCode: !!flags['allow-code'] });
      return;

    default:
      die(`unknown command "${cmd}". Try: wk help`);
  }

  if (changed) save(state);
}

main();
