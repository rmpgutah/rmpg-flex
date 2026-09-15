import { describe, it, expect } from 'vitest';
import { evaluateCitationCompleteness } from '../src/utils/citationCompleteness';

describe('citationCompleteness', () => {
  it('100% / grade A when all required items are met', () => {
    const r = evaluateCitationCompleteness({
      person_id: 1, violation_description: 'Speeding', issuing_officer_id: 2,
      appearance_required: 0,
    });
    expect(r.score).toBe(100);
    expect(r.grade).toBe('A');
    expect(r.missing_required).toEqual([]);
  });

  it('always returns missing_required as an array, never omitted', () => {
    const r = evaluateCitationCompleteness({});
    expect(Array.isArray(r.missing_required)).toBe(true);
    expect(r.missing_required.length).toBeGreaterThan(0);
  });

  it('violation_count from citation_violations satisfies the violation check', () => {
    const r = evaluateCitationCompleteness({
      person_id: 1, issuing_officer_id: 2, violation_count: 1, appearance_required: 0,
    });
    expect(r.missing_required).not.toContain('Violation description recorded');
  });

  it('court date only required when appearance_required is set', () => {
    const withoutAppearance = evaluateCitationCompleteness({
      person_id: 1, violation_description: 'x', issuing_officer_id: 2, appearance_required: 0,
    });
    expect(withoutAppearance.missing_required).not.toContain('Court date set');

    const needsCourtDate = evaluateCitationCompleteness({
      person_id: 1, violation_description: 'x', issuing_officer_id: 2, appearance_required: 1,
    });
    expect(needsCourtDate.missing_required).toContain('Court date set');

    const hasCourtDate = evaluateCitationCompleteness({
      person_id: 1, violation_description: 'x', issuing_officer_id: 2,
      appearance_required: 1, court_date: '2026-01-01',
    });
    expect(hasCourtDate.missing_required).not.toContain('Court date set');
  });

  it('vehicle info is optional and never blocks a 100% score', () => {
    const r = evaluateCitationCompleteness({
      person_id: 1, violation_description: 'x', issuing_officer_id: 2, appearance_required: 0,
    });
    expect(r.score).toBe(100);
  });

  it('grade boundaries follow the score thresholds', () => {
    // 3 of 4 required met -> 75% -> grade B
    const r = evaluateCitationCompleteness({
      person_id: 1, violation_description: 'x', issuing_officer_id: 2, appearance_required: 1,
    });
    expect(r.score).toBe(75);
    expect(r.grade).toBe('B');
  });
});
