export interface WallpaperPreset {
  id: string;
  label: string;
  background: string;
}

export const DEFAULT_WALLPAPER_ID = 'blue-silver-default';
export const CUSTOM_WALLPAPER_ID = 'custom-image';
const CUSTOM_WALLPAPER_KEY = 'rmpg_desktop_wallpaper_custom';
export const CUSTOM_WALLPAPER_MAX_BYTES = 4 * 1024 * 1024; // 4 MB

export const DESKTOP_WALLPAPERS: WallpaperPreset[] = [
  { id: 'blue-silver-default', label: 'Blue & Silver', background: 'var(--surface-base)' },
  { id: 'sunken', label: 'Sunken Slate', background: 'var(--surface-sunken)' },
  { id: 'overlay', label: 'Deep Overlay', background: 'var(--surface-overlay)' },
  {
    id: 'panel-grid',
    label: 'Panel Grid',
    background:
      'linear-gradient(var(--border-subtle) 1px, transparent 1px), ' +
      'linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px), var(--surface-base)',
  },
  {
    id: 'precinct-radial',
    label: 'Precinct Radial',
    background: 'radial-gradient(circle at center, var(--surface-raised) 0%, var(--surface-base) 70%)',
  },
  {
    id: 'shift-gradient',
    label: 'Shift Gradient',
    background: 'linear-gradient(160deg, var(--surface-overlay) 0%, var(--surface-base) 100%)',
  },
  {
    id: 'steel-mesh',
    label: 'Steel Mesh',
    background:
      'linear-gradient(45deg, var(--border-subtle) 1px, transparent 1px), ' +
      'linear-gradient(-45deg, var(--border-subtle) 1px, transparent 1px), var(--surface-sunken)',
  },
  {
    id: 'twilight-fade',
    label: 'Twilight Fade',
    background: 'linear-gradient(160deg, var(--surface-base) 0%, var(--surface-overlay) 100%)',
  },
  { id: CUSTOM_WALLPAPER_ID, label: 'Custom Image', background: 'var(--surface-base)' },
];

export function getCustomWallpaperDataUrl(): string | null {
  try { return localStorage.getItem(CUSTOM_WALLPAPER_KEY); } catch { return null; }
}

export function setCustomWallpaperDataUrl(dataUrl: string): void {
  try { localStorage.setItem(CUSTOM_WALLPAPER_KEY, dataUrl); } catch { /* quota */ }
}

export function clearCustomWallpaper(): void {
  try { localStorage.removeItem(CUSTOM_WALLPAPER_KEY); } catch { /* noop */ }
}

export function getWallpaper(id: string): WallpaperPreset {
  return DESKTOP_WALLPAPERS.find(w => w.id === id) ?? DESKTOP_WALLPAPERS[0];
}

const SLIDESHOW_KEY = 'rmpg_desktop_wallpaper_slideshow';
const SLIDESHOW_INTERVAL_KEY = 'rmpg_desktop_wallpaper_slideshow_interval_min';

export function isSlideshowEnabled(): boolean {
  return localStorage.getItem(SLIDESHOW_KEY) === '1';
}

export function setSlideshowEnabled(on: boolean): void {
  localStorage.setItem(SLIDESHOW_KEY, on ? '1' : '0');
}

export function getSlideshowIntervalMin(): number {
  return parseInt(localStorage.getItem(SLIDESHOW_INTERVAL_KEY) || '5', 10);
}

export function setSlideshowIntervalMin(min: number): void {
  localStorage.setItem(SLIDESHOW_INTERVAL_KEY, String(min));
}
