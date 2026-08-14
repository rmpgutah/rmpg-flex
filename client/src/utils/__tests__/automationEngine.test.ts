import { describe, it, expect } from 'vitest';
import { evaluateRules, type ClientGpsFix, type EvaluatorState, type AutomationRule } from '../automationEngine';

function makeFix(overrides: Partial<ClientGpsFix> = {}): ClientGpsFix {
  return { ts: Date.now(), lat: 40.7, lng: -111.9, accuracy: 5, heading: null, speed: 10, source: 'gps', ...overrides };
}

function makeState(overrides: Partial<EvaluatorState> = {}): EvaluatorState {
  return { lastFired: {}, lastFix: null, lastMovedTs: Date.now(), assignedCallLatLng: null, ...overrides };
}

function makeRule(overrides: Partial<AutomationRule>): AutomationRule {
  return {
    id: 1, name: 'Test', description: null,
    scope: 'global', scope_id: null, enabled: 1,
    trigger_type: 'speed_threshold',
    trigger_config: JSON.stringify({ speed_ms: 30, direction: 'above' }),
    action_type: 'notify_officer',
    action_config: JSON.stringify({ message: 'Fast!', severity: 'warn' }),
    dedup_window_ms: 300000,
    evaluate_client: 1, evaluate_server: 1,
    ...overrides,
  };
}

describe('evaluateRules', () => {
  it('returns empty when speed below threshold', () => {
    const actions = evaluateRules(makeFix({ speed: 10 }), [makeRule({})], makeState(), []);
    expect(actions).toHaveLength(0);
  });

  it('fires notify_officer when speed above threshold', () => {
    const actions = evaluateRules(makeFix({ speed: 45 }), [makeRule({})], makeState(), []);
    expect(actions).toHaveLength(1);
    expect(actions[0].localAction?.type).toBe('notify_officer');
    expect(actions[0].localAction?.message).toBe('Fast!');
  });

  it('respects dedup_window_ms', () => {
    const state = makeState({ lastFired: { 1: Date.now() - 10000 } });
    const actions = evaluateRules(makeFix({ speed: 45 }), [makeRule({})], state, []);
    expect(actions).toHaveLength(0);
  });

  it('skips evaluate_client=0 rules', () => {
    const actions = evaluateRules(makeFix({ speed: 99 }), [makeRule({ evaluate_client: 0 })], makeState(), []);
    expect(actions).toHaveLength(0);
  });

  it('marks server-only actions as pendingServerAction', () => {
    const actions = evaluateRules(
      makeFix({ speed: 99 }),
      [makeRule({ action_type: 'change_unit_status', action_config: JSON.stringify({ status: 'on_scene' }) })],
      makeState(),
      [],
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].pendingServerAction).toBe(true);
    expect(actions[0].localAction).toBeUndefined();
  });

  it('no_movement fires when stationary past threshold', () => {
    const oldTs = Date.now() - 20 * 60 * 1000; // 20 min ago
    const rule = makeRule({
      trigger_type: 'no_movement',
      trigger_config: JSON.stringify({ threshold_ms: 15 * 60 * 1000, radius_m: 50 }),
    });
    const state = makeState({ lastMovedTs: oldTs });
    const actions = evaluateRules(makeFix(), [rule], state, []);
    expect(actions).toHaveLength(1);
  });

  it('call_proximity fires when near assigned call', () => {
    const rule = makeRule({
      trigger_type: 'call_proximity',
      trigger_config: JSON.stringify({ radius_m: 200 }),
    });
    const state = makeState({ assignedCallLatLng: { lat: 40.7001, lng: -111.9001 } });
    const actions = evaluateRules(makeFix(), [rule], state, []);
    expect(actions).toHaveLength(1);
  });
});
