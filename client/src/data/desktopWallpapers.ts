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
  {
    id: 'dot-grid',
    label: 'Dot Grid',
    background:
      'radial-gradient(circle, rgba(var(--rmpg-500-rgb),0.28) 1px, transparent 1px) 0 0 / 22px 22px, var(--surface-sunken)',
  },
  {
    id: 'diagonal-stripes',
    label: 'Diagonal Stripes',
    background:
      'repeating-linear-gradient(45deg, rgba(var(--rmpg-500-rgb),0.08) 0px, rgba(var(--rmpg-500-rgb),0.08) 1px, transparent 1px, transparent 14px), var(--surface-base)',
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    background:
      'linear-gradient(rgba(var(--rmpg-500-rgb),0.18) 1px, transparent 1px) 0 0 / 80px 80px,' +
      'linear-gradient(90deg, rgba(var(--rmpg-500-rgb),0.18) 1px, transparent 1px) 0 0 / 80px 80px,' +
      'linear-gradient(rgba(var(--rmpg-500-rgb),0.06) 1px, transparent 1px) 0 0 / 16px 16px,' +
      'linear-gradient(90deg, rgba(var(--rmpg-500-rgb),0.06) 1px, transparent 1px) 0 0 / 16px 16px,' +
      'var(--surface-sunken)',
  },
  {
    id: 'scanlines',
    label: 'Scanlines',
    background:
      'repeating-linear-gradient(0deg, rgba(var(--rmpg-500-rgb),0.06) 0px, rgba(var(--rmpg-500-rgb),0.06) 1px, transparent 1px, transparent 5px), var(--surface-overlay)',
  },
  {
    id: 'cross-hatch',
    label: 'Cross-Hatch',
    background:
      'repeating-linear-gradient(45deg, rgba(var(--rmpg-500-rgb),0.06) 0px, rgba(var(--rmpg-500-rgb),0.06) 1px, transparent 1px, transparent 12px),' +
      'repeating-linear-gradient(-45deg, rgba(var(--rmpg-500-rgb),0.06) 0px, rgba(var(--rmpg-500-rgb),0.06) 1px, transparent 1px, transparent 12px),' +
      'var(--surface-base)',
  },
  {
    id: 'dark-matter',
    label: 'Dark Matter',
    background:
      'radial-gradient(ellipse at 20% 50%, rgba(var(--rmpg-500-rgb),0.18) 0%, transparent 55%),' +
      'radial-gradient(ellipse at 80% 20%, rgba(var(--rmpg-500-rgb),0.14) 0%, transparent 45%),' +
      'radial-gradient(ellipse at 60% 85%, rgba(var(--rmpg-500-rgb),0.12) 0%, transparent 40%),' +
      'var(--surface-overlay)',
  },
  {
    id: 'topographic',
    label: 'Topographic',
    background:
      'radial-gradient(ellipse at 30% 40%, rgba(var(--rmpg-500-rgb),0.12) 0%, rgba(var(--rmpg-500-rgb),0.12) 18%, transparent 19%),' +
      'radial-gradient(ellipse at 30% 40%, rgba(var(--rmpg-500-rgb),0.10) 22%, transparent 23%),' +
      'radial-gradient(ellipse at 70% 60%, rgba(var(--rmpg-500-rgb),0.10) 0%, rgba(var(--rmpg-500-rgb),0.10) 14%, transparent 15%),' +
      'radial-gradient(ellipse at 70% 60%, rgba(var(--rmpg-500-rgb),0.08) 18%, transparent 19%),' +
      'var(--surface-base)',
  },
  {
    id: 'hex-shimmer',
    label: 'Hex Shimmer',
    background:
      'radial-gradient(circle at 0% 50%, rgba(var(--rmpg-500-rgb),0.12) 0%, transparent 60%),' +
      'radial-gradient(circle at 100% 50%, rgba(var(--rmpg-500-rgb),0.10) 0%, transparent 55%),' +
      'linear-gradient(60deg, rgba(var(--rmpg-500-rgb),0.04) 25%, transparent 25%, transparent 75%, rgba(var(--rmpg-500-rgb),0.04) 75%) 0 0 / 40px 70px,' +
      'linear-gradient(60deg, rgba(var(--rmpg-500-rgb),0.04) 25%, transparent 25%, transparent 75%, rgba(var(--rmpg-500-rgb),0.04) 75%) 20px 35px / 40px 70px,' +
      'var(--surface-sunken)',
  },
];

export function getWallpaper(id: string): WallpaperPreset {
  return DESKTOP_WALLPAPERS.find(w => w.id === id) ?? DESKTOP_WALLPAPERS[0];
}
