import { describe, it, expect } from 'vitest';
import {
  computePriorityBucket,
  formatAge,
  computeFreshnessClass,
} from '../../src/utils/warrantHelpers';

describe('computePriorityBucket', () => {
  it('returns critical for score >= 90', () => {
    expect(computePriorityBucket(95)).toBe('critical');
    expect(computePriorityBucket(100)).toBe('critical');
  });
  it('returns high for 70-89', () => {
    expect(computePriorityBucket(70)).toBe('high');
    expect(computePriorityBucket(89)).toBe('high');
  });
  it('returns medium for 40-69', () => {
    expect(computePriorityBucket(40)).toBe('medium');
    expect(computePriorityBucket(69)).toBe('medium');
  });
  it('returns low for < 40 or null', () => {
    expect(computePriorityBucket(0)).toBe('low');
    expect(computePriorityBucket(null)).toBe('low');
    expect(computePriorityBucket(undefined)).toBe('low');
  });
});

describe('formatAge', () => {
  it('formats days', () => {
    expect(formatAge(0)).toBe('0d');
    expect(formatAge(3)).toBe('3d');
    expect(formatAge(13)).toBe('13d');
  });
  it('formats weeks', () => {
    expect(formatAge(14)).toBe('2w');
    expect(formatAge(28)).toBe('4w');
  });
  it('formats months', () => {
    expect(formatAge(60)).toBe('2mo');
    expect(formatAge(180)).toBe('6mo');
  });
  it('formats years', () => {
    expect(formatAge(365)).toBe('1y');
    expect(formatAge(730)).toBe('2y');
  });
  it('handles null', () => {
    expect(formatAge(null)).toBe('—');
  });
});

describe('computeFreshnessClass', () => {
  it('returns fresh for < 1 day', () => {
    expect(computeFreshnessClass(0)).toBe('fresh');
    expect(computeFreshnessClass(0.5)).toBe('fresh');
  });
  it('returns recent for 1-6 days', () => {
    expect(computeFreshnessClass(1)).toBe('recent');
    expect(computeFreshnessClass(6)).toBe('recent');
  });
  it('returns stale for 7-29 days', () => {
    expect(computeFreshnessClass(7)).toBe('stale');
    expect(computeFreshnessClass(29)).toBe('stale');
  });
  it('returns old for >= 30 days', () => {
    expect(computeFreshnessClass(30)).toBe('old');
    expect(computeFreshnessClass(365)).toBe('old');
  });
  it('returns manual for null', () => {
    expect(computeFreshnessClass(null)).toBe('manual');
  });
});
