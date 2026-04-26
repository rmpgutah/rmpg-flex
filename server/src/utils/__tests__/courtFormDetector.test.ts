import { describe, it, expect } from 'vitest';
import { detectCourtForm } from '../courtFormDetector';

// Each fixture is a synthetic header/preamble snippet — the kind of text the
// PDF-text extractor produces from the first page or two of a real form.

describe('detectCourtForm — federal', () => {
  it('classifies AO 440 federal civil summons', () => {
    const text = `AO 440 (Rev. 06/12) Summons in a Civil Action
UNITED STATES DISTRICT COURT
for the
Northern District of Illinois
JANE DOE, Plaintiff, v. ACME CORP, Defendant
Civil Action No. 1:26-cv-04472
SUMMONS IN A CIVIL ACTION
TO: (Defendant's name and address) Acme Corp, 123 Main, Chicago, IL 60601
A lawsuit has been filed against you. YOU ARE HEREBY SUMMONED to appear and defend.
By order of the Court. Clerk of Court.`;
    const r = detectCourtForm(text);
    expect(r.isCourtDocument).toBe(true);
    expect(r.formNumber).toMatch(/AO\s*440/i);
    expect(r.courtSystem).toBe('us_district');
    expect(r.category).toBe('summons');
    expect(r.state).toBe('IL');
    expect(r.confidence).toBeGreaterThanOrEqual(60);
  });

  it('classifies AO 88B federal subpoena', () => {
    const text = `AO 88B (Rev. 02/14) Subpoena to Produce Documents
UNITED STATES DISTRICT COURT for the District of Maryland
Case No. 8:25-mc-00012
SUBPOENA — YOU ARE HEREBY COMMANDED to produce the following documents.`;
    const r = detectCourtForm(text);
    expect(r.isCourtDocument).toBe(true);
    expect(r.formNumber).toMatch(/AO\s*88/i);
    expect(r.category).toBe('subpoena');
    expect(r.state).toBe('MD');
    expect(r.courtSystem).toBe('us_district');
  });
});

describe('detectCourtForm — California', () => {
  it('classifies SUM-100 standard summons', () => {
    const text = `SUM-100 SUMMONS (CITACION JUDICIAL)
SUPERIOR COURT OF CALIFORNIA, COUNTY OF LOS ANGELES
NOTICE TO DEFENDANT: You have been sued.
Plaintiff: Capital One v. Daisy Doe, Defendant
Case Number: 26CV12345
The name and address of the court is: 111 N Hill St, Los Angeles, CA 90012`;
    const r = detectCourtForm(text);
    expect(r.isCourtDocument).toBe(true);
    expect(r.formNumber).toBe('SUM-100');
    expect(r.state).toBe('CA');
    expect(r.courtSystem).toBe('state_superior');
    expect(r.category).toBe('summons');
  });

  it('classifies UD-100 unlawful detainer (eviction)', () => {
    const text = `UD-100 COMPLAINT — UNLAWFUL DETAINER
SUPERIOR COURT OF CALIFORNIA, COUNTY OF SAN DIEGO
Plaintiff seeks possession of premises located at 99 Elm St.
Defendant: John Tenant`;
    const r = detectCourtForm(text);
    expect(r.isCourtDocument).toBe(true);
    expect(r.formNumber).toBe('UD-100');
    expect(r.category).toBe('eviction_notice');
    expect(r.state).toBe('CA');
  });

  it('classifies FL-110 family law summons', () => {
    const text = `FL-110 SUMMONS — Family Law
SUPERIOR COURT OF CALIFORNIA, COUNTY OF SAN FRANCISCO
PETITIONER: Jane Doe RESPONDENT: John Doe
PETITION FOR DISSOLUTION OF MARRIAGE
NOTICE TO RESPONDENT: You have 30 calendar days to respond.`;
    const r = detectCourtForm(text);
    expect(r.isCourtDocument).toBe(true);
    expect(r.formNumber).toBe('FL-110');
    expect(r.state).toBe('CA');
    expect(r.category).toBe('family_law_petition');
  });

  it('classifies CH-100 civil harassment restraining order', () => {
    const text = `CH-100 Request for Civil Harassment Restraining Orders
SUPERIOR COURT OF CALIFORNIA, COUNTY OF ORANGE
Petitioner v. Respondent
TEMPORARY RESTRAINING ORDER`;
    const r = detectCourtForm(text);
    expect(r.formNumber).toBe('CH-100');
    expect(r.state).toBe('CA');
    expect(r.category).toBe('restraining_order_temporary');
  });
});

describe('detectCourtForm — New York', () => {
  it('classifies a NY Supreme Court summons with index number', () => {
    const text = `SUPREME COURT OF THE STATE OF NEW YORK
COUNTY OF KINGS
Index No. 712345/2026
PLAINTIFF, against DEFENDANT
SUMMONS — TO THE DEFENDANT: YOU ARE HEREBY SUMMONED to answer.
Attorney for Plaintiff: Smith & Co.`;
    const r = detectCourtForm(text);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('NY');
    expect(r.category).toBe('summons');
    expect(r.courtSystem).toBe('state_supreme');
  });
});

describe('detectCourtForm — Texas', () => {
  it('classifies a Texas Citation', () => {
    const text = `THE STATE OF TEXAS
DISTRICT COURT OF DALLAS COUNTY, TEXAS
Cause No. DC-26-00789
JANE DOE vs. JOHN ROE
CITATION — TO: JOHN ROE, DEFENDANT
You are hereby commanded to appear and answer the petition.
Tex. R. Civ. P. 99 governs service.`;
    const r = detectCourtForm(text);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('TX');
    expect(r.category).toBe('citation');
    expect(r.courtSystem).toBe('state_district');
  });
});

describe('detectCourtForm — Florida', () => {
  it('classifies a FL family law form', () => {
    const text = `IN THE CIRCUIT COURT OF THE NINTH JUDICIAL CIRCUIT IN AND FOR ORANGE COUNTY, FLORIDA
Family Law Form 12.901(b)(1)
PETITION FOR DISSOLUTION OF MARRIAGE
Petitioner: Jane Doe Respondent: John Doe`;
    const r = detectCourtForm(text);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('FL');
    expect(r.courtSystem).toBe('state_circuit');
    expect(r.category).toBe('family_law_petition');
  });
});

describe('detectCourtForm — Utah', () => {
  it('classifies a Utah Justice Court small-claims affidavit', () => {
    const text = `IN THE JUSTICE COURT OF SALT LAKE COUNTY, STATE OF UTAH
SMALL CLAIMS AFFIDAVIT AND ORDER
Plaintiff vs. Defendant
Case No. SC-2026-00112
Pursuant to URCP 4, you are hereby commanded.`;
    const r = detectCourtForm(text);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('UT');
    expect(r.courtSystem).toBe('state_justice');
    expect(r.category).toBe('small_claims_claim');
  });
});

describe('detectCourtForm — Illinois (Cook County)', () => {
  it('classifies an Illinois Cook County eviction summons', () => {
    const text = `IN THE CIRCUIT COURT OF COOK COUNTY, ILLINOIS
MUNICIPAL DEPARTMENT - FIRST DISTRICT
CCG 0007
PLAINTIFF v. DEFENDANT
SUMMONS — UNLAWFUL DETAINER
YOU ARE HEREBY SUMMONED to appear at the courthouse.`;
    const r = detectCourtForm(text);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('IL');
    expect(r.category).toBe('eviction_notice');
  });
});

describe('detectCourtForm — Pennsylvania (Common Pleas)', () => {
  it('classifies a Pennsylvania Court of Common Pleas complaint', () => {
    const text = `IN THE COURT OF COMMON PLEAS OF PHILADELPHIA COUNTY
COMMONWEALTH OF PENNSYLVANIA
CIVIL TRIAL DIVISION
No. 26-04-12345
JANE DOE, Plaintiff v. JOHN ROE, Defendant
COMPLAINT IN CIVIL ACTION
NOTICE TO DEFEND.`;
    const r = detectCourtForm(text);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('PA');
    expect(r.courtSystem).toBe('court_of_common_pleas');
    expect(r.category).toBe('complaint');
  });
});

describe('detectCourtForm — Georgia (Superior)', () => {
  it('classifies a Georgia Superior Court divorce petition', () => {
    const text = `IN THE SUPERIOR COURT OF FULTON COUNTY, STATE OF GEORGIA
PETITIONER v. RESPONDENT
PETITION FOR DIVORCE
Civil Action File No. 2026CV-987654`;
    const r = detectCourtForm(text);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('GA');
    expect(r.courtSystem).toBe('state_superior');
    expect(r.category).toBe('family_law_petition');
  });
});

describe('detectCourtForm — Massachusetts', () => {
  it('classifies a Mass Trial Court CJD form', () => {
    const text = `MASSACHUSETTS TRIAL COURT, PROBATE AND FAMILY COURT DEPARTMENT
CJD 100 — Complaint for Divorce
PETITIONER vs. RESPONDENT
SUMMONS`;
    const r = detectCourtForm(text);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('MA');
    expect(r.courtSystem).toBe('state_probate');
  });
});

describe('detectCourtForm — Delaware (Chancery)', () => {
  it('classifies a Delaware Court of Chancery action', () => {
    const text = `IN THE COURT OF CHANCERY OF THE STATE OF DELAWARE
C.A. No. 2026-1234-XYZ
JANE DOE, Plaintiff v. ACME LLC, Defendant
VERIFIED COMPLAINT FOR DECLARATORY JUDGMENT
JURY TRIAL DEMANDED.`;
    const r = detectCourtForm(text);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('DE');
    expect(r.courtSystem).toBe('state_chancery');
    expect(r.category).toBe('verified_complaint');
  });
});

describe('detectCourtForm — boundary cases', () => {
  it('rejects clearly non-court text', () => {
    const text = 'Hello world. This is a totally unrelated text fragment without any legal markers.';
    const r = detectCourtForm(text);
    expect(r.isCourtDocument).toBe(false);
    expect(r.category).toBe('unknown_court_form');
    expect(r.confidence).toBeLessThan(30);
  });

  it('rejects very short text', () => {
    const r = detectCourtForm('Short');
    expect(r.isCourtDocument).toBe(false);
    expect(r.confidence).toBe(0);
  });

  it('classifies a Writ of Execution', () => {
    const text = `SUPERIOR COURT OF THE STATE OF ARIZONA, MARICOPA COUNTY
Case No. CV2025-067890
WRIT OF EXECUTION
TO THE SHERIFF: YOU ARE HEREBY COMMANDED to levy upon the goods and chattels of the defendant.`;
    const r = detectCourtForm(text);
    expect(r.isCourtDocument).toBe(true);
    expect(r.category).toBe('writ');
    expect(r.state).toBe('AZ');
  });

  it('classifies a generic Order to Show Cause', () => {
    const text = `IN THE DISTRICT COURT OF THE FOURTH JUDICIAL DISTRICT
COUNTY OF UTAH, STATE OF UTAH
ORDER TO SHOW CAUSE
YOU ARE HEREBY ORDERED to appear and show cause why you should not be held in contempt.
Case No. 264400123`;
    const r = detectCourtForm(text);
    expect(r.isCourtDocument).toBe(true);
    expect(r.category).toBe('order_to_show_cause');
    expect(r.state).toBe('UT');
  });

  it('returns signals for debug/audit', () => {
    const r = detectCourtForm('SUM-100 SUMMONS — SUPERIOR COURT OF CALIFORNIA, NOTICE TO DEFENDANT.');
    expect(r.signals.length).toBeGreaterThan(0);
    expect(r.signals.some((s) => s.startsWith('form_number'))).toBe(true);
    expect(r.signals.some((s) => s.startsWith('court_system'))).toBe(true);
  });
});
