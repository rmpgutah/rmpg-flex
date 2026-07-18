import { describe, it, expect, beforeEach } from 'vitest';
import { loadFavorites, saveFavorites, loadRecent, pushRecent, FAVORITES_KEY, RECENT_KEY } from './navFavorites';

describe('navFavorites', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('round-trips favorites through localStorage', () => {
    saveFavorites(new Set(['/dispatch', '/map']));
    expect(loadFavorites()).toEqual(new Set(['/dispatch', '/map']));
    expect(JSON.parse(localStorage.getItem(FAVORITES_KEY)!)).toEqual(['/dispatch', '/map']);
  });

  it('loadFavorites returns an empty set when nothing is stored', () => {
    expect(loadFavorites()).toEqual(new Set());
  });

  it('pushRecent dedupes and caps at 10, most-recent first', () => {
    for (let i = 0; i < 12; i++) pushRecent(`/path-${i}`);
    pushRecent('/path-5'); // re-push an existing entry — should move to front, not duplicate
    const recent = loadRecent();
    expect(recent.length).toBe(10);
    expect(recent[0]).toBe('/path-5');
    expect(new Set(recent).size).toBe(10);
    expect(sessionStorage.getItem(RECENT_KEY)).not.toBeNull();
  });
});
