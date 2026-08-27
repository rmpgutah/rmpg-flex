/**
 * Shared CSV escape helper for route handlers.
 * Replaces 11+ local copies scattered across route files.
 *
 * Properly escapes values for CSV export per RFC 4180:
 * - Wraps values containing commas, quotes, or newlines in double quotes
 * - Escapes existing double quotes by doubling them
 */
export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
