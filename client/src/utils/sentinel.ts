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
