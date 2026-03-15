import { describe, it, expect } from 'vitest';
import {
  formatTimer,
  getTimerSeverity,
  getTimerProgress,
  getTimerColor,
  isActiveStatus,
  THRESHOLDS,
  STATUS_LABELS,
  getThreshold,
  getTimerState,
  getCallAge,
  type TimerSeverity,
} from '../../src/utils/dispatchTimers';
import type { CallForService, CallStatus } from '../../src/types';

// ── Helper: build a minimal CallForService for testing ──────

function makeCall(overrides: Partial<CallForService> = {}): CallForService {
  return {
    id: 1,
    call_number: 'CFS-2025-0001',
    incident_type: 'traffic_stop',
    priority: 'P2',
    status: 'pending',
    caller_name: null,
    caller_phone: null,
    location: '123 Main St',
    city: 'Test City',
    latitude: null,
    longitude: null,
    narrative: null,
    created_at: new Date().toISOString(),
    dispatched_at: null,
    enroute_at: null,
    onscene_at: null,
    cleared_at: null,
    closed_at: null,
    assigned_unit_ids: '[]',
    created_by: 1,
    ...overrides,
  } as CallForService;
}

describe('dispatchTimers', () => {
  describe('formatTimer', () => {
    it('formats seconds as M:SS for times under 1 hour', () => {
      expect(formatTimer(0)).toBe('0:00');
      expect(formatTimer(5)).toBe('0:05');
      expect(formatTimer(65)).toBe('1:05');
      expect(formatTimer(600)).toBe('10:00');
      expect(formatTimer(3599)).toBe('59:59');
    });

    it('formats times over 1 hour as H:MM:SS', () => {
      expect(formatTimer(3600)).toBe('1:00:00');
      expect(formatTimer(3661)).toBe('1:01:01');
      expect(formatTimer(7200)).toBe('2:00:00');
    });

    it('handles negative values', () => {
      expect(formatTimer(-5)).toBe('0:00');
    });
  });

  describe('getTimerSeverity', () => {
    it('returns normal below 1/3 threshold', () => {
      expect(getTimerSeverity(20, 100)).toBe('normal');
      expect(getTimerSeverity(33, 100)).toBe('normal');
    });

    it('returns warning at 1/3 to 2/3 threshold', () => {
      expect(getTimerSeverity(34, 100)).toBe('warning');
      expect(getTimerSeverity(66, 100)).toBe('warning');
    });

    it('returns critical at 2/3 to 99% threshold', () => {
      expect(getTimerSeverity(67, 100)).toBe('critical');
      expect(getTimerSeverity(99, 100)).toBe('critical');
    });

    it('returns overdue at or above 100% threshold', () => {
      expect(getTimerSeverity(100, 100)).toBe('overdue');
      expect(getTimerSeverity(200, 100)).toBe('overdue');
    });

    it('returns normal for Infinity threshold', () => {
      expect(getTimerSeverity(999999, Infinity)).toBe('normal');
    });
  });

  describe('getTimerProgress', () => {
    it('returns 0 for Infinity threshold', () => {
      expect(getTimerProgress(500, Infinity)).toBe(0);
    });

    it('returns 0 for zero threshold', () => {
      expect(getTimerProgress(100, 0)).toBe(0);
    });

    it('returns ratio capped at 1.0', () => {
      expect(getTimerProgress(50, 100)).toBe(0.5);
      expect(getTimerProgress(100, 100)).toBe(1.0);
      expect(getTimerProgress(200, 100)).toBe(1.0); // capped
    });
  });

  describe('getTimerColor', () => {
    it('returns the correct colors for each severity', () => {
      const expected: Record<TimerSeverity, string> = {
        normal: '#4ade80',
        warning: '#f59e0b',
        critical: '#ef4444',
        overdue: '#ef4444',
      };
      for (const [severity, color] of Object.entries(expected)) {
        expect(getTimerColor(severity as TimerSeverity)).toBe(color);
      }
    });
  });

  describe('isActiveStatus', () => {
    it('returns true for active statuses', () => {
      const active: CallStatus[] = ['pending', 'dispatched', 'enroute', 'onscene', 'on_hold'];
      for (const status of active) {
        expect(isActiveStatus(status)).toBe(true);
      }
    });

    it('returns false for inactive statuses', () => {
      const inactive: CallStatus[] = ['cleared', 'closed', 'cancelled', 'archived'];
      for (const status of inactive) {
        expect(isActiveStatus(status)).toBe(false);
      }
    });
  });

  describe('THRESHOLDS', () => {
    it('P1 is shortest, P4 is longest', () => {
      expect(THRESHOLDS.pending.P1).toBeLessThan(THRESHOLDS.pending.P3);
      expect(THRESHOLDS.pending.P3).toBeLessThan(THRESHOLDS.pending.P2); // P2 is 4h for PSO Priority One
      expect(THRESHOLDS.pending.P2).toBeLessThan(THRESHOLDS.pending.P4);
    });

    it('P1 is 60 seconds (emergency)', () => {
      expect(THRESHOLDS.pending.P1).toBe(60);
    });
  });

  describe('STATUS_LABELS', () => {
    it('has short 3-4 character labels', () => {
      for (const [, label] of Object.entries(STATUS_LABELS)) {
        expect(label!.length).toBeLessThanOrEqual(4);
      }
    });
  });

  describe('getThreshold', () => {
    it('returns priority-based threshold for pending calls', () => {
      expect(getThreshold(makeCall({ status: 'pending', priority: 'P1' }))).toBe(60);
      expect(getThreshold(makeCall({ status: 'pending', priority: 'P4' }))).toBe(86400);
    });

    it('returns dispatched threshold for dispatched calls', () => {
      expect(getThreshold(makeCall({ status: 'dispatched' }))).toBe(THRESHOLDS.dispatched);
    });

    it('returns onscene threshold for onscene calls', () => {
      expect(getThreshold(makeCall({ status: 'onscene' }))).toBe(THRESHOLDS.onscene);
    });

    it('returns Infinity for on_hold calls', () => {
      expect(getThreshold(makeCall({ status: 'on_hold' }))).toBe(Infinity);
    });

    it('returns Infinity for enroute calls (no alarm needed)', () => {
      expect(getThreshold(makeCall({ status: 'enroute' }))).toBe(Infinity);
    });
  });

  describe('72-hour absolute overdue enforcement', () => {
    it('absoluteOverdue threshold is 72 hours (259200 seconds)', () => {
      expect(THRESHOLDS.absoluteOverdue).toBe(72 * 60 * 60);
    });

    it('marks enroute call as overdue after 72 hours even though per-status threshold is Infinity', () => {
      const call = makeCall({
        status: 'enroute',
        created_at: new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString(),
        enroute_at: new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString(),
      });
      const state = getTimerState(call);
      expect(state.isOverdue).toBe(true);
      expect(state.severity).toBe('overdue');
    });

    it('marks enroute call as critical after 48 hours', () => {
      const call = makeCall({
        status: 'enroute',
        created_at: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(),
        enroute_at: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(),
      });
      const state = getTimerState(call);
      expect(state.severity).toBe('critical');
    });

    it('does not override overdue for calls already overdue by per-status threshold', () => {
      // P1 pending call after 2 minutes — already overdue by per-status (60s)
      const call = makeCall({
        status: 'pending',
        priority: 'P1',
        created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      });
      const state = getTimerState(call);
      expect(state.severity).toBe('overdue');
    });

    it('does not apply to cleared/closed calls', () => {
      const call = makeCall({
        status: 'cleared',
        created_at: new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString(),
        cleared_at: new Date().toISOString(),
      });
      const state = getTimerState(call);
      // cleared calls have Infinity threshold and aren't active, so no overdue
      expect(state.isOverdue).toBe(false);
    });

    it('getCallAge returns age since created_at', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const call = makeCall({ created_at: twoHoursAgo });
      const age = getCallAge(call);
      // Should be approximately 7200 seconds (±2s tolerance for test execution)
      expect(age).toBeGreaterThan(7198);
      expect(age).toBeLessThan(7210);
    });
  });
});
