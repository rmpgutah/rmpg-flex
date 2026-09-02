import { describe, it, expect } from 'vitest';
import {
  formatStampTimestamp, formatGeoLine, formatOfficerLine, contextLabelForEntity, buildStampLines,
  buildEvidenceOverlayLines,
} from '../photoStamp';

describe('photoStamp — stamp lines', () => {
  // 2026-06-11 20:07:03Z = 14:07:03 MDT
  const D = new Date('2026-06-11T20:07:03.000Z');

  it('formats the timestamp MM-DD-YYYY at HH:MM:SS (TMZ)', () => {
    const s = formatStampTimestamp(D);
    expect(s).toMatch(/^06-11-2026 at 14:07:03 \(M[DS]T\)$/);
  });

  it('never formats capture time in the device zone (UTC would be 20:07)', () => {
    const s = formatStampTimestamp(D);
    expect(s).not.toContain('20:07');
  });

  it('formats geo line with 6-decimal coords, or UNAVAILABLE', () => {
    expect(formatGeoLine(40.76078, -111.891045)).toBe('GEO  40.760780, -111.891045');
    expect(formatGeoLine(40.66879, 111.94449)).toBe('GEO  40.668790, -111.944490');
    expect(formatGeoLine(undefined, undefined)).toBe('GEO  UNAVAILABLE');
    expect(formatGeoLine(NaN, 5)).toBe('GEO  UNAVAILABLE');
  });

  it('formats the officer + context line', () => {
    expect(formatOfficerLine({ officerLast: 'Zamora', badge: 'D-101', context: 'Vehicle Inspection' }))
      .toBe('FI. ZAMORA #D-101  —  VEHICLE INSPECTION');
    expect(formatOfficerLine({ officerLast: 'Doe' })).toBe('FI. DOE');
  });

  it('derives context labels per entity type', () => {
    expect(contextLabelForEntity('evidence', '25-0142')).toBe('EVIDENCE - CASE NO. 25-0142');
    expect(contextLabelForEntity('evidence')).toBe('EVIDENCE');
    expect(contextLabelForEntity('person')).toBe('PERSONS RECORD');
    expect(contextLabelForEntity('vehicle')).toBe('VEHICLES RECORD');
    expect(contextLabelForEntity('property')).toBe('PROPERTIES RECORD');
    expect(contextLabelForEntity('fleet_inspection')).toBe('VEHICLE INSPECTION');
    expect(contextLabelForEntity('widget')).toBe('WIDGET RECORD');
  });

  it('builds Files-tab overlay lines in Mountain Time for stored attachment metadata', () => {
    const lines = buildEvidenceOverlayLines({
      takenAt: '2026-08-12T08:42:12.000Z',
      lat: 40.71348,
      lon: -111.83359,
      officerName: 'Christopher Zamora',
      referenceNotes: 'Reference',
    });
    expect(lines[0]).toMatch(/^08-12-2026 at 02:42:12 \(M[DS]T\)$/);
    expect(lines[1]).toBe('GEO  40.713480, -111.833590');
    expect(lines[2]).toBe('FI. CHRISTOPHER ZAMORA  —  REFERENCE');
  });

  it('builds the full 3-line stamp set', () => {
    const lines = buildStampLines({ officerLast: 'Zamora', badge: 'D-101', context: 'Evidence - Case No. 25-0142', lat: 40.76, lon: -111.89, date: D });
    expect(lines.length).toBe(3);
    expect(lines[0]).toMatch(/^06-11-2026 at 14:07:03 \(M[DS]T\)$/);
    expect(lines[1]).toMatch(/^GEO  40\.760000, -111\.890000$/);
    expect(lines[2]).toBe('FI. ZAMORA #D-101  —  EVIDENCE - CASE NO. 25-0142');
  });
});
