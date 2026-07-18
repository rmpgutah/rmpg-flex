export interface WallpaperPreset {
  id: string;
  label: string;
  background: string;
}

export const DEFAULT_WALLPAPER_ID = 'blue-silver-default';

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
];

export function getWallpaper(id: string): WallpaperPreset {
  return DESKTOP_WALLPAPERS.find(w => w.id === id) ?? DESKTOP_WALLPAPERS[0];
}
