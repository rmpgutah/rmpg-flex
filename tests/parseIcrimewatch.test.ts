import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseIcrimewatchDetail, extractOfndrIds } from '../src/utils/sorSources/parseIcrimewatch';

const html = readFileSync(new URL('./fixtures/icrimewatch-detail.html', import.meta.url), 'utf8');

describe('parseIcrimewatchDetail', () => {
  const rec = parseIcrimewatchDetail(html, '2301330');
  it('extracts identity + registration', () => {
    expect(rec.registry_id).toBe('2301330');
    expect(rec.last_name.toUpperCase()).toBe('CLARK');
    expect(rec.first_name.toUpperCase()).toContain('CAMDEN');
  });
  it('extracts physical description', () => {
    expect(rec.sex.toUpperCase()).toBe('M');
    expect(rec.race.toUpperCase()).toContain('WHITE');
  });
  it('captures the full detail blob with offenses + aliases', () => {
    const d = JSON.parse(rec.detail_json);
    expect(Array.isArray(d.offenses)).toBe(true);
    expect(d.offenses.length).toBeGreaterThan(0);
    expect(Array.isArray(d.aliases)).toBe(true);
    expect(d.status).toMatch(/active/i);
  });
  it('captures a photo url when present', () => {
    expect(rec.photo_url).toMatch(/\/pictures\/\d+\/\d+/);
  });
});

describe('parseIcrimewatchDetail — robustness', () => {
  it('returns empty fields without throwing on a challenge/garbage page', () => {
    const rec = parseIcrimewatchDetail('<html><body>Access Denied</body></html>', '999');
    expect(rec.last_name).toBe('');
    expect(rec.first_name).toBe('');
    expect(() => parseIcrimewatchDetail('', '0')).not.toThrow();
  });
});

describe('extractOfndrIds', () => {
  it('pulls OfndrID values out of a results page', () => {
    const sample = '<a href="offenderdetails.php?OfndrID=111&AgencyID=54438">x</a>'
      + '<a href="offenderdetails.php?OfndrID=222&AgencyID=54438">y</a>';
    expect(extractOfndrIds(sample)).toEqual(['111', '222']);
  });
  it('dedups repeated ids', () => {
    const sample = 'OfndrID=5 OfndrID=5 OfndrID=6';
    expect(extractOfndrIds(sample)).toEqual(['5', '6']);
  });
});
