import { describe, it, expect } from 'vitest';
import { isVerifiedAggregatorPoint, autoPromote, shouldPersistPoint } from '../src/utils/personIntel/applyVerifiedToPerson';

describe('isVerifiedAggregatorPoint', () => {
  it('requires ≥0.60 confidence and two sources', () => {
    expect(isVerifiedAggregatorPoint({
      category: 'address', field: 'city', value: 'Salt Lake City',
      sources: ['Pipl'], confidence: 0.70,
    })).toBe(false);
    expect(isVerifiedAggregatorPoint({
      category: 'address', field: 'city', value: 'Salt Lake City',
      sources: ['Pipl', 'MicroBilt'], confidence: 0.70,
    })).toBe(true);
  });

  it('rejects noise below 0.60 even with two sources', () => {
    expect(isVerifiedAggregatorPoint({
      category: 'online', field: 'profile', value: 'x',
      sources: ['Pipl', 'Spokeo'], confidence: 0.40,
    })).toBe(false);
  });

  it('trusts a high-confidence InternalRecords-only point', () => {
    expect(isVerifiedAggregatorPoint({
      category: 'address', field: 'street', value: '123 Main',
      sources: ['InternalRecords'], confidence: 0.80,
    })).toBe(true);
  });
});

describe('persist thresholds', () => {
  it('drops points below the 0.40 noise floor', () => {
    expect(shouldPersistPoint(0.39)).toBe(false);
    expect(shouldPersistPoint(0.40)).toBe(true);
  });

  it('auto-promotes corroborated points', () => {
    expect(autoPromote(0.60, 2)).toBe(true);
    expect(autoPromote(0.90, 1)).toBe(false);
  });
});
