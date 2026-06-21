import { describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { searchByAddress, getParcel, buildQueryUrl }
  from '../src/utils/sl-assessor/client';
import { AssessorConfigError, AssessorHttpError, AssessorParseError }
  from '../src/utils/sl-assessor/types';

const fixture = (n: string) =>
  readFileSync(join(__dirname, 'fixtures/sl-assessor', n), 'utf8');

describe('buildQueryUrl', () => {
  test('encodes the address', () => {
    const url = buildQueryUrl('2200 S 500 E');
    expect(url).toContain('apps.saltlakecounty.gov/assessor');
    expect(url).toContain(encodeURIComponent('2200 S 500 E'));
  });
});

describe('searchByAddress', () => {
  test('rejects when FIRECRAWL_API_KEY unset', async () => {
    await expect(searchByAddress({}, '2200 S 500 E')).rejects.toBeInstanceOf(AssessorConfigError);
  });

  test('returns parsed parcels on Firecrawl success', async () => {
    const html = fixture('multi.html');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ success: true, data: { html } }), { status: 200 }),
    );
    const out = await searchByAddress({ FIRECRAWL_API_KEY: 'sk_test' }, '2200 S 500 E');
    expect(out.length).toBeGreaterThanOrEqual(2);
    fetchSpy.mockRestore();
  });

  test('throws AssessorHttpError on Firecrawl 5xx', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('boom', { status: 502 }),
    );
    await expect(
      searchByAddress({ FIRECRAWL_API_KEY: 'sk_test' }, '2200 S 500 E'),
    ).rejects.toBeInstanceOf(AssessorHttpError);
    fetchSpy.mockRestore();
  });
});
