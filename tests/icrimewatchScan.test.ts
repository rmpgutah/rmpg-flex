import { describe, it, expect } from 'vitest';
import { buildSearchUrl, buildDetailUrl } from '../src/utils/sorSources/icrimewatch';

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
