# Workout Console UI: design brief

Same design system as the EF Console: **punk zine × hacked terminal**.

- Ground: photocopy-black with grain, halftone and CRT scanlines (`base.css`).
- Panels: hard black boxes, 2px rules, sharp corners, hard offset shadows
  (`.panel.is-pink|is-cyan|is-acid`). No rounded cards, no soft shadows.
- Neons from tokens only: `--pink` (accent, primary actions), `--acid` (logged,
  PRs, streaks), `--cyan` (plans, info), `--hazard` (missed plans), `--blood` (errors).
  Workout types bring their own color through `--c` (`typeStyle(type)`).
- Type: stencil display for titles, condensed shout for big numbers, mono for
  data and chips, marker scrawl only for Claude's note and empty states.
- Hero: the log terminal. `> push day: bench 3x8 @185` with a live parse
  preview (type, day, each exercise with its sets). LOG / PLAN toggle; text
  starting with "plan" plans.
- The one big moment: logging (acid burst + `LOGGED` or `PR!` stamp).
- Phone first-class: tabs become a fixed bottom bar, the calendar becomes a
  list of days, 16px gutters, no horizontal scroll, ≥40px touch targets.
- Copy: short, direct, a record not a coach. No streak guilt, no nagging.

## Files

```
main.js            boot, store, ctx, tabs, render loop, sheets
dom.js, icons.js   h()/s()/mount(), inline SVG icons
views/common.js    shared helpers (typeMark, drafts, keepFocus, item lists)
views/header.js    logo, sync light, log terminal, next-up card, vitals
views/overview.js  Today: today panel, Claude's note, 2-week strip, recent, streak
views/log.js       every workout, grouped by week, filters
views/plan.js      rolling 14 days (+ / drag to move), last 7 days, planned list
views/lifts.js     weekly bars, recent PRs, exercise table with sparklines, heatmap
views/body.js      optional body weight: log, stats, trend chart
views/sheet.js     edit sheets for a workout or plan; new past workout; new plan
views/setup.js     GitHub token, preferences, types, exercises, about
styles/*.css       tokens, base, header, drawer (sheets), setup, brief, fx, views
```
