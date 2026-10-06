# Workout Console architecture (the contract)

Built on the EF Console pattern: the repo is the database, a static GitHub Pages
site reads and writes it through the Contents API, and Claude runs a CLI every
chat turn. If you change a shape, change it here first.

## The loop

```
Danny ──chat──▶ Claude (CLAUDE.md), every turn:
                  wk sync            git pull --rebase --autostash + what Danny did on the website
                  wk log / plan …    edits data/state.json through engine/ops.js
                  wk brief --write   the note shown on the website
                  wk commit && wk push   author: Danny Zweben (noreply); retries over website races
                  ▼
        github.com/dzweben/exc-dashboard ── data/state.json (every change = a commit)
                  ▲
Danny ──taps──▶ website (docs/index.html) ── Contents API with Danny's fine-grained token
```

- `data/state.json` never merges as text: `bin/wk-merge.mjs` (git merge driver
  `wkstate`) writes `applyWrites(A, diffWrites(O, B))`, field by field.
- `src/engine/*` is pure JS shared by the website (esbuild) and the CLI (Node).
- Dates are `YYYY-MM-DD` in `settings.tz`; timestamps ISO UTC; anything needing
  "today" takes it as an argument (`ctx = { now, today, src }`).

## State

```js
State = {
  schema: 1,
  settings: { tz, owner, weekStart: 'mon', unit: 'lb'|'kg', dist: 'mi'|'km',
              target: null|N (workouts/week goal), horizon: 14, reminders: true (suggest what's due), plates: true (weights exclude the bar) },
  brief:    { at, headline, lines: [], asks: [] } | null,
  sync:     { lastClaudeSync, lastActivitySeen },
  types:     { [id]: Type },       // splits: push, pull, legs, upper, full, arms, cardio, class, sport, mobility, other
  exercises: { [id]: Exercise },
  plans:     { [id]: Plan },
  workouts:  { [id]: Workout },
  body:      { ['b_<date>']: Body },
  activity:  { [id]: Activity },
}
Type     = { id, name, kind: 'lift'|'cardio'|'other', color, glyph, aliases: [], order, archived, created }
Exercise = { id (slug), name, kind: 'lift'|'bw'|'cardio'|'time', type: typeId|null (its area), aliases: [], notes (Danny's goal), rotation: bool, archived, created }
Workout  = { id: 'w_…', d, time, type, title, min, items: Item[], notes, feel: 1-5|null, plan: planId|null, created, updated, src }
Plan     = { id: 'pl_…', d, time, type, title, items: Item[] (targets), notes, status: 'planned'|'done'|'skipped', workout, created, updated, src }
Item     = { id: 'i1', ex, sets: [{ r, w, s? }], dist, min, notes }   // w in settings.unit (null = bodyweight / added weight for bw), s = seconds
Body     = { id: 'b_2026-10-05', d, w, notes, created }               // one per day
Activity = { id, at, src: 'chat'|'dash', type: log|edit|delete|plan|unplan|move|skip|unskip|body|ex|type|settings|scrub, ref, title, from, to }
```

`serializeState` writes stable key order (entries sorted by id).

## Writes (`model.js`)

`Write = { op: set|update|delete, col, id, data?, arr?, ifAbsent? }` (`col`
`meta` with id settings|brief|sync). `update` merges `data` shallowly (settings
one level deep) and applies `arr` specs: id arrays (`workouts.items`,
`plans.items`) by element id (`remove` + `was`, `upsert`, `insert` with id
renumbering on clash, `patch`, `order`), value sets (`aliases`) by add/remove.
`diffWrites(base, next)` emits the finest writes such that
`applyWrites(base, diffWrites(base, next))` equals `next`, and
`applyWrites(remote, diffWrites(base, ours))` keeps remote's concurrent edits.
New exercises/types are created `ifAbsent`.

## Engine

- `parse.js`: `parseWorkout(text, { today, state, mode: 'log'|'plan' })` →
  `{ d, type, title, min, items: [{ ex, name, isNew, kind, sets, dist, min }], notes, unknown }`;
  `parseNumbers(segment)` (set notations, distance, time); `findDay(text, today, mode)`
  (log mode backdates bare weekdays); `fmtItem`, `fmtMin`, `fmtPace`.
- `ops.js`: `seedDefaults, logWorkout (links + completes a same-day plan; returns
  { id, prs }), editWorkout, deleteWorkout, planWorkout, editPlan, movePlan,
  skipPlan, unskipPlan, deletePlan, completePlan, logBody, deleteBody,
  addExercise, editExercise, mergeExercise, addType, editType, setBrief,
  editSettings, scrubText`; `OPS` registry. Every op returns `{ state, writes, activity }`.
- `stats.js`: `e1rm` (Epley), `prsIndex(state)` (workout id → PRs; marks:
  weight, e1rm, reps, distance, pace, hold, duration; a first session sets none),
  `exerciseStats`, `lastSeen`, `lastOfType`, `weekStats`, `weeks`, `heatmap`,
  `streak` (days, and weeks at target), `bodyTrend`, `fmtPR`, and the rotation:
  `rotation` (exercises logged or flagged `rotation`, most days since last hit
  first), `areaGaps` (per type), `suggestions(state, today, n)` (most overdue, one
  per area, not done today), `sinceLabel`.
- `views.js`: `calendarView`, `todayView` (logged, planned, missed, next),
  `logView`, `upcomingPlans`.
- `brief.js`: `buildBrief`, `changesBetween`, `changesSince`, `commitMessage`, `fmtEntry`.

## Stores (`src/store/`)

Unchanged from the EF Console: `createGitHubStore({ owner, repo, branch, path,
token, author })` loads the file, applies writes optimistically, queues one
batch per action, rebases queued batches onto newer remote copies and PUTs
with the file sha (retries 409/422). Pending batches survive reloads in
localStorage under `wk.pending.v2:…`. Without a token it reads the public raw
file read-only.

## Website (`src/ui/`)

`main.js` owns state, builds `ctx`, renders the active tab every change. Tabs:
Today (overview), Log, 2 weeks, PRs, Body, Setup. The header holds the log
terminal (LOG / PLAN modes, live parse preview), the next-up card and the
vitals. Sheets (`views/sheet.js`) edit a workout or plan. The token is stored
under `wk.gh.token` (never the EF Console's key). `scripts/build.mjs` inlines
everything into `docs/index.html`; `--preview` embeds a state for local testing.
