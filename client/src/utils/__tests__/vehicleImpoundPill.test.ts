// Regression pin for the PS-203 IMPOUNDED pill.
//
// The banner pill used to be `data.tow_status && data.tow_status !== 'none'` —
// a case-SENSITIVE comparison against a column live D1 stores capitalized
// ('None'). So the only vehicles stamped IMPOUNDED on the printed form were the
// ones that had explicitly recorded "no tow"; rows left '' or NULL were
// correctly blank. Recording the negative was punished, and the form contradicted
// its own TOW STATUS: NONE field two sections lower.
//
// These cases are drawn from the real tow_status distribution on live D1
// (2026-08-01): '' ×15, NULL ×8, 'None' ×2.

import { describe, it, expect } from 'vitest';
import { isVehicleImpounded } from '../recordPdfGenerator';

describe('isVehicleImpounded', () => {
  it('treats the live "no tow" values as NOT impounded', () => {
    // 'None' is the case that regressed — it must not stamp the form.
    expect(isVehicleImpounded('None')).toBe(false);
    expect(isVehicleImpounded('none')).toBe(false);
    expect(isVehicleImpounded('NONE')).toBe(false);
    expect(isVehicleImpounded('')).toBe(false);
    expect(isVehicleImpounded(null)).toBe(false);
    expect(isVehicleImpounded(undefined)).toBe(false);
    expect(isVehicleImpounded('  None  ')).toBe(false);
    expect(isVehicleImpounded('N/A')).toBe(false);
    expect(isVehicleImpounded('Not Towed')).toBe(false);
  });

  it('flags a genuine tow/hold regardless of casing', () => {
    expect(isVehicleImpounded('Impounded')).toBe(true);
    expect(isVehicleImpounded('impound')).toBe(true);
    expect(isVehicleImpounded('IMPOUNDED')).toBe(true);
    expect(isVehicleImpounded('Police Hold')).toBe(true);
    expect(isVehicleImpounded('Evidence Hold')).toBe(true);
  });

  it('does not flag an unrelated free-text tow value', () => {
    // Prior logic returned true for ANY non-'none' string, so a released
    // vehicle also printed as IMPOUNDED.
    expect(isVehicleImpounded('Released')).toBe(false);
    expect(isVehicleImpounded('Owner Recovered')).toBe(false);
  });

  it('ignores non-string values rather than coercing them', () => {
    expect(isVehicleImpounded(0)).toBe(false);
    expect(isVehicleImpounded(1)).toBe(false);
    expect(isVehicleImpounded({})).toBe(false);
  });
});
