# Workout Console

Danny's workout log. No routine: go in, pick a couple of exercises that fit
the goals (strength, range of motion, well-being), stay easy, edge past last
time. The log remembers everything and shows what hasn't been hit lately
("today could be tib raises or soleus stretch"). Also PRs, weekly volume, a
streak + heatmap, optional plans and body weight, with Claude as the chat
front end. Weights are plates only (the bar is never counted). Same setup as the
[EF Console](https://github.com/dzweben/ef-dashboard-management).

- **Website:** https://dzweben.github.io/Exc-dashboard/ (read-only): what
  hasn't been hit lately, best + trend per exercise, consistency, recent sessions.
- **Chat:** tell Claude what you did (`lat pulldown 130x3`, `soleus stretch 35s
  @90 per side`); ask `what haven't I hit?` when you want to know. Claude logs it
  on the right day and commits + pushes; it doesn't nudge.
- **Database:** `data/state.json`. Git history is the track record.

The site needs no token. (A token made earlier for the old editable version can
be revoked: GitHub → Settings → Developer settings → Fine-grained tokens.)

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
