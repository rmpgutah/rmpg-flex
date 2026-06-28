// ============================================================
// Dispatcher Rule Registry
//
// Module-level mutable array — `registerRules(...)` is called once
// at app boot (from WebSocketContext) with the bundled rule catalog.
// `findRules(envelope)` returns every rule matching the given
// trigger. The brain then asks each matching rule to compose text
// and funnels them through speakQueue.
// ============================================================

import type { DispatcherRule, TriggerEnvelope } from './types';

const rules: DispatcherRule[] = [];

export function registerRule(r: DispatcherRule): void {
  rules.push(r);
}

export function registerRules(rs: DispatcherRule[]): void {
  rules.push(...rs);
}

/** Test-only: clear the registry between tests. */
export function __clearRulesForTest(): void {
  rules.length = 0;
}

export function findRules(env: TriggerEnvelope): DispatcherRule[] {
  return rules.filter((r) => {
    if (r.trigger !== env.kind) return false;
    if (env.kind === 'event' && r.eventTypes && !r.eventTypes.includes(env.type)) {
      return false;
    }
    return r.match(env.ctx);
  });
}
