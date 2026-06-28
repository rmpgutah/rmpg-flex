import { describe, it, expect } from 'vitest';
import {
  priorityBucket,
  formatAge,
  freshnessClass,
  stateFromSource,
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
  it('stateFromSource', () => {
    expect(stateFromSource('ut_warrants')).toBe('UT');
    expect(stateFromSource('fed_usms_wanted')).toBe('FED');
    expect(stateFromSource('manual')).toBe('—');
    expect(stateFromSource(null)).toBe('—');
  });
});
