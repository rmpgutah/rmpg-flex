import { describe, it, expect } from 'vitest';
import { evaluateCompleteness, getChecklist } from '../src/utils/caseCompleteness';

describe('caseCompleteness', () => {
  it('investigative types get the evidentiary extras; admin types do not', () => {
    expect(getChecklist('criminal').some((d) => d.key === 'evidence')).toBe(true);
    expect(getChecklist('admin').some((d) => d.key === 'evidence')).toBe(false);
  });

  it('100% when all required items are met (general case)', () => {
    const r = evaluateCompleteness('general', {
      lead_investigator_id: 5, narrative: 'x', persons: 2,
    });
    expect(r.percent).toBe(100);
    expect(r.missing).toEqual([]);
  });

  it('reports required misses and a partial percent', () => {
    const r = evaluateCompleteness('general', { lead_investigator_id: 5 });
    // 1 of 3 required met (lead only) → 33%
    expect(r.percent).toBe(33);
    expect(r.missing).toContain('Narrative or summary written');
    expect(r.missing).toContain('At least one person linked');
  });

  it('counts evidence as required for criminal cases', () => {
    const base = { lead_investigator_id: 1, narrative: 'n', persons: 1 };
    expect(evaluateCompleteness('criminal', base).missing).toContain('Evidence logged');
    expect(evaluateCompleteness('criminal', { ...base, evidence: 1 }).percent).toBe(100);
  });

  it('treats summary as satisfying the narrative requirement', () => {
    const r = evaluateCompleteness('general', { lead_investigator_id: 1, summary: 'done', persons: 1 });
    expect(r.items.find((i) => i.key === 'narrative')?.met).toBe(true);
  });

  it('optional items appear but never block 100%', () => {
    const r = evaluateCompleteness('general', { lead_investigator_id: 1, narrative: 'n', persons: 1 });
    expect(r.percent).toBe(100);
    expect(r.items.find((i) => i.key === 'has_task')?.met).toBe(false); // optional, unmet
    expect(r.items.find((i) => i.key === 'has_task')?.required).toBe(false);
  });

  it('tasks_resolved only true when there are tasks and none open', () => {
    expect(evaluateCompleteness('general', { tasks_total: 0, tasks_open: 0 }).items.find((i) => i.key === 'tasks_resolved')?.met).toBe(false);
    expect(evaluateCompleteness('general', { tasks_total: 3, tasks_open: 0 }).items.find((i) => i.key === 'tasks_resolved')?.met).toBe(true);
    expect(evaluateCompleteness('general', { tasks_total: 3, tasks_open: 1 }).items.find((i) => i.key === 'tasks_resolved')?.met).toBe(false);
  });
});
