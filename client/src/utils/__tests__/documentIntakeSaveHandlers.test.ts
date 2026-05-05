import { describe, it, expect } from 'vitest';
import {
  splitPersonName, parseMoney, normalizeDate,
  buildWarrantPayload, buildFiPayload,
  buildWitnessStatementSupplement, buildInfoFormSupplement,
  getSaveBuilder, hasSaveHandler, requiresIncident,
} from '../documentIntakeSaveHandlers';

describe('splitPersonName', () => {
  it('splits "LAST, FIRST" form', () => {
    expect(splitPersonName('SMITH, JANE')).toEqual({ first: 'JANE', last: 'SMITH' });
  });
  it('splits "FIRST LAST" form', () => {
    expect(splitPersonName('Jane Smith')).toEqual({ first: 'Jane', last: 'Smith' });
  });
  it('handles three-part names with comma form', () => {
    expect(splitPersonName('Doe, John Q')).toEqual({ first: 'John Q', last: 'Doe' });
  });
  it('handles single-token names', () => {
    expect(splitPersonName('Madonna')).toEqual({ first: '', last: 'Madonna' });
  });
  it('returns blanks for empty input', () => {
    expect(splitPersonName('')).toEqual({ first: '', last: '' });
  });
  it('collapses whitespace', () => {
    expect(splitPersonName('  SMITH ,   JANE  ')).toEqual({ first: 'JANE', last: 'SMITH' });
  });
});

describe('parseMoney', () => {
  it('parses dollar-sign + commas', () => {
    expect(parseMoney('$5,000.00')).toBe(5000);
  });
  it('parses bare numbers', () => {
    expect(parseMoney('5000')).toBe(5000);
  });
  it('returns null on garbage', () => {
    expect(parseMoney('abc')).toBeNull();
  });
  it('returns null on empty', () => {
    expect(parseMoney('')).toBeNull();
  });
});

describe('normalizeDate', () => {
  it('converts MM/DD/YYYY to ISO', () => {
    expect(normalizeDate('05/05/2024')).toBe('2024-05-05');
  });
  it('expands 2-digit years', () => {
    expect(normalizeDate('5/5/24')).toBe('2024-05-05');
  });
  it('passes through unrecognized formats', () => {
    expect(normalizeDate('May 5, 2024')).toBe('May 5, 2024');
  });
});

describe('buildWarrantPayload', () => {
  it('classifies bench warrant type', () => {
    const result = buildWarrantPayload({
      warrant_type: 'BENCH WARRANT',
      charges: 'Failure to Appear',
      bond_amount: '5000.00',
      issuing_judge: 'Hon. Smith',
      court_name: 'Third District Court',
      defendant_name: 'DOE, JOHN',
      defendant_dob: '04/15/1980',
      docket_number: '2024-CR-001',
      issued_date: '03/01/2024',
    });
    expect(result.endpoint).toBe('/warrants');
    expect(result.payload).toMatchObject({
      type: 'bench',
      charge_description: 'Failure to Appear',
      issuing_court: 'Third District Court',
      issuing_judge: 'Hon. Smith',
      bail_amount: 5000,
    });
    expect((result.payload as any).notes).toContain('DOE, JOHN');
    expect((result.payload as any).notes).toContain('04/15/1980');
    expect((result.payload as any).notes).toContain('2024-CR-001');
  });

  it('classifies FTA warrant type', () => {
    const result = buildWarrantPayload({ warrant_type: 'FAILURE TO APPEAR', charges: 'X' });
    expect((result.payload as any).type).toBe('fta');
  });

  it('classifies search warrant type', () => {
    const result = buildWarrantPayload({ warrant_type: 'SEARCH WARRANT', charges: 'X' });
    expect((result.payload as any).type).toBe('search');
  });

  it('defaults unknown type to arrest', () => {
    const result = buildWarrantPayload({ warrant_type: 'WRIT OF SOMETHING', charges: 'X' });
    expect((result.payload as any).type).toBe('arrest');
  });

  it('falls back to "(see notes)" when charges blank', () => {
    const result = buildWarrantPayload({});
    expect((result.payload as any).charge_description).toBe('(see notes)');
  });
});

describe('buildFiPayload', () => {
  it('builds full FI payload with split name + ISO dates', () => {
    const result = buildFiPayload({
      subject_name: 'SMITH, JANE',
      subject_dob: '03/15/1985',
      subject_address: '456 Oak Ave, SLC, UT',
      phone: '801-555-1234',
      contact_date: '05/01/2024',
      contact_location: '123 Main St',
      reason_for_contact: 'loitering',
      action_taken: 'identified, no charges',
      vehicle_plate: 'ABC123',
      vehicle_description: 'Silver Sedan',
    });
    expect(result.endpoint).toBe('/field-interviews');
    expect(result.payload).toMatchObject({
      date: '2024-05-01',
      location: '123 Main St',
      reason: 'loitering',
      disposition: 'identified, no charges',
      contact_type: 'field',
      subject_first_name: 'JANE',
      subject_last_name: 'SMITH',
      subject_dob: '1985-03-15',
      vehicle_plate: 'ABC123',
      vehicle_description: 'Silver Sedan',
    });
    expect((result.payload as any).narrative).toContain('456 Oak Ave');
    expect((result.payload as any).narrative).toContain('801-555-1234');
  });

  it('defaults date to today when not in OCR', () => {
    const result = buildFiPayload({ subject_name: 'X' });
    const today = new Date().toISOString().slice(0, 10);
    expect((result.payload as any).date).toBe(today);
  });

  it('defaults reason and disposition when blank', () => {
    const result = buildFiPayload({ subject_name: 'X' });
    expect((result.payload as any).reason).toBe('other');
    expect((result.payload as any).disposition).toBe('none');
  });
});

describe('buildWitnessStatementSupplement', () => {
  it('builds /incidents/:id/supplements payload with composed narrative', () => {
    const result = buildWitnessStatementSupplement(
      {
        witness_name: 'ROE, RICHARD',
        witness_dob: '7/4/1970',
        witness_address: '321 Pine St',
        witness_phone: '801-555-7777',
        interviewing_officer: 'Detective Cruz',
        statement_body: 'On June 1st I observed two males approach the victim.',
        incident_date: '06/01/2024',
        incident_location: '100 Main St',
      },
      { incidentId: 42, incidentNumber: 'INC-2024-0123' },
    );
    expect(result.endpoint).toBe('/incidents/42/supplements');
    expect((result.payload as any).report_type).toBe('witness_statement');
    expect((result.payload as any).subject).toBe('Statement of ROE, RICHARD');
    expect((result.payload as any).narrative).toContain('Witness: ROE, RICHARD');
    expect((result.payload as any).narrative).toContain('DOB: 7/4/1970');
    expect((result.payload as any).narrative).toContain('--- STATEMENT ---');
    expect((result.payload as any).narrative).toContain('two males');
    expect(result.label).toContain('INC-2024-0123');
  });

  it('throws when incidentId is missing', () => {
    expect(() => buildWitnessStatementSupplement({ witness_name: 'X' }, {})).toThrow(/incidentId/);
  });

  it('uses "Unknown Witness" subject when name is blank', () => {
    const result = buildWitnessStatementSupplement({}, { incidentId: 1 });
    expect((result.payload as any).subject).toBe('Statement of Unknown Witness');
  });
});

describe('buildInfoFormSupplement', () => {
  it('builds payload with reference number in subject when present', () => {
    const result = buildInfoFormSupplement(
      {
        reference_number: 'INFO-2024-0042',
        subject_name: 'BROWN, ALICE',
        subject_dob: '12/31/1972',
        occurrence_date: '02/14/2024',
        reporting_party: 'NEIGHBOR, BOB',
        narrative: 'RP states he heard yelling next door at 0200.',
      },
      { incidentId: 7, incidentNumber: 'INC-2024-0007' },
    );
    expect(result.endpoint).toBe('/incidents/7/supplements');
    expect((result.payload as any).report_type).toBe('supplemental');
    expect((result.payload as any).subject).toBe('Info Report INFO-2024-0042');
    expect((result.payload as any).narrative).toContain('Reference #: INFO-2024-0042');
    expect((result.payload as any).narrative).toContain('Reporting Party: NEIGHBOR, BOB');
    expect((result.payload as any).narrative).toContain('--- NARRATIVE ---');
  });

  it('falls back to subject-name in label when no reference number', () => {
    const result = buildInfoFormSupplement(
      { subject_name: 'BROWN, ALICE' },
      { incidentId: 7 },
    );
    expect((result.payload as any).subject).toBe('Info Report — BROWN, ALICE');
  });

  it('throws when incidentId is missing', () => {
    expect(() => buildInfoFormSupplement({ subject_name: 'X' }, {})).toThrow(/incidentId/);
  });
});

describe('registry', () => {
  it('hasSaveHandler returns true for all registered kinds', () => {
    expect(hasSaveHandler('court_warrant')).toBe(true);
    expect(hasSaveHandler('fi_card')).toBe(true);
    expect(hasSaveHandler('witness_statement')).toBe(true);
    expect(hasSaveHandler('info_form')).toBe(true);
    expect(hasSaveHandler('supplemental_report')).toBe(true);
  });
  it('hasSaveHandler returns false for unregistered kinds', () => {
    expect(hasSaveHandler('court_order')).toBe(false);
    expect(hasSaveHandler('trespass_order')).toBe(false);
    expect(hasSaveHandler('unknown')).toBe(false);
  });

  it('requiresIncident is true for witness_statement / info_form / supplemental_report', () => {
    expect(requiresIncident('witness_statement')).toBe(true);
    expect(requiresIncident('info_form')).toBe(true);
    expect(requiresIncident('supplemental_report')).toBe(true);
  });
  it('requiresIncident is false for direct-save kinds', () => {
    expect(requiresIncident('court_warrant')).toBe(false);
    expect(requiresIncident('fi_card')).toBe(false);
  });
  it('requiresIncident is false for unregistered kinds', () => {
    expect(requiresIncident('court_order')).toBe(false);
    expect(requiresIncident('unknown')).toBe(false);
  });

  it('getSaveBuilder returns the right builder for each kind', () => {
    expect(getSaveBuilder('witness_statement')).toBe(buildWitnessStatementSupplement);
    expect(getSaveBuilder('info_form')).toBe(buildInfoFormSupplement);
    expect(getSaveBuilder('supplemental_report')).toBe(buildInfoFormSupplement);
    expect(getSaveBuilder('court_order')).toBeNull();
  });
});
