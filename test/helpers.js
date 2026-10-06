// Shared fixtures: a seeded state and a fixed clock.
import { emptyState } from '../src/engine/model.js';
import { OPS } from '../src/engine/ops.js';

export const TODAY = '2026-10-05';
export const ctx = (over = {}) => ({ now: `${over.today ?? TODAY}T22:00:00.000Z`, today: TODAY, src: 'chat', ...over });

export function seeded() {
  return OPS.seedDefaults(emptyState(), {}, ctx()).state;
}

/** Run ops in order: [[name, args, ctxOverrides?]…] → final state. */
export function run(state, steps) {
  let s = state;
  const results = [];
  for (const [name, args, over] of steps) {
    const res = OPS[name](s, args, ctx(over));
    s = res.state;
    results.push(res);
  }
  return { state: s, results };
}
