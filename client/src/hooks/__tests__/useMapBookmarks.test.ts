import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { BOOKMARK_COLORS, useMapBookmarks } from '../useMapBookmarks';

describe('BOOKMARK_COLORS', () => {
  it('does not use banned field-label gold', () => {
    expect(BOOKMARK_COLORS.join(' ').toLowerCase()).not.toContain('d4a017');
  });
});

describe('useMapBookmarks', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renames a bookmark and persists it', () => {
    const { result } = renderHook(() => useMapBookmarks(null, false));
    act(() => {
      result.current.addBookmark({
        name: 'Bookmark 1', latitude: 40.76, longitude: -111.89, color: '#c3ccd6', notes: '', zoom: 14,
      });
    });
    const id = result.current.bookmarks[0].id;
    act(() => {
      result.current.updateBookmark(id, { name: 'Court annex' });
    });
    expect(result.current.bookmarks[0].name).toBe('Court annex');
    const stored = JSON.parse(localStorage.getItem('rmpg_map_bookmarks') || '[]');
    expect(stored[0].name).toBe('Court annex');
  });

  it('rewrites stored banned gold to silver', () => {
    localStorage.setItem('rmpg_map_bookmarks', JSON.stringify([{
      id: 'bm-1', name: 'Old', latitude: 1, longitude: 2, color: '#d4a017', notes: '', createdAt: 1, zoom: 12,
    }]));
    const { result } = renderHook(() => useMapBookmarks(null, false));
    expect(result.current.bookmarks[0].color.toLowerCase()).not.toBe('#d4a017');
  });
});
