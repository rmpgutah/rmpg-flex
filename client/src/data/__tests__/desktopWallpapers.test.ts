import { describe, it, expect, beforeEach } from 'vitest';
import { getCustomWallpaperDataUrl, setCustomWallpaperDataUrl, clearCustomWallpaper, CUSTOM_WALLPAPER_ID, getWallpaper } from '../desktopWallpapers';

describe('custom wallpaper helpers', () => {
  beforeEach(() => {
    clearCustomWallpaper();
  });

  it('returns null when no custom wallpaper set', () => {
    expect(getCustomWallpaperDataUrl()).toBeNull();
  });

  it('round-trips a data URL', () => {
    const url = 'data:image/png;base64,abc123';
    setCustomWallpaperDataUrl(url);
    expect(getCustomWallpaperDataUrl()).toBe(url);
  });

  it('getWallpaper finds the custom preset', () => {
    const w = getWallpaper(CUSTOM_WALLPAPER_ID);
    expect(w.id).toBe(CUSTOM_WALLPAPER_ID);
  });

  it('clearCustomWallpaper removes the stored URL', () => {
    setCustomWallpaperDataUrl('data:image/png;base64,test');
    clearCustomWallpaper();
    expect(getCustomWallpaperDataUrl()).toBeNull();
  });
});
