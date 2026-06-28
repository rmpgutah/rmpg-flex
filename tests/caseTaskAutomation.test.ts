import { describe, it, expect } from 'vitest';
import { pickTemplate, CASE_TASK_TEMPLATES } from '../src/utils/caseTaskTemplates';
import { classifyTaskDue } from '../src/utils/caseTaskNudges';

describe('pickTemplate', () => {
  it('returns the type-specific set when defined', () => {
    expect(pickTemplate('missing_person').some((t) => t.title.includes('NCIC'))).toBe(true);
    expect(pickTemplate('criminal').length).toBe(CASE_TASK_TEMPLATES.criminal.length);
  });
  it('falls back to default for unknown / empty types', () => {
    expect(pickTemplate('zzz')).toBe(CASE_TASK_TEMPLATES.default);
    expect(pickTemplate(null)).toBe(CASE_TASK_TEMPLATES.default);
  });
  it('every template item has a title and valid priority', () => {
    const valid = new Set(['low', 'normal', 'high', 'urgent']);
    for (const items of Object.values(CASE_TASK_TEMPLATES)) {
      for (const it of items) {
        expect(it.title.length).toBeGreaterThan(0);
        expect(valid.has(it.priority)).toBe(true);
      }
    }
  });
});

describe('classifyTaskDue', () => {
  const now = new Date('2026-06-13T12:00:00');
  it('flags a past due date as overdue', () => {
    expect(classifyTaskDue('2026-06-10', now)).toBe('overdue');
  });
  it('flags within-24h as due_soon (end-of-day due)', () => {
    expect(classifyTaskDue('2026-06-13', now)).toBe('due_soon'); // ~12h out
  });
  it('returns null when comfortably in the future', () => {
    expect(classifyTaskDue('2026-06-20', now)).toBeNull();
  });
  it('returns null for missing / malformed dates', () => {
    expect(classifyTaskDue(null, now)).toBeNull();
    expect(classifyTaskDue('nope', now)).toBeNull();
  });
});
