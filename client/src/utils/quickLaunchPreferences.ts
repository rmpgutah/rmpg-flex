const QUICK_LAUNCH_KEY = 'rmpg_quick_launch';

export function getQuickLaunchPins(): string[] {
  try {
    const raw = localStorage.getItem(QUICK_LAUNCH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export function setQuickLaunchPins(pins: string[]): void {
  try {
    localStorage.setItem(QUICK_LAUNCH_KEY, JSON.stringify(pins));
  } catch { /* silent — storage unavailable */ }
}
