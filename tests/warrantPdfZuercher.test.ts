import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseZuercherPdf } from '../src/utils/warrantSources/parse/pdfZuercher';

// ---------------------------------------------------------------------------
// McKenzie County, ND — 8-column Zuercher layout
// Header: Date Issued | Warrant Number | OCA # | Last, First Name | Charges | Bond | Extradition | Status
// Fixture captured 2026-06-13 from https://www.mckenziesheriff.net/usrfiles/cp/warrant_list_11-15-24.pdf
// Text: 391KB full document → trimmed to first 60 records (~9 KB)
// ---------------------------------------------------------------------------
describe('parseZuercherPdf — McKenzie ND (8-column)', () => {
  const text = readFileSync('tests/fixtures/warrants/zuercher-mckenzie.txt', 'utf8');

  it('returns at least 55 hits from 60-record fixture', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-mckenzie-nd', 'ND');
    expect(hits.length).toBeGreaterThanOrEqual(55);
  });

  it('sets source_key and state on every hit', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-mckenzie-nd', 'ND');
    for (const h of hits) {
      expect(h.source_key).toBe('pdf-zuercher-mckenzie-nd');
      expect(h.state).toBe('ND');
    }
  });

  it('produces non-empty warrant_id and full_name on every hit', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-mckenzie-nd', 'ND');
    for (const h of hits) {
      expect(h.warrant_id).toBeTruthy();
      expect(h.full_name).toBeTruthy();
    }
  });

  it('uses the explicit warrant number as warrant_id', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-mckenzie-nd', 'ND');
    // First record: ABBOTT, CARLEE — warrant W24-00412
    const abbott = hits.find(h => h.full_name?.includes('Abbott') && h.full_name?.includes('Carlee'));
    expect(abbott).toBeDefined();
    expect(abbott?.warrant_id).toBe('W24-00412');
  });

  it('parses issue_date as YYYY-MM-DD', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-mckenzie-nd', 'ND');
    const abbott = hits.find(h => h.warrant_id === 'W24-00412');
    expect(abbott?.issue_date).toBe('2024-06-20');
  });

  it('parses numeric bond amounts', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-mckenzie-nd', 'ND');
    const abbott = hits.find(h => h.warrant_id === 'W24-00412');
    expect(abbott?.bail_amount).toBe(750);
  });

  it('returns null bail_amount for "No Bond" records', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-mckenzie-nd', 'ND');
    // ACEVEDO, JUAN — W17-00064 — No Bond
    const acevedo = hits.find(h => h.warrant_id === 'W17-00064');
    expect(acevedo).toBeDefined();
    expect(acevedo?.bail_amount).toBeNull();
  });

  it('parses charge_description', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-mckenzie-nd', 'ND');
    const abbott = hits.find(h => h.warrant_id === 'W24-00412');
    expect(abbott?.charge_description).toContain('Bail Jump');
  });

  it('stores OCA number as case_number', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-mckenzie-nd', 'ND');
    const abbott = hits.find(h => h.warrant_id === 'W24-00412');
    expect(abbott?.case_number).toBe('202400443');
  });

  it('correctly splits LAST, FIRST name into parts', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-mckenzie-nd', 'ND');
    const abbott = hits.find(h => h.warrant_id === 'W24-00412');
    expect(abbott?.last_name).toBe('Abbott');
    expect(abbott?.first_name).toBe('Carlee');
  });

  it('deduplicates records with the same warrant_id', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-mckenzie-nd', 'ND');
    const ids = hits.map(h => h.warrant_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('returns empty array for empty input', () => {
    expect(parseZuercherPdf('', 'pdf-zuercher-mckenzie-nd', 'ND')).toEqual([]);
  });

  it('returns empty array for unrecognised text', () => {
    expect(parseZuercherPdf('hello world this is not a warrant list', 'any', 'ND')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Codington County, SD — 4-column Zuercher layout
// Header: Last, First Name | Charges | Bond | Date Issued
// Fixture captured 2026-06-13 from https://codington.sdcounty.gov/sheriff/information/warrants/Warrants.pdf
// Text: 172KB full document → trimmed to first 60 records (~7.6 KB)
// ---------------------------------------------------------------------------
describe('parseZuercherPdf — Codington SD (4-column)', () => {
  const text = readFileSync('tests/fixtures/warrants/zuercher-codington.txt', 'utf8');

  it('returns at least 55 hits from 60-record fixture', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-codington-sd', 'SD');
    expect(hits.length).toBeGreaterThanOrEqual(55);
  });

  it('sets source_key and state on every hit', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-codington-sd', 'SD');
    for (const h of hits) {
      expect(h.source_key).toBe('pdf-zuercher-codington-sd');
      expect(h.state).toBe('SD');
    }
  });

  it('produces non-empty warrant_id and full_name on every hit', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-codington-sd', 'SD');
    for (const h of hits) {
      expect(h.warrant_id).toBeTruthy();
      expect(h.full_name).toBeTruthy();
    }
  });

  it('parses first record (Abraham, McKenzie) correctly', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-codington-sd', 'SD');
    // cleanName title-cases the all-caps name, so "McKenzie" stays as "McKenzie"
    const first = hits.find(h => h.last_name === 'Abraham' && h.first_name === 'McKenzie');
    expect(first).toBeDefined();
    expect(first?.last_name).toBe('Abraham');
    expect(first?.first_name).toBe('McKenzie');
    expect(first?.issue_date).toBe('2026-03-03');
    expect(first?.bail_amount).toBeNull(); // "PR" = personal recognizance
    expect(first?.charge_description).toContain('Underage Purchase');
  });

  it('parses issue_date as YYYY-MM-DD', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-codington-sd', 'SD');
    for (const h of hits) {
      if (h.issue_date) {
        expect(h.issue_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('parses numeric bond amounts with qualifiers', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-codington-sd', 'SD');
    // Abrajan-Chontal, Abidan — 500.00 (Cash Only)
    const abrajan = hits.find(h => h.full_name?.includes('Abrajan'));
    expect(abrajan).toBeDefined();
    expect(abrajan?.bail_amount).toBe(500);
  });

  it('returns null bail_amount for "No Bond" records', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-codington-sd', 'SD');
    // Abraham, Sunshine — No Bond
    const sunshine = hits.find(h => h.full_name?.includes('Abraham') && h.full_name?.includes('Sunshine'));
    expect(sunshine).toBeDefined();
    expect(sunshine?.bail_amount).toBeNull();
  });

  it('derives a stable warrant_id (hash) when no warrant number is present', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-codington-sd', 'SD');
    const first = hits.find(h => h.last_name === 'Abraham' && h.first_name === 'McKenzie');
    expect(first?.warrant_id).toMatch(/^h[a-z0-9]+$/); // deriveWarrantId hash prefix
  });

  it('deduplicates records with the same derived warrant_id', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-codington-sd', 'SD');
    const ids = hits.map(h => h.warrant_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('handles hyphenated multi-part last names', () => {
    const hits = parseZuercherPdf(text, 'pdf-zuercher-codington-sd', 'SD');
    // Al-Baidhani, Samir
    const albaid = hits.find(h => h.last_name?.includes('Al-Baidhani'));
    expect(albaid).toBeDefined();
    expect(albaid?.first_name).toBe('Samir');
  });
});
