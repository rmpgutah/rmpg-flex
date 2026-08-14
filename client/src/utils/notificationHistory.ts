export interface StoredNotification {
  id: string;
  category: 'dispatch' | 'warrant' | 'fleet' | 'system' | 'welfare';
  title: string;
  body: string;
  ts: number;
  read: boolean;
  actions?: Array<{ label: string; route: string }>;
}

const KEY = 'rmpg_notification_history';
const MAX = 100;

export function getNotificationHistory(): StoredNotification[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export function pushNotification(n: Omit<StoredNotification, 'id' | 'read'>): void {
  const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const all = [{ ...n, id, read: false }, ...getNotificationHistory()].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* noop */ }
}

export function markAllRead(): void {
  const all = getNotificationHistory().map(n => ({ ...n, read: true }));
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* noop */ }
}

export function clearCategory(category: StoredNotification['category']): void {
  const all = getNotificationHistory().filter(n => n.category !== category);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* noop */ }
}

export function getUnreadCount(): number {
  return getNotificationHistory().filter(n => !n.read).length;
}
