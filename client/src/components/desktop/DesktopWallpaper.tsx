// client/src/components/desktop/DesktopWallpaper.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  getWallpaper, CUSTOM_WALLPAPER_ID, getCustomWallpaperDataUrl,
  DESKTOP_WALLPAPERS, isSlideshowEnabled, getSlideshowIntervalMin,
} from '../../data/desktopWallpapers';
import { getCurrentTimeSlot } from '../../utils/dynamicWallpaperPreferences';

export interface DynamicWallpaperConfig {
  dayWallpaperId: string;
  nightWallpaperId: string;
}

interface DesktopWallpaperProps {
  wallpaperId: string;
  children: React.ReactNode;
  /** When set, ignores wallpaperId and switches between day/night based on the hour. */
  dynamicWallpaper?: DynamicWallpaperConfig;
}

function wallpaperBackground(id: string): { isCustom: boolean; customUrl: string | null; bg: string } {
  if (id === CUSTOM_WALLPAPER_ID) {
    const url = getCustomWallpaperDataUrl();
    return { isCustom: true, customUrl: url, bg: 'var(--surface-base)' };
  }
  return { isCustom: false, customUrl: null, bg: getWallpaper(id).background };
}

export default function DesktopWallpaper({ wallpaperId, children, dynamicWallpaper }: DesktopWallpaperProps) {
  const [slideshowIdx, setSlideshowIdx] = useState(0);
  const slideshowOn = isSlideshowEnabled();
  const intervalMin = getSlideshowIntervalMin();

  // Time-based dynamic wallpaper: start with the correct slot, then recheck every minute.
  const [timeSlot, setTimeSlot] = useState<'day' | 'night'>(() => getCurrentTimeSlot());
  const slotRef = useRef(timeSlot);
  slotRef.current = timeSlot;

  useEffect(() => {
    if (!dynamicWallpaper) return;
    const id = setInterval(() => {
      const next = getCurrentTimeSlot();
      if (next !== slotRef.current) setTimeSlot(next);
    }, 60_000);
    return () => clearInterval(id);
  }, [dynamicWallpaper]);

  useEffect(() => {
    if (!slideshowOn) return;
    const presets = DESKTOP_WALLPAPERS.filter(w => w.id !== CUSTOM_WALLPAPER_ID);
    if (presets.length === 0) return;
    const id = setInterval(() => setSlideshowIdx(i => (i + 1) % presets.length), intervalMin * 60_000);
    return () => clearInterval(id);
  }, [slideshowOn, intervalMin]);

  // Dynamic wallpaper: two absolutely-positioned layers that cross-fade on slot change.
  if (dynamicWallpaper) {
    const dayInfo = wallpaperBackground(dynamicWallpaper.dayWallpaperId || wallpaperId);
    const nightInfo = wallpaperBackground(dynamicWallpaper.nightWallpaperId || wallpaperId);
    const dayActive = timeSlot === 'day';
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        {/* Day layer */}
        <div
          style={{
            position: 'absolute', inset: 0,
            ...(dayInfo.isCustom && dayInfo.customUrl
              ? { backgroundImage: `url(${dayInfo.customUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
              : { background: dayInfo.bg }),
            opacity: dayActive ? 1 : 0,
            transition: 'opacity 1.5s ease',
            pointerEvents: 'none',
          }}
        />
        {/* Night layer */}
        <div
          style={{
            position: 'absolute', inset: 0,
            ...(nightInfo.isCustom && nightInfo.customUrl
              ? { backgroundImage: `url(${nightInfo.customUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
              : { background: nightInfo.bg }),
            opacity: dayActive ? 0 : 1,
            transition: 'opacity 1.5s ease',
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>{children}</div>
      </div>
    );
  }

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
