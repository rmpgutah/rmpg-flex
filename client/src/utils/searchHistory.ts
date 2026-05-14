// Search history utility

const HISTORY_PREFIX = 'rmpg_search_';
const MAX_HISTORY = 20;

/** Add a search term to history */
export function addToSearchHistory(context: string, term: string): void {
  if (!term.trim()) return;

  try {
    const key = `${HISTORY_PREFIX}${context}`;
    const history = getSearchHistory(context);

    // Remove duplicate if exists
    const filtered = history.filter((h) => h.toLowerCase() !== term.toLowerCase());
    filtered.unshift(term.trim());

    // Trim to max size
    const trimmed = filtered.slice(0, MAX_HISTORY);
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // localStorage unavailable
  }
}

/** Get search history for a context */
export function getSearchHistory(context: string): string[] {
  try {
    const raw = localStorage.getItem(`${HISTORY_PREFIX}${context}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Clear search history for a context */
export function clearSearchHistory(context: string): void {
  localStorage.removeItem(`${HISTORY_PREFIX}${context}`);
}

/** Clear all search history */
export function clearAllSearchHistory(): void {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(HISTORY_PREFIX))
    .forEach((k) => localStorage.removeItem(k));
}
