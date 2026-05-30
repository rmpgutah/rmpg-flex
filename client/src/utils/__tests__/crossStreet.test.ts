import { describe, it, expect } from 'vitest';
import { deriveCrossStreet, normalizeStreet, isSameStreet, type NearbyRoad } from '../crossStreet';

describe('normalizeStreet', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeStreet('  S. Main   St. ')).toBe('s main st');
  });
});

describe('isSameStreet', () => {
  // signature is isSameStreet(roadName, primaryStreet) — primary is house-number-first
  it('matches the road network name against the address own street (Terra Sol bug)', () => {
    expect(isSameStreet('Terra Sol Dr', '3533 South Terra Sol Drive')).toBe(true);
    expect(isSameStreet('S Terra Sol Dr', '3533 South Terra Sol Drive')).toBe(true);
  });

  it('keeps SLC grid streets distinct (does not collapse on shared directional)', () => {
    // "200 West" is a real cross street for an address on 300 South.
    expect(isSameStreet('200 West', '150 W 300 S')).toBe(false);
    // ...but the address own street ("300 South") is still excluded.
    expect(isSameStreet('300 South', '150 W 300 S')).toBe(true);
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

  it('excludes the address own street even with suffix/directional spelling drift', () => {
    // Regression: "3533 South Terra Sol Drive" must NOT yield "Terra Sol Dr".
    const nearby: NearbyRoad[] = [
      { name: 'Terra Sol Dr', distance: 6 },   // the address street itself
      { name: 'W 3500 S', distance: 30 },       // genuine cross street
    ];
    expect(deriveCrossStreet('3533 South Terra Sol Drive', nearby)).toBe('W 3500 S');
  });
});
