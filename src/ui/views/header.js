// Header: logo + clock line, sync light, the log terminal (hero), the next-up card,
// and the vitals strip. Mounted once; update(ctx) refreshes it, tick(ctx) the clock.
import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { parseWorkout, fmtItem, fmtMin } from '../../engine/parse.js';
import { fmtDay, fmtRelative, localTimeOf, diffDays } from '../../engine/dates.js';
import { fmtPR } from '../../engine/stats.js';
import { kfmt, typeStyle } from './common.js';

const SYNC = {
  synced: ['SYNCED', 'acid'], saving: ['SAVING…', 'cyan', true], loading: ['LOADING…', 'cyan', true], pending: ['PENDING', 'hazard'],
  offline: ['OFFLINE', 'blood'], error: ['ERROR', 'blood'], conflict: ['CONFLICT', 'blood'], readonly: ['READ-ONLY', 'ink'],
};

function isTyping(target) {
  const t = target?.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || target?.isContentEditable;
}

/** Text that starts with "plan" (or the PLAN mode) plans instead of logs. */
export function readTerminal(text, ctx, mode = 'log') {
  let t = String(text ?? '').trim();
  let m = mode;
  const pm = t.match(/^(?:plan|planning|schedule)\b[:\s]*/i);
  if (pm) {
    m = 'plan';
    t = t.slice(pm[0].length);
  }
  if (!t) return null;
  const parsed = parseWorkout(t, { today: ctx.today, state: ctx.state, mode: m });
  return { mode: m, parsed };
}

export function mountHeader(el, ctx0) {
  let ctx = ctx0;
  let mode = 'log';
  let busy = false;

  const time = h('span.hdr-time');
  const dateEl = h('span');
  const syncLabel = h('span.hdr-sync-label');
  const sync = h('button.hdr-sync', { type: 'button', title: 'Refresh from GitHub', onclick: () => ctx.store.refresh() }, h('span.led'), syncLabel);
  const connect = h('a.hdr-connect', { href: '#setup', hidden: true }, icon('key'), h('span', 'Connect'));
  const modeTag = h('span.hdr-mode');

  const input = h('input.term-input#wk-term', {
    type: 'text',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: 'push day: bench 3x8 @185, ohp 3x10 @95, 30 min',
    'aria-label': 'Log a workout',
    oninput: () => preview(),
    onkeydown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        input.value = '';
        preview();
        input.blur();
      }
    },
  });
  const prev = h('div.term-preview', { 'aria-live': 'polite' });
  const modeBtns = {
    log: h('button.term-mode', { type: 'button', onclick: () => setMode('log') }, 'LOG'),
    plan: h('button.term-mode', { type: 'button', onclick: () => setMode('plan') }, 'PLAN'),
  };
  const go = h('button.btn.btn-hot.term-go', { type: 'button', onclick: () => submit() }, icon('enter'), h('span', 'Log it'));
  const term = h('div.term',
    h('div.term-bar',
      h('span.term-dots', h('i'), h('i'), h('i')),
      h('span.term-path', 'danny@gym:~$'),
      h('span.term-modes', modeBtns.log, modeBtns.plan),
      h('span.term-keys', h('kbd', '/'), ' focus · ', h('kbd', '↵'), ' save'),
    ),
    h('div.term-line',
      h('span.term-prompt', { onclick: () => input.focus() }, '>'),
      h('div.term-field', input, h('span.term-cursor', { 'aria-hidden': 'true' })),
      go,
    ),
    prev,
  );
  const next = h('div.hdr-next');
  const vitals = h('div.hdr-vitals');

  mount(el,
    h('div.hdr-top',
      h('div.hdr-logo-row',
        h('h1.hdr-logo.glitch', { 'data-text': 'WORKOUT//LOG' }, 'WORKOUT', h('span.hdr-logo-slash', '//'), 'LOG'),
        modeTag,
      ),
      h('div.hdr-sub', h('span', 'DANNY'), h('span.sep', '//'), dateEl, h('span.sep', '//'), time),
      h('div.hdr-status', connect, sync),
    ),
    h('div.hdr-main', term, next),
    vitals,
  );

  function setMode(m, focus = true) {
    mode = m;
    modeBtns.log.classList.toggle('is-on', m === 'log');
    modeBtns.plan.classList.toggle('is-on', m === 'plan');
    input.placeholder = m === 'plan' ? 'pull day wed · legs fri: squat 5x5 @235 · run 4 mi sat' : 'push day: bench 3x8 @185, ohp 3x10 @95, 30 min';
    go.lastChild.textContent = m === 'plan' ? 'Plan it' : 'Log it';
    preview();
    if (focus) input.focus();
  }

  function chip(text, cls = '', style = null) {
    return h('span.qa-tok', { class: cls, style }, text);
  }

  function preview() {
    const r = readTerminal(input.value, ctx, mode);
    if (!r) {
      mount(prev, h('span.qa-hint', mode === 'plan'
        ? 'plan a day: type + day, exercises optional'
        : 'say what you did: lifts as 3x8 @185 or 185x8, cardio as 3 mi in 27 min, a day like sat or yesterday'));
      return;
    }
    if (!ctx.loaded) {
      mount(prev, h('span.qa-hint', 'loading your log…'));
      return;
    }
    const p = r.parsed;
    const type = ctx.type(p.type);
    const rel = fmtRelative(p.d, ctx.today);
    mount(prev,
      h('span.qa-tok.qa-mode', { class: r.mode === 'plan' ? 'is-plan' : '' }, r.mode === 'plan' ? 'PLAN' : 'LOG'),
      h('span.qa-tok.qa-cat', { style: typeStyle(type) }, type.name.toUpperCase()),
      h('span.qa-title', p.title),
      chip(`${fmtDay(p.d).toUpperCase()}${rel === 'today' || rel === 'yesterday' ? ` · ${rel.toUpperCase()}` : ''}`, r.mode === 'log' && p.d > ctx.today ? 'is-warn' : ''),
      p.min ? chip(fmtMin(p.min).toUpperCase()) : null,
      ...p.items.map((it) => chip(`${it.isNew ? 'NEW ' : ''}${(ctx.state.exercises?.[it.ex]?.name ?? it.name).toUpperCase()}${fmtItem(it, ctx.state.settings) ? ` ${fmtItem(it, ctx.state.settings)}` : ''}`, it.isNew ? 'is-new' : '')),
      p.unknown.length ? chip(`?? ${p.unknown.join(', ')}`, 'is-warn') : null,
    );
  }

  async function submit() {
    if (busy) return;
    const r = readTerminal(input.value, ctx, mode);
    if (!r) {
      term.classList.remove('is-nudge');
      void term.offsetWidth;
      term.classList.add('is-nudge');
      return;
    }
    const p = r.parsed;
    busy = true;
    term.classList.add('is-busy');
    let res;
    if (r.mode === 'plan') {
      res = await ctx.act('planWorkout', p, { toast: `Planned: ${p.title} → ${fmtDay(p.d)}` });
    } else {
      res = await ctx.act('logWorkout', p, {
        toast: (x) => `Logged: ${p.title} · ${fmtDay(p.d)}${x.prs?.length ? ` · ★ ${x.prs.length} PR` : ''}`,
        undo: (x) => ctx.act('deleteWorkout', { id: x.id }, { toast: 'Removed.', kind: 'info' }),
      });
      if (res?.writes?.length) {
        ctx.fx.burst(term, 'var(--acid)');
        ctx.fx.stamp(term, res.prs?.length ? 'PR!' : 'LOGGED');
      }
    }
    busy = false;
    term.classList.remove('is-busy');
    if (res?.writes?.length) {
      input.value = '';
      term.classList.remove('is-added');
      void term.offsetWidth;
      term.classList.add('is-added');
      preview();
    }
  }

  function nextCard() {
    const tv = ctx.vm.today;
    const done = tv.workouts;
    if (done.length) {
      const prs = done.flatMap((w) => ctx.vm.prs.get(w.id) ?? []);
      return h('button.nx.is-done', { type: 'button', onclick: () => ctx.openWorkout(done[done.length - 1].id) },
        h('span.nx-label', 'TODAY · LOGGED'),
        h('span.nx-big.shout', done.map((w) => w.title).join(' + ')),
        h('span.nx-sub', prs.length ? `★ ${fmtPR(prs[0], ctx.state.settings)}` : `${done.reduce((a, w) => a + w.items.length, 0)} exercises${done[0].min ? ` · ${fmtMin(done[0].min)}` : ''}`),
      );
    }
    const plan = tv.planned[0];
    if (plan) {
      return h('div.nx.is-plan', { style: typeStyle(ctx.type(plan.type)) },
        h('span.nx-label', 'ON THE PLAN TODAY'),
        h('button.nx-big.shout', { type: 'button', onclick: () => ctx.openPlan(plan.id) }, plan.title),
        h('div.nx-btns',
          h('button.btn.btn-acid', {
            type: 'button',
            onclick: (e) => {
              const card = e.currentTarget.closest('.nx');
              ctx.act('completePlan', { id: plan.id }, { toast: (x) => `Logged ${plan.title}${x.prs?.length ? ` · ★ ${x.prs.length} PR` : ''}. Tap it to fill in the numbers.` }).then((x) => {
                if (x?.writes?.length) {
                  ctx.fx.stamp(card, 'DONE');
                  ctx.openWorkout(x.id);
                }
              });
            },
          }, icon('check'), 'Did it'),
          h('button.btn', { type: 'button', onclick: () => ctx.openPlan(plan.id) }, 'Details'),
        ),
      );
    }
    const n = tv.next;
    return h('div.nx',
      h('span.nx-label', n ? 'NEXT UP' : 'REST DAY'),
      h('span.nx-big.shout', n ? n.title : 'Nothing planned'),
      h('span.nx-sub', n ? `${fmtDay(n.d)} · ${fmtRelative(n.d, ctx.today)}` : 'Plan one: type "plan pull day wed"'),
      n ? h('button.btn.btn-sm', { type: 'button', onclick: () => ctx.openPlan(n.id) }, 'Open') : h('button.btn.btn-sm', { type: 'button', onclick: () => setMode('plan') }, icon('plus'), 'Plan'),
    );
  }

  function vital(label, num, unit, sub, cls = '', meter = null) {
    return h('div.vital', { class: cls },
      h('span.label', label),
      h('div.vital-val', h('span.vital-num.shout', num), unit ? h('span.vital-unit', unit) : null),
      meter,
      sub ? h('span.vital-sub', sub) : null,
    );
  }

  function renderVitals() {
    const w = ctx.vm.week;
    const st = ctx.vm.streak;
    const target = ctx.state.settings?.target;
    const lastWeek = ctx.vm.weeks[ctx.vm.weeks.length - 2];
    const pct = target ? Math.min(100, Math.round((w.sessions / target) * 100)) : null;
    const lastLog = ctx.vm.log[0]?.workout;
    mount(vitals,
      vital('THIS WEEK', target ? h('span', h('b', String(w.sessions)), h('span.vital-of', '/'), String(target)) : String(w.sessions), w.sessions === 1 && !target ? 'workout' : 'workouts',
        lastWeek ? `last week ${lastWeek.sessions}` : null, w.sessions ? 'is-acid' : '',
        pct != null ? h('div.meter', { class: pct >= 100 ? '' : 'is-cyan', role: 'img', 'aria-label': `${pct}% of weekly target` }, h('i', { style: { width: `${pct}%` } })) : null),
      vital('VOLUME', kfmt(w.volume), ctx.state.settings?.unit ?? 'lb', lastWeek ? `last week ${kfmt(lastWeek.volume)}` : null, w.volume ? '' : 'is-dim'),
      vital('CARDIO', w.dist ? String(w.dist) : '0', ctx.state.settings?.dist ?? 'mi', w.minutes ? `${w.minutes} min total` : null),
      vital('STREAK', String(st.days.current), st.days.current === 1 ? 'day' : 'days', `${st.weeks.current} wk · best ${st.days.best}d`, st.days.current ? 'is-acid' : ''),
      vital('PRS', String(w.prs), 'this wk', lastLog ? `last: ${fmtDay(lastLog.d)} (${diffDays(lastLog.d, ctx.today) === 0 ? 'today' : `${diffDays(lastLog.d, ctx.today)}d`})` : 'nothing logged yet', w.prs ? 'is-hot' : ''),
    );
  }

  function update(c) {
    ctx = c;
    const st = SYNC[c.store.status?.kind] ?? SYNC.loading;
    syncLabel.textContent = st[0];
    sync.className = `hdr-sync tone-${st[1]}${st[2] ? ' is-blink' : ''}`;
    sync.title = c.store.status?.message || 'Refresh from GitHub';
    connect.hidden = c.store.mode !== 'readonly' && c.hasToken;
    modeTag.textContent = c.store.mode === 'local' ? 'PREVIEW' : c.store.mode === 'readonly' ? 'READ-ONLY' : '';
    modeTag.className = `hdr-mode${c.store.mode === 'local' ? ' is-local' : c.store.mode === 'readonly' ? ' is-readonly' : ''}`;
    el.classList.toggle('is-loading', !c.loaded);
    mount(next, nextCard());
    renderVitals();
    tick(c);
    if (document.activeElement !== input) preview();
  }

  function tick(c) {
    const now = new Date().toISOString();
    dateEl.textContent = fmtDay(c.today).toUpperCase().replace('/', '.');
    time.textContent = `${localTimeOf(now, c.tz)} ET`;
  }

  document.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return;
    if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault();
      input.focus();
    }
  });

  setMode('log', false);
  return { update, tick, setMode, input };
}
