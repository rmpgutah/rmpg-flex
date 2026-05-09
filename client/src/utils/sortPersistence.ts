// Table sort state persistence

const SORT_PREFIX = 'rmpg_sort_';

interface SortState {
  column: string;
  direction: 'asc' | 'desc';
}

/** Save sort state for a table */
export function saveSortState(tableId: string, state: SortState): void {
  try {
    localStorage.setItem(`${SORT_PREFIX}${tableId}`, JSON.stringify(state));
  } catch {
    // localStorage unavailable
  }
}

/** Load sort state for a table */
export function loadSortState(tableId: string): SortState | null {
  try {
    const raw = localStorage.getItem(`${SORT_PREFIX}${tableId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Clear sort state for a table */
export function clearSortState(tableId: string): void {
  localStorage.removeItem(`${SORT_PREFIX}${tableId}`);
}
