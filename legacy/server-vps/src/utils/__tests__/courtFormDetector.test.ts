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

describe('detectCourtForm — 50-state expansion', () => {
  it('Alabama: small claims Form C-13', () => {
    const r = detectCourtForm(`STATE OF ALABAMA, JEFFERSON COUNTY DISTRICT COURT — Form C-13 SMALL CLAIMS COMPLAINT. Plaintiff vs. Defendant. Case No. SM-2026-001.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('AL');
    expect(r.formNumber).toMatch(/C-13/i);
  });

  it('Alaska: Civil form CIV-100', () => {
    const r = detectCourtForm(`IN THE DISTRICT COURT OF THE STATE OF ALASKA, THIRD JUDICIAL DISTRICT AT ANCHORAGE. CIV-100 SUMMONS. Plaintiff v. Defendant.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('AK');
    expect(r.formNumber).toMatch(/CIV-100/i);
    expect(r.category).toBe('summons');
  });

  it('Arizona: Justice Court JC-form', () => {
    const r = detectCourtForm(`MARICOPA COUNTY JUSTICE COURT, STATE OF ARIZONA. JC-100 CIVIL COMPLAINT — Eviction. NOTICE TO DEFENDANT.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('AZ');
    expect(r.formNumber).toMatch(/JC-100/i);
  });

  it('Colorado: JDF judicial department form', () => {
    const r = detectCourtForm(`DISTRICT COURT, EL PASO COUNTY, COLORADO. JDF 1101 CIVIL SUMMONS. Plaintiff: v. Defendant: Case Number: 2026CV1234.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('CO');
    expect(r.formNumber).toMatch(/JDF\s*1101/i);
    expect(r.category).toBe('summons');
  });

  it('Connecticut: JD-CV summons', () => {
    const r = detectCourtForm(`SUPERIOR COURT OF THE STATE OF CONNECTICUT, JUDICIAL DISTRICT OF HARTFORD. JD-CV-1 SUMMONS — CIVIL. Docket No. HHD-CV-26-0012345-S.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('CT');
    expect(r.formNumber).toMatch(/JD-CV-1/i);
  });

  it('Idaho: CAO Court Administrative Order form', () => {
    const r = detectCourtForm(`IN THE DISTRICT COURT OF THE FOURTH JUDICIAL DISTRICT OF THE STATE OF IDAHO IN AND FOR THE COUNTY OF ADA. CAO CV 1-1 SUMMONS.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('ID');
    expect(r.formNumber).toMatch(/CAO\s+CV\s*1-1/i);
  });

  it('Iowa: Rule of Civil Procedure reference', () => {
    const r = detectCourtForm(`IN THE IOWA DISTRICT COURT FOR POLK COUNTY. ORIGINAL NOTICE — Iowa R. Civ. P. 1.302. Plaintiff vs. Defendant.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('IA');
    expect(r.formNumber).toMatch(/Iowa\s+R/i);
  });

  it('Kentucky: AOC-105 summons', () => {
    const r = detectCourtForm(`COMMONWEALTH OF KENTUCKY, FAYETTE CIRCUIT COURT. AOC-105 CIVIL SUMMONS. Plaintiff vs. Defendant. Case No. 26-CI-00123.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('KY');
    expect(r.formNumber).toMatch(/AOC-105/i);
  });

  it('Maryland: DC-CV district court form', () => {
    const r = detectCourtForm(`DISTRICT COURT OF MARYLAND FOR BALTIMORE COUNTY. DC-CV-001 CIVIL ACTION COMPLAINT. Plaintiff vs. Defendant.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('MD');
    expect(r.formNumber).toMatch(/DC[/-]CV[/-]001/i);
  });

  it('Michigan: MC 01 summons', () => {
    const r = detectCourtForm(`STATE OF MICHIGAN, 16TH JUDICIAL CIRCUIT — MACOMB COUNTY. MC 01 SUMMONS AND COMPLAINT. Plaintiff v Defendant. Case No. 2026-1234-CZ.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('MI');
    expect(r.formNumber).toMatch(/MC\s+01/i);
  });

  it('Minnesota: MNCIS form', () => {
    const r = detectCourtForm(`STATE OF MINNESOTA, COUNTY OF HENNEPIN, FOURTH JUDICIAL DISTRICT COURT. MNCIS-1234 SUMMONS. Plaintiff v. Defendant.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('MN');
    expect(r.formNumber).toMatch(/MNCIS-1234/i);
  });

  it('Nevada: JCRCP rule reference', () => {
    const r = detectCourtForm(`LAS VEGAS JUSTICE COURT, CLARK COUNTY, NEVADA. SUMMONS pursuant to JCRCP 4. Plaintiff vs. Defendant.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('NV');
    expect(r.courtSystem).toBe('state_justice');
  });

  it('New Hampshire: NHJB form', () => {
    const r = detectCourtForm(`THE STATE OF NEW HAMPSHIRE, JUDICIAL BRANCH, CIRCUIT COURT — DISTRICT DIVISION. NHJB-2065-FP SUMMONS. Plaintiff v. Defendant.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('NH');
    expect(r.formNumber).toMatch(/NHJB-2065/i);
  });

  it('New Jersey: CN-numbered court notice', () => {
    const r = detectCourtForm(`SUPERIOR COURT OF NEW JERSEY, LAW DIVISION — CIVIL PART, ESSEX COUNTY. CN 10527 SUMMONS. Plaintiff vs. Defendant. Docket No. ESX-L-001234-26.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('NJ');
    expect(r.formNumber).toMatch(/CN\s*10527/i);
  });

  it('New Mexico: Rule 4-200 NMRA', () => {
    const r = detectCourtForm(`STATE OF NEW MEXICO, COUNTY OF BERNALILLO, SECOND JUDICIAL DISTRICT COURT. SUMMONS — Rule 4-200 NMRA. Plaintiff v. Defendant.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('NM');
    expect(r.formNumber).toMatch(/4-200/i);
  });

  it('North Carolina: AOC-CV-100 civil summons', () => {
    const r = detectCourtForm(`STATE OF NORTH CAROLINA, COUNTY OF MECKLENBURG. IN THE GENERAL COURT OF JUSTICE — DISTRICT COURT DIVISION. AOC-CV-100 CIVIL SUMMONS. Plaintiff vs. Defendant.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('NC');
    expect(r.formNumber).toMatch(/AOC-CV-100/i);
  });

  it('North Dakota: SFN form', () => {
    const r = detectCourtForm(`STATE OF NORTH DAKOTA, COUNTY OF BURLEIGH, DISTRICT COURT. SFN 12345 SUMMONS. Plaintiff v. Defendant. Case No. 08-2026-CV-00123.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('ND');
    expect(r.formNumber).toMatch(/SFN\s*12345/i);
  });

  it('Ohio: Standard Probate Form', () => {
    const r = detectCourtForm(`PROBATE COURT OF FRANKLIN COUNTY, OHIO. Standard Probate Form 4.0 APPLICATION FOR AUTHORITY TO ADMINISTER ESTATE. Petitioner: Decedent:`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('OH');
    expect(r.formNumber).toMatch(/Standard\s+Probate\s+Form\s+4\.0/i);
  });

  it('Oregon: ORCP rule', () => {
    const r = detectCourtForm(`IN THE CIRCUIT COURT OF THE STATE OF OREGON FOR MULTNOMAH COUNTY. SUMMONS pursuant to ORCP 7. Plaintiff v. Defendant. Case No. 26CV12345.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('OR');
    expect(r.formNumber).toMatch(/ORCP\s*7/i);
  });

  it('South Carolina: SCRCP rule', () => {
    const r = detectCourtForm(`STATE OF SOUTH CAROLINA, COUNTY OF RICHLAND. IN THE COURT OF COMMON PLEAS. SUMMONS — SCRCP 4. Plaintiff vs. Defendant. Civil Action No. 2026-CP-40-12345.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('SC');
    expect(r.formNumber).toMatch(/SCRCP\s*4/i);
  });

  it('Virginia: DC-401 warrant in debt', () => {
    const r = detectCourtForm(`COMMONWEALTH OF VIRGINIA, FAIRFAX COUNTY GENERAL DISTRICT COURT. DC-401 WARRANT IN DEBT. Plaintiff vs. Defendant.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('VA');
    expect(r.formNumber).toMatch(/DC-401/i);
  });

  it('Washington: WPF DRPSCU 01.0100 family-law summons', () => {
    const r = detectCourtForm(`SUPERIOR COURT OF WASHINGTON, COUNTY OF KING. WPF DRPSCU 01.0100 SUMMONS. Petitioner v. Respondent.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('WA');
    expect(r.formNumber).toMatch(/WPF/i);
  });

  it('Wisconsin: GF-180 summons', () => {
    const r = detectCourtForm(`STATE OF WISCONSIN, CIRCUIT COURT, DANE COUNTY. GF-180 SUMMONS. Plaintiff vs. Defendant. Case No. 26CV001234.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('WI');
    expect(r.formNumber).toMatch(/GF-180/i);
  });

  it('District of Columbia: Sup. Ct. Civ. R. reference', () => {
    const r = detectCourtForm(`SUPERIOR COURT OF THE DISTRICT OF COLUMBIA, CIVIL DIVISION. SUMMONS pursuant to Sup. Ct. Civ. R. 4. Plaintiff v. Defendant.`);
    expect(r.isCourtDocument).toBe(true);
    expect(r.state).toBe('DC');
    expect(r.formNumber).toMatch(/Sup\.\s*Ct/i);
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
