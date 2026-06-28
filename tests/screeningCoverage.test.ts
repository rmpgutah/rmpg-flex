import { describe, it, expect } from 'vitest';
import { sorCoverage } from '../src/utils/screening/coverage';

describe('sorCoverage', () => {
  it('reports available when the registry has records', () => {
    const c = sorCoverage(1200, true);
    expect(c.available).toBe(true);
    expect(c.severity).toBe('ok');
    expect(c.rowCount).toBe(1200);
    // No false-clear warning when data exists.
    expect(c.message).toBeUndefined();
  });

  it('flags an empty + unprovisioned registry as a false-clear risk', () => {
    const c = sorCoverage(0, false);
    expect(c.available).toBe(false);
    expect(c.severity).toBe('warning');
    expect(c.configured).toBe(false);
    // Must explicitly tell the operator a blank result is NOT a clearance.
    expect(c.message).toMatch(/not a clearance/i);
    expect(c.message).toMatch(/provision|import/i);
  });

  it('distinguishes "feed configured but 0 rows" from "no feed at all"', () => {
    const configured = sorCoverage(0, true);
    const unconfigured = sorCoverage(0, false);
    expect(configured.available).toBe(false);
    expect(configured.severity).toBe('warning');
    // The configured message should point at polling, not provisioning.
    expect(configured.message).toMatch(/poll|loaded yet/i);
    expect(configured.message).not.toEqual(unconfigured.message);
  });

  it('treats a single loaded record as available', () => {
    expect(sorCoverage(1, false).available).toBe(true);
  });
});
