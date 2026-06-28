// Sentinel-string guard for live D1 text columns.
//
// Live text columns store the literal strings "None"/"N/A"/"0"/etc. rather than
// NULL (see project memory [[project-sentinel-none-strings]] — a naive `if
// (field)` once fired a false GANG alert on a no-gang person). This is the
// canonical guard; it mirrors the inline copies in PersonsTab.hasValue and
// recordPdfGenerator.hasValuePdf, which predate this shared module.

const ABSENT_SENTINELS = ['none', 'n/a', 'na', '0', 'false', 'no', 'null', 'undefined', '--', ''];

/** True when `v` is a real, present value (not null/blank/sentinel). */
export function hasValue(v?: string | number | null): boolean {
  return v != null && !ABSENT_SENTINELS.includes(String(v).trim().toLowerCase());
}

/** Returns the trimmed value when present, else `fallback` (default ''). */
export function cleanField(v?: string | number | null, fallback = ''): string {
  return hasValue(v) ? String(v).trim() : fallback;
}

// Sentinels that are never valid numbers. NOTE: '0'/'false'/'no' are NOT here —
// for numeric fields 0 is a real value (a 0.00 BAC, a 0 balance), unlike the
// string guard where "0" reads as absent.
const NON_NUMERIC_SENTINELS = ['none', 'n/a', 'na', 'null', 'undefined', '--', ''];

/**
 * Coerce a possibly-sentinel/possibly-string value to a finite number, or null.
 * Use before calling .toFixed()/.toLocaleString() on data from live D1 text
 * columns — calling those on a string ("None", "0.08") throws at runtime.
 */
export function toNum(v?: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (NON_NUMERIC_SENTINELS.includes(s.toLowerCase())) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
