import { describe, it, expect } from 'vitest';
import {
  priorityBucket,
  formatAge,
  freshnessClass,
} from '../warrantListHelpers';

describe('warrantListHelpers', () => {
  it('priorityBucket', () => {
    expect(priorityBucket(95)).toBe('critical');
    expect(priorityBucket(75)).toBe('high');
    expect(priorityBucket(50)).toBe('medium');
    expect(priorityBucket(5)).toBe('low');
    expect(priorityBucket(null)).toBe('low');
  });

  // These boundaries are coupled to computePriorityScore's base values in
  // src/routes/warrants.ts. They are asserted against the SCORES THE MODEL
  // PRODUCES, not round numbers, so a change on either side breaks the pair.
  it('priorityBucket boundaries match the scoring model', () => {
    // A felony with NO modifiers scores exactly 60 and must read as high — the
    // scorer's stated intent. Under the previous 70 boundary this was 'medium',
    // and a live felony scoring 61 was being understated on the service queue.
    expect(priorityBucket(60)).toBe('high');
    expect(priorityBucket(61)).toBe('high');
    expect(priorityBucket(59)).toBe('medium');

    // A maximally stale misdemeanor tops out at 45 (30 + the 15 staleness cap).
    // It must stay medium: age alone must never reach the felony band.
    expect(priorityBucket(45)).toBe('medium');

    // A plain misdemeanor (30) stays low; critical remains reserved for a felony
    // with genuinely stacked aggravating factors.
    expect(priorityBucket(30)).toBe('low');
    expect(priorityBucket(89)).toBe('high');
    expect(priorityBucket(90)).toBe('critical');
  });
  it('formatAge', () => {
    expect(formatAge(3)).toBe('3d');
    expect(formatAge(15)).toBe('2w');
    expect(formatAge(180)).toBe('6mo');
    expect(formatAge(800)).toBe('2y');
    expect(formatAge(null)).toBe('—');
  });
  it('freshnessClass', () => {
    expect(freshnessClass(0)).toBe('fresh');
    expect(freshnessClass(3)).toBe('recent');
    expect(freshnessClass(20)).toBe('stale');
    expect(freshnessClass(60)).toBe('old');
    expect(freshnessClass(null)).toBe('manual');
  });
  // stateFromSource was deleted — see the note in warrantListHelpers.ts. The
  // derivation now lives server-side in src/utils/warrantSourceState.ts and is
  // covered by tests/warrantSourceState.test.ts against the REAL live source
  // keys. The old test here only ever exercised the 'ut_warrants' shape, which
  // is why a parser that failed on every production key looked tested.

});
