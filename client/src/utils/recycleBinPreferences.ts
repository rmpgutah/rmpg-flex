// Recycle Bin preferences — tracks desktop icons that have been removed by
// the user so they can be restored from the Recycle Bin widget.

const KEY = 'rmpg_desktop_deleted_icons';

export interface DeletedIcon {
  path: string;
  label: string;
  deletedAt: number; // epoch ms
}

function load(): DeletedIcon[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DeletedIcon[]) : [];
  } catch {
    return [];
  }
}

function save(items: DeletedIcon[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* quota */ }
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
}
