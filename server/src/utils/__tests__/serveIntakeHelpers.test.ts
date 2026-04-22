import { describe, it, expect } from 'vitest';
import { parseAddressParts, extractAttorneyBlock, parseInfoSheetLabels, parseJobActivity, computeDiligenceSchedule } from '../serveIntakeHelpers';

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
