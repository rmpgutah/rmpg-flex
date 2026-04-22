import { describe, it, expect } from 'vitest';
import { parseAddressParts, extractAttorneyBlock, parseInfoSheetLabels, parseJobActivity, computeDiligenceSchedule, deriveServiceType, primaryDocToken, classifyEntityType, buildNotesNarrative, NotesInput, extractDocketBarcodeJobNumber, extractComplaintResidence, addressConfidence, normalizeAddressForMatch, extractAllDefendants } from '../serveIntakeHelpers';

describe('parseAddressParts', () => {
  it('parses a unit-qualified address', () => {
    const r = parseAddressParts('1812 WEST 4100 SOUTH UNIT E215, WEST VALLEY CITY, UT 84119');
    expect(r).toEqual({
      building: '1812', floor: '1ST', suite: 'E215',
      street: '1812 WEST 4100 SOUTH UNIT E215',
      city: 'WEST VALLEY CITY', state: 'UT', zip: '84119',
    });
  });

  it('parses a plain single-family address', () => {
    const r = parseAddressParts('1176 EL MONTE DRIVE, SALT LAKE CITY, UT 84117');
    expect(r).toEqual({
      building: '1176', floor: '1ST', suite: 'NOT APPLICABLE',
      street: '1176 EL MONTE DRIVE',
      city: 'SALT LAKE CITY', state: 'UT', zip: '84117',
    });
  });

  it('handles APT', () => {
    const r = parseAddressParts('500 MAIN ST APT 12B, LOGAN, UT 84321');
    expect(r.suite).toBe('12B');
    expect(r.building).toBe('500');
  });

  it('handles #', () => {
    const r = parseAddressParts('500 MAIN ST #7, LOGAN, UT 84321');
    expect(r.suite).toBe('7');
  });

  it('returns empty parts for unparseable input', () => {
    const r = parseAddressParts('gibberish');
    expect(r.building).toBe('');
    expect(r.city).toBe('');
  });
});

describe('extractAttorneyBlock', () => {
  const armstrongDocket = `
                                                             This document requires you to
                                                     respond. Please see the Notice to Responding Party
    GUGLIELMO & ASSOCIATES
    Heather Valerga, (Utah Attorney Bar#  14431)
    PO Box 41688
    Tucson, AZ 85717
    Tel: (877)325-5700
    FAX: (520)325-2480
    Utah@guglielmolaw.com
    Attorney for Plaintiff
  `;

  it('extracts the Utah attorney block anchored on Bar#', () => {
    const r = extractAttorneyBlock(armstrongDocket);
    expect(r.name).toBe('Heather Valerga');
    expect(r.barNumber).toBe('14431');
    expect(r.firm).toBe('GUGLIELMO & ASSOCIATES');
    expect(r.addressLine1).toBe('PO Box 41688');
    expect(r.addressLine2).toBe('Tucson, AZ 85717');
    expect(r.tel).toBe('8773255700');
    expect(r.fax).toBe('5203252480');
    expect(r.email).toBe('Utah@guglielmolaw.com');
  });

  it('returns empty struct when no Bar# token present', () => {
    const r = extractAttorneyBlock('unrelated pdf text with no bar number');
    expect(r.barNumber).toBe('');
    expect(r.name).toBe('');
  });
});

describe('parseInfoSheetLabels', () => {
  const infoSheet = `
    Court Case
    Case                [not provided]
    Plaintiff           Capital One, N.A., successor by merger to
                        Discover Bank
    Defendant           Abbey Armstrong
    Filed               —
    Court Date          —
    Court               THIRD JUDICIAL DISTRICT COURT, STATE
                        OF UTAH - MATHESON
    Address             450 S STATE ST PO BOX 1860
                        SALT LAKE CITY, UT 84114
    County              SALT LAKE

    Job Created         Apr 1, 2026
    Created By          ICU Investigations, LLC
  `;

  it('parses labelled fields including multi-line values', () => {
    const r = parseInfoSheetLabels(infoSheet);
    expect(r.plaintiff).toBe('Capital One, N.A., successor by merger to Discover Bank');
    expect(r.defendant).toBe('Abbey Armstrong');
    expect(r.court).toBe('THIRD JUDICIAL DISTRICT COURT, STATE OF UTAH - MATHESON');
    expect(r.courtAddress).toBe('450 S STATE ST PO BOX 1860 SALT LAKE CITY, UT 84114');
    expect(r.county).toBe('SALT LAKE');
    expect(r.createdBy).toBe('ICU Investigations, LLC');
  });

  it('returns empty strings when sheet is blank', () => {
    const r = parseInfoSheetLabels('');
    expect(r.plaintiff).toBe('');
  });
});

describe('parseJobActivity', () => {
  const infoSheet = `
    Job Activity
    4/13/26, 2:10 pm   Process server assigned   Christopher Zamora was assigned to the job   Jason Currie
    4/7/26, 12:12 pm   Due Date Changed          Due date was changed from Apr 15, 2026 to Apr 21, 2026
    4/2/26, 6:07 am    Job Data Updated          David Blake
    4/1/26, 12:01 pm   Due Date Changed          Due date was set to Apr 15, 2026

    Job Type           G&A Service Type
  `;

  it('parses timestamped activity entries', () => {
    const r = parseJobActivity(infoSheet);
    expect(r).toHaveLength(4);
    expect(r[0].when).toBe('4/13/26, 2:10 pm');
    expect(r[0].action).toBe('Process server assigned');
    expect(r[1].action).toBe('Due Date Changed');
    expect(r[1].detail).toContain('Apr 15, 2026 to Apr 21, 2026');
  });

  it('returns [] when no Job Activity section', () => {
    expect(parseJobActivity('nothing relevant')).toEqual([]);
  });

  it('does not merge trailing "Job Created" metadata into an activity detail', () => {
    // Repro of the armstrong David Blake row: pdftotext -layout collapses a
    // side-column metadata field ("Job Created  Apr 1, 2026") onto the same
    // line as a "Job Data Updated | David Blake" entry. Parser must keep only
    // the actor in detail, not the trailing metadata.
    const infoSheet = [
      'Job Activity',
      ' 4/2/26, 6:07 am     Job Data Updated                                                                          David Blake            Job Created      Apr 1, 2026',
    ].join('\n');
    const r = parseJobActivity(infoSheet);
    expect(r).toHaveLength(1);
    expect(r[0].when).toBe('4/2/26, 6:07 am');
    expect(r[0].action).toBe('Job Data Updated');
    expect(r[0].detail).toBe('David Blake');
    expect(r[0].detail).not.toMatch(/Job Created/i);
  });
});

describe('computeDiligenceSchedule', () => {
  it('returns 3 attempts with the required weekend slot across a multi-day window', () => {
    const now = new Date('2026-04-19T07:30:00-06:00');
    const due = new Date('2026-04-21T23:59:59-06:00');
    const plan = computeDiligenceSchedule(due, now);
    expect(plan).toHaveLength(3);
    expect(plan.map(p => p.window).sort()).toEqual(['6AM-9AM', '6PM-9PM', '9AM-6PM'].sort());
    expect(plan.some(p => { const d = p.date.getDay(); return d === 0 || d === 6; })).toBe(true);
  });

  it('fits all 3 attempts into a same-day window if that is all that is left', () => {
    const now = new Date('2026-04-19T07:00:00-06:00');
    const due = new Date('2026-04-19T21:00:00-06:00');
    const plan = computeDiligenceSchedule(due, now);
    expect(plan).toHaveLength(3);
  });
});

describe('deriveServiceType', () => {
  it('maps SUMMONS → SUMMONS SERVICE', () => { expect(deriveServiceType('SUMMONS')).toBe('SUMMONS SERVICE'); });
  it('maps SUBPOENA', () => { expect(deriveServiceType('SUBPOENA')).toBe('SUBPOENA SERVICE'); });
  it('maps UNLAWFUL DETAINER → EVICTION SERVICE', () => { expect(deriveServiceType('UNLAWFUL DETAINER')).toBe('EVICTION SERVICE'); });
  it('defaults to PROCESS SERVICE', () => { expect(deriveServiceType('RANDOM')).toBe('PROCESS SERVICE'); });
});

describe('primaryDocToken', () => {
  it('takes the first meaningful token of a semi-colon-separated docs list', () => {
    expect(primaryDocToken('Summons and Complaint; Bilingual Notice')).toBe('SUMMONS');
  });
  it('strips " and " joiners', () => {
    expect(primaryDocToken('Summons and Complaint')).toBe('SUMMONS');
  });
});

describe('classifyEntityType', () => {
  it('individuals', () => { expect(classifyEntityType('Abbey Armstrong')).toBe('individual'); });
  it('orgs by suffix', () => {
    for (const org of ['Capital One, N.A.', 'Acme LLC', 'Foo Inc.', 'Discover Bank', 'GUGLIELMO & ASSOCIATES']) {
      expect(classifyEntityType(org)).toBe('organization');
    }
  });
});

describe('buildNotesNarrative', () => {
  const input: NotesInput = {
    plaintiff: 'Capital One, N.A., successor by merger to Discover Bank',
    orderingClientRule: 'Sub-serve on 1st attempt to any occupant 16+.',
    clientJobNumber: '633570',
    documents: 'Summons and Complaint; Bilingual Notice',
    documentPages: 11,
    bilingual: true,
    signedDate: 'March 25, 2026',
    responseDeadlineDays: 21,
    court: 'THIRD JUDICIAL DISTRICT COURT',
    courtAddress: '450 SOUTH STATE ST, P.O. BOX 1860, SALT LAKE CITY UT 84114',
    clerkPhone: '(801) 238-7300',
    attorney: { name: 'Heather Valerga', firm: 'GUGLIELMO & ASSOCIATES', barNumber: '14431', addressLine1: 'PO Box 41688', addressLine2: 'Tucson, AZ 85717', tel: '(877)325-5700', fax: '', email: 'Utah@guglielmolaw.com' },
    serviceRulesSummary: 'SUB-SERVE OK TO OCCUPANT 16+. PERSONAL SERVICE ONLY AT PLACE OF EMPLOYMENT.',
    serviceWindows: '6AM-9AM, 9AM-6PM, 6PM-9PM, WEEKEND REQUIRED',
    dueDate: '04/21/2026',
    daysRemaining: 2,
    recommendedAttempts: [
      { label: 'SUN, APR 19, 8:30 AM (6AM-9AM)', weekend: true },
      { label: 'MON, APR 20, 12:00 PM (9AM-6PM)', weekend: false },
      { label: 'TUE, APR 21, 7:30 PM (6PM-9PM)', weekend: false },
    ],
    jobActivity: [
      { when: '4/13/26, 2:10 PM', action: 'Process server assigned', detail: 'Christopher Zamora was assigned to the job' },
    ],
    instructionsVerbatim: 'Sub-serve on 1st attempt to any occupant 16+.',
    timestamp: '2026-04-19 07:30:12',
  };

  it('produces 8 entries in the documented order', () => {
    const notes = buildNotesNarrative(input);
    expect(notes).toHaveLength(8);
    expect(notes[0].text).toMatch(/^CASE --/);
    expect(notes[1].text).toMatch(/^COURT --/);
    expect(notes[2].text).toMatch(/^ATTORNEY --/);
    expect(notes[3].text).toMatch(/^SERVICE RULES --/);
    expect(notes[4].text).toMatch(/^SCHEDULE --/);
    expect(notes[5].text).toMatch(/^RECOMMENDED SCHEDULE --/);
    expect(notes[6].text).toMatch(/^CLIENT HISTORY --/);
    expect(notes[7].text).toMatch(/^INSTRUCTIONS \(VERBATIM\) --/);
  });

  it('CASE line contains pipe-delimited plaintiff/client/case#/documents/signed/deadline', () => {
    const notes = buildNotesNarrative(input);
    const caseText = notes[0].text;
    expect(caseText).toContain('PLAINTIFF: CAPITAL ONE');
    expect(caseText).toContain('CASE #633570');
    expect(caseText).toContain('2 DOCS');
    expect(caseText).toContain('11 PAGES');
    expect(caseText).toContain('BILINGUAL');
    expect(caseText).toContain('SIGNED/FILED: MARCH 25, 2026');
    expect(caseText).toContain('RESPONSE DEADLINE: 21 DAYS AFTER SERVICE');
  });

  it('ATTORNEY line uses Firm parenthetical + BAR#', () => {
    const notes = buildNotesNarrative(input);
    expect(notes[2].text).toContain('HEATHER VALERGA (GUGLIELMO & ASSOCIATES) BAR#14431');
    expect(notes[2].text).toContain('PO BOX 41688, TUCSON, AZ 85717');
    expect(notes[2].text).toContain('TEL: (877)325-5700');
    expect(notes[2].text).toContain('EMAIL: UTAH@GUGLIELMOLAW.COM');
  });
});

describe('extractDocketBarcodeJobNumber', () => {
  it('extracts 6-digit job number from asterisk-delimited Code39', () => {
    expect(extractDocketBarcodeJobNumber('SCC\n\n*S10000633570*\n\n633570')).toBe('633570');
  });
  it('returns empty when no barcode present', () => {
    expect(extractDocketBarcodeJobNumber('no barcode here')).toBe('');
  });
});

describe('extractComplaintResidence', () => {
  it('extracts residence from Utah complaint paragraph 2', () => {
    const text = 'Defendant Abbey Armstrong is an individual, who resides at 2361 E 3395 S Salt Lake Cty, UT, 84109-3037, in SALT LAKE County, this court has jurisdiction.';
    expect(extractComplaintResidence(text)).toMatch(/2361 E 3395 S Salt Lake Cty, UT, 84109-3037/);
  });
  it('returns empty when no "who resides at" pattern', () => {
    expect(extractComplaintResidence('no residence clause')).toBe('');
  });
});

describe('addressConfidence', () => {
  it('scores identical addresses at 100', () => {
    expect(addressConfidence('2361 E 3395 S, Salt Lake City, UT 84109', '2361 E 3395 S, Salt Lake City, UT 84109')).toBe(100);
  });
  it('scores unit-only difference high', () => {
    const score = addressConfidence('2361 E 3395 S UNIT A, SLC, UT', '2361 E 3395 S, SLC, UT');
    expect(score).toBeGreaterThan(85);
  });
  it('scores completely different addresses low', () => {
    const score = addressConfidence('2361 E 3395 S, SLC, UT', '1000 Main St, Logan, UT');
    expect(score).toBeLessThan(60);
  });
  it('handles 3-way match', () => {
    const score = addressConfidence(
      '2361 E 3395 S, Salt Lake City, UT 84109',
      '2361 E 3395 S, Salt Lake Cty, UT, 84109-3037',
      '2361 E 3395 S, SALT LAKE CITY, UT 84109',
    );
    expect(score).toBeGreaterThan(85);
  });
});

describe('extractAllDefendants', () => {
  it('extracts a single defendant from caption', () => {
    const text = 'Capital One,\n Plaintiff,\n vs.\n Abbey Armstrong, an individual,\n Defendant';
    expect(extractAllDefendants(text)).toEqual(['Abbey Armstrong']);
  });
  it('extracts two defendants joined by "and"', () => {
    const text = 'Capital One,\n Plaintiff,\n vs.\n Abbey Armstrong and John Doe, an individuals,\n Defendants';
    const r = extractAllDefendants(text);
    expect(r).toEqual(['Abbey Armstrong', 'John Doe']);
  });
  it('extracts three+ defendants with mixed separators', () => {
    const text = 'X, P,\n v.\n Jane Smith, John Doe, and Jim Roe, Defendants';
    const r = extractAllDefendants(text);
    expect(r).toContain('Jane Smith');
    expect(r).toContain('John Doe');
    expect(r).toContain('Jim Roe');
  });
  it('returns [] when no caption found', () => {
    expect(extractAllDefendants('no caption here')).toEqual([]);
  });
});

