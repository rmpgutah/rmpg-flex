/** Pure normalization helpers for warrant sources (name / date / bond). */

function titleCase(s: string): string {
  return s.replace(/\b([A-Za-z])([A-Za-z']*)/g, (_, a, b) => a.toUpperCase() + b.toLowerCase());
}

/**
 * Trim, collapse internal whitespace, normalise comma spacing, and title-case
 * strings that are fully upper-case or fully lower-case.  Mixed-case input is
 * returned as-is so "McDonald" or "O'Brien" are preserved.
 */
export function cleanName(s: string | null | undefined): string {
  if (!s) return '';
  const collapsed = s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
  return /^[^a-z]*$/.test(collapsed) || /^[^A-Z]*$/.test(collapsed)
    ? titleCase(collapsed)
    : collapsed;
}

/**
 * Normalise a date value to `YYYY-MM-DD` (UTC).  Handles:
 *  - ISO `YYYY-MM-DD` strings
 *  - Epoch-millisecond numbers (ArcGIS/Socrata numeric dates)
 *  - `M/D/YYYY` strings
 * Returns `null` for anything else.
 */
export function normalizeDate(v: string | number | null | undefined): string | null {
  if (v == null || v === '') return null;

  // Numeric epoch-ms (ArcGIS) or a string that looks like a large integer.
  if (typeof v === 'number' || /^\d{12,}$/.test(String(v))) {
    const d = new Date(Number(v));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  const s = String(v).trim();

  // ISO YYYY-MM-DD
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // M/D/YYYY
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;

  return null;
}

/**
 * Normalise a bail/bond value to a number (dollars).
 * Strips currency symbols and commas; returns `null` for text-only values
 * like "PR" or "No Bond".
 */
export function normalizeBond(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build a display name from structured name parts, falling back to `full_name`.
 * Result is always run through `cleanName` for consistent casing/spacing.
 */
export function displayName(p: {
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
}): string {
  if (p.last_name || p.first_name) {
    const first = [p.first_name, p.middle_name].filter(Boolean).join(' ').trim();
    return cleanName([p.last_name, first].filter(Boolean).join(', '));
  }
  return cleanName(p.full_name ?? '');
}
