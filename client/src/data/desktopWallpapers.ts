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
];

export function getWallpaper(id: string): WallpaperPreset {
  return DESKTOP_WALLPAPERS.find(w => w.id === id) ?? DESKTOP_WALLPAPERS[0];
}
