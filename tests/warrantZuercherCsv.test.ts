import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseZuercherCsv } from '../src/utils/warrantSources/parse/zuercherCsv';

// Zuercher portal CSV export (`web_warrant_list.csv`) — used by Teton County, WY
// and many other Zuercher-platform sheriffs. Header row names the columns;
// Last_First_Name and Charges may be quoted (charges embed commas + semicolons).
describe('parseZuercherCsv — Teton County, WY', () => {
  const csv = readFileSync('tests/fixtures/warrants/teton-wy.csv', 'utf8');

  it('parses all 30 data rows', () => {
    const hits = parseZuercherCsv(csv, 'csv-zuercher-teton-wy', 'WY');
    expect(hits.length).toBe(30);
  });

  it('sets source_key, state, full_name and warrant_id on every hit', () => {
    const hits = parseZuercherCsv(csv, 'csv-zuercher-teton-wy', 'WY');
    for (const h of hits) {
      expect(h.source_key).toBe('csv-zuercher-teton-wy');
      expect(h.state).toBe('WY');
      expect(h.full_name).toBeTruthy();
      expect(h.warrant_id).toBeTruthy();
    }
  });

  it('maps the first row (MORSETH, DUSTIN) with 2-digit-year date + bond', () => {
    const hits = parseZuercherCsv(csv, 'csv-zuercher-teton-wy', 'WY');
    const m = hits.find(h => h.last_name === 'Morseth');
    expect(m).toBeDefined();
    expect(m?.first_name).toBe('Dustin');
    expect(m?.issue_date).toBe('2026-06-11');   // 06/11/26 → 2026
    expect(m?.warrant_id).toBe('W202600145');
    expect(m?.case_number).toBe('W202600145');
    expect(m?.bail_amount).toBe(1500);          // "1500.00 (Cash/Surety)"
    expect(m?.age).toBe(48);
    expect(m?.charge_description).toContain('CARELESS DRIVING');
  });

  it('keeps commas inside a quoted Charges field intact', () => {
    const hits = parseZuercherCsv(csv, 'csv-zuercher-teton-wy', 'WY');
    // CASTRO-OCHOA's charges are quoted because one charge text contains commas.
    const c = hits.find(h => h.last_name === 'Castro-Ochoa');
    expect(c).toBeDefined();
    expect(c?.charge_description).toContain('DRIVING WHILE LICENSE SUSPENDED, CANCELED, OR REVOKED');
  });

  it('returns [] for empty / header-only / non-CSV input', () => {
    expect(parseZuercherCsv('', 'csv-zuercher-teton-wy', 'WY')).toEqual([]);
    expect(parseZuercherCsv('Date_Issued,Last_First_Name,Charges,Warrant_Number,Bond', 'x', 'WY')).toEqual([]);
    expect(parseZuercherCsv('just some text\nwith no warrant columns', 'x', 'WY')).toEqual([]);
  });
});
