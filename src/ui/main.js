// EXC: Danny's read-only training dashboard. He logs by talking to Claude; this page
// only shows the record: what hasn't been hit lately, progress, consistency.
import { h, mount, s } from './dom.js';
import { normalizeState } from '../engine/model.js';
import { todayISO, addDays, fmtDay } from '../engine/dates.js';
import { fmtItem, fmtPace, trimNum } from '../engine/parse.js';
import {
  rotation, exerciseStats, prsIndex, fmtPR, chronological, heatmap, weekStats, weeks, sinceLabel, bodyTrend,
} from '../engine/stats.js';

const SOURCES = [
  { url: 'https://api.github.com/repos/dzweben/Exc-dashboard/contents/data/state.json?ref=main', headers: { Accept: 'application/vnd.github.raw' } },
  { url: 'https://raw.githubusercontent.com/dzweben/Exc-dashboard/main/data/state.json' },
];

async function loadState() {
  if (typeof window !== 'undefined' && window.__WK_PREVIEW__) return normalizeState(window.__WK_PREVIEW__);
  let lastErr = null;
  for (const src of SOURCES) {
    try {
      const sep = src.url.includes('?') ? '&' : '?';
      const res = await fetch(`${src.url}${sep}t=${Date.now()}`, { headers: src.headers ?? {}, cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}`);
      return normalizeState(await res.json());
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('could not load');
}

const area = (state, id) => state.types?.[id] ?? { name: 'Other', color: '#8b93a7' };
const tone = (state, id) => ({ '--c': area(state, id).color });

function since(days) {
  if (days == null) return { big: '—', small: 'never' };
  if (days === 0) return { big: '0', small: 'today' };
  return { big: String(days), small: days === 1 ? 'day ago' : 'days ago' };
}

function spark(values, w = 120, hgt = 34) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 6) + 3, hgt - 4 - ((v - min) / span) * (hgt - 8)]);
  const [lx, ly] = pts[pts.length - 1];
  return s('svg', { class: 'spark', viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, 'aria-hidden': 'true' },
    s('polyline', { points: pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' '), fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
    s('circle', { cx: lx, cy: ly, r: 3.5, fill: 'currentColor' }),
  );
}

function bestText(state, best) {
  const u = state.settings?.unit ?? 'lb';
  const d = state.settings?.dist ?? 'mi';
  if (best.weight) return `${trimNum(best.weight.value)} ${u}`;
  if (best.reps) return `${best.reps.value} reps`;
  if (best.hold) return `${best.hold.value}s`;
  if (best.distance) return `${trimNum(best.distance.value)} ${d}`;
  if (best.pace) return `${fmtPace(best.pace.value)}/${d}`;
  if (best.duration) return `${Math.round(best.duration.value)} min`;
  return '';
}

function section(title, sub, ...body) {
  return h('section.card', h('header.card-head', h('h2', title), sub ? h('p.sub', sub) : null), ...body);
}

// ------------------------------------------------------------------ sections

function stats(state, today) {
  const wk = weekStats(state, today);
  const all = chronological(state);
  const last30 = all.filter((w) => w.d > addDays(today, -30)).length;
  const ws = weeks(state, today, 52);
  let run = 0;
  for (let i = ws.length - 1; i >= 0; i--) {
    if (ws[i].sessions) run++;
    else if (i === ws.length - 1) continue; // this week can still be empty
    else break;
  }
  const prCount = [...prsIndex(state).values()].reduce((a, l) => a + l.length, 0);
  const tracked = exerciseStats(state).length;
  const tile = (n, label) => h('div.stat', h('b.stat-n', String(n)), h('span.stat-l', label));
  return h('div.stats',
    tile(wk.sessions, 'this week'),
    tile(last30, 'last 30 days'),
    tile(run, run === 1 ? 'week active' : 'weeks active'),
    tile(prCount, prCount === 1 ? 'PR' : 'PRs'),
    tile(tracked, 'exercises'),
  );
}

function notHit(state, today) {
  const rot = rotation(state, today);
  if (!rot.length) return section('Not hit lately', null, h('p.empty', 'Nothing logged yet.'));
  return section('Not hit lately', 'longest gap first',
    h('ul.due', rot.map((r) => {
      const sn = since(r.daysSince);
      return h('li.due-row', { style: tone(state, r.area), class: r.daysSince === 0 ? 'is-today' : r.daysSince == null || r.daysSince >= 10 ? 'is-hot' : '' },
        h('div.due-days', h('b', sn.big), h('span', sn.small)),
        h('div.due-main',
          h('span.due-name', r.name),
          h('span.due-meta', h('i.dot'), area(state, r.area).name, r.last ? ` · last ${fmtItem(r.last.item, state.settings) || 'done'}` : ' · not logged yet'),
          r.goal ? h('span.due-goal', r.goal) : null,
        ),
      );
    })),
  );
}

function progress(state) {
  const rows = exerciseStats(state).sort((a, b) => b.sessions - a.sessions || (a.last.d < b.last.d ? 1 : -1));
  if (!rows.length) return null;
  return section('Progress', 'best so far, trend per session',
    h('div.prog', rows.map((r) => {
      const ex = state.exercises?.[r.ex];
      const first = r.trend[0]?.value;
      const lastV = r.trend[r.trend.length - 1]?.value;
      const delta = first != null && lastV != null && r.trend.length > 1 ? lastV - first : null;
      return h('div.prog-card', { style: tone(state, ex?.type) },
        h('div.prog-top', h('span.prog-name', r.name), h('span.prog-n', `${r.sessions}×`)),
        h('b.prog-best', bestText(state, r.best) || fmtItem(r.last.item, state.settings) || 'done'),
        h('div.prog-foot',
          spark(r.trend.map((t) => t.value)) ?? h('span.prog-base', 'baseline set'),
          delta != null && Math.abs(delta) > 0.01 ? h('span.prog-delta', { class: delta > 0 ? 'is-up' : 'is-down' }, `${delta > 0 ? '+' : ''}${trimNum(Math.round(delta * 10) / 10)}`) : null,
        ),
      );
    })),
  );
}

function consistency(state, today) {
  const cells = heatmap(state, today, 20);
  const cols = [];
  for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7));
  // sessions per area, last 30 days
  const from = addDays(today, -29);
  const counts = new Map();
  for (const w of chronological(state)) {
    if (w.d < from) continue;
    const areas = new Set(w.items.map((i) => state.exercises?.[i.ex]?.type ?? w.type));
    if (!areas.size) areas.add(w.type);
    for (const a of areas) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  const max = Math.max(1, ...counts.values());
  return section('Consistency', 'last 20 weeks',
    h('div.heat', cols.map((c) => h('div.heat-col', c.map((d) => h('span.heat-cell', {
      class: [d.count ? 'on' : '', d.d === today ? 'today' : '', d.future ? 'future' : ''].join(' '),
      style: d.count ? tone(state, d.types[0]) : null,
      title: `${fmtDay(d.d)}${d.count ? ` · ${d.count} session${d.count > 1 ? 's' : ''}` : ''}`,
    }))))),
    counts.size ? h('div.areas',
      h('p.sub', 'areas hit, last 30 days'),
      [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([a, n]) => h('div.area-row', { style: tone(state, a) },
        h('span.area-name', area(state, a).name),
        h('span.area-bar', h('i', { style: { width: `${(n / max) * 100}%` } })),
        h('b.area-n', String(n)),
      ))) : null,
  );
}

function recent(state, today) {
  const list = chronological(state).reverse().slice(0, 8);
  if (!list.length) return null;
  const idx = prsIndex(state);
  return section('Recent sessions', null,
    h('ul.sessions', list.map((w) => h('li.session',
      h('div.session-head', h('b', fmtDay(w.d)), h('span.sub', sinceLabel(Math.round((Date.parse(today) - Date.parse(w.d)) / 864e5)))),
      h('ul.session-items', w.items.map((it) => h('li', { style: tone(state, state.exercises?.[it.ex]?.type) },
        h('i.dot'), h('span', state.exercises?.[it.ex]?.name ?? it.ex), h('span.mono', fmtItem(it, state.settings))))),
      w.notes ? h('p.session-note', w.notes) : null,
      (idx.get(w.id) ?? []).map((p) => h('p.session-pr', `PR · ${fmtPR(p, state.settings)}`)),
    ))),
  );
}

function body(state, today) {
  const bt = bodyTrend(state, today, 180);
  if (!bt.list.length) return null;
  return section('Body weight', null,
    h('div.bw', h('b.stat-n', String(bt.last.w)), h('span.sub', fmtDay(bt.last.d)), spark(bt.list.map((b) => b.w), 220, 44)),
  );
}

function render(root, state) {
  const today = todayISO(state.settings?.tz || 'America/New_York');
  const lastW = chronological(state).pop();
  mount(root,
    h('header.top',
      h('h1.logo', 'EXC', h('span', '/ training log')),
      h('p.sub', lastW ? `last session ${fmtDay(lastW.d)} · ${sinceLabel(Math.round((Date.parse(today) - Date.parse(lastW.d)) / 864e5))}` : 'no sessions yet'),
    ),
    stats(state, today),
    h('div.grid',
      h('div.col', notHit(state, today), recent(state, today)),
      h('div.col', progress(state), consistency(state, today), body(state, today)),
    ),
    h('footer.foot', `Logged through Claude · updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`),
  );
}

export async function boot(root = document.getElementById('wk-app')) {
  const go = async () => {
    try {
      render(root, await loadState());
    } catch (err) {
      mount(root, h('p.boot', `Couldn't load the log (${err?.message || err}). Refresh to try again.`));
    }
  };
  await go();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') go(); });
}

if (typeof window !== 'undefined' && !window.__WK_NO_BOOT__) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot());
  else boot();
}

