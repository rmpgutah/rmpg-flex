import { describe, it, expect, vi, beforeEach } from 'vitest';

const enqueue = vi.fn();
vi.mock('../speakQueue', () => ({
  enqueueSpeech: (...args: any[]) => enqueue(...args),
}));

import {
  handleDispatchEvent,
  getBrainContext,
  __resetBrainForTest,
} from '../dispatcherBrain';
import { registerRule, __clearRulesForTest } from '../dispatcherRules/registry';

describe('dispatcherBrain', () => {
  beforeEach(() => {
    enqueue.mockClear();
    __resetBrainForTest();
    __clearRulesForTest();
  });

  it('ignores events when brain is disabled (default)', () => {
    registerRule({
      id: 't', trigger: 'event', eventTypes: ['x'],
      match: () => true, severity: 'minor', cooldownMs: 0,
      compose: () => 'hi',
    });
    handleDispatchEvent('x', {});
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('fires a matching rule when the flag is set', () => {
    localStorage.setItem('rmpg-voice-brain-enabled', '1');
    registerRule({
      id: 't', trigger: 'event', eventTypes: ['x'],
      match: () => true, severity: 'minor', cooldownMs: 0,
      compose: () => 'hi',
    });
    handleDispatchEvent('x', {});
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      text: 'hi',
      severity: 'minor',
      ruleId: 't',
      entityKey: 'global',
    });
  });

  it('uses rule.entityKey(ctx) for dedup when provided', () => {
    localStorage.setItem('rmpg-voice-brain-enabled', '1');
    registerRule({
      id: 'citation', trigger: 'event', eventTypes: ['citation_created'],
      match: () => true, severity: 'minor', cooldownMs: 0,
      entityKey: (ctx) => String(ctx.event?.payload?.id ?? 'global'),
      compose: () => 'c',
    });
    handleDispatchEvent('citation_created', { id: 'RN-1' });
    expect(enqueue.mock.calls[0][0].entityKey).toBe('RN-1');
  });

  it('absorbs call_number and unit_call_sign into context', () => {
    localStorage.setItem('rmpg-voice-brain-enabled', '1');
    handleDispatchEvent('call_created', {
      id: 42,
      call_number: 'CN-26-0500',
      location_address: '123 Main',
      incident_type: 'domestic',
      unit_call_sign: '3-Adam',
    });
    const ctx = getBrainContext();
    expect(ctx.lastCall?.call_number).toBe('CN-26-0500');
    expect(ctx.lastCall?.location).toBe('123 Main');
    expect(ctx.lastUnit?.call_sign).toBe('3-Adam');
  });

  it('clears ctx.event after matching so timers do not see stale event data', () => {
    localStorage.setItem('rmpg-voice-brain-enabled', '1');
    registerRule({
      id: 't', trigger: 'event', eventTypes: ['x'],
      match: () => true, severity: 'minor', cooldownMs: 0,
      compose: () => 'hi',
    });
    handleDispatchEvent('x', { some: 'payload' });
    expect(getBrainContext().event).toBeUndefined();
  });

  it('skips rules that do not match', () => {
    localStorage.setItem('rmpg-voice-brain-enabled', '1');
    registerRule({
      id: 'picky', trigger: 'event', eventTypes: ['x'],
      match: (ctx) => !!ctx.event?.payload?.needed,
      severity: 'minor', cooldownMs: 0,
      compose: () => 'nope',
    });
    handleDispatchEvent('x', {});
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('skips rules whose compose returns empty string', () => {
    localStorage.setItem('rmpg-voice-brain-enabled', '1');
    registerRule({
      id: 'empty', trigger: 'event', eventTypes: ['x'],
      match: () => true, severity: 'minor', cooldownMs: 0,
      compose: () => '',
    });
    handleDispatchEvent('x', {});
    expect(enqueue).not.toHaveBeenCalled();
  });
});
