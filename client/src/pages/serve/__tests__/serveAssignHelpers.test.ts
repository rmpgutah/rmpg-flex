import { describe, it, expect } from 'vitest';
import { toggleSelect, attentionSummary } from '../serveAssignHelpers';

describe('toggleSelect', () => {
  it('adds and removes an id immutably', () => {
    expect(toggleSelect([], 5)).toEqual([5]);
    expect(toggleSelect([5, 6], 5)).toEqual([6]);
    const a = [1]; const b = toggleSelect(a, 2);
    expect(a).toEqual([1]); expect(b).toEqual([1, 2]);
  });
});

describe('attentionSummary', () => {
  it('renders the highest-severity label + count', () => {
    expect(attentionSummary({ deadline_passed: 2, diligence_gap: 1 })).toBe('2 overdue');
    expect(attentionSummary({ unassigned_near_deadline: 3 })).toBe('3 unassigned');
    expect(attentionSummary({})).toBe('');
  });
});
