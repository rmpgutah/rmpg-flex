// Recycle Bin preferences — tracks desktop icons that have been removed by
// the user so they can be restored from the Recycle Bin widget.
//
// This module is an external store: every mutation dispatches
// `RECYCLE_BIN_CHANGE_EVENT` on `window`, and `subscribeRecycleBin` +
// `getRecycleBinSnapshot` are shaped for `useSyncExternalStore`. Components
// must read through that seam rather than polling `getDeletedIcons()` from an
// effect — see DesktopRecycleBin.tsx for why (a deps-less
// `useEffect(() => setItems(getDeletedIcons()))` produced a fresh array on
// every render and re-rendered forever).

const KEY = 'rmpg_desktop_deleted_icons';

/** Fired on `window` after every write to the recycle bin. */
export const RECYCLE_BIN_CHANGE_EVENT = 'flexos:recycle-bin-changed';

export interface DeletedIcon {
  path: string;
  label: string;
  deletedAt: number; // epoch ms
}

/**
 * Raw serialized bin contents, or '' when empty/unavailable. A primitive, so
 * it is a stable `useSyncExternalStore` snapshot: React compares snapshots
 * with `Object.is`, and two reads of unchanged storage return equal strings.
 */
export function getRecycleBinSnapshot(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

/** Parse a snapshot from `getRecycleBinSnapshot` into icons (tolerant of junk). */
export function parseDeletedIcons(raw: string): DeletedIcon[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DeletedIcon[]) : [];
  } catch {
    return [];
  }
}

function load(): DeletedIcon[] {
  return parseDeletedIcons(getRecycleBinSnapshot());
}

function notify(): void {
  try { window.dispatchEvent(new Event(RECYCLE_BIN_CHANGE_EVENT)); } catch { /* non-DOM */ }
}

function save(items: DeletedIcon[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* quota */ }
  notify();
}

/**
 * Subscribe to bin changes from this tab (custom event) and other tabs
 * (`storage` event for our key). Returns the unsubscribe function, as
 * `useSyncExternalStore` expects.
 */
export function subscribeRecycleBin(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === KEY) onChange();
  };
  window.addEventListener(RECYCLE_BIN_CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(RECYCLE_BIN_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function getDeletedIcons(): DeletedIcon[] {
  return load();
}

export function addDeletedIcon(icon: Omit<DeletedIcon, 'deletedAt'>): void {
  const items = load();
  if (items.some(i => i.path === icon.path)) return; // already in bin
  save([...items, { ...icon, deletedAt: Date.now() }]);
}

export function restoreDeletedIcon(path: string): DeletedIcon | null {
  const items = load();
  const found = items.find(i => i.path === path) ?? null;
  save(items.filter(i => i.path !== path));
  return found;
}

export function emptyRecycleBin(): void {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
  notify();
}
