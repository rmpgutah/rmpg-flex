import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  addRecent, getRecents, toggleFavorite, getFavorites,
  isFavorite, removeFavorite,
} from '../navDestinations';

// jsdom provides localStorage; clear between tests for isolation.
beforeEach(() => {
  try { localStorage.clear(); } catch { /* noop */ }
  vi.restoreAllMocks();
});

describe('navDestinations — recents', () => {
  it('adds newest-first and caps at 12', () => {
    for (let i = 0; i < 15; i++) addRecent({ label: `P${i}`, lat: 40 + i * 0.01, lng: -111 - i * 0.01 });
    const recents = getRecents();
    expect(recents.length).toBe(12);
    expect(recents[0].label).toBe('P14'); // newest first
    // oldest three (P0,P1,P2) evicted
    expect(recents.some(r => r.label === 'P0')).toBe(false);
  });

  it('dedups by rounded coords and bumps to front', () => {
    addRecent({ label: 'A', lat: 40.76083, lng: -111.89105 });
    addRecent({ label: 'B', lat: 40.0, lng: -111.0 });
    // same coords (within 5dp) as A → should bump A's slot, not duplicate
    addRecent({ label: 'A2', lat: 40.760831, lng: -111.891049 });
    const recents = getRecents();
    expect(recents.length).toBe(2);
    expect(recents[0].label).toBe('A2');
  });

  it('ignores non-finite coords', () => {
    addRecent({ label: 'bad', lat: NaN, lng: 0 });
    expect(getRecents().length).toBe(0);
  });
});

describe('navDestinations — favorites', () => {
  it('toggle adds then removes; isFavorite tracks state', () => {
    expect(isFavorite(40.7608, -111.891)).toBe(false);
    toggleFavorite({ label: 'HQ', lat: 40.7608, lng: -111.891 });
    expect(isFavorite(40.7608, -111.891)).toBe(true);
    expect(getFavorites().length).toBe(1);
    toggleFavorite({ label: 'HQ', lat: 40.76080, lng: -111.89100 });
    expect(isFavorite(40.7608, -111.891)).toBe(false);
    expect(getFavorites().length).toBe(0);
  });

  it('removeFavorite by coords', () => {
    toggleFavorite({ label: 'X', lat: 1.23456, lng: 2.34567 });
    removeFavorite(1.234561, 2.345669);
    expect(getFavorites().length).toBe(0);
  });
});

describe('navDestinations — storage failure tolerance', () => {
  it('degrades gracefully when getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(getRecents()).toEqual([]);
    expect(isFavorite(0, 0)).toBe(false);
  });
});
