import { describe, it, expect } from 'vitest';
import { parseAddressParts, extractAttorneyBlock, parseInfoSheetLabels, parseJobActivity, computeDiligenceSchedule, deriveServiceType, primaryDocToken, classifyEntityType, buildNotesNarrative, NotesInput, validateAddressFormat, normalizeAddress, addressesMatch } from '../serveIntakeHelpers';

describe('parseAddressParts', () => {
  it('parses a unit-qualified address', () => {
    const r = parseAddressParts('1812 WEST 4100 SOUTH UNIT E215, WEST VALLEY CITY, UT 84119');
    expect(r).toEqual({
      building: '1812', floor: '', suite: 'E215',
      street: '1812 WEST 4100 SOUTH UNIT E215',
      city: 'WEST VALLEY CITY', state: 'UT', zip: '84119',
    });
  });

  it('parses a plain single-family address', () => {
    const r = parseAddressParts('1176 EL MONTE DRIVE, SALT LAKE CITY, UT 84117');
    expect(r).toEqual({
      building: '1176', floor: '', suite: 'NOT APPLICABLE',
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
});

describe('computeDiligenceSchedule', () => {
  // Helper: collapse each slot to its local-day string so tests can assert
  // "3 different days" without dragging timezone math into every assertion.
  const localDay = (d: Date, offset = -6) =>
    new Date(d.getTime() + offset * 3600000).toISOString().slice(0, 10);

  it('returns 3 attempts with distinct windows AND distinct days when multi-day window allows', () => {
    const now = new Date('2026-04-19T07:30:00-06:00'); // Sun
    const due = new Date('2026-04-21T23:59:59-06:00'); // Tue
    const plan = computeDiligenceSchedule(due, now, -6);
    expect(plan).toHaveLength(3);
    expect(plan.map(p => p.window).sort()).toEqual(['6AM-9AM', '6PM-9PM', '9AM-6PM'].sort());
    expect(plan.some(p => p.weekend)).toBe(true);
    // BUG REGRESSION GUARD: previously the picker stacked all 3 attempts on
    // the earliest day. Each attempt must now be on a different calendar day.
    const days = new Set(plan.map(p => localDay(p.date)));
    expect(days.size).toBe(3);
  });

  it('spreads across 3 different days even in a 4-day window (and still picks a weekend)', () => {
    const now = new Date('2026-04-23T08:00:00-06:00'); // Thu
    const due = new Date('2026-04-26T23:59:59-06:00'); // Sun
    const plan = computeDiligenceSchedule(due, now, -6);
    expect(plan).toHaveLength(3);
    const days = new Set(plan.map(p => localDay(p.date)));
    expect(days.size).toBe(3);
    expect(plan.some(p => p.weekend)).toBe(true);
  });

  it('falls back to same-day stacking only when no multi-day option exists', () => {
    const now = new Date('2026-04-19T07:00:00-06:00');
    const due = new Date('2026-04-19T21:00:00-06:00'); // single-day window
    const plan = computeDiligenceSchedule(due, now, -6);
    expect(plan).toHaveLength(3);
    const days = new Set(plan.map(p => localDay(p.date)));
    expect(days.size).toBe(1); // expected: all on the same day, because that's all there is
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

  // buildNotesNarrative defaults to 3 consolidated notes (briefing / case
  // packet / dossier). When caseNarrativeText is supplied a 4th detailed
  // narrative note slots between CASE PACKET and DOSSIER. Output is plain
  // text without emoji or box-drawing characters.
  it('produces 3 plain-text consolidated sections in order without narrative', () => {
    const notes = buildNotesNarrative(input);
    expect(notes).toHaveLength(3);
    expect(notes[0].text).toMatch(/^OFFICER BRIEFING/);
    expect(notes[1].text).toMatch(/^CASE PACKET/);
    expect(notes[2].text).toMatch(/^SUBJECT & ADDRESS DOSSIER/);
  });

  it('inserts the 4th CASE NARRATIVE note when caseNarrativeText is supplied', () => {
    const narrativeText = 'CASE NARRATIVE - Detailed review of the Complaint\nWHO:\nPLAINTIFF: Capital One';
    const notes = buildNotesNarrative({ ...input, caseNarrativeText: narrativeText });
    expect(notes).toHaveLength(4);
    expect(notes[0].text).toMatch(/^OFFICER BRIEFING/);
    expect(notes[1].text).toMatch(/^CASE PACKET/);
    expect(notes[2].text).toMatch(/^CASE NARRATIVE/);
    expect(notes[3].text).toMatch(/^SUBJECT & ADDRESS DOSSIER/);
  });

  it('OFFICER BRIEFING contains the 3-day diligence plan with door-approach guidance', () => {
    const notes = buildNotesNarrative(input);
    const brief = notes[0].text;
    expect(brief).toContain('3-DAY DILIGENCE PLAN');
    expect(brief).toContain('ATTEMPT 1');
    expect(brief).toContain('ATTEMPT 2');
    expect(brief).toContain('ATTEMPT 3');
    expect(brief).toContain('Knock 3 times');
    expect(brief).toContain('photograph front door');
    expect(brief).toContain('Vary the day-of-week');
    expect(brief).toContain('GPS-tagged photo');
  });

  it('CASE PACKET embeds caseSynopsisText when supplied', () => {
    const synopsis = '📖 WHAT YOU ARE SERVING (auto-synopsis)\nDiscover Bank is suing Daisy Doe to collect $14,500.';
    const notes = buildNotesNarrative({ ...input, caseSynopsisText: synopsis });
    expect(notes[1].text).toContain('📖 WHAT YOU ARE SERVING');
    expect(notes[1].text).toContain('Discover Bank is suing Daisy Doe');
  });

  it('CASE PACKET section contains plaintiff, case #, documents, signed date, deadline', () => {
    const notes = buildNotesNarrative(input);
    const caseText = notes[1].text;
    expect(caseText).toContain('PLAINTIFF         : CAPITAL ONE');
    expect(caseText).toContain('CASE #            : 633570');
    expect(caseText).toContain('SUMMONS + COMPLAINT');
    expect(caseText).toContain('PAGES             : 11');
    expect(caseText).toContain('(BILINGUAL)');
    expect(caseText).toContain('SIGNED / FILED    : MARCH 25, 2026');
    expect(caseText).toContain('RESPONSE DEADLINE : 21 day(s) after service');
  });

  it('ATTORNEY block in CASE PACKET includes name, firm, bar #, address, phone, email', () => {
    const notes = buildNotesNarrative(input);
    const caseText = notes[1].text;
    expect(caseText).toContain('NAME              : HEATHER VALERGA');
    expect(caseText).toContain('FIRM              : GUGLIELMO & ASSOCIATES');
    expect(caseText).toContain('BAR #             : 14431');
    expect(caseText).toContain('ADDRESS           : PO BOX 41688, TUCSON, AZ 85717');
    expect(caseText).toContain('PHONE             : (877)325-5700');
    expect(caseText).toContain('EMAIL             : Utah@guglielmolaw.com');
  });

  it('DOSSIER folds in enrichmentText + verbatim instructions + job activity', () => {
    const enrichmentText = '🔍 INTAKE ENRICHMENT\n👤 SUBJECT HISTORY: 3 prior call(s)';
    const notes = buildNotesNarrative({ ...input, enrichmentText });
    const dossier = notes[2].text;
    expect(dossier).toContain('🔍 INTAKE ENRICHMENT');
    expect(dossier).toContain('SUBJECT HISTORY');
    expect(dossier).toContain('VERBATIM CLIENT INSTRUCTIONS');
    expect(dossier).toContain('Sub-serve on 1st attempt');
    expect(dossier).toContain('JOB ACTIVITY HISTORY');
  });
});

// ═══════════════════════════════════════════════════════════════
// NEW TESTS — Serve Intake Enhancements
// ═══════════════════════════════════════════════════════════════

describe('parseAddressParts — floor extraction', () => {
  it('extracts floor from "Floor 3" pattern', () => {
    const r = parseAddressParts('100 MAIN ST FLOOR 3, SALT LAKE CITY, UT 84101');
    expect(r.floor).toBe('3');
  });

  it('extracts floor from "3RD FLOOR" pattern', () => {
    const r = parseAddressParts('100 MAIN ST 3RD FLOOR, SALT LAKE CITY, UT 84101');
    expect(r.floor).toBe('3');
  });

  it('extracts floor from "FL 2" pattern', () => {
    const r = parseAddressParts('200 STATE ST FL 2, SALT LAKE CITY, UT 84101');
    expect(r.floor).toBe('2');
  });

  it('extracts floor from "LEVEL B" pattern', () => {
    const r = parseAddressParts('300 S TEMPLE LEVEL B, SALT LAKE CITY, UT 84101');
    expect(r.floor).toBe('B');
  });

  it('returns empty floor when no floor info in address', () => {
    const r = parseAddressParts('456 ELM ST, PROVO, UT 84601');
    expect(r.floor).toBe('');
  });
});

describe('classifyEntityType — improved & classification', () => {
  it('classifies "Tom & Mary Johnson" as individual', () => {
    expect(classifyEntityType('Tom & Mary Johnson')).toBe('individual');
  });

  it('still classifies "GUGLIELMO & ASSOCIATES" as org', () => {
    expect(classifyEntityType('GUGLIELMO & ASSOCIATES')).toBe('organization');
  });

  it('classifies org keywords: Foundation, Holdings, Enterprises', () => {
    expect(classifyEntityType('Smith Foundation')).toBe('organization');
    expect(classifyEntityType('ABC Holdings')).toBe('organization');
    expect(classifyEntityType('XYZ Enterprises')).toBe('organization');
  });

  it('classifies simple names as individual', () => {
    expect(classifyEntityType('John Smith')).toBe('individual');
    expect(classifyEntityType('Maria Garcia')).toBe('individual');
  });

  it('"A & B Corp" → org due to Corp keyword', () => {
    expect(classifyEntityType('A & B Corp')).toBe('organization');
  });
});

describe('validateAddressFormat', () => {
  it('returns valid for a complete address', () => {
    const r = validateAddressFormat('123 Main St, Salt Lake City, UT 84101');
    expect(r.valid).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it('warns on missing ZIP', () => {
    const r = validateAddressFormat('123 Main St, Salt Lake City, UT');
    expect(r.valid).toBe(false);
    expect(r.warnings.some(w => /ZIP/i.test(w))).toBe(true);
  });

  it('warns on missing street number', () => {
    const r = validateAddressFormat('Main St, Salt Lake City, UT 84101');
    expect(r.valid).toBe(false);
    expect(r.warnings.some(w => /street number/i.test(w))).toBe(true);
  });

  it('warns on missing comma separator', () => {
    const r = validateAddressFormat('123 Main St Salt Lake City UT 84101');
    expect(r.valid).toBe(false);
    expect(r.warnings.some(w => /separator/i.test(w))).toBe(true);
  });

  it('invalid for empty string', () => {
    const r = validateAddressFormat('');
    expect(r.valid).toBe(false);
  });
});

describe('normalizeAddress', () => {
  it('expands street abbreviations', () => {
    expect(normalizeAddress('123 Main St, SLC, UT 84101')).toContain('STREET');
  });

  it('normalizes to uppercase', () => {
    const n = normalizeAddress('123 Main Dr, Provo, UT 84601');
    expect(n).toBe('123 MAIN DRIVE, PROVO, UT 84601');
  });

  it('collapses multiple spaces', () => {
    const n = normalizeAddress('123  Main   St,  SLC,  UT  84101');
    expect(n).not.toMatch(/  /);
  });
});

describe('addressesMatch', () => {
  it('matches addresses with different abbreviations', () => {
    expect(addressesMatch('123 Main St, Salt Lake City, UT 84101', '123 Main Street, Salt Lake City, UT 84101')).toBe(true);
  });

  it('does not match different addresses', () => {
    expect(addressesMatch('123 Main St, Salt Lake City, UT 84101', '456 Elm Dr, Provo, UT 84601')).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(addressesMatch('', '123 Main St, SLC, UT 84101')).toBe(false);
  });
});
