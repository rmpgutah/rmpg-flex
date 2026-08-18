import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseNatrona, parseNatronaPager } from '../../src/utils/warrantSources/parse/natrona';

const html = readFileSync(new URL('./fixtures/natrona.html', import.meta.url), 'utf8');

describe('parseNatrona', () => {
  it('extracts person rows with a stable warrant_id + name', () => {
    const hits = parseNatrona(html);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].warrant_id).toBeTruthy();
    expect(hits[0].last_name || hits[0].full_name).toBeTruthy();
    expect(hits[0].source_key).toBe('natrona-county-wy');
    expect(hits[0].state).toBe('WY');
  });

  it('parses age where present', () => {
    const hits = parseNatrona(html);
    expect(hits.some((h) => typeof h.age === 'number')).toBe(true);
  });

  it('does not include the header row', () => {
    const hits = parseNatrona(html);
    expect(hits.every((h) => (h.full_name || '').toLowerCase() !== 'name')).toBe(true);
  });

  it('produces unique warrant_ids', () => {
    const hits = parseNatrona(html);
    const ids = hits.map((h) => h.warrant_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns [] when no results', () => {
    expect(parseNatrona('<html><body>Found 0 Warrants</body></html>')).toEqual([]);
  });

  it('extracts the 10 person rows visible on the page (header excluded)', () => {
    const hits = parseNatrona(html);
    expect(hits.length).toBe(10);
  });

  it('parses FIRST LAST name format and a synthetic natrona: warrant_id', () => {
    const hits = parseNatrona(html);
    const anthony = hits.find((h) => h.full_name === 'Anthony Smith');
    expect(anthony).toBeDefined();
    expect(anthony!.first_name).toBe('Anthony');
    expect(anthony!.last_name).toBe('Smith');
    expect(anthony!.age).toBe(63);
    expect(anthony!.warrant_id).toBe('natrona:smith-anthony-63');
    expect(anthony!.charge_description ?? null).toBeNull();
    expect(anthony!.bail_amount ?? null).toBeNull();
  });
});

describe('parseNatronaPager', () => {
  it('detects a Next link using &#39; entity-encoded quotes', () => {
    // Build the HTML entity string at runtime so TS/esbuild cannot alter it.
    // ASP.NET control IDs use '$' (not '&') as the separator, so the target
    // is safe for the [^'&]+ capture group.
    const amp = String.fromCharCode(38); // '&'
    const eq = `${amp}#39;`; // '&#39;'
    const target = 'ctl00$MainContent$DataPager1$ctl02$ctl00';
    const h = `<a href="javascript:__doPostBack(${eq}${target}${eq},${eq}${eq})">Next</a>`;
    expect(parseNatronaPager(h)).toBe(target);
  });

  it('detects a Next link using literal single quotes', () => {
    // Use String.fromCharCode(39) so the quote char is never part of template source.
    const q = String.fromCharCode(39); // "'"
    const h = `<a href="javascript:__doPostBack(${q}ctl00$DataPager$ctl02${q},${q}${q})">Next</a>`;
    expect(parseNatronaPager(h)).toBe('ctl00$DataPager$ctl02');
  });

  it('detects the fixture Next link', () => {
    // The fixture is Page 1 of 2, so a DataPager Next link must be present.
    expect(parseNatronaPager(html)).toMatch(/DataPager/);
  });

  it('returns null when there is no Next link', () => {
    expect(parseNatronaPager('<html><body>no pager</body></html>')).toBeNull();
  });

  it('returns null when only non-Next pager links exist', () => {
    const q = String.fromCharCode(39);
    const prevOnly = `<a href="javascript:__doPostBack(${q}Prev${q},${q}${q})">Prev</a>`;
    expect(parseNatronaPager(prevOnly)).toBeNull();
  });
});
