import { describe, it, expect } from 'vitest';
import {
  isValidTaskStatus,
  isValidTaskPriority,
  completedAtFor,
  isTaskOverdue,
} from '../src/utils/caseTasks';

describe('caseTasks rules', () => {
  it('validates statuses', () => {
    expect(isValidTaskStatus('open')).toBe(true);
    expect(isValidTaskStatus('in_progress')).toBe(true);
    expect(isValidTaskStatus('done')).toBe(true);
    expect(isValidTaskStatus('canceled')).toBe(true);
    expect(isValidTaskStatus('bogus')).toBe(false);
    expect(isValidTaskStatus(undefined)).toBe(false);
  });

  it('validates priorities', () => {
    expect(isValidTaskPriority('urgent')).toBe(true);
    expect(isValidTaskPriority('normal')).toBe(true);
    expect(isValidTaskPriority('critical')).toBe(false);
  });

  describe('completedAtFor', () => {
    const NOW = '2026-06-13T12:00:00.000Z';
    it('stamps completed_at when entering done', () => {
      expect(completedAtFor('done', NOW, null)).toBe(NOW);
    });
    it('preserves an existing completed_at while staying done', () => {
      expect(completedAtFor('done', NOW, '2026-06-01T00:00:00.000Z')).toBe('2026-06-01T00:00:00.000Z');
    });
    it('clears completed_at when leaving done (reopen / cancel)', () => {
      expect(completedAtFor('open', NOW, '2026-06-01T00:00:00.000Z')).toBeNull();
      expect(completedAtFor('canceled', NOW, '2026-06-01T00:00:00.000Z')).toBeNull();
    });
  });

  describe('isTaskOverdue', () => {
    const NOW = new Date('2026-06-13T12:00:00');
    it('is overdue when due date is in the past and still actionable', () => {
      expect(isTaskOverdue('2026-06-10', 'open', NOW)).toBe(true);
      expect(isTaskOverdue('2026-06-10', 'in_progress', NOW)).toBe(true);
    });
    it('is not overdue for done/canceled tasks', () => {
      expect(isTaskOverdue('2026-06-10', 'done', NOW)).toBe(false);
      expect(isTaskOverdue('2026-06-10', 'canceled', NOW)).toBe(false);
    });
    it('treats the due date as end-of-day (not overdue same day)', () => {
      expect(isTaskOverdue('2026-06-13', 'open', NOW)).toBe(false);
    });
    it('is not overdue without a due date or with a bad date', () => {
      expect(isTaskOverdue(null, 'open', NOW)).toBe(false);
      expect(isTaskOverdue('not-a-date', 'open', NOW)).toBe(false);
    });
  });
});
