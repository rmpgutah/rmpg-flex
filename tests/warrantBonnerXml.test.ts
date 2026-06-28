import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBonnerXml } from '../src/utils/warrantSources/parse/bonnerXml';

// Bonner County, ID sheriff publishes a structured XML warrant feed (felony +
// misdemeanor). Each <warrant> carries name, DOB, warrant #, issued date, class
// (FE/MI), charge description, and bond. Fixture = first 30 felony records.
describe('parseBonnerXml — Bonner County, ID', () => {
  const xml = readFileSync('tests/fixtures/warrants/bonner-id.xml', 'utf8');

  it('parses all 30 warrants in the fixture', () => {
    const hits = parseBonnerXml(xml, 'xml-bonner-felony-id', 'ID');
    expect(hits.length).toBe(30);
  });

  it('sets source_key, state, full_name, warrant_id and DOB on every hit', () => {
    const hits = parseBonnerXml(xml, 'xml-bonner-felony-id', 'ID');
    for (const h of hits) {
      expect(h.source_key).toBe('xml-bonner-felony-id');
      expect(h.state).toBe('ID');
      expect(h.full_name).toBeTruthy();
      expect(h.warrant_id).toBeTruthy();
      expect(h.date_of_birth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('maps the first record (Achziger, Andrew James) fully', () => {
    const hits = parseBonnerXml(xml, 'xml-bonner-felony-id', 'ID');
    const a = hits.find(h => h.last_name === 'Achziger');
    expect(a).toBeDefined();
    expect(a?.first_name).toBe('Andrew');
    expect(a?.middle_name).toBe('James');
    expect(a?.date_of_birth).toBe('1975-01-09');     // DOB:01/09/1975
    expect(a?.warrant_id).toBe('34297');             // Warrant:34297
    expect(a?.case_number).toBe('34297');
    expect(a?.issue_date).toBe('2021-12-07');        // Issued:12/07/2021
    expect(a?.warrant_type).toBe('Felony');          // Class:FE
    expect(a?.charge_description).toContain('Possession Of Controlled Substance');
    expect(a?.bail_amount).toBe(20000);              // $20000.00
  });

  it('returns [] for empty / non-XML input', () => {
    expect(parseBonnerXml('', 'xml-bonner-felony-id', 'ID')).toEqual([]);
    expect(parseBonnerXml('<html>not warrants</html>', 'x', 'ID')).toEqual([]);
  });
});
