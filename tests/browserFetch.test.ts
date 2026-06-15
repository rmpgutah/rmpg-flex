import { describe, it, expect } from 'vitest';
import { FirecrawlConfigError, buildScrapePayload } from '../src/utils/browserFetch';

describe('buildScrapePayload', () => {
  it('requests rendered html with stealth proxy', () => {
    const p = buildScrapePayload('https://www.icrimewatch.net/offenderdetails.php?OfndrID=1&AgencyID=54438');
    expect(p.url).toContain('offenderdetails.php');
    expect(p.formats).toContain('html');
    expect(p.proxy).toBe('stealth');
  });
  it('passes through optional waitFor', () => {
    const p = buildScrapePayload('https://x', { waitFor: 3000 });
    expect(p.waitFor).toBe(3000);
  });
});

describe('FirecrawlConfigError', () => {
  it('is throwable and carries a message', () => {
    const e = new FirecrawlConfigError('missing key');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('FirecrawlConfigError');
  });
});
