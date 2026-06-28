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
  }, 30_000); // Flaky on slow CI runners doing 60k-char allocation + extraction.
});

describe('extractFromText — court_summons real-sample regression fixtures', () => {
  // Synthetic versions of the three real-world layouts encountered
  // during calibration on 2026-05-05. If any regex change breaks one
  // of these, the user-visible extraction quality regresses for that
  // entire format family.

  it('Utah Guglielmo (3rd District / column-aligned with caption bleed)', () => {
    const text = `GUGLIELMO & ASSOCIATES
Heather Valerga, (Utah Attorney Bar# 14431)
PO Box 41688
Tucson, AZ 85717
Tel: (877)325-5700
FAX: (520)325-2480
Utah@guglielmolaw.com
Attorney for Plaintiff

                  IN THE THIRD JUDICIAL DISTRICT COURT, STATE OF UTAH
                           SALT LAKE COUNTY, Salt Lake City Department
Capital One, N.A., successor by merger to Discover
Bank ,
                Plaintiff,                          SUMMONS

         vs.
                                                            Civil No.
Abbey Armstrong, an individual,
              Defendant                                     Judge:

                                                                                      *S10000633570*
`;
    const result = extractFromText(text);
    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f.value]));
    expect(result.kind).toBe('court_summons');
    // Caption bleed must be stripped — plaintiff is JUST the corporate name.
    expect(byKey.plaintiff).toBe('Capital One, N.A., successor by merger to Discover Bank');
    expect(byKey.defendant).toBe('Abbey Armstrong');
    expect(byKey.attorney_bar_number).toBe('14431');
    expect(byKey.attorney_phone).toBe('877-325-5700');
    expect(byKey.attorney_email).toBe('Utah@guglielmolaw.com');
    expect(byKey.document_subtype).toBe('SUMMONS');
    // Utah AOC barcode tracker as fallback when visible Civil No. is blank.
    expect(byKey.civil_case_number).toBe('S10000633570');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('Florida 2-column (Miami-Dade County Court)', () => {
    const text = `Filing # 246663928 E-Filed 04/23/2026 11:02:20 AM


         MCKENZIE CAPITAL LLC,                        IN THE COUNTY COURT OF THE
             Plaintiff,                               11TH JUDICIAL CIRCUIT, IN AND
         vs.                                          FOR    MIAMI-DADE     COUNTY,
                                                      FLORIDA.
         ARK CONTRACTORS LLC, a
         Utah Limited Liability Company,              COUNTY CIVIL DIVISION
            Defendant(s).                             CASE NO. 2026-053140-CC-05

         _________________________________/



                                            CORPORATE SUMMONS

Telephone: (800)768-3119
legal@mckcap.com
Bar No. 121600
`;
    const result = extractFromText(text);
    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f.value]));
    expect(result.kind).toBe('court_summons');
    expect(byKey.civil_case_number).toBe('2026-053140-CC-05');
    expect(byKey.plaintiff).toBe('MCKENZIE CAPITAL LLC');
    expect(byKey.defendant).toBe('ARK CONTRACTORS LLC');
    expect(byKey.attorney_bar_number).toBe('121600');
    expect(byKey.attorney_phone).toBe('800-768-3119');
    expect(byKey.attorney_email).toBe('legal@mckcap.com');
    expect(byKey.document_subtype).toBe('CORPORATE SUMMONS');
  });

  it('Utah Juab County (firm letterhead with parenthesized bar #)', () => {
    const text = `RESNICK & LOUIS, P.C.
GARY R. GUELKER (8474)
K. TAYLOR SORENSEN (17323)
3191 S Valley St
Salt Lake City, UT 84109
Telephone: 801.960.3655
Facsimile: 801.877.8576
gguelker@rlattorneys.com
Attorneys for Plaintiff


                      IN THE FOURTH JUDICIAL DISTRICT COURT
                      IN AND FOR JUAB COUNTY, STATE OF UTAH


                                                                  SUMMONS

                                                      Civil No. 260600001 MI
                                                      Judge ANTHONY HOWELL
                                                      Tier 3
`;
    const result = extractFromText(text);
    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f.value]));
    expect(result.kind).toBe('court_summons');
    expect(byKey.civil_case_number).toBe('260600001');
    expect(byKey.attorney_name).toBe('Gary R. Guelker'); // re-cased from ALLCAPS
    expect(byKey.attorney_bar_number).toBe('8474');
    expect(byKey.attorney_phone).toBe('801-960-3655');
    expect(byKey.attorney_email).toBe('gguelker@rlattorneys.com');
    expect(byKey.document_subtype).toBe('SUMMONS');
  });
});

describe('extractFromText — court_summons (Utah district court)', () => {
  // Calibrated against the Capital One v. defendant pattern from
  // Guglielmo & Associates seen 2026-05-05.
  const sample = `GUGLIELMO & ASSOCIATES, PLLC
Heather Valerga, (Utah Attorney Bar# 14431)
PO Box 41688
Tucson, AZ 85717
Tel: (877) 325-5700
Utah@guglielmolaw.com
Attorney for Plaintiff

IN THE THIRD JUDICIAL DISTRICT COURT, STATE OF UTAH
SALT LAKE COUNTY, Salt Lake City Department

Capital One, N.A., successor by merger to Discover Bank,
Plaintiff,

SUMMONS

vs.

Darelis Montilla,
Defendant

Civil No. 240901234`;

  it('classifies as court_summons', () => {
    expect(detectKind(sample).kind).toBe('court_summons');
  });

  it('extracts core caption fields', () => {
    const result = extractFromText(sample);
    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f.value]));
    expect(result.kind).toBe('court_summons');
    expect(byKey.civil_case_number).toBe('240901234');
    expect(byKey.court_state).toBe('UTAH');
    expect(byKey.attorney_bar_number).toBe('14431');
    expect(byKey.attorney_email).toBe('Utah@guglielmolaw.com');
    expect(byKey.attorney_for).toBe('plaintiff');
    expect(byKey.document_subtype).toContain('SUMMONS');
  });
});

describe('extractFromText — servemanager_job (Information Form)', () => {
  // Calibrated against the Guglielmo → ICU Investigations job
  // export seen 2026-05-05.
  const sample = `JOB
15821690     634308     5/7/26                              Archive   Edit

CLIENT
Guglielmo & Associates, PLLC

SERVER
ICU Investigations, LLC
Christopher Zamora
435-986-1200

Job Type    G&A Service Type
Status      Pending
Attempt Due May 7, 2026
Due         May 7, 2026

Service Attempts                          Field Sheet   New Attempt

Recipient

Recipient: Darelis Montilla

DOB: 11/29/1993

No Service Attempts`;

  it('classifies as servemanager_job', () => {
    expect(detectKind(sample).kind).toBe('servemanager_job');
  });

  it('extracts client/server/recipient/dates', () => {
    const result = extractFromText(sample);
    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f.value]));
    expect(result.kind).toBe('servemanager_job');
    expect(byKey.job_number).toBe('15821690');
    expect(byKey.client_firm).toContain('Guglielmo');
    expect(byKey.server_firm).toContain('ICU Investigations');
    expect(byKey.server_individual).toBe('Christopher Zamora');
    expect(byKey.recipient_name).toContain('Darelis Montilla');
    expect(byKey.recipient_dob).toBe('11/29/1993');
    expect(byKey.job_due_date).toContain('May 7');
  });
});

describe('detectKind — courtFormDetector bridge', () => {
  it('bridges complaint via courtFormDetector when our extractors miss', () => {
    // A complaint that doesn't trigger our court_warrant or summons
    // detectors but that courtFormDetector recognises.
    const text = `IN THE FOURTH JUDICIAL DISTRICT COURT, STATE OF UTAH

COMPLAINT FOR BREACH OF CONTRACT

Plaintiff Capital One files this complaint against the defendant
for breach of contract dated June 1, 2024.`;
    const result = detectKind(text);
    // Either our court_summons detector picks it up (also acceptable),
    // OR the bridge catches it as 'court_complaint'. Both routes
    // beat 'unknown'.
    expect(['court_summons', 'court_complaint']).toContain(result.kind);
  });
});

describe('extractFromText — generic discovery fallback', () => {
  it('appends discovered entities when extractor finds nothing', () => {
    // Generic policy text with names, phones, dates — no anchors match.
    const text = `OFFICE MEMO
Please contact John Smith at (801) 555-0100 to confirm the
appointment on 06/15/2024. Email: jsmith@example.com.`;
    const result = extractFromText(text);
    // Should have at least a discovered_phone, discovered_email, discovered_date.
    const keys = result.fields.map((f) => f.key);
    expect(keys.some((k) => k.startsWith('discovered_phone_'))).toBe(true);
    expect(keys.some((k) => k.startsWith('discovered_email_'))).toBe(true);
    expect(keys.some((k) => k.startsWith('discovered_date_'))).toBe(true);
    // Discovered fields should all be capped at 0.5 confidence.
    const discovered = result.fields.filter((f) => f.key.startsWith('discovered_'));
    for (const f of discovered) expect(f.confidence).toBeLessThanOrEqual(0.5);
  });

  it('does NOT append discovery when an extractor already matched', () => {
    const text = `FIELD INTERVIEW CARD
Subject Name: SMITH, JANE
DOB: 03/15/1985
Reason for Contact: loitering
Action Taken: warned
Officer: ROE, J.
Badge #: 9876`;
    const result = extractFromText(text);
    expect(result.kind).toBe('fi_card');
    // No discovered_* fields when anchors matched.
    const hasDiscovered = result.fields.some((f) => f.key.startsWith('discovered_'));
    expect(hasDiscovered).toBe(false);
  });
});
