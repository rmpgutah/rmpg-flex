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

  it('includes all 8 new pattern wallpapers', () => {
    const ids = DESKTOP_WALLPAPERS.map(w => w.id);
    for (const id of [
      'dot-grid', 'diagonal-stripes', 'blueprint', 'scanlines',
      'cross-hatch', 'dark-matter', 'topographic', 'hex-shimmer',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('all new pattern wallpapers pass the no-hardcoded-hex constraint', () => {
    const newIds = new Set([
      'dot-grid', 'diagonal-stripes', 'blueprint', 'scanlines',
      'cross-hatch', 'dark-matter', 'topographic', 'hex-shimmer',
    ]);
    for (const w of DESKTOP_WALLPAPERS.filter(wp => newIds.has(wp.id))) {
      expect(w.background).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });
});
