// Manual-entry combobox resolution for the Screening search.
// The source field accepts free text: an operator can pick a registry from the
// datalist OR type one (including "All sources"). This maps that text to a real
// source key, or 'all' for the fan-out, or null when nothing matches.

export const ALL_SOURCES = 'all';

export interface SourceOption {
  sourceKey: string;
  label: string;
  supportsSearch: boolean;
}

export function resolveSourceKey(text: string, sources: SourceOption[]): string | null {
  const t = text.trim().toLowerCase();
  if (!t || t === 'all' || t === 'all sources') return ALL_SOURCES;
  const searchable = sources.filter((s) => s.supportsSearch);
  const exact = searchable.find((s) => s.label.toLowerCase() === t || s.sourceKey.toLowerCase() === t);
  if (exact) return exact.sourceKey;
  const prefix = searchable.find((s) => s.label.toLowerCase().startsWith(t) || s.sourceKey.toLowerCase().startsWith(t));
  return prefix ? prefix.sourceKey : null;
}
