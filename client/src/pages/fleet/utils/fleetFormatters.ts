/**
 * Fleet formatting utilities — military time, precision numbers, expiry helpers.
 *
 * Every date/time display in the Fleet module should use these functions
 * to ensure a consistent 24-hour format with seconds.
 */

/**
 * Format an ISO date string as military time: "YYYY-MM-DD HH:MM:SS"
 * Handles date-only strings, ISO strings with 'T', and null/undefined.
 *
 * IMPORTANT: date-only strings ("2026-06-15") are parsed by JS as UTC
 * midnight, which shifts to the previous day in western US timezones.
 * We append 'T00:00:00' to force local-time interpretation.
 */
export function formatMilitary(isoString: string | undefined | null): string {
  if (!isoString) return '-';
  // Force local-time parse for date-only strings
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(isoString) ? `${isoString}T00:00:00` : isoString;
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return isoString; // fallback for unparseable strings
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}

/**
 * Format military date only (no time portion): "YYYY-MM-DD"
 */
export function formatMilitaryDate(isoString: string | undefined | null): string {
  if (!isoString) return '-';
  // Date-only strings can be returned directly — avoids UTC timezone shift
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoString)) return isoString;
  const normalized = isoString.replace(' ', 'T'); // SQLite space → T
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return isoString;
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd}`;
}

/**
 * Get current local datetime in the format expected by `<input type="datetime-local">`.
 * Returns "YYYY-MM-DDTHH:MM:SS" (the 'T' separator is required by the input).
 */
export function nowLocalISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}:${ss}`;
}

/**
 * Normalise a stored date string into the format datetime-local inputs expect.
 * Handles "YYYY-MM-DD" (date-only) by appending "T00:00:00", and
 * "YYYY-MM-DD HH:MM:SS" (space-separated) by replacing the space with 'T'.
 */
export function toDatetimeLocal(d: string | undefined | null): string {
  if (!d) return '';
  // Already has 'T' separator — good for datetime-local
  if (d.includes('T')) return d;
  // Space-separated ISO (from SQLite) → replace with T
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(d)) return d.replace(' ', 'T');
  // Date-only → append midnight
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${d}T00:00:00`;
  return d;
}

/**
 * Calculate days remaining until expiry. Negative = past due.
 */
export function daysUntilExpiry(dateStr: string | undefined | null): number | null {
  if (!dateStr) return null;
  // Force local-time for date-only strings to avoid UTC timezone shift
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00` : dateStr;
  const exp = new Date(normalized);
  if (isNaN(exp.getTime())) return null;
  return Math.ceil((exp.getTime() - Date.now()) / 86_400_000);
}

/**
 * Calculate expiry progress as 0–100 for progress bars.
 * 100 = full time remaining (totalDays left), 0 = expired.
 */
export function expiryProgress(dateStr: string | undefined | null, totalDays = 365): number {
  const days = daysUntilExpiry(dateStr);
  if (days === null || days <= 0) return 0;
  return Math.min(100, Math.round((days / totalDays) * 100));
}
