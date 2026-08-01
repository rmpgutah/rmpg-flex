// isVehicleStolen — the stolen-vehicle determination behind a CRITICAL
// officer-safety alert.
//
// Two call sites decided this independently and both got it wrong in the same
// direction — raising a FALSE alert rather than missing a real one:
//
//   intelScreen.screenVehicle()  is_stolen === 1 || isRealValue(stolen_status)
//   dispatcherAwareness          /stolen|yes|active/i.test(stolen_status)
//
// isRealValue only rejects sentinels, and /stolen/ matches inside "not stolen",
// so BOTH treated the literal "Not Stolen" as stolen. On live D1 that is not
// hypothetical: is_stolen is populated on ZERO of 42 rows, stolen_status is the
// column that carries the value, and every populated non-empty value today is a
// NEGATIVE — "Not Stolen" (5 rows) and "Cleared" (1). An ALPR capture of any of
// those six plates fired a critical notification reading
// "STOLEN (Not Stolen) — <plate>".
//
// The live values are pinned explicitly below so this cannot regress quietly.
import { describe, it, expect } from 'vitest';
import { isVehicleStolen } from '../src/utils/intelMatch';

describe('isVehicleStolen — live stolen_status values', () => {
  // Exactly what live D1 holds today.
  const LIVE_NEGATIVES = ['Not Stolen', 'Cleared', '', null];

  for (const v of LIVE_NEGATIVES) {
    it(`does NOT flag ${JSON.stringify(v)} (live value)`, () => {
      expect(isVehicleStolen(null, v)).toBe(false);
    });
  }

  it('rejects every live value even though isRealValue accepts "Not Stolen"', () => {
    // The regression in one line: presence is not the same as affirmation.
    expect(isVehicleStolen(null, 'Not Stolen')).toBe(false);
  });
});

describe('isVehicleStolen — negations beat the bare /stolen/ match', () => {
  for (const v of ['not stolen', 'NOT STOLEN', 'Not-Stolen', 'non stolen',
                   'unstolen', 'recovered', 'Unfounded', 'false report', 'no']) {
    it(`treats ${JSON.stringify(v)} as not stolen`, () => {
      expect(isVehicleStolen(null, v)).toBe(false);
    });
  }
});

describe('isVehicleStolen — real positives still fire', () => {
  for (const v of ['Stolen', 'STOLEN', 'stolen - confirmed', 'reported stolen',
                   'yes', 'Active', 'confirmed']) {
    it(`flags ${JSON.stringify(v)}`, () => {
      expect(isVehicleStolen(null, v)).toBe(true);
    });
  }

  it('honours the boolean column when it is actually set', () => {
    expect(isVehicleStolen(1, null)).toBe(true);
    expect(isVehicleStolen(true, null)).toBe(true);
    expect(isVehicleStolen('1', null)).toBe(true);
  });

  it('a set boolean wins even against a negative status string', () => {
    // NCIC said stolen; a stale local status string must not suppress it.
    expect(isVehicleStolen(1, 'Not Stolen')).toBe(true);
  });
});

describe('isVehicleStolen — sentinel strings are not affirmations', () => {
  // Live text columns store "None"/"N/A"/"0" instead of NULL.
  for (const v of ['none', 'N/A', 'na', 'null', '0', 'unknown', '   ']) {
    it(`treats sentinel ${JSON.stringify(v)} as not stolen`, () => {
      expect(isVehicleStolen(0, v)).toBe(false);
    });
  }

  it('does not treat a 0 boolean as stolen', () => {
    expect(isVehicleStolen(0, null)).toBe(false);
  });
});
