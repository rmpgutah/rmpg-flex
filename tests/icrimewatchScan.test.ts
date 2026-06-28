import { describe, it, expect } from 'vitest';
import { buildSearchUrl, buildDetailUrl, isIcwScanDue } from '../src/utils/sorSources/icrimewatch';

describe('icrimewatch url builders', () => {
  it('builds the agency-scoped search-all url', () => {
    expect(buildSearchUrl()).toBe('https://www.icrimewatch.net/results.php?SubmitAllSearch=1&AgencyID=54438');
  });
  it('builds a last-name search url', () => {
    expect(buildSearchUrl('CLARK')).toContain('lname=CLARK');
    expect(buildSearchUrl('CLARK')).toContain('AgencyID=54438');
  });
  it('builds a detail url', () => {
    expect(buildDetailUrl('2301330')).toBe('https://www.icrimewatch.net/offenderdetails.php?OfndrID=2301330&AgencyID=54438');
  });
});

describe('isIcwScanDue', () => {
  const now = Date.parse('2026-06-15T00:00:00Z');
  it('is due when never run (null)', () => {
    expect(isIcwScanDue(null, now)).toBe(true);
  });
  it('is due when unparseable', () => {
    expect(isIcwScanDue('not-a-date', now)).toBe(true);
  });
  it('is NOT due before the interval elapses', () => {
    const twoDaysAgo = new Date(now - 2 * 86_400_000).toISOString();
    expect(isIcwScanDue(twoDaysAgo, now, 7)).toBe(false);
  });
  it('is due once the interval elapses', () => {
    const eightDaysAgo = new Date(now - 8 * 86_400_000).toISOString();
    expect(isIcwScanDue(eightDaysAgo, now, 7)).toBe(true);
  });
});
