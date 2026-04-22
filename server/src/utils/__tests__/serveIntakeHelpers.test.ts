import { describe, it, expect } from 'vitest';
import { parseAddressParts, extractAttorneyBlock, parseInfoSheetLabels } from '../serveIntakeHelpers';

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
