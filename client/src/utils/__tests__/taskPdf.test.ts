import { describe, it, expect } from 'vitest';
import {
  wrapText,
  describeFilters,
  fmtTimestamp,
  generateTasksPdf,
  type TaskRowForPdf,
} from '../taskPdf';

function mkTask(overrides: Partial<TaskRowForPdf> = {}): TaskRowForPdf {
  return {
    id: 1,
    task_title: 'Follow up on warrant 47 service',
    priority: 'high',
    status: 'pending',
    assigned_to_name: 'Officer Smith',
    assigned_by_name: 'Sgt. Doe',
    due_date: '2026-06-30',
    linked_entity_type: 'warrant',
    linked_entity_id: 47,
    description: 'Verify subject address.',
    created_at: '2026-06-22T14:23:05Z',
    completed_at: null,
    ...overrides,
  };
}

describe('wrapText (task pdf)', () => {
  it('returns a single empty entry for empty input', () => {
    expect(wrapText('', 20)).toEqual(['']);
  });
  it('keeps short strings as one line', () => {
    expect(wrapText('follow up', 30)).toEqual(['follow up']);
  });
  it('wraps at word boundaries', () => {
    expect(wrapText('one two three four', 10)).toEqual(['one two', 'three four']);
  });
  it('preserves explicit newlines as paragraph breaks', () => {
    expect(wrapText('first line\nsecond line', 50)).toEqual(['first line', 'second line']);
  });
});

describe('describeFilters (task pdf)', () => {
  it('describes an empty filter set as unfiltered', () => {
    expect(describeFilters(undefined)).toMatch(/unfiltered/i);
    expect(describeFilters({})).toMatch(/unfiltered/i);
  });
  it('joins active filters with commas', () => {
    expect(describeFilters({
      status: 'pending',
      priority: 'high',
      assignedToName: 'Officer Smith',
    })).toBe('status=pending, priority=high, assignee=Officer Smith');
  });
  it('falls back to assignee_id when only the numeric id is known', () => {
    expect(describeFilters({ assignedTo: '10' })).toBe('assignee_id=10');
  });
  it('prefers the resolved name over the numeric id when both are present', () => {
    expect(describeFilters({ assignedTo: '10', assignedToName: 'Officer Smith' }))
      .toBe('assignee=Officer Smith');
  });
  it('renders the overdue-only flag as overdue=only', () => {
    expect(describeFilters({ overdue: true })).toBe('overdue=only');
  });
  it('skips empty fields', () => {
    expect(describeFilters({
      status: 'pending', priority: '', assignedTo: '',
    })).toBe('status=pending');
  });
});

describe('fmtTimestamp (task pdf)', () => {
  it('returns em-dash for empty input', () => {
    expect(fmtTimestamp(null)).toBe('—');
    expect(fmtTimestamp(undefined)).toBe('—');
    expect(fmtTimestamp('')).toBe('—');
  });
  it('formats a UTC timestamp in Mountain Time with the MT suffix', () => {
    const out = fmtTimestamp('2026-06-22T14:23:05Z');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} MT$/);
    expect(out).toContain('2026-06-22');
    expect(out).toContain(' MT');
  });
});

describe('generateTasksPdf', () => {
  it('produces a jsPDF document even with zero tasks', () => {
    const doc = generateTasksPdf({ tasks: [] });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    const bytes = doc.output('arraybuffer');
    expect(bytes.byteLength).toBeGreaterThan(1500);
  });

  it('produces a non-trivial document for a single task', () => {
    const doc = generateTasksPdf({
      tasks: [mkTask()],
      filters: { status: 'pending' },
      totalMatching: 1,
      exportedBy: 'Sgt. Doe',
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    const bytes = doc.output('arraybuffer');
    expect(bytes.byteLength).toBeGreaterThan(2000);
  });

  it('paginates when given many tasks', () => {
    const tasks: TaskRowForPdf[] = [];
    for (let i = 0; i < 60; i++) {
      tasks.push(mkTask({ id: i + 1, task_title: `Task ${i + 1} long enough to occupy a full row` }));
    }
    const doc = generateTasksPdf({ tasks, totalMatching: 60 });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
  });

  it('does not crash when tasks omit optional fields', () => {
    const doc = generateTasksPdf({
      tasks: [{
        id: 99,
        task_title: 'Bare-bones task',
      }],
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('does not crash when the due_date is past (overdue accent path)', () => {
    const doc = generateTasksPdf({
      tasks: [mkTask({ due_date: '2020-01-01' })],
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});
