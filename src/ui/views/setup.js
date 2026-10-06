// Setup: connect GitHub (token + repo), preferences, workout types, exercises, about.
import { h } from '../dom.js';
import { EX_KINDS, TYPE_KINDS } from '../../engine/model.js';
import { ic, keepFocus, draftGet, draftSet, draftClear, editField, agoLabel, typeMark, typeStyle } from './common.js';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

const STATUS_TONE = { synced: 'good', saving: 'busy', loading: 'busy', pending: 'warn', offline: 'bad', error: 'bad', conflict: 'bad', readonly: 'idle' };
const STATUS_WORD = { synced: 'SYNCED', saving: 'SAVING…', loading: 'LOADING…', pending: 'PENDING', offline: 'OFFLINE', error: 'ERROR', conflict: 'CONFLICT', readonly: 'READ-ONLY' };

/** Prefilled fine-grained token form. */
export function tokenUrl(config = {}) {
  const q = new URLSearchParams({
    name: 'Workout Console',
    description: `Workout Console website: read + write ${config.path || 'data/state.json'} in ${config.repo || 'exc-dashboard'}`,
    expires_in: '365',
    contents: 'write',
  });
  if (config.owner) q.set('target_name', config.owner);
  return `${TOKEN_URL}?${q.toString()}`;
}

export function tokenWarning(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return 'Paste a token first.';
  if (/\s/.test(t)) return 'That has spaces in it. Copy the token again.';
  if (t.startsWith('github_pat_')) return null;
  if (/^gh[pousr]_/.test(t)) return 'That looks like a classic token. It works, but a fine-grained one limited to this repo is safer.';
  return "That doesn't look like a GitHub token (they start with github_pat_). Saving anyway.";
}

function section(id, title, sub, body, { tone = '', right = null } = {}) {
  return h('section.panel.setup-sec', { id, class: tone ? `is-${tone}` : '', 'aria-labelledby': `${id}-h` },
    h('header.panel-head',
      h('div.setup-sec-title', h('h2', { id: `${id}-h` }, h('span.slash', '//'), title), sub ? h('p.setup-sub', sub) : null),
      right,
    ),
    h('div.panel-body', body),
  );
}

export function renderSetup(ctx) {
  const restore = keepFocus();
  const canWrite = !!ctx?.store?.canWrite;
  const root = h('div.setup',
    h('div.setup-hero',
      h('p.label.is-bracket', 'system config'),
      h('h1.setup-title.glitch', { 'data-text': 'SETUP' }, 'SETUP'),
      h('p.setup-lede', 'Wire the log to GitHub, set units and a weekly goal, tune your splits and exercises.'),
    ),
    h('div.setup-grid',
      githubSection(ctx),
      h('div.setup-col', prefsSection(ctx, canWrite), aboutSection(ctx)),
      typesSection(ctx, canWrite),
      exercisesSection(ctx, canWrite),
    ),
  );
  restore(root);
  return root;
}

function statusCard(ctx) {
  const st = ctx?.store?.status ?? {};
  const kind = typeof st.kind === 'string' ? st.kind : 'loading';
  const mode = ctx?.store?.mode ?? 'readonly';
  const modeLine = mode === 'github' ? 'GITHUB · READ + WRITE' : mode === 'local' ? 'LOCAL PREVIEW · THIS BROWSER ONLY' : 'READ-ONLY · NO TOKEN';
  const at = st.at && ctx?.now ? agoLabel(st.at, ctx.now) : '';
  return h('div.setup-status', { class: `is-${STATUS_TONE[kind] ?? 'idle'}`, role: 'status' },
    h('span.setup-led', { 'aria-hidden': 'true' }),
    h('div.setup-status-main',
      h('div.setup-status-kind', STATUS_WORD[kind] ?? kind.toUpperCase(), h('span.setup-status-mode', modeLine)),
      h('p.setup-status-msg', st.message || (mode === 'readonly' ? 'Viewing only. Add a token below to save changes.' : '')),
      at ? h('p.setup-status-at', `last update ${at}`) : null,
    ),
    h('button.btn.btn-sm', { type: 'button', onclick: () => { ctx?.store?.refresh?.(); ctx?.toast?.('Pulling the latest…', { kind: 'info', ms: 1800 }); } }, ic(ctx, 'refresh'), 'Refresh'),
  );
}

function githubSection(ctx) {
  const cfg = { owner: '', repo: '', branch: '', path: '', ...(ctx?.config ?? {}) };
  const repoName = cfg.repo || 'exc-dashboard';
  const hasToken = !!ctx?.hasToken;
  const steps = [
    ['Open GitHub’s token page', h('span', ' ', h('a', { href: tokenUrl(cfg), target: '_blank', rel: 'noopener noreferrer' }, 'this link', ic(ctx, 'external')), ' opens a fine-grained token form with the name, expiry and Contents: Read and write filled in.')],
    ['Repository access', h('span', ' ', h('b', 'Only select repositories'), ' → pick ', h('code', repoName), '. Not your EF Console repo: one token per site.')],
    ['Permissions', h('span', ' Check ', h('b', 'Contents: Read and write'), ' is listed (Metadata: Read-only comes with it).')],
    ['Generate + paste', h('span', ' Hit ', h('b', 'Generate token'), ', copy the ', h('code', 'github_pat_…'), ' string, paste it below, Save. Once per device.')],
  ];
  const tokenId = 'setup-token';
  const tokenForm = h('form.setup-token', {
    autocomplete: 'off',
    onsubmit: (e) => {
      e.preventDefault();
      const input = e.currentTarget.querySelector(`#${tokenId}`);
      const val = String(input?.value ?? '').trim();
      const warn = tokenWarning(val);
      if (!val) {
        ctx?.toast?.(warn, { kind: 'error' });
        return;
      }
      if (input) input.value = '';
      draftClear(ctx, 'token');
      ctx?.setToken?.(val);
      ctx?.toast?.(warn ? `Token saved. ${warn}` : 'Token saved in this browser. Connecting…', { kind: warn ? 'info' : 'good', ms: warn ? 7000 : 3500 });
    },
  },
    h('label.field-row', { for: tokenId }, h('span.label', hasToken ? 'Replace token' : 'Fine-grained token')),
    h('div.setup-inline',
      h('span.setup-prompt', { 'aria-hidden': 'true' }, '>'),
      h(`input.field.setup-token-input#${tokenId}`, {
        type: 'password', name: 'wk-token',
        placeholder: hasToken ? '•••••••• saved · paste a new one to replace' : 'github_pat_…',
        value: draftGet(ctx, 'token', ''),
        oninput: (e) => draftSet(ctx, 'token', e.currentTarget.value),
        autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      }),
      h('button.btn', { type: 'button', 'aria-label': 'Show or hide the token', onclick: (e) => { const i = e.currentTarget.parentElement?.querySelector('input'); if (i) i.type = i.type === 'password' ? 'text' : 'password'; } }, ic(ctx, 'eye')),
      h('button.btn.btn-hot', { type: 'submit' }, ic(ctx, 'key'), 'Save token'),
    ),
    h('p.setup-note',
      hasToken ? h('b.setup-ok', 'TOKEN SAVED IN THIS BROWSER. ') : null,
      'Kept in this browser’s localStorage only: never committed, never sent anywhere but api.github.com. Your other github.io sites share this storage, so give it this one repo only.',
      hasToken ? h('button.btn.btn-sm.setup-forget', { type: 'button', onclick: () => { ctx?.clearToken?.(); ctx?.toast?.('Token forgotten. Read-only now.', { kind: 'info' }); } }, ic(ctx, 'x'), 'Forget token') : null,
    ),
  );
  const fields = [['owner', 'Owner', 'dzweben'], ['repo', 'Repo', 'exc-dashboard'], ['branch', 'Branch', 'default branch'], ['path', 'Path', 'data/state.json']];
  const cfgForm = h('form.setup-config', {
    onsubmit: (e) => {
      e.preventDefault();
      const next = {};
      for (const [k] of fields) next[k] = String(draftGet(ctx, `cfg.${k}`, cfg[k] ?? '')).trim();
      if (!next.owner || !next.repo || !next.path) return ctx?.toast?.('Owner, repo and path are required.', { kind: 'error' });
      next.path = next.path.replace(/^\/+/, '');
      draftClear(ctx, ...fields.map(([k]) => `cfg.${k}`));
      ctx?.saveConfig?.(next);
      ctx?.toast?.(`Pointing at ${next.owner}/${next.repo}:${next.path}`, { kind: 'good' });
    },
  },
    h('div.setup-cfg-grid', fields.map(([k, label, ph]) => h('label.field-row', { for: `setup-cfg-${k}` }, h('span.label', label),
      h(`input.field#setup-cfg-${k}`, { value: draftGet(ctx, `cfg.${k}`, cfg[k] ?? ''), placeholder: ph, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', oninput: (e) => draftSet(ctx, `cfg.${k}`, e.currentTarget.value) })))),
    h('div.setup-actions', h('button.btn', { type: 'submit' }, 'Save repo settings')),
  );
  return section('setup-github', 'Connect GitHub',
    'The site saves to data/state.json in your repo. Every burst of taps becomes one commit under your name; Claude reads the same file.',
    [
      statusCard(ctx),
      h('ol.setup-steps', steps.map(([t, body], i) => h('li.setup-step', h('span.setup-step-n', { 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')), h('p', h('b.setup-step-t', t + '.'), body)))),
      tokenForm,
      h('details.setup-adv', h('summary', h('span.label', 'saving to'), h('code.setup-target', `${cfg.owner || 'dzweben'}/${repoName} @ ${cfg.branch || 'default branch'} : ${cfg.path || 'data/state.json'}`), h('span.setup-edit', 'edit')), cfgForm),
    ],
    { tone: 'pink', right: h('span.setup-badge', { class: hasToken ? 'is-on' : '' }, ic(ctx, hasToken ? 'unlock' : 'lock'), hasToken ? 'TOKEN SET' : 'NO TOKEN') },
  );
}

const roNote = (ctx, canWrite) => (canWrite ? null : h('p.setup-ro', ic(ctx, 'lock'), 'Read-only: connect GitHub above to edit.'));

function prefsSection(ctx, canWrite) {
  const st = ctx.state.settings ?? {};
  const set = (patch, toast) => ctx.act('editSettings', { patch }, { toast: toast ?? 'Saved.' });
  const seg = (label, key, options) => h('div.dr-field', h('span.label', label),
    h('div.seg', options.map(([v, text]) => h('button.seg-btn', { type: 'button', disabled: !canWrite, 'aria-pressed': String(st[key] === v), onclick: () => set({ [key]: v }) }, text))));
  return section('setup-prefs', 'Preferences', null, [
    roNote(ctx, canWrite),
    seg('Weight unit', 'unit', [['lb', 'lb'], ['kg', 'kg']]),
    seg('Distance unit', 'dist', [['mi', 'miles'], ['km', 'km']]),
    h('label.dr-field.field-row', { for: 'pref-target' }, h('span.label', 'Weekly goal (workouts), blank = none'),
      h('input.field#pref-target', { inputmode: 'numeric', disabled: !canWrite, placeholder: 'none', ...editField(ctx, 'pref.target', st.target ?? '', (v) => set({ target: v.trim() ? Number(v) : null }, v.trim() ? `Goal: ${v} a week` : 'No weekly goal')) })),
    h('div.dr-field', h('span.label', 'Reminders from Claude'),
      h('div.seg',
        h('button.seg-btn', { type: 'button', disabled: !canWrite, 'aria-pressed': String(!st.reminders), onclick: () => set({ reminders: false }, 'No reminders.') }, 'Off: just keep the record'),
        h('button.seg-btn', { type: 'button', disabled: !canWrite, 'aria-pressed': String(!!st.reminders), onclick: () => set({ reminders: true }, 'Claude will mention planned workouts.') }, 'On: mention the plan'),
      )),
  ]);
}

function typesSection(ctx, canWrite) {
  const types = Object.values(ctx.state.types ?? {}).sort((a, b) => a.order - b.order);
  const row = (t) => h('div.setup-row', { style: typeStyle(t) },
    typeMark(t),
    h('input.field.setup-color', { type: 'color', value: t.color, disabled: !canWrite, 'aria-label': `${t.name} color`, onchange: (e) => ctx.act('editType', { id: t.id, patch: { color: e.currentTarget.value } }) }),
    h(`input.field#type-name-${t.id}`, { disabled: !canWrite, 'aria-label': 'Name', ...editField(ctx, `type.name.${t.id}`, t.name, (v) => v.trim() && ctx.act('editType', { id: t.id, patch: { name: v.trim() } }, { toast: 'Renamed.' })) }),
    h(`select.field#type-kind-${t.id}`, { disabled: !canWrite, 'aria-label': 'Kind', onchange: (e) => ctx.act('editType', { id: t.id, patch: { kind: e.currentTarget.value } }) }, TYPE_KINDS.map((k) => h('option', { value: k, selected: k === t.kind }, k))),
    h(`input.field.setup-aliases#type-al-${t.id}`, { disabled: !canWrite, 'aria-label': 'Words that mean this type', placeholder: 'words that mean this', ...editField(ctx, `type.al.${t.id}`, t.aliases.join(', '), (v) => ctx.act('editType', { id: t.id, patch: { aliases: v.split(',') } }, { toast: 'Saved.' })) }),
    h('button.btn.btn-sm.btn-ghost', { type: 'button', disabled: !canWrite, onclick: () => ctx.act('editType', { id: t.id, patch: { archived: !t.archived } }) }, t.archived ? 'Unhide' : 'Hide'),
  );
  return section('setup-types', 'Workout types', 'Your splits and kinds of sessions. The words column is what Claude and the terminal listen for ("leg day", "yoga").', [
    roNote(ctx, canWrite),
    h('div.setup-rows', types.map(row)),
    h('form.dr-inline', {
      onsubmit: (e) => {
        e.preventDefault();
        const name = String(draftGet(ctx, 'type.new', '')).trim();
        if (!name) return;
        draftClear(ctx, 'type.new');
        ctx.act('addType', { name, kind: 'lift', aliases: [name.toLowerCase()] }, { toast: `Added ${name}` });
      },
    }, h('input.field#type-new', { placeholder: 'new type: Glutes, Climbing…', disabled: !canWrite, value: draftGet(ctx, 'type.new', ''), oninput: (e) => draftSet(ctx, 'type.new', e.currentTarget.value) }), h('button.btn', { type: 'submit', disabled: !canWrite }, ic(ctx, 'plus'), 'Add')),
  ]);
}

function exercisesSection(ctx, canWrite) {
  const show = draftGet(ctx, 'ex.showAll', false) === true;
  const used = new Set(Object.values(ctx.state.workouts ?? {}).flatMap((w) => w.items.map((i) => i.ex)));
  const all = Object.values(ctx.state.exercises ?? {}).sort((a, b) => (used.has(b.id) - used.has(a.id)) || a.name.localeCompare(b.name));
  const list = show ? all : all.filter((e) => used.has(e.id) || !e.created.startsWith('2026-10-05T00:00'));
  const types = Object.values(ctx.state.types ?? {}).sort((a, b) => a.order - b.order);
  const row = (x) => h('div.setup-row.ex-set-row',
    h(`input.field#ex-name-${x.id}`, { disabled: !canWrite, 'aria-label': 'Name', ...editField(ctx, `ex.name.${x.id}`, x.name, (v) => v.trim() && ctx.act('editExercise', { id: x.id, patch: { name: v.trim() } }, { toast: 'Renamed.' })) }),
    h(`select.field#ex-kind-${x.id}`, { disabled: !canWrite, 'aria-label': 'Kind', onchange: (e) => ctx.act('editExercise', { id: x.id, patch: { kind: e.currentTarget.value } }) }, EX_KINDS.map((k) => h('option', { value: k, selected: k === x.kind }, { lift: 'weights', bw: 'bodyweight', cardio: 'cardio', time: 'timed' }[k]))),
    h(`select.field#ex-type-${x.id}`, { disabled: !canWrite, 'aria-label': 'Usual type', onchange: (e) => ctx.act('editExercise', { id: x.id, patch: { type: e.currentTarget.value || null } }) }, h('option', { value: '', selected: !x.type }, '—'), types.map((t) => h('option', { value: t.id, selected: t.id === x.type }, t.name))),
    h(`input.field.setup-aliases#ex-al-${x.id}`, { disabled: !canWrite, 'aria-label': 'Other names', placeholder: 'other names', ...editField(ctx, `ex.al.${x.id}`, x.aliases.join(', '), (v) => ctx.act('editExercise', { id: x.id, patch: { aliases: v.split(',') } }, { toast: 'Saved.' })) }),
  );
  return section('setup-ex', 'Exercises', 'Names, how they are measured, and the other names you use for them. New ones get created when you log them.', [
    roNote(ctx, canWrite),
    list.length ? h('div.setup-rows', list.map(row)) : h('p.dr-hint', 'Only exercises you have logged show here.'),
    h('button.btn.btn-sm', { type: 'button', onclick: () => { draftSet(ctx, 'ex.showAll', !show); ctx.rerender(); } }, show ? 'Show only mine' : `Show all ${all.length} (starter list too)`),
  ]);
}

function aboutSection(ctx) {
  const cfg = ctx?.config ?? {};
  const base = `https://github.com/${encodeURIComponent(cfg.owner || 'dzweben')}/${encodeURIComponent(cfg.repo || 'exc-dashboard')}`;
  const st = ctx?.state ?? {};
  const count = (k) => Object.keys(st[k] ?? {}).length;
  const stat = (n, label) => h('div.setup-stat', h('b.shout', String(n)), h('span.label', label));
  return section('setup-about', 'About', null, [
    h('div.setup-stats', stat(count('workouts'), 'workouts'), stat(count('plans'), 'plans'), stat(count('exercises'), 'exercises'), stat(count('body'), 'weigh-ins')),
    h('ul.setup-about-list',
      h('li', h('span.label', 'claude synced'), h('span', st.sync?.lastClaudeSync && ctx?.now ? agoLabel(st.sync.lastClaudeSync, ctx.now) : 'not yet')),
      h('li', h('span.label', 'timezone'), h('span', ctx?.tz || 'America/New_York')),
    ),
    h('div.setup-actions',
      h('a.btn', { href: base, target: '_blank', rel: 'noopener noreferrer' }, ic(ctx, 'github'), 'Repo'),
      h('a.btn', { href: `${base}/commits/HEAD/data/state.json`, target: '_blank', rel: 'noopener noreferrer' }, ic(ctx, 'clock'), 'History'),
    ),
  ]);
}
