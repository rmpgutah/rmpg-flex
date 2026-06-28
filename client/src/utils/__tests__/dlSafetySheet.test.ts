import { describe, it, expect } from 'vitest';
import { generateSafetySheet } from '../dlSafetySheet';

describe('generateSafetySheet', () => {
  it('produces a PDF with danger banner for a flagged subject', () => {
    const doc = generateSafetySheet({
      ocrResult: { first_name: 'JOHN', last_name: 'SAMPLE', dob: '1985-01-15', dl_number: '123456789', dl_state: 'UT', scan_method: 'PDF417 BARCODE' },
      leFields: [{ tag: 'NAM', label: 'Name', value: 'SAMPLE,JOHN' }, { tag: 'DOB', label: 'Date of Birth', value: '19850115' }, { tag: 'HGT', label: 'Height', value: '510' }],
      scanAlerts: [{ level: 'danger', code: 'EXPIRED', message: 'LICENSE EXPIRED 2025-01-15' }, { level: 'warning', code: 'UNDER_21', message: 'Subject under 21' }],
      scanMatches: [{ id: 7, first_name: 'JOHN', last_name: 'SAMPLE', active_warrants: 2, total_warrants: 3 }],
      deepSweep: {
        sources: [{ key: 'utah_sor', label: 'Utah Sex Offender Registry', danger: true, rows: [{ summary: 'SAMPLE, JOHN — UTAH SOR · III RISK', danger: true }] }],
        profile: { person: { id: 7, first_name: 'JOHN', last_name: 'SAMPLE', is_sex_offender: 1, sor_number: 'UT123', gang_affiliation: 'None', scars_marks_tattoos: 'Tattoo left arm' }, criminal_history: [{ offense_date: '2020-01-01', offense: 'Assault', disposition: 'Convicted' }], incidents: [], vehicles: [{ plate_number: 'ABC123', state: 'UT', make: 'Ford', is_stolen: 1 }] },
      },
      courtRecords: [{ case_name: 'United States v. Sample', court: 'D. Utah', date_filed: '2024-03-01', is_criminal: true }],
    });
    const out = doc.output('arraybuffer');
    expect(out.byteLength).toBeGreaterThan(1000);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('produces a clean sheet with no-flags banner when nothing returns', () => {
    const doc = generateSafetySheet({ ocrResult: { last_name: 'DOE', first_name: 'JANE' }, leFields: null, scanAlerts: [], scanMatches: [], deepSweep: null, courtRecords: null });
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(800);
  });
});
