// client/src/components/desktop/DesktopWallpaper.tsx
import React, { useState, useEffect } from 'react';
import {
  getWallpaper, CUSTOM_WALLPAPER_ID, getCustomWallpaperDataUrl,
  DESKTOP_WALLPAPERS, isSlideshowEnabled, getSlideshowIntervalMin,
} from '../../data/desktopWallpapers';

export default function DesktopWallpaper({ wallpaperId, children }: { wallpaperId: string; children: React.ReactNode }) {
  const [slideshowIdx, setSlideshowIdx] = useState(0);
  const slideshowOn = isSlideshowEnabled();
  const intervalMin = getSlideshowIntervalMin();

  useEffect(() => {
    if (!slideshowOn) return;
    const presets = DESKTOP_WALLPAPERS.filter(w => w.id !== CUSTOM_WALLPAPER_ID);
    if (presets.length === 0) return;
    const id = setInterval(() => setSlideshowIdx(i => (i + 1) % presets.length), intervalMin * 60_000);
    return () => clearInterval(id);
  }, [slideshowOn, intervalMin]);

  const isCustom = wallpaperId === CUSTOM_WALLPAPER_ID;
  const customUrl = isCustom ? getCustomWallpaperDataUrl() : null;

  let style: React.CSSProperties;
  if (slideshowOn) {
    const presets = DESKTOP_WALLPAPERS.filter(w => w.id !== CUSTOM_WALLPAPER_ID);
    const active = presets[slideshowIdx % presets.length] ?? presets[0];
    style = { position: 'absolute', inset: 0, background: active.background, overflow: 'hidden' };
  } else if (isCustom && customUrl) {
    style = { position: 'absolute', inset: 0, backgroundImage: `url(${customUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', overflow: 'hidden' };
  } else {
    style = { position: 'absolute', inset: 0, background: getWallpaper(wallpaperId).background, overflow: 'hidden' };
  }

  return <div style={style}>{children}</div>;
}
