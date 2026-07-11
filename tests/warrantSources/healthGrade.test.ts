import { describe, it, expect } from 'vitest';
import { computeHealthGrade } from '../../src/utils/warrantSources/healthGrade';

describe('computeHealthGrade', () => {
  it('returns null when there is no run history', () => {
    expect(computeHealthGrade([])).toBeNull();
  });

  it('returns A for a 100% success rate', () => {
    const runs = Array(20).fill({ success: true });
    expect(computeHealthGrade(runs)).toBe('A');
  });

  it('returns A at exactly the 95% boundary (19/20)', () => {
    const runs = [...Array(19).fill({ success: true }), { success: false }];
    expect(computeHealthGrade(runs)).toBe('A');
  });

  it('returns B just below the A boundary (18/20 = 90%)', () => {
    const runs = [...Array(18).fill({ success: true }), ...Array(2).fill({ success: false })];
    expect(computeHealthGrade(runs)).toBe('B');
  });

  it('returns B at exactly the 85% boundary (17/20)', () => {
    const runs = [...Array(17).fill({ success: true }), ...Array(3).fill({ success: false })];
    expect(computeHealthGrade(runs)).toBe('B');
  });

  it('returns C just below the B boundary (16/20 = 80%)', () => {
    const runs = [...Array(16).fill({ success: true }), ...Array(4).fill({ success: false })];
    expect(computeHealthGrade(runs)).toBe('C');
  });

  it('returns C at exactly the 70% boundary (14/20)', () => {
    const runs = [...Array(14).fill({ success: true }), ...Array(6).fill({ success: false })];
    expect(computeHealthGrade(runs)).toBe('C');
  });

  it('returns D just below the C boundary (13/20 = 65%)', () => {
    const runs = [...Array(13).fill({ success: true }), ...Array(7).fill({ success: false })];
    expect(computeHealthGrade(runs)).toBe('D');
  });

  it('returns D at exactly the 50% boundary (10/20)', () => {
    const runs = [...Array(10).fill({ success: true }), ...Array(10).fill({ success: false })];
    expect(computeHealthGrade(runs)).toBe('D');
  });

  it('returns F below the 50% boundary (9/20 = 45%)', () => {
    const runs = [...Array(9).fill({ success: true }), ...Array(11).fill({ success: false })];
    expect(computeHealthGrade(runs)).toBe('F');
  });

  it('returns F for a 0% success rate', () => {
    const runs = Array(5).fill({ success: false });
    expect(computeHealthGrade(runs)).toBe('F');
  });

  it('divides by the actual run count, not the 20-run window, when a source has fewer than 20 runs', () => {
    // 2/3 = 66.7% -> D (>=50%, <70%). If the implementation mistakenly
    // divided by MAX_RUNS_CONSIDERED (20) instead of the actual considered
    // length (3), this would wrongly compute 2/20 = 10% -> F instead.
    const runs = [{ success: true }, { success: true }, { success: false }];
    expect(computeHealthGrade(runs)).toBe('D');
  });

  it('only considers the most recent 20 runs when more are provided', () => {
    // 25 failures followed by 20 successes — if the function only looks at
    // the last 20 (the 20 successes), this is an A; if it wrongly averaged
    // all 45, it would be an F. Caller is responsible for passing rows in
    // newest-first or oldest-first order consistently — this test documents
    // that the function takes the FIRST 20 entries of the array it's given,
    // so callers must slice/order before calling.
    const runs = [...Array(20).fill({ success: true }), ...Array(25).fill({ success: false })];
    expect(computeHealthGrade(runs)).toBe('A');
  });
});
