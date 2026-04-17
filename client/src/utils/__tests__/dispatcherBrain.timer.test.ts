import { describe, it, expect, vi, beforeEach } from 'vitest';

const enqueue = vi.fn();
vi.mock('../speakQueue', () => ({
  enqueueSpeech: (...args: any[]) => enqueue(...args),
}));

import {
  handleDispatchEvent,
  setCurrentUser,
  getBrainContext,
  __resetBrainForTest,
  __tickTimersForTest,
} from '../dispatcherBrain';
import { registerRules, __clearRulesForTest } from '../dispatcherRules/registry';
import { COACHING_RULES } from '../dispatcherRules/coaching';

describe('dispatcherBrain timer', () => {
  beforeEach(() => {
    enqueue.mockClear();
    __resetBrainForTest();
    __clearRulesForTest();
    registerRules(COACHING_RULES);
    localStorage.setItem('rmpg-voice-brain-enabled', '1');
  });

  it('timer tick with no on-scene context fires no rules', () => {
    setCurrentUser('3-Adam');
    __tickTimersForTest();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('status_update for current user on-scene populates currentUserOnSceneAt', () => {
    setCurrentUser('3-Adam');
    handleDispatchEvent('unit_status', { call_sign: '3-Adam', status: 'on_scene' });
    expect(getBrainContext().currentUserOnSceneAt).toBeDefined();
  });

  it('status_update for a different unit does NOT touch currentUserOnSceneAt', () => {
    setCurrentUser('3-Adam');
    handleDispatchEvent('unit_status', { call_sign: '5-Charlie', status: 'on_scene' });
    expect(getBrainContext().currentUserOnSceneAt).toBeUndefined();
  });

  it('clear status empties currentUserOnSceneAt', () => {
    setCurrentUser('3-Adam');
    handleDispatchEvent('unit_status', { call_sign: '3-Adam', status: 'on_scene' });
    expect(getBrainContext().currentUserOnSceneAt).toBeDefined();
    handleDispatchEvent('unit_status', { call_sign: '3-Adam', status: 'clear' });
    expect(getBrainContext().currentUserOnSceneAt).toBeUndefined();
  });

  it('overdue-status-check fires after 8+ minutes on scene', () => {
    setCurrentUser('3-Adam');
    // Force the context to simulate 9 minutes on scene.
    (getBrainContext() as any).currentUserOnSceneAt = Date.now() - 9 * 60_000;
    __tickTimersForTest();
    expect(enqueue).toHaveBeenCalledTimes(1);
    const call = enqueue.mock.calls[0][0];
    expect(call.ruleId).toBe('overdue-status-check');
    expect(call.text).toContain('3-Adam');
    expect(call.text).toContain('status check');
  });

  it('timer tick is a no-op when brain is disabled', () => {
    localStorage.removeItem('rmpg-voice-brain-enabled');
    setCurrentUser('3-Adam');
    (getBrainContext() as any).currentUserOnSceneAt = Date.now() - 9 * 60_000;
    __tickTimersForTest();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
