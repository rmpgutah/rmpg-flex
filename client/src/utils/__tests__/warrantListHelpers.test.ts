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
