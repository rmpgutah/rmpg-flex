import { describe, it, expect, beforeEach } from 'vitest';
import { registerRule, findRules, __clearRulesForTest } from '../dispatcherRules/registry';
import type { BrainContext } from '../dispatcherRules/types';

const emptyCtx: BrainContext = { transcript: [] };

describe('dispatcherRules registry', () => {
  beforeEach(() => __clearRulesForTest());

  it('returns rules matching an event type', () => {
    registerRule({
      id: 'test-rule',
      trigger: 'event',
      eventTypes: ['call_created'],
      match: () => true,
      severity: 'minor',
      cooldownMs: 0,
      compose: () => 'hi',
    });
    const hits = findRules({ kind: 'event', type: 'call_created', ctx: emptyCtx });
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('test-rule');
  });

  it('filters out rules whose eventTypes does not include the envelope type', () => {
    registerRule({
      id: 'listens-for-something-else',
      trigger: 'event',
      eventTypes: ['citation_created'],
      match: () => true,
      severity: 'minor',
      cooldownMs: 0,
      compose: () => 'ignore me',
    });
    const hits = findRules({ kind: 'event', type: 'call_created', ctx: emptyCtx });
    expect(hits).toHaveLength(0);
  });

  it('respects the match() predicate', () => {
    registerRule({
      id: 'needs-a-call',
      trigger: 'event',
      eventTypes: ['call_created'],
      match: (ctx) => !!ctx.event?.payload?.call_number,
      severity: 'minor',
      cooldownMs: 0,
      compose: () => '',
    });
    expect(findRules({ kind: 'event', type: 'call_created', ctx: emptyCtx })).toHaveLength(0);

    const withPayload: BrainContext = {
      ...emptyCtx,
      event: { type: 'call_created', payload: { call_number: 'CN-1' } },
    };
    expect(findRules({ kind: 'event', type: 'call_created', ctx: withPayload })).toHaveLength(1);
  });

  it('timer rules are not returned for event triggers', () => {
    registerRule({
      id: 'tick',
      trigger: 'timer',
      match: () => true,
      severity: 'minor',
      cooldownMs: 0,
      compose: () => 'tick',
    });
    expect(findRules({ kind: 'event', type: 'anything', ctx: emptyCtx })).toHaveLength(0);
    expect(findRules({ kind: 'timer', ctx: emptyCtx })).toHaveLength(1);
  });

  it('a rule WITHOUT eventTypes matches any event of the right trigger kind', () => {
    registerRule({
      id: 'catch-all-events',
      trigger: 'event',
      match: () => true,
      severity: 'minor',
      cooldownMs: 0,
      compose: () => '*',
    });
    expect(findRules({ kind: 'event', type: 'call_created',     ctx: emptyCtx })).toHaveLength(1);
    expect(findRules({ kind: 'event', type: 'citation_created', ctx: emptyCtx })).toHaveLength(1);
  });
});
