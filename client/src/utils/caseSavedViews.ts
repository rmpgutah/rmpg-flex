// Saved case-list filter views (v3 Phase 4). Per-user localStorage presets
// (server-persisted/shared views are out of scope). Array ops are pure +
// unit-tested; the get/persist wrappers touch localStorage.

export interface CaseViewFilters {
  search?: string;
  status?: string;
  type?: string;
  priority?: string;
  mine?: boolean;
  overdue?: boolean;
}

export interface SavedView {
  name: string;
  filters: CaseViewFilters;
}

const KEY = 'rmpg-case-saved-views';

/** Pure: insert-or-replace a view by name (case-insensitive). */
export function upsertView(views: SavedView[], view: SavedView): SavedView[] {
  const name = view.name.trim();
  const rest = views.filter((v) => v.name.toLowerCase() !== name.toLowerCase());
  return [...rest, { ...view, name }].sort((a, b) => a.name.localeCompare(b.name));
}

/** Pure: remove a view by name (case-insensitive). */
export function removeView(views: SavedView[], name: string): SavedView[] {
  return views.filter((v) => v.name.toLowerCase() !== name.toLowerCase());
}

export function getSavedViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function persistViews(views: SavedView[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(views)); } catch { /* quota / disabled — ignore */ }
}
