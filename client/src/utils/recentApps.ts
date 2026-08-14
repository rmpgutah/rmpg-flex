const KEY = (appKey: string) => `rmpg_desktop_recent_${appKey}`;
const MAX = 3;

export interface RecentEntry { label: string; route: string; ts: number; }

export function recordAppOpen(appKey: string, entry: RecentEntry): void {
  try {
    const existing: RecentEntry[] = JSON.parse(localStorage.getItem(KEY(appKey)) || '[]');
    const filtered = existing.filter(e => e.route !== entry.route);
    filtered.unshift(entry);
    localStorage.setItem(KEY(appKey), JSON.stringify(filtered.slice(0, MAX)));
  } catch { /* noop */ }
}

export function getRecentApps(appKey: string): RecentEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY(appKey)) || '[]'); } catch { return []; }
}
