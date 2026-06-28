import { describe, it, expect } from 'vitest';
import {
  classifyDocument,
  buildDocumentExtraction,
} from '../src/utils/documentIntakeExtract';

// pdfjs flattens a page's text items into one space-joined string (pages
// joined by \n). These fixtures mimic that realistic shape, not a tidy
// label-per-line layout, so the extractor is exercised the way prod hits it.
const WARRANT =
  'IN THE THIRD DISTRICT COURT, STATE OF UTAH ARREST WARRANT ' +
  'Case No: 231400123 Defendant: SMITH, JOHN DOB: 05/12/1988 ' +
  'Charges: Theft by deception, a third degree felony ' +
  'Bond Amount: $5,000.00 Issuing Judge: Hon. Jane Doe Issued: 03/15/2026';

const FI =
  'FIELD INTERVIEW CARD Subject: DOE, JANE DOB: 11/02/1995 ' +
  'Address: 123 Main St, Salt Lake City UT Phone: 801-555-0100 ' +
  'Date of Contact: 06/01/2026 Location of Contact: 200 S West Temple ' +
  'Reason for Contact: suspicious activity near loading dock ' +
  'Action Taken: field interview, released';

const WITNESS =
  'WITNESS STATEMENT Statement of: WILLIAMS, ROBERT DOB: 07/04/1970 ' +
  'I, Robert Williams, declare under penalty of perjury that the following ' +
  'is true. Incident Date: 05/30/2026 Interviewing Officer: Ofc. K. Lee';

const INFO =
  'INFORMATION REPORT Reference No: 2026-00457 Subject: BROWN, MARY ' +
  'Reporting Party: anonymous caller Occurrence Date: 05/29/2026 ' +
  'Narrative: caller reported a vehicle parked overnight in the fire lane';

describe('classifyDocument', () => {
  it('detects a court warrant', () => {
    expect(classifyDocument(WARRANT).kind).toBe('court_warrant');
  });
  it('detects a field-interview card', () => {
    expect(classifyDocument(FI).kind).toBe('fi_card');
  });
  it('detects a witness statement', () => {
    expect(classifyDocument(WITNESS).kind).toBe('witness_statement');
  });
  it('detects an information report', () => {
    expect(classifyDocument(INFO).kind).toBe('info_form');
  });
  it('returns unknown for unrelated text', () => {
    expect(classifyDocument('grocery list: milk, eggs, bread').kind).toBe('unknown');
  });
  it('surfaces court category + state when present', () => {
    const c = classifyDocument(WARRANT);
    expect(c.courtCategory).toBe('District Court');
    expect(c.state).toBe('Utah');
  });
});

describe('buildDocumentExtraction — court_warrant', () => {
  const ex = buildDocumentExtraction({ text: WARRANT, pageCount: 2, usedOcr: false });
  const byKey = Object.fromEntries(ex.fields.map((f) => [f.key, f]));

  it('classifies and tags the envelope', () => {
    expect(ex.kind).toBe('court_warrant');
    expect(ex.tier).toBe('implemented');
    expect(ex.pageCount).toBe(2);
    expect(ex.usedOcr).toBe(false);
    expect(ex.confidence).toBeGreaterThan(0);
    expect(ex.confidence).toBeLessThanOrEqual(1);
  });

  it('extracts the defendant name (stops before DOB)', () => {
    expect(byKey.defendant_name.value).toContain('SMITH');
    expect(byKey.defendant_name.value).not.toContain('DOB');
  });

  it('extracts a normalized date for DOB', () => {
    expect(byKey.defendant_dob.value).toBe('05/12/1988');
    expect(byKey.defendant_dob.confidence).toBeGreaterThan(0.8);
  });

  it('extracts the bond amount as money', () => {
    expect(byKey.bond_amount.value).toContain('5,000');
    expect(byKey.bond_amount.value).not.toContain('Judge');
  });

  it('extracts the docket/case number', () => {
    expect(byKey.docket_number.value).toBe('231400123');
  });

  it('extracts the issued date', () => {
    expect(byKey.issued_date.value).toBe('03/15/2026');
  });
});

describe('buildDocumentExtraction — fi_card', () => {
  const ex = buildDocumentExtraction({ text: FI });
  const byKey = Object.fromEntries(ex.fields.map((f) => [f.key, f]));

  it('classifies as fi_card with field keys the save handler reads', () => {
    expect(ex.kind).toBe('fi_card');
    expect(byKey.subject_name.value).toContain('DOE');
    expect(byKey.contact_date.value).toBe('06/01/2026');
    expect(byKey.subject_dob.value).toBe('11/02/1995');
    expect(byKey.reason_for_contact.value.length).toBeGreaterThan(0);
  });
});

describe('buildDocumentExtraction — unknown', () => {
  it('returns a stub envelope with no fields', () => {
    const ex = buildDocumentExtraction({ text: 'random unrelated content here' });
    expect(ex.kind).toBe('unknown');
    expect(ex.tier).toBe('stub');
    expect(ex.fields).toEqual([]);
    expect(ex.confidence).toBe(0);
  });
});
