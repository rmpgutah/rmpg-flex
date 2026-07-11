import { describe, it, expect } from 'vitest';
import { computeHealthGrade } from '../src/utils/warrantSources/healthGrade';

describe('computeHealthGrade — degraded runs grade as failures', () => {
  it('grades a run of all-degraded rows as F, even though none had errors', () => {
    // These rows simulate what insertScraperRunRow writes when degraded=true:
    // success is already folded to 0 at write time (see logScanResult.ts),
    // so computeHealthGrade's contract/formula needs no changes — this test
    // documents that end-to-end behavior explicitly.
    const runs = Array.from({ length: 20 }, () => ({ success: false }));
    expect(computeHealthGrade(runs)).toBe('F');
  });

  it('a mix of 18 clean successes and 2 degraded-turned-failures still grades B (90% falls in the >=85% band)', () => {
    const runs = [
      ...Array.from({ length: 18 }, () => ({ success: true })),
      ...Array.from({ length: 2 }, () => ({ success: false })),
    ];
    // 18/20 = 90% → falls in the >=85% band per healthGrade.ts's documented thresholds.
    expect(computeHealthGrade(runs)).toBe('B');
  });
});
