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
    it('returns normal below 60% threshold', () => {
      expect(getTimerSeverity(30, 100)).toBe('normal');
      expect(getTimerSeverity(59, 100)).toBe('normal');
    });

    it('returns warning at 60-89% threshold', () => {
      expect(getTimerSeverity(60, 100)).toBe('warning');
      expect(getTimerSeverity(89, 100)).toBe('warning');
    });

    it('returns critical at 90-99% threshold', () => {
      expect(getTimerSeverity(90, 100)).toBe('critical');
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
    it('has increasing thresholds for P1-P4', () => {
      expect(THRESHOLDS.pending.P1).toBeLessThan(THRESHOLDS.pending.P2);
      expect(THRESHOLDS.pending.P2).toBeLessThan(THRESHOLDS.pending.P3);
      expect(THRESHOLDS.pending.P3).toBeLessThan(THRESHOLDS.pending.P4);
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
      expect(getThreshold(makeCall({ status: 'pending', priority: 'P4' }))).toBe(600);
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
});
