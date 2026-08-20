import { describe, it, expect } from 'vitest';
import { DESKTOP_WALLPAPERS, DEFAULT_WALLPAPER_ID, getWallpaper } from './desktopWallpapers';

describe('desktopWallpapers', () => {
  it('includes the default wallpaper id in the preset list', () => {
    expect(DESKTOP_WALLPAPERS.some(w => w.id === DEFAULT_WALLPAPER_ID)).toBe(true);
  });

  it('getWallpaper falls back to the default for an unknown id', () => {
    expect(getWallpaper('not-a-real-id').id).toBe(DEFAULT_WALLPAPER_ID);
  });

  it('every preset background references a CSS variable, never a hardcoded hex', () => {
    for (const w of DESKTOP_WALLPAPERS) {
      expect(w.background).toMatch(/var\(--/);
      expect(w.background).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });
});
