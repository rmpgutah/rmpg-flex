// client/src/components/desktop/DesktopWallpaper.tsx
import React from 'react';
import { getWallpaper, CUSTOM_WALLPAPER_ID, getCustomWallpaperDataUrl } from '../../data/desktopWallpapers';

export default function DesktopWallpaper({ wallpaperId, children }: { wallpaperId: string; children: React.ReactNode }) {
  const isCustom = wallpaperId === CUSTOM_WALLPAPER_ID;
  const customUrl = isCustom ? getCustomWallpaperDataUrl() : null;

  const style: React.CSSProperties = isCustom && customUrl
    ? { position: 'absolute', inset: 0, backgroundImage: `url(${customUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', overflow: 'hidden' }
    : { position: 'absolute', inset: 0, background: getWallpaper(wallpaperId).background, overflow: 'hidden' };

  return <div style={style}>{children}</div>;
}
