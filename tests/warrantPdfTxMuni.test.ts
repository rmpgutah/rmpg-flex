import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTxMuniPdf } from '../src/utils/warrantSources/parse/pdfTxMuni';

// ---------------------------------------------------------------------------
// Killeen, TX — Name | Warrant Date | Balance Due | Offense Description
// Fixture captured 2026-06-13 from
// https://www.killeentexas.gov/DocumentCenter/View/6548/Active-Warrant-List-PDF
// (620 KB full document → first ~147 records, ~12 KB). Balance precedes offense;
// no warrant number (id is derived).
// ---------------------------------------------------------------------------
describe('parseTxMuniPdf — Killeen (date | balance | offense)', () => {
  const text = readFileSync('tests/fixtures/warrants/txmuni-killeen.txt', 'utf8');

  it('returns at least 55 hits', () => {
    const hits = parseTxMuniPdf(text, 'pdf-txmuni-killeen-tx', 'TX');
    expect(hits.length).toBeGreaterThanOrEqual(55);
  });

  it('sets source_key, state, full_name and warrant_id on every hit', () => {
    const hits = parseTxMuniPdf(text, 'pdf-txmuni-killeen-tx', 'TX');
    for (const h of hits) {
      expect(h.source_key).toBe('pdf-txmuni-killeen-tx');
      expect(h.state).toBe('TX');
      expect(h.full_name).toBeTruthy();
      expect(h.warrant_id).toBeTruthy();
    }
  });

  it('parses the first record (AARON, FLOYD LEE III) correctly', () => {
    const hits = parseTxMuniPdf(text, 'pdf-txmuni-killeen-tx', 'TX');
    const aaron = hits.find(h => h.last_name === 'Aaron');
    expect(aaron).toBeDefined();
    expect(aaron?.first_name).toBe('Floyd');
    expect(aaron?.issue_date).toBe('2019-05-13');
    expect(aaron?.bail_amount).toBe(557.83);
    expect(aaron?.charge_description).toContain('UNSAFE SPEED/TOO FAST FOR CONDITIONS');
  });

  it('parses thousands-separated balances (2,184.00 -> 2184)', () => {
    const hits = parseTxMuniPdf(text, 'pdf-txmuni-killeen-tx', 'TX');
    const lara = hits.find(h => h.last_name === 'Abeldano Godoy' && h.bail_amount === 2184);
    expect(lara).toBeDefined();
    expect(lara?.first_name).toBe('Lara');
  });

  it('keeps multiple offenses for the same defendant as distinct hits', () => {
    const hits = parseTxMuniPdf(text, 'pdf-txmuni-killeen-tx', 'TX');
    // ABBAS, SEAN ALI has two warrants on 12/08/2025 (497.20 + 811.80)
    const abbas = hits.filter(h => h.last_name === 'Abbas' && h.first_name === 'Sean');
    expect(abbas.length).toBeGreaterThanOrEqual(2);
    const amounts = abbas.map(h => h.bail_amount).sort();
    expect(amounts).toContain(497.2);
    expect(amounts).toContain(811.8);
  });

  it('reconstructs a wrapped offense that contains commas without corrupting the name', () => {
    const hits = parseTxMuniPdf(text, 'pdf-txmuni-killeen-tx', 'TX');
    // "ADAMS, JOHNATHAN RYAN 01/13/2026 297.83" offense wraps as
    //   "FAILED TO YIELD ROW FROM PVT RD, DR," / "ALLEY, BLDG"
    // The comma-bearing fragment "ALLEY, BLDG" must NOT be read as a new defendant.
    const wrapped = hits.find(h => h.last_name === 'Adams' && h.first_name === 'Johnathan' && h.bail_amount === 297.83);
    expect(wrapped).toBeDefined();
    expect(wrapped?.charge_description).toContain('PVT RD');
    expect(wrapped?.charge_description).toContain('ALLEY');
    // and no defendant ever absorbs an offense fragment as a surname
    expect(hits.some(h => h.last_name?.includes('Alley') || h.last_name?.includes('Pvt'))).toBe(false);
  });

  it('strips page-break boilerplate out of every charge and name', () => {
    const hits = parseTxMuniPdf(text, 'pdf-txmuni-killeen-tx', 'TX');
    for (const h of hits) {
      const c = `${h.charge_description ?? ''} ${h.full_name ?? ''}`;
      expect(c).not.toContain('Defendant Name');
      expect(c).not.toContain('WARRANT LIST');
      expect(c).not.toMatch(/AS OF \d/);
    }
  });
});

// ---------------------------------------------------------------------------
// Bell Mead, TX — Name | Warrant No | Balance Due | Offense Description
// Warrant number replaces the date (e.g. "171511 01", "B000056701"); no issue date.
// ---------------------------------------------------------------------------
describe('parseTxMuniPdf — Bell Mead (warrant-no | balance | offense)', () => {
  const text = readFileSync('tests/fixtures/warrants/txmuni-bellmead.txt', 'utf8');

  it('returns at least 55 hits', () => {
    const hits = parseTxMuniPdf(text, 'pdf-txmuni-bellmead-tx', 'TX');
    expect(hits.length).toBeGreaterThanOrEqual(55);
  });

  it('parses the first record (ABALOS, PAULA JENNETTE) with warrant no as case_number', () => {
    const hits = parseTxMuniPdf(text, 'pdf-txmuni-bellmead-tx', 'TX');
    const abalos = hits.find(h => h.last_name === 'Abalos' && h.bail_amount === 426.6);
    expect(abalos).toBeDefined();
    expect(abalos?.first_name).toBe('Paula');
    expect(abalos?.case_number).toContain('171511');
    expect(abalos?.charge_description).toContain('NO DRIVERS LICENSE');
    expect(abalos?.issue_date == null).toBe(true); // no date column
  });

  it('handles a letter-prefixed warrant number adjacent to its balance (B000117801 425.10)', () => {
    const hits = parseTxMuniPdf(text, 'pdf-txmuni-bellmead-tx', 'TX');
    // The "B" prefix must not be mis-read as a middle initial, and the balance must split cleanly.
    const ahmad = hits.find(h => h.case_number?.includes('B000117801'));
    expect(ahmad).toBeDefined();
    expect(ahmad?.last_name).toBe('Abushanap');
    expect(ahmad?.first_name).toBe('Ahmad');
    expect(ahmad?.bail_amount).toBe(425.1);
    expect(ahmad?.charge_description).toContain('NO DRIVERS LICENSE');
  });

  it('sets source_key and state on every hit', () => {
    const hits = parseTxMuniPdf(text, 'pdf-txmuni-bellmead-tx', 'TX');
    for (const h of hits) {
      expect(h.source_key).toBe('pdf-txmuni-bellmead-tx');
      expect(h.state).toBe('TX');
      expect(h.full_name).toBeTruthy();
    }
  });

  it('strips the two-line "MUNICIPAL COURT / ACTIVE WARRANT LISTING" page banner from charges', () => {
    const hits = parseTxMuniPdf(text, 'pdf-txmuni-bellmead-tx', 'TX');
    for (const h of hits) {
      expect(h.charge_description ?? '').not.toMatch(/MUNICIPAL COURT/i);
      expect(h.charge_description ?? '').not.toMatch(/ACTIVE WARRANT LISTING/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Taylor, TX — Name | Warrant Date | Citation No | Offense Description | Balance Due
// Balance is at the END of the row (after the offense); has a citation number.
// ---------------------------------------------------------------------------
describe('parseTxMuniPdf — Taylor (date | citation | offense | balance-at-end)', () => {
  const text = readFileSync('tests/fixtures/warrants/txmuni-taylor.txt', 'utf8');

  it('returns at least 55 hits', () => {
    const hits = parseTxMuniPdf(text, 'pdf-txmuni-taylor-tx', 'TX');
    expect(hits.length).toBeGreaterThanOrEqual(55);
  });

  it('parses the first record (ABUNDIZ, LUCY) with balance pulled off the end', () => {
    const hits = parseTxMuniPdf(text, 'pdf-txmuni-taylor-tx', 'TX');
    const lucy = hits.find(h => h.last_name === 'Abundiz' && h.first_name === 'Lucy' && h.bail_amount === 401.7);
    expect(lucy).toBeDefined();
    expect(lucy?.issue_date).toBe('2017-12-13');
    expect(lucy?.case_number).toBe('1006565');
    // The trailing balance must not bleed into the charge, and the in-charge "(BEFORE 9/1/09)" must survive.
    expect(lucy?.charge_description).toContain('UNRESTRAINED CHILD');
    expect(lucy?.charge_description).not.toMatch(/401\.7\s*$/);
  });

  it('parses integer balances (no decimal) at end of row', () => {
    const hits = parseTxMuniPdf(text, 'pdf-txmuni-taylor-tx', 'TX');
    // ACEVEDO, OSCAR ANTONIO ... SPEEDING SCHOOL ZONE 41 MPH in a 30 MPH zone 252
    const oscar = hits.find(h => h.last_name === 'Acevedo' && h.first_name === 'Oscar');
    expect(oscar).toBeDefined();
    expect(oscar?.bail_amount).toBe(252);
    expect(oscar?.charge_description).toContain('SPEEDING SCHOOL ZONE');
  });

  it('sets source_key and state on every hit', () => {
    const hits = parseTxMuniPdf(text, 'pdf-txmuni-taylor-tx', 'TX');
    for (const h of hits) {
      expect(h.source_key).toBe('pdf-txmuni-taylor-tx');
      expect(h.state).toBe('TX');
      expect(h.full_name).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Robustness contract
// ---------------------------------------------------------------------------
describe('parseTxMuniPdf — robustness', () => {
  it('returns [] for empty input', () => {
    expect(parseTxMuniPdf('', 'pdf-txmuni-killeen-tx', 'TX')).toEqual([]);
  });
  it('returns [] for unrecognised input', () => {
    expect(parseTxMuniPdf('hello world not a warrant list', 'x', 'TX')).toEqual([]);
  });
});
