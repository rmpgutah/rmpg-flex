import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useNavRecentDestinations } from '../useNavRecentDestinations';

beforeEach(() => localStorage.clear());

describe('useNavRecentDestinations', () => {
  it('caps recents at 12, most-recent-first', () => {
    const { result } = renderHook(() => useNavRecentDestinations());
    act(() => {
      for (let i = 0; i < 15; i++) {
        result.current.addRecent({ label: `D${i}`, lat: i, lng: i });
      }
    });
    expect(result.current.recents).toHaveLength(12);
    expect(result.current.recents[0].label).toBe('D14'); // newest first
  });

  it('dedupes recents by coordinates', () => {
    const { result } = renderHook(() => useNavRecentDestinations());
    act(() => { result.current.addRecent({ label: 'X', lat: 40.7608, lng: -111.8910 }); });
    act(() => { result.current.addRecent({ label: 'X2', lat: 40.7608, lng: -111.8910 }); });
    expect(result.current.recents).toHaveLength(1);
    expect(result.current.recents[0].label).toBe('X2');
  });

  it('toggles favorite on/off and round-trips through storage', () => {
    const dest = { label: 'HQ', lat: 40.5, lng: -111.5 };
    const { result } = renderHook(() => useNavRecentDestinations());
    act(() => { result.current.toggleFavorite(dest); });
    expect(result.current.isFavorite(dest.lat, dest.lng)).toBe(true);

    // Rehydrate a fresh instance from storage.
    const { result: r2 } = renderHook(() => useNavRecentDestinations());
    expect(r2.current.favorites).toHaveLength(1);

    act(() => { result.current.toggleFavorite(dest); });
    expect(result.current.isFavorite(dest.lat, dest.lng)).toBe(false);
  });
});
