// isFlagSet — the sentinel guard behind officer-safety cautions.
//
// The set-membership check alone let two shapes of "empty" through, and both
// produced FALSE safety output rather than suppressing a real flag:
//
//   1. JSON-encoded empty collections. `flags` columns hold the literal string
//      "[]" — on live that is ALL 42 vehicles_records rows and 68 persons rows.
//      dispatcherAwareness joins set flags into a caution, so every vehicle
//      lookup emitted `Flags: [].` and every person caution rendered "[]",
//      which the AI dispatcher reads back over the air.
//   2. Trailing punctuation. Live holds "Unknown." (mental_health_flags,
//      substance_abuse), which an exact match misses — so a mental-health
//      caution fired for a subject whose record says the answer is unknown.
//
// Same presence-vs-affirmation error as the "Not Stolen" stolen flag: a value
// existing is not that value being true. The live strings are pinned here.
import { describe, it, expect } from 'vitest';
import { isFlagSet } from '../src/utils/sentinel';

describe('isFlagSet — JSON-encoded empty collections (live "[]" rows)', () => {
  for (const v of ['[]', '{}', '[ ]', '[""]', '["", ""]', '[null]']) {
    it(`treats ${JSON.stringify(v)} as ABSENT`, () => {
      expect(isFlagSet(v)).toBe(false);
    });
  }

  it('still treats a populated flag list as SET', () => {
    // Real live values from persons.flags.
    expect(isFlagSet('["dl_ocr_imported"]')).toBe(true);
    expect(isFlagSet('["dl_scan_imported"]')).toBe(true);
    expect(isFlagSet('[{"type":"archived","at":"2026-07-21T19:36:10.478Z"}]')).toBe(true);
  });

  it('treats a populated object as SET and an empty one as absent', () => {
    expect(isFlagSet('{"gang":"x"}')).toBe(true);
    expect(isFlagSet('{}')).toBe(false);
  });

  it('does not mistake bracket-looking prose for JSON', () => {
    // Falls through to the sentinel match rather than throwing.
    expect(isFlagSet('[see narrative]')).toBe(true);
  });
});

describe('isFlagSet — trailing punctuation (live "Unknown." rows)', () => {
  for (const v of ['Unknown.', 'unknown.', 'N/A.', 'None.', 'no.', 'None ', '--.']) {
    it(`treats ${JSON.stringify(v)} as ABSENT`, () => {
      expect(isFlagSet(v)).toBe(false);
    });
  }

  it('keeps a real value that merely ends in a period', () => {
    // Live caution_flags values are full sentences and must survive.
    expect(isFlagSet('History of violence with people, and animals.')).toBe(true);
    expect(isFlagSet('Active warrant on file as of 06/13/2026.')).toBe(true);
  });
});

describe('isFlagSet — bare sentinels still absent', () => {
  for (const v of ['', '   ', 'none', 'NONE', 'n/a', 'na', '0', 'false', 'no',
                   'null', 'undefined', '--', 'unknown', null, undefined]) {
    it(`treats ${JSON.stringify(v)} as ABSENT`, () => {
      expect(isFlagSet(v)).toBe(false);
    });
  }

  it('treats real flag content as SET', () => {
    expect(isFlagSet('Methamphetamine')).toBe(true);
    expect(isFlagSet('Probation')).toBe(true);
    expect(isFlagSet('Evasive History')).toBe(true);
    expect(isFlagSet(1)).toBe(true);
  });

  it('agrees with the live gang_affiliation data (42 rows of "None")', () => {
    expect(isFlagSet('None')).toBe(false);
  });
});
