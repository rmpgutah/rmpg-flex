const STORAGE_KEY = 'rmpg_desktop_default_window_opacity';
const MIN_OPACITY = 0.3;
const MAX_OPACITY = 1;

function clamp(value: number): number {
  return Math.max(MIN_OPACITY, Math.min(MAX_OPACITY, Math.round(value * 10) / 10));
}

export function getDefaultWindowOpacity(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 1;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clamp(parsed) : 1;
  } catch {
    return 1;
  }
}

export function setDefaultWindowOpacity(opacity: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clamp(opacity)));
  } catch { /* silent */ }
}
