import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateServerRules, type AutomationRule } from '../src/utils/automationEngine';
import type { IncomingFix } from '../src/utils/tripTelemetry';

// Minimal mock env
const mockEnv = { ALERT_HUB: undefined, WELFARE_WATCH: undefined } as any;
const mockCtx = { waitUntil: vi.fn() } as any;

function makeRule(overrides: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 1, name: 'Test', description: null,
    scope: 'global', scope_id: null, enabled: 1,
    trigger_type: 'speed_threshold',
    trigger_config: JSON.stringify({ speed_ms: 40, direction: 'above' }),
    action_type: 'notify_dispatch',
    action_config: JSON.stringify({ message: 'Speed alert', severity: 'warn' }),
    dedup_window_ms: 300000,
    evaluate_client: 1, evaluate_server: 1,
    ...overrides,
  };
}

function makeFix(overrides: Partial<IncomingFix> = {}): IncomingFix {
  return { lat: 40.7, lng: -111.9, speed: 45, heading: null, ts: Date.now(), ...overrides };
}

describe('evaluateServerRules', () => {
  let mockDb: any;

  beforeEach(() => {
    mockCtx.waitUntil.mockClear();
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue(null), run: vi.fn().mockResolvedValue({}) }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      }),
    };
  });

  it('does nothing when no rules match', async () => {
    const rule = makeRule({ trigger_config: JSON.stringify({ speed_ms: 100, direction: 'above' }) });
    await evaluateServerRules(mockDb, mockEnv, mockCtx, 1, null, [makeFix()], [rule]);
    expect(mockCtx.waitUntil).not.toHaveBeenCalled();
  });

  it('fires when speed exceeds threshold', async () => {
    const rule = makeRule();
    // no prior firing in DB
    mockDb.prepare.mockReturnValue({
      bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue(null), run: vi.fn().mockResolvedValue({}) }),
    });
    await evaluateServerRules(mockDb, mockEnv, mockCtx, 1, null, [makeFix({ speed: 45 })], [rule]);
    expect(mockCtx.waitUntil).toHaveBeenCalled();
  });

  it('respects dedup_window_ms — does not re-fire within window', async () => {
    const rule = makeRule({ dedup_window_ms: 600000 });
    const recentFiring = { fired_at: new Date(Date.now() - 60000).toISOString() };
    mockDb.prepare.mockReturnValue({
      bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue(recentFiring), run: vi.fn().mockResolvedValue({}) }),
    });
    await evaluateServerRules(mockDb, mockEnv, mockCtx, 1, null, [makeFix({ speed: 45 })], [rule]);
    // waitUntil only called for the dedup INSERT, not for the action
    const calls = mockCtx.waitUntil.mock.calls;
    expect(calls.length).toBeLessThan(2);
  });

  it('skips disabled rules', async () => {
    const rule = makeRule({ enabled: 0 });
    await evaluateServerRules(mockDb, mockEnv, mockCtx, 1, null, [makeFix({ speed: 99 })], [rule]);
    expect(mockCtx.waitUntil).not.toHaveBeenCalled();
  });
});
