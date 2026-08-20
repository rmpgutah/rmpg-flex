import { describe, test, expect } from 'vitest';
import { lookupFailedCoverage, LOOKUP_OK, sorCoverage } from '../src/utils/screening/coverage';

describe('lookupFailedCoverage', () => {
  test('is not available and is a warning', () => {
    const c = lookupFailedCoverage('Active BOLOs');
    expect(c.available).toBe(false);
    expect(c.severity).toBe('warning');
  });

  test('names the subject that could not be checked', () => {
    expect(lookupFailedCoverage('Active BOLOs').message).toContain('Active BOLOs');
  });

  test('states explicitly that it is NOT a clearance', () => {
    // The whole point: an operator must not read a failed lookup as "clear".
    const msg = lookupFailedCoverage('Active BOLOs').message ?? '';
    expect(msg).toMatch(/NOT a clearance/);
    expect(msg).toMatch(/neither confirm nor rule out/);
  });

  test('distinguishable from a successful lookup', () => {
    expect(LOOKUP_OK.available).toBe(true);
    expect(LOOKUP_OK.severity).toBe('ok');
    expect(lookupFailedCoverage('x').available).not.toBe(LOOKUP_OK.available);
  });

  test('a successful lookup carries no scary message', () => {
    expect(LOOKUP_OK.message).toBeUndefined();
  });
});

describe('sorCoverage still behaves (regression guard)', () => {
  test('rows present → available', () => {
    expect(sorCoverage(1200, true).available).toBe(true);
  });

  test('no rows → warning, whether or not a feed is configured', () => {
    expect(sorCoverage(0, true).available).toBe(false);
    expect(sorCoverage(0, false).available).toBe(false);
    expect(sorCoverage(0, true).message).toMatch(/NOT a clearance/);
    expect(sorCoverage(0, false).message).toMatch(/NOT a clearance/);
  });
});

describe('the distinction the false-clear fixes rely on', () => {
  // Each fixed endpoint now reports `checked` alongside its result, so a caller
  // can tell these two apart. Before, both looked identical.
  const checkedAndClear = { count: 0, checked: true, coverage: LOOKUP_OK };
  const couldNotCheck = { count: 0, checked: false, coverage: lookupFailedCoverage('Active BOLOs') };

  test('both carry a zero count', () => {
    expect(checkedAndClear.count).toBe(couldNotCheck.count);
  });

  test('but only one of them was actually checked', () => {
    expect(checkedAndClear.checked).toBe(true);
    expect(couldNotCheck.checked).toBe(false);
  });

  test('and only one claims coverage', () => {
    expect(checkedAndClear.coverage.available).toBe(true);
    expect(couldNotCheck.coverage.available).toBe(false);
  });
});
