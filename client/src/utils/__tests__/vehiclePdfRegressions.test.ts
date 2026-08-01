// Regression tests for the vehicle-record PDF (FORM PS-203) defects found
// 2026-07-31 when the operator compared a live-printed record against the
// on-screen Records view.
//
// Defect 1: tow_status was compared raw against the lowercase literal
// 'none', but the column is stored title-cased ('None', 'Police Hold', ...)
// per TOW_STATUS_OPTIONS. Every non-empty tow_status — including the
// default 'None' — falsely stamped an IMPOUNDED pill on the vehicle
// quick-reference banner, contradicting the document's own LEGAL STATUS
// section two sections lower.
//
// Defect 2: the linked-records strip had no persons badge at all (vehicle
// records link to persons via `linked_persons`), so the LINKED count
// silently excluded every associated person. Labels were also always
// plural regardless of count ("1 PROPERTIES").
import { describe, it, expect } from 'vitest';
import { isVehicleActivelyTowed } from '../recordPdfGenerator';
import { pluralizeBadgeLabel } from '../pdfDetailHelpers';

describe('isVehicleActivelyTowed (Defect 1 — false IMPOUNDED pill)', () => {
  it.each([
    ['none', false],
    ['None', false],
    ['NONE', false],
    ['', false],
    [null, false],
    [undefined, false],
    ['n/a', false],
    ['N/A', false],
    ['-', false],
  ])('tow_status %j does not indicate an active tow', (value, expected) => {
    expect(isVehicleActivelyTowed(value as any)).toBe(expected);
  });

  it.each([
    'Police Hold',
    'Investigation Hold',
    'Owner Request',
    'Abandoned',
  ])('a genuine tow_status value (%s) DOES indicate an active tow', (value) => {
    expect(isVehicleActivelyTowed(value)).toBe(true);
  });
});

describe('pluralizeBadgeLabel (Defect 2 — mis-pluralized LINKED strip)', () => {
  it('keeps the singular form at count 1', () => {
    expect(pluralizeBadgeLabel('property', 1)).toBe('property');
    expect(pluralizeBadgeLabel('person', 1)).toBe('person');
    expect(pluralizeBadgeLabel('warrant', 1)).toBe('warrant');
  });

  it('uses the irregular plural for property/trespass at counts != 1', () => {
    expect(pluralizeBadgeLabel('property', 2)).toBe('properties');
    expect(pluralizeBadgeLabel('property', 0)).toBe('properties');
    expect(pluralizeBadgeLabel('trespass', 3)).toBe('trespasses');
  });

  it('uses the regular +s rule for everything else', () => {
    expect(pluralizeBadgeLabel('person', 2)).toBe('persons');
    expect(pluralizeBadgeLabel('warrant', 3)).toBe('warrants');
    expect(pluralizeBadgeLabel('vehicle', 5)).toBe('vehicles');
  });
});
