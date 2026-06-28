import { describe, it, expect } from 'vitest';
import { COACHING_RULES } from '../dispatcherRules/coaching';
import type { BrainContext, DispatcherRule } from '../dispatcherRules/types';

function findRule(id: string): DispatcherRule {
  const r = COACHING_RULES.find((rule) => rule.id === id);
  if (!r) throw new Error(`Rule ${id} not found`);
  return r;
}

function ctxForCall(type: string, call: any): BrainContext {
  return { transcript: [], event: { type, payload: { call } } };
}

describe('coaching rules', () => {
  it('exports 5 rules', () => {
    expect(COACHING_RULES).toHaveLength(5);
  });

  describe('dv-approach-warning', () => {
    const rule = findRule('dv-approach-warning');
    it('matches call_created with domestic_violence flag', () => {
      const ctx = ctxForCall('call_created', { call_number: 'CN-1', domestic_violence: 1 });
      expect(rule.match(ctx)).toBe(true);
      expect(rule.compose(ctx)).toContain('domestic');
      expect(rule.compose(ctx).toLowerCase()).toContain('caution');
    });
    it('does not match calls without DV flag', () => {
      const ctx = ctxForCall('call_created', { call_number: 'CN-2', domestic_violence: 0 });
      expect(rule.match(ctx)).toBe(false);
    });
    it('entityKey = call_number (cooldown keyed per call)', () => {
      const ctx = ctxForCall('call_created', { call_number: 'CN-9', domestic_violence: 1 });
      expect(rule.entityKey!(ctx)).toBe('CN-9');
    });
  });

  describe('felony-backup-suggest', () => {
    const rule = findRule('felony-backup-suggest');
    it('matches felony_in_progress with fewer than 2 units assigned', () => {
      const ctx = ctxForCall('call_created', {
        call_number: 'CN-F1', felony_in_progress: 1, assigned_units: ['3-Adam'],
      });
      expect(rule.match(ctx)).toBe(true);
      expect(rule.compose(ctx)).toContain('second unit');
    });
    it('does NOT match when 2+ units already assigned', () => {
      const ctx = ctxForCall('call_created', {
        call_number: 'CN-F2', felony_in_progress: 1, assigned_units: ['3-Adam', '3-Bravo'],
      });
      expect(rule.match(ctx)).toBe(false);
    });
    it('handles JSON-string assigned_units (legacy shape)', () => {
      const ctx = ctxForCall('call_created', {
        call_number: 'CN-F3', felony_in_progress: 1, assigned_units: JSON.stringify(['3-Adam']),
      });
      expect(rule.match(ctx)).toBe(true);
    });
  });

  describe('mental-health-protocol', () => {
    const rule = findRule('mental-health-protocol');
    it('matches mental_health_crisis flag', () => {
      const ctx = ctxForCall('call_created', { call_number: 'CN-MH', mental_health_crisis: 1 });
      expect(rule.match(ctx)).toBe(true);
      const spoken = rule.compose(ctx);
      expect(spoken.toLowerCase()).toContain('mental health');
      expect(spoken).toContain('CIT');
    });
  });

  describe('geofence-breach', () => {
    const rule = findRule('geofence-breach');
    it('matches event with call_sign; compose names the unit + beat', () => {
      const ctx: BrainContext = {
        transcript: [],
        event: { type: 'unit_outside_beat', payload: { call_sign: '3-Adam', beat: 'Delta-2' } },
      };
      expect(rule.match(ctx)).toBe(true);
      expect(rule.compose(ctx)).toContain('3-Adam');
      expect(rule.compose(ctx)).toContain('Delta-2');
    });
  });

  describe('overdue-status-check (timer rule)', () => {
    const rule = findRule('overdue-status-check');
    it('is a timer-triggered rule', () => {
      expect(rule.trigger).toBe('timer');
    });
    it('fires when on-scene for 8+ minutes', () => {
      const ctx: BrainContext = {
        transcript: [],
        currentUserCallSign: '3-Adam',
        currentUserOnSceneAt: Date.now() - 9 * 60_000,
      };
      expect(rule.match(ctx)).toBe(true);
      const spoken = rule.compose(ctx);
      expect(spoken).toContain('3-Adam');
      expect(spoken).toContain('status check');
    });
    it('does NOT fire before 8 minutes', () => {
      const ctx: BrainContext = {
        transcript: [],
        currentUserCallSign: '3-Adam',
        currentUserOnSceneAt: Date.now() - 3 * 60_000,
      };
      expect(rule.match(ctx)).toBe(false);
    });
    it('does NOT fire when no currentUserOnSceneAt', () => {
      const ctx: BrainContext = { transcript: [], currentUserCallSign: '3-Adam' };
      expect(rule.match(ctx)).toBe(false);
    });
  });
});
