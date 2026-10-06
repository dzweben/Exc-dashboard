// Workout Console boot: picks a store, owns app state, renders views, dispatches ops.
import { h, mount, safeStorage, isSegmented } from './dom.js';
import { todayISO, nowISO, addDays } from '../engine/dates.js';
import { OPS } from '../engine/ops.js';
import { calendarView, todayView, logView, upcomingPlans } from '../engine/views.js';
import { weekStats, weeks, streak, heatmap, prsIndex, exerciseStats, bodyTrend } from '../engine/stats.js';
import { normalizeState, emptyState } from '../engine/model.js';
import { createGitHubStore } from '../store/githubstore.js';
import { createLocalStore } from '../store/localstore.js';
import { mountHeader } from './views/header.js';
import { renderOverview } from './views/overview.js';
import { renderLog } from './views/log.js';
import { renderPlan } from './views/plan.js';
import { renderLifts } from './views/lifts.js';
import { renderBody } from './views/body.js';
import { renderSetup } from './views/setup.js';
import { renderWorkoutSheet, renderPlanSheet } from './views/sheet.js';
import { burst, stamp } from './fx/burst.js';
import { icon } from './icons.js';

const storage = safeStorage();
// Keys are prefixed "wk." : every Pages site under dzweben.github.io shares one localStorage,
// and the EF Console's token ("ef.gh.token") only has access to its own repo.
const TOKEN_KEY = 'wk.gh.token';
const CONFIG_KEY = 'wk.gh.config';

export const DEFAULT_CONFIG = Object.freeze({
  owner: 'dzweben',
  repo: 'workout-dashboard',
  branch: '', // '' = the repo's default branch
  path: 'data/state.json',
  // Author + committer of every website commit (GitHub's noreply address, never a personal email).
  author: Object.freeze({ name: 'Danny Zweben', email: '176344411+dzweben@users.noreply.github.com' }),
});

const HEALTHY = new Set(['synced', 'saving', 'pending']);
const POINTER_RELEASE_MS = 400;
const POINTER_HOLD_MAX_MS = 5000;

export const TABS = [
  { id: 'overview', label: 'Today', icon: 'bolt' },
  { id: 'log', label: 'Log', icon: 'history' },
  { id: 'plan', label: '2 weeks', icon: 'calendar' },
  { id: 'lifts', label: 'PRs', icon: 'trophy' },
  { id: 'body', label: 'Body', icon: 'scale' },
  { id: 'setup', label: 'Setup', icon: 'settings' },
];

const VIEWS = {
  overview: renderOverview,
  log: renderLog,
  plan: renderPlan,
  lifts: renderLifts,
  body: renderBody,
  setup: renderSetup,
};

const CONFIG_KEYS = ['owner', 'repo', 'branch', 'path'];

function pickConfig(cfg) {
  const out = { ...DEFAULT_CONFIG };
  if (cfg && typeof cfg === 'object') for (const k of CONFIG_KEYS) if (typeof cfg[k] === 'string') out[k] = cfg[k];
  return out;
}

function readConfig() {
  try {
    const raw = storage.get(CONFIG_KEY);
    return pickConfig(raw ? JSON.parse(raw) : {});
  } catch {
    return pickConfig({});
  }
}

function tabFromHash() {
  const t = (location.hash || '').replace(/^#/, '');
  return TABS.some((x) => x.id === t) ? t : 'overview';
}

/** Mount the app. `opts.createStore(storeOptions)` swaps in a store (tests). */
export function boot(root = document, opts = {}) {
  const els = {
    header: root.getElementById('wk-header'),
    tabs: root.getElementById('wk-tabs'),
    main: root.getElementById('wk-main'),
    overlay: root.getElementById('wk-overlay'),
    toasts: root.getElementById('wk-toasts'),
  };

  const app = {
    state: emptyState(),
    loaded: false,
    loadFailed: false,
    config: readConfig(),
    token: storage.get(TOKEN_KEY) || '',
    store: null,
    status: { kind: 'loading', at: null, message: 'Loading…' },
    ui: { tab: tabFromHash(), sheet: null, filters: {}, drafts: {} },
    renderQueued: false,
    renderHeld: false,
    pointerHold: false,
    holdTimer: null,
    focusHeld: false,
    renderedTab: null,
    header: null,
    unsub: null,
    unstatus: null,
  };

  // ---------- store ----------
  function defaultStore(storeOptions) {
    const preview = window.__WK_PREVIEW__;
    if (preview) return createLocalStore(normalizeState(preview), { key: 'wk.preview.v1' });
    return createGitHubStore(storeOptions);
  }

  function pickStore() {
    if (app.unsub) app.unsub();
    if (app.unstatus) app.unstatus();
    app.unsub = app.unstatus = null;
    if (app.store && app.store.dispose) app.store.dispose();
    app.loaded = false;
    app.loadFailed = false;
    app.status = { kind: 'loading', at: null, message: 'Loading…' };
    const storeOptions = { ...app.config, author: { ...DEFAULT_CONFIG.author }, token: app.token || null };
    const store = typeof opts.createStore === 'function' ? opts.createStore(storeOptions) : defaultStore(storeOptions);
    app.store = store;
    const current = () => app.store === store;
    app.unsub = store.subscribe((state) => {
      if (!current() || !state) return;
      app.state = state;
      app.loaded = true;
      schedule();
    });
    if (store.onStatus) {
      const off = store.onStatus((st) => {
        if (!current() || !st) return;
        app.status = st;
        if (HEALTHY.has(st.kind)) app.loadFailed = false;
        schedule();
      });
      app.unstatus = typeof off === 'function' ? off : null;
    }
    let loading;
    try {
      loading = Promise.resolve(store.load());
    } catch (err) {
      loading = Promise.reject(err);
    }
    loading.then(
      () => {
        if (!current()) return;
        if (app.status.kind === 'error') app.loadFailed = true;
        schedule();
      },
      (err) => {
        if (!current()) return;
        app.loadFailed = true;
        if (app.status.kind === 'loading') app.status = { kind: 'error', at: nowISO(), message: err?.message || String(err) };
        schedule();
      },
    );
  }

  function notReadyReason() {
    const st = app.status ?? {};
    const why = (st.kind === 'error' || st.kind === 'offline') && st.message ? ` ${st.message}` : '';
    if (!app.loaded) return `Still loading your log…${why}`;
    if (app.loadFailed && st.kind === 'error') return `Still loading your log…${why || ' GitHub load failed.'}`;
    if (typeof app.store?.isLoaded === 'function' && app.store.isLoaded() === false) return `Still loading your log…${why || ' GitHub load failed.'}`;
    return null;
  }

  // ---------- ctx ----------
  function buildCtx() {
    const state = app.state;
    const tz = state.settings?.tz || 'America/New_York';
    const today = todayISO(tz);
    const now = nowISO();
    const vm = memoVm(state, today);
    const canWrite = !!app.store && app.store.mode !== 'readonly';
    return {
      state, today, now, tz, vm,
      type: (id) => state.types?.[id] ?? state.types?.other ?? { id: 'other', name: 'Workout', color: '#b0b8c1', glyph: 'WO', kind: 'other' },
      ex: (id) => state.exercises?.[id] ?? { id, name: id, kind: 'lift' },
      ui: app.ui,
      loaded: app.loaded,
      store: { mode: app.store?.mode ?? 'readonly', status: app.status, canWrite, refresh: () => app.store?.refresh?.() },
      config: app.config,
      hasToken: !!app.token,
      act, setUI, setTab, rerender: schedule,
      openWorkout: (id) => setUI({ sheet: { kind: 'workout', id }, sheetConfirm: null, sheetDraft: null }),
      openPlan: (id) => setUI({ sheet: { kind: 'plan', id }, sheetConfirm: null, sheetDraft: null }),
      newPlan: (d) => setUI({ sheet: { kind: 'plan', id: null, d }, sheetConfirm: null, sheetDraft: null }),
      newWorkout: (d) => setUI({ sheet: { kind: 'workout', id: null, d }, sheetConfirm: null, sheetDraft: null }),
      closeOverlay,
      toast,
      fx: { burst, stamp },
      icon,
      setToken, clearToken, saveConfig,
    };
  }

  let vmCache = { state: null, today: null, vm: null };
  function memoVm(state, today) {
    if (vmCache.state === state && vmCache.today === today) return vmCache.vm;
    const vm = {
      today: todayView(state, today),
      cal: calendarView(state, today, 14, today),
      past: calendarView(state, addDays(today, -6), 7, today),
      log: logView(state, { limit: 400 }),
      upcoming: upcomingPlans(state, today, 14),
      week: weekStats(state, today),
      weeks: weeks(state, today, 8),
      streak: streak(state, today),
      heat: heatmap(state, today, 16),
      prs: prsIndex(state),
      exercises: exerciseStats(state),
      body: bodyTrend(state, today, 120),
    };
    vmCache = { state, today, vm };
    return vm;
  }

  // ---------- actions ----------
  async function act(name, args = {}, o = {}) {
    const fn = OPS[name];
    if (!fn) {
      toast(`Unknown action: ${name}`, { kind: 'error' });
      return null;
    }
    if (!app.store || app.store.mode === 'readonly') {
      toast('Read-only. Connect GitHub in Setup to save changes.', { kind: 'error', action: { label: 'Setup', fn: () => setTab('setup') } });
      return null;
    }
    const notReady = notReadyReason();
    if (notReady) {
      toast(notReady, { kind: 'error', action: app.status?.kind === 'error' ? { label: 'Setup', fn: () => setTab('setup') } : null });
      return null;
    }
    const tz = app.state.settings?.tz || 'America/New_York';
    const c = { now: nowISO(), today: todayISO(tz), src: 'dash' };
    let res;
    try {
      res = fn(app.state, args, c);
    } catch (err) {
      console.error(err);
      toast(`That didn't work: ${err?.message || err}`, { kind: 'error' });
      return null;
    }
    if (!res || !res.writes || res.writes.length === 0) return res;
    try {
      await app.store.apply(res.writes, res.activity ?? []);
    } catch (err) {
      console.error(err);
      if (err?.code === 'not_loaded') toast(err.message || 'Still loading your log…', { kind: 'error' });
      else toast(`Couldn't save: ${err?.message || err}`, { kind: 'error' });
      return null;
    }
    const msg = typeof o.toast === 'function' ? o.toast(res) : o.toast;
    if (msg) toast(msg, { kind: o.kind ?? 'good', action: o.undo ? { label: 'Undo', fn: () => o.undo(res) } : null });
    return res;
  }

  function setUI(patch) {
    app.ui = { ...app.ui, ...patch };
    schedule();
  }

  function closeOverlay() {
    setUI({ sheet: null, sheetConfirm: null, sheetDraft: null });
  }

  function setTab(tab) {
    if (!TABS.some((t) => t.id === tab)) return;
    app.ui = { ...app.ui, tab };
    try { history.replaceState(null, '', `#${tab}`); } catch { /* sandboxed */ }
    schedule();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  function setToken(token) {
    app.token = String(token || '').trim();
    if (app.token) storage.set(TOKEN_KEY, app.token);
    else storage.del(TOKEN_KEY);
    pickStore();
  }
  function clearToken() { setToken(''); }
  function saveConfig(cfg) {
    app.config = pickConfig(cfg);
    const saved = {};
    for (const k of CONFIG_KEYS) saved[k] = app.config[k];
    storage.set(CONFIG_KEY, JSON.stringify(saved));
    pickStore();
  }

  // ---------- toasts ----------
  const toastTimers = new Set();
  function toast(message, { kind = 'info', action = null, ms = 4200 } = {}) {
    const el = h('div.toast', { class: kind === 'error' ? 'is-error' : kind === 'good' ? 'is-good' : '', role: 'status' },
      h('span', message),
      action ? h('button.btn.btn-sm', { type: 'button', onclick: () => { el.remove(); action.fn(); } }, action.label) : null,
    );
    els.toasts.appendChild(el);
    while (els.toasts.children.length > 3) els.toasts.firstChild.remove();
    const t = setTimeout(() => {
      toastTimers.delete(t);
      el.remove();
    }, ms);
    toastTimers.add(t);
  }

  // ---------- render ----------
  function schedule() {
    if (app.renderQueued || app.disposed) return;
    app.renderQueued = true;
    requestAnimationFrame(() => {
      app.renderQueued = false;
      if (app.disposed) return;
      if (app.pointerHold) {
        app.renderHeld = true;
        return;
      }
      render();
    });
  }

  function holdRenders() {
    app.pointerHold = true;
    clearTimeout(app.holdTimer);
    app.holdTimer = setTimeout(releaseRenders, POINTER_HOLD_MAX_MS);
  }
  function releaseSoon(ms) {
    if (!app.pointerHold) return;
    clearTimeout(app.holdTimer);
    app.holdTimer = setTimeout(releaseRenders, ms);
  }
  function releaseRenders() {
    clearTimeout(app.holdTimer);
    app.holdTimer = null;
    if (!app.pointerHold) return;
    app.pointerHold = false;
    if (app.renderHeld) {
      app.renderHeld = false;
      schedule();
    }
  }

  function typingSegmented(container) {
    const a = document.activeElement;
    return !!a && a !== container && typeof container.contains === 'function' && container.contains(a) && isSegmented(a);
  }

  function renderTabs(ctx) {
    return h('div.tabs', { role: 'tablist', 'aria-label': 'Views' },
      TABS.map((t) => h('button.tab', {
        type: 'button', role: 'tab',
        'aria-selected': String(ctx.ui.tab === t.id),
        class: ctx.ui.tab === t.id ? 'is-active' : '',
        onclick: () => setTab(t.id),
      }, icon(t.icon), h('span', t.label))),
    );
  }

  function render() {
    const ctx = buildCtx();
    if (!app.header) app.header = mountHeader(els.header, ctx);
    app.header.update(ctx);
    mount(els.tabs, renderTabs(ctx));
    if (app.renderedTab === ctx.ui.tab && typingSegmented(els.main)) {
      app.focusHeld = true;
    } else {
      const view = VIEWS[ctx.ui.tab] ?? VIEWS.overview;
      let node;
      try {
        node = view(ctx);
      } catch (err) {
        console.error(err);
        node = h('div.panel', h('div.panel-body', h('p', `This view crashed: ${err?.message || err}`)));
      }
      const y = window.scrollY;
      mount(els.main, node);
      app.renderedTab = ctx.ui.tab;
      if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
    }
    let overlay = null;
    try {
      if (ctx.ui.sheet?.kind === 'workout') overlay = renderWorkoutSheet(ctx);
      else if (ctx.ui.sheet?.kind === 'plan') overlay = renderPlanSheet(ctx);
    } catch (err) {
      console.error(err);
    }
    els.toasts.classList.toggle('is-beside-sheet', !!overlay && overlay.classList.contains('is-side'));
    if (overlay) {
      const shown = els.overlay.firstChild;
      const sameSheet = !!shown && shown.dataset?.key != null && shown.dataset.key === overlay.dataset?.key;
      if (sameSheet && typingSegmented(els.overlay)) app.focusHeld = true;
      else if (shown !== overlay) mount(els.overlay, overlay);
      els.overlay.hidden = false;
    } else {
      els.overlay.replaceChildren();
      els.overlay.hidden = true;
    }
  }

  // ---------- listeners ----------
  const listeners = [];
  const listen = (target, type, fn, capture = false) => {
    target.addEventListener(type, fn, capture);
    listeners.push(() => target.removeEventListener(type, fn, capture));
  };
  listen(window, 'hashchange', () => setTab(tabFromHash()));
  listen(document, 'keydown', (e) => {
    if (e.key === 'Escape' && app.ui.sheet) closeOverlay();
  });
  listen(document, 'pointerdown', holdRenders, true);
  listen(document, 'pointerup', () => releaseSoon(POINTER_RELEASE_MS), true);
  listen(document, 'pointercancel', releaseRenders, true);
  listen(document, 'dragstart', releaseRenders, true);
  listen(document, 'click', () => releaseSoon(0), true);
  listen(window, 'blur', releaseRenders);
  listen(document, 'focusout', () => {
    if (!app.focusHeld) return;
    app.focusHeld = false;
    schedule();
  }, true);
  const timers = [
    setInterval(() => app.header && app.header.tick && app.header.tick(buildCtx()), 1000),
    setInterval(schedule, 60 * 1000),
  ];

  app.act = act;
  app.buildCtx = buildCtx;
  app.dispose = () => {
    app.disposed = true;
    for (const t of timers) clearInterval(t);
    for (const t of toastTimers) clearTimeout(t);
    clearTimeout(app.holdTimer);
    for (const off of listeners.splice(0)) off();
    if (app.unsub) app.unsub();
    if (app.unstatus) app.unstatus();
    if (app.store && app.store.dispose) app.store.dispose();
  };

  pickStore();
  schedule();
  return app;
}

if (typeof window !== 'undefined' && !window.__WK_NO_BOOT__) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot());
  else boot();
}
