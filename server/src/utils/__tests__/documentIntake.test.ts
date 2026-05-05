import { describe, it, expect } from 'vitest';
import {
  extractFromText, detectKind, listRegisteredKinds,
} from '../documentIntake';
import { applyAnchors, rollupConfidence } from '../documentIntake/applyAnchors';
import type { FieldAnchor } from '../documentIntake/types';

describe('listRegisteredKinds', () => {
  it('exposes implemented + stub tiers', () => {
    const kinds = listRegisteredKinds();
    const tiers = new Set(kinds.map((k) => k.tier));
    expect(tiers.has('implemented')).toBe(true);
    expect(tiers.has('stub')).toBe(true);
    expect(kinds.length).toBeGreaterThanOrEqual(8);
    // Sanity: every kind has at least one anchor.
    for (const k of kinds) expect(k.anchorCount).toBeGreaterThan(0);
  });
});

describe('applyAnchors', () => {
  const anchors: FieldAnchor[] = [
    { key: 'name', label: 'Name', patterns: [/Name:\s*(.+)/i, /Subject:\s*(.+)/i] },
    { key: 'dob', label: 'DOB', patterns: [/DOB:\s*(\d+\/\d+\/\d+)/i] },
  ];
  it('first-pattern hit gets confidence 1.0', () => {
    const result = applyAnchors('Name: Jones\nDOB: 5/5/1990', anchors);
    expect(result[0].value).toBe('Jones');
    expect(result[0].confidence).toBe(1);
  });
  it('fallback pattern hits get reduced confidence', () => {
    const result = applyAnchors('Subject: Smith\nDOB: 1/2/2000', anchors);
    expect(result[0].value).toBe('Smith');
    expect(result[0].confidence).toBeCloseTo(0.85);
  });
  it('non-matching anchor returns empty value at confidence 0', () => {
    const result = applyAnchors('Random text', anchors);
    expect(result[0].value).toBe('');
    expect(result[0].confidence).toBe(0);
  });
  it('rollupConfidence averages per-field scores', () => {
    expect(rollupConfidence([
      { key: 'a', value: 'x', confidence: 1 },
      { key: 'b', value: '', confidence: 0 },
    ])).toBe(0.5);
  });
});

describe('detectKind', () => {
  it('classifies a court warrant heading correctly', () => {
    const text = `IN THE THIRD JUDICIAL DISTRICT COURT
THE STATE OF UTAH vs. DOE, JOHN
BENCH WARRANT
Docket No: 2024-CR-12345`;
    const result = detectKind(text);
    expect(result.kind).toBe('court_warrant');
    expect(result.score).toBeGreaterThan(0.5);
  });

  it('classifies a field interview card', () => {
    const text = `FIELD INTERVIEW CARD
Subject Name: SMITH, JANE
DOB: 03/15/1985
Reason for Contact: suspicious activity
Action Taken: warned and released
Officer: DOE, J. Badge #: 1234`;
    expect(detectKind(text).kind).toBe('fi_card');
  });

  it('classifies a witness statement', () => {
    const text = `WITNESS STATEMENT
Case No: 2024-INV-007
Witness Name: ROE, RICHARD
DOB: 7/4/1970
I, Richard Roe, declare under penalty of perjury that the following is true:
Statement:
On the night of June 1st, I observed two males approach the victim...`;
    expect(detectKind(text).kind).toBe('witness_statement');
  });

  it('classifies a trespass order at stub tier', () => {
    const text = `CRIMINAL TRESPASS NOTICE
Subject: HENDERSON, MARK
DOB: 9/9/1990
Property Address: 123 Main St`;
    expect(detectKind(text).kind).toBe('trespass_order');
  });

  it('returns unknown when nothing scores above threshold', () => {
    expect(detectKind('Hello world this is a generic policy document.').kind).toBe('unknown');
  });
});

describe('extractFromText — court_warrant', () => {
  const sample = `IN THE THIRD JUDICIAL DISTRICT COURT OF SALT LAKE COUNTY
THE STATE OF UTAH vs. DOE, JOHN
BENCH WARRANT
Docket No: 2024-CR-98765
Defendant: DOE, JOHN
DOB: 04/15/1980
Charges: Failure to Appear, UCA 76-8-1001
Bond Amount: $5,000.00
Issuing Judge: Hon. Smith, Patricia
Date of Issuance: 03/01/2024
`;

  it('extracts core fields with high confidence', () => {
    const result = extractFromText(sample);
    expect(result.kind).toBe('court_warrant');
    expect(result.tier).toBe('implemented');

    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f.value]));
    expect(byKey.docket_number).toBe('2024-CR-98765');
    expect(byKey.defendant_dob).toBe('04/15/1980');
    expect(byKey.bond_amount).toBe('5000.00');
    expect(byKey.defendant_name).toContain('DOE');
    expect(result.confidence).toBeGreaterThan(0.6);
  });
});

describe('extractFromText — fi_card', () => {
  it('extracts subject + officer + reason', () => {
    const text = `FIELD INTERVIEW CARD
Subject Name: SMITH, JANE
DOB: 03/15/1985
Address: 456 Oak Ave, Salt Lake City, UT
Phone: 801-555-1234
Reason for Contact: loitering near closed business
Action Taken: identified, no charges
Officer: ROE, J.
Badge #: 9876
`;
    const result = extractFromText(text);
    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f.value]));
    expect(result.kind).toBe('fi_card');
    expect(byKey.subject_dob).toBe('03/15/1985');
    expect(byKey.phone).toBe('801-555-1234');
    expect(byKey.reason_for_contact).toContain('loitering');
    expect(byKey.badge_number).toBe('9876');
  });
});

describe('extractFromText — info_form', () => {
  it('extracts reporting party + occurrence', () => {
    const text = `SUPPLEMENTAL INFORMATION REPORT
Reference No: INFO-2024-0042
Subject: BROWN, ALICE
DOB: 12/31/1972
Address: 789 Elm St
Date of Occurrence: 02/14/2024
Reporting Party: NEIGHBOR, BOB
Narrative:
RP states he heard yelling next door at approximately 0200 hours...`;
    const result = extractFromText(text);
    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f.value]));
    expect(result.kind).toBe('info_form');
    expect(byKey.reference_number).toBe('INFO-2024-0042');
    expect(byKey.occurrence_date).toBe('02/14/2024');
    expect(byKey.reporting_party).toContain('NEIGHBOR');
  });
});

describe('extractFromText — witness_statement', () => {
  it('extracts identity + statement body', () => {
    const text = `WITNESS STATEMENT
Case No: 2024-INV-007
Incident No: INC-12345
Witness Name: ROE, RICHARD
DOB: 7/4/1970
Address: 321 Pine St
Phone: 801-555-7777
Incident Date: 06/01/2024
Interviewing Officer: DETECTIVE CRUZ
Badge #: 5555
Statement:
On the night of June 1st, I observed two males approach the victim and demand his wallet. They fled north on State Street.
I, Richard Roe, declare under penalty of perjury that the following is true.`;
    const result = extractFromText(text);
    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f.value]));
    expect(result.kind).toBe('witness_statement');
    expect(byKey.case_number).toBe('2024-INV-007');
    expect(byKey.incident_number).toBe('INC-12345');
    expect(byKey.statement_body).toContain('two males');
  });
});

describe('extractFromText — forceKind override', () => {
  it('uses explicit kind even when detector disagrees', () => {
    const text = 'Random text with Subject: TEST USER\nDOB: 1/1/2000';
    const result = extractFromText(text, { forceKind: 'fi_card' });
    expect(result.kind).toBe('fi_card');
    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f.value]));
    expect(byKey.subject_name).toContain('TEST');
  });
});

describe('extractFromText — preview cap', () => {
  it('caps rawTextPreview at 50KB', () => {
    const big = 'a'.repeat(60_000);
    const result = extractFromText(big);
    expect(result.rawTextPreview.length).toBeLessThanOrEqual(50_000);
  });
});
