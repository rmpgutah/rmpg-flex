import { describe, expect, test, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { searchByAddress, getParcel, buildQueryUrl, parseAddressComponents }
  from '../src/utils/sl-assessor/client';
import { AssessorConfigError, AssessorHttpError, AssessorParseError }
  from '../src/utils/sl-assessor/types';

const fixture = (n: string) =>
  readFileSync(join(__dirname, 'fixtures/sl-assessor', n), 'utf8');

describe('parseAddressComponents', () => {
  // Regression test: verified live 2026-07-14 against parcel
  // 27-18-451-077-0000 ("10846 S INDIGO SKY WY") — the real SLCo Assessor
  // address-search form only recognizes the "WY" abbreviation for Way
  // streets. Searching with the literal word "Way" (previously mapped to
  // itself, unchanged) returned zero results for a parcel that genuinely
  // exists, silently producing a false "no matching parcels" in the UI.
  test('normalizes "Way" to the SLCo form\'s "WY" abbreviation', () => {
    const comps = parseAddressComponents('10846 S Indigo Sky Way');
    expect(comps.street_type).toBe('WY');
  });

  test('leaves an already-abbreviated "WY" token untouched', () => {
    const comps = parseAddressComponents('10846 S Indigo Sky WY');
    expect(comps.street_type).toBe('WY');
  });

  // Regression: callers now pass a full "street, city, state zip" address
  // (needed so resolveCountyFromAddress can route by city/ZIP) — this must
  // parse identically to a bare street, not glue the city/state/zip onto
  // street_name and guarantee a false "no match".
  test('strips a city/state/zip suffix before parsing the street', () => {
    const comps = parseAddressComponents('10846 South Indigo Sky Way, South Jordan, UT 84009');
    expect(comps.street_Num).toBe('10846');
    expect(comps.street_dir).toBe('S');
    expect(comps.street_name).toBe('INDIGO SKY');
    expect(comps.street_type).toBe('WY');
  });
});

describe('buildQueryUrl', () => {
  test('encodes the address', () => {
    const url = buildQueryUrl('2200 S 500 E');
    expect(url).toContain('apps.saltlakecounty.gov/assessor');
    expect(url).toContain(encodeURIComponent('2200 S 500 E'));
  });
});

describe('searchByAddress', () => {
  // The new client POSTs directly to resultsMain.cfm (no Firecrawl key needed
  // for the single-result path). Without a key it falls back to direct POST only.
  test('returns empty array when all upstream calls fail (no key, POST errors)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('connection refused', { status: 502 }),
    );
    const out = await searchByAddress({}, '2200 S 500 E');
    expect(out).toEqual([]);
    fetchSpy.mockRestore();
  });

  test('returns parsed parcels on Firecrawl success (multi-result path)', async () => {
    const html = fixture('multi.html');
    // All fetch calls return Firecrawl-format JSON. The POST to resultsMain.cfm
    // gets this JSON body (res.url='' → no redirect), then Firecrawl is called
    // and the html is parsed as a parcel list.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ success: true, data: { html } }), { status: 200 }),
    );
    const out = await searchByAddress({ FIRECRAWL_API_KEY: 'sk_test' }, '2200 S 500 E');
    expect(out.length).toBeGreaterThanOrEqual(1);
    fetchSpy.mockRestore();
  });

  test('returns empty array when all fetches return 5xx (does not throw)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('boom', { status: 502 }),
    );
    // New behaviour: errors are swallowed and empty array returned instead of throwing.
    await expect(
      searchByAddress({ FIRECRAWL_API_KEY: 'sk_test' }, '2200 S 500 E'),
    ).resolves.toEqual([]);
    fetchSpy.mockRestore();
  });
});

describe('parseAddressComponents — spelled-out trailing direction', () => {
  // "Could not reach the Assessor" on 10506 South 465 East, Sandy.
  // SLC's grid names streets by DIRECTION ("465 East"), and the county's form
  // wants that as street_type="E". Only TYPE_EXPAND was applied to the
  // trailing token, so "EAST" stayed a literal word and street_name became
  // "465 EAST" — the POST then returned the search form rather than the
  // parcel, which the UI reports as an unreachable assessor.
  //
  // Verified live 2026-08-01 against resultsMain.cfm:
  //   {name:'465', type:'E'}    → 302 to the detail page (43 KB)
  //   {name:'465 EAST'}         → search form (16.8 KB)

  it('expands a trailing EAST to the street_type the county expects', () => {
    expect(parseAddressComponents('10506 South 465 East')).toEqual({
      street_Num: '10506', street_dir: 'S', street_name: '465', street_type: 'E',
    });
  });

  it('expands every spelled-out trailing direction', () => {
    for (const [word, abbr] of [['North', 'N'], ['South', 'S'], ['East', 'E'], ['West', 'W']]) {
      expect(parseAddressComponents(`1000 East 500 ${word}`).street_type).toBe(abbr);
    }
  });

  it('still accepts the already-abbreviated form', () => {
    expect(parseAddressComponents('10506 S 465 E')).toEqual({
      street_Num: '10506', street_dir: 'S', street_name: '465', street_type: 'E',
    });
  });

  it('does not mistake a street TYPE for a direction', () => {
    const c = parseAddressComponents('3533 South Terra Sol Drive');
    expect(c.street_name).toBe('TERRA SOL');
    expect(c.street_type).toBe('DR');
  });

  it('leaves a named street with no trailing token alone', () => {
    expect(parseAddressComponents('4000 South Redwood Road').street_name).toBe('REDWOOD');
  });
});
