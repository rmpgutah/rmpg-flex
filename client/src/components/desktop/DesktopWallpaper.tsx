// client/src/components/desktop/DesktopWallpaper.tsx
import React from 'react';
import { getWallpaper } from '../../data/desktopWallpapers';

export default function DesktopWallpaper({ wallpaperId, children }: { wallpaperId: string; children: React.ReactNode }) {
  const wallpaper = getWallpaper(wallpaperId);
  return (
    <div style={{ position: 'absolute', inset: 0, background: wallpaper.background, overflow: 'hidden' }}>
      {children}
    </div>
  );
}
