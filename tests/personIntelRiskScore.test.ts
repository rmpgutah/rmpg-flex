import { describe, it, expect } from 'vitest';
import { computeRiskScore } from '../src/utils/personIntel/riskScore';
import type { RiskFlag } from '../src/utils/personIntel/types';

describe('computeRiskScore', () => {
  it('no flags = 0', () => {
    expect(computeRiskScore([])).toBe(0);
  });
  it('warrant = 30', () => {
    expect(computeRiskScore(['warrant'])).toBe(30);
  });
  it('ofac = 40', () => {
    expect(computeRiskScore(['ofac'])).toBe(40);
  });
  it('nsopw = 25', () => {
    expect(computeRiskScore(['nsopw'])).toBe(25);
  });
  it('hibp_breach = 10', () => {
    expect(computeRiskScore(['hibp_breach'])).toBe(10);
  });
  it('arrest_mention = 15', () => {
    expect(computeRiskScore(['arrest_mention'])).toBe(15);
  });
  it('caps at 100', () => {
    const flags: RiskFlag[] = ['warrant', 'ofac', 'nsopw', 'hibp_breach', 'arrest_mention'];
    expect(computeRiskScore(flags)).toBeLessThanOrEqual(100);
  });
  it('multiple flags accumulate', () => {
    expect(computeRiskScore(['warrant', 'nsopw'])).toBe(55);
  });
});
