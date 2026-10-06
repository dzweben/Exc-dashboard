# Workout Console

Danny's workout log: lifts with sets/reps/weights, cardio, classes, PRs,
weekly volume, a streak + heatmap, a 2-week plan, and an optional body-weight
log, with Claude as the chat front end. Same setup as the
[EF Console](https://github.com/dzweben/ef-dashboard-management).

- **Website:** https://dzweben.github.io/workout-dashboard/
  Type workouts into the terminal bar (`push day: bench 3x8 @185, 30 min`),
  switch it to PLAN for the next two weeks, tap a workout to fix its numbers,
  hit "Did it" on a planned day. Every change is a commit under Danny's name.
- **Chat:** tell Claude `ran 3 miles yesterday`, `legs: squat 5x5 @225`,
  `plan pull day wed`, `what did I do last push day?`. Every turn Claude pulls
  your website changes, logs what you said (backdated to the day it happened),
  writes a short note for the site, and commits + pushes.
- **Database:** `data/state.json`. Git history is the track record.

## One-time setup

1. **Turn on the website.** Repo **Settings → Pages → Build and deployment →
   Source: Deploy from a branch**, branch `main`, folder `/docs` → Save.
2. **Let the site save.** Create a fine-grained token:
   https://github.com/settings/personal-access-tokens/new?name=Workout+Console&target_name=dzweben&expires_in=365&contents=write
   - Repository access: **Only select repositories → workout-dashboard**
   - Repository permissions: **Contents → Read and write**
   Open the site → **Setup** → paste → Save token. Once per device. It stays in
   that browser's localStorage only (shared by all your github.io sites, so keep
   it limited to this one repo). Revoke it on GitHub if anything looks off.
3. **Privacy.** The repo is public: anyone can read your workouts. Making it
   private needs GitHub Pro for Pages (free with the Student Developer Pack).

## What Claude understands

| You say | Logged as |
|---|---|
| `did push day: bench 3x8 @185, ohp 3x10 @95, 30 min` | Push day, today, 2 lifts, 30 min |
| `squat 225x5, 245x5, 265x3 sat` | Leg day last Saturday, 3 sets |
| `ran 3 miles in 27 min yesterday` / `5k 25:30` | Run with distance, time and pace |
| `pullups 3x10 +25` / `plank 3x45s` | bodyweight with added weight / timed holds |
| `yoga class 60 min` / `played basketball for an hour` | class / sport sessions |
| `plan legs fri: squat 5x5 @235` | a planned workout on Friday |
| `weighed 172.4` | body weight today |

## Developing

```bash
npm install          # esbuild (only for rebuilding the website)
npm test             # engine, merge driver and CLI tests
npm run build        # src/ui → docs/index.html
node bin/wk.mjs help # the CLI Claude uses every turn
```

See `CLAUDE.md` (the per-turn protocol), `docs/ARCHITECTURE.md` (data shapes and
modules) and `src/ui/README.md` (design brief).
