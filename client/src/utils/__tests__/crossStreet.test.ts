import { describe, it, expect } from 'vitest';
import { deriveCrossStreet, normalizeStreet, type NearbyRoad } from '../crossStreet';

describe('normalizeStreet', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeStreet('  S. Main   St. ')).toBe('s main st');
  });
});

describe('deriveCrossStreet', () => {
  const roads: NearbyRoad[] = [
    { name: 'Main Street', distance: 4 },   // the address's own street
    { name: 'E 300 S', distance: 12 },      // nearest genuine cross street
    { name: 'E 400 S', distance: 55 },
  ];

  it('returns the nearest road whose name differs from the address street', () => {
    expect(deriveCrossStreet('150 Main Street', roads)).toBe('E 300 S');
  });

  it('ignores the leading house number when matching the primary street', () => {
    // "150 Main Street" must still be recognized as Main Street and excluded.
    expect(deriveCrossStreet('150 Main Street', roads)).not.toBe('Main Street');
  });

  it('returns empty string when no cross street is available', () => {
    expect(deriveCrossStreet('150 Main Street', [{ name: 'Main Street', distance: 4 }])).toBe('');
  });

  it('returns empty string for no nearby roads', () => {
    expect(deriveCrossStreet('150 Main Street', [])).toBe('');
  });
});
