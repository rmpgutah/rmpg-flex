/**
 * Fleet formatting utilities — military time, precision numbers, expiry helpers.
 *
 * Every date/time display in the Fleet module should use these functions
 * to ensure a consistent 24-hour format with seconds.
 */
import { parseTimestamp } from '../../../utils/dateUtils';

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
  const d = parseTimestamp(isoString);
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
  const d = parseTimestamp(isoString);
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
  // parseTimestamp reads naive timestamps as UTC and date-only strings as local
  const exp = parseTimestamp(dateStr);
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

/**
 * Coerce ANY value into a finite number safe for `.toFixed()`.
 *
 * Why this exists: every recurring "Cannot read properties of undefined
 * (reading 'toFixed')" crash in the Fleet module traces back to a value that
 * passed a truthiness/`?? 0` guard but was not actually a number. Two ways
 * that happens here:
 *   1. False guards — `obj ? obj.x.toFixed() : …` checks the *parent*, not the
 *      number, so a present row with a null metric still calls `.toFixed`.
 *   2. Sentinel strings — live D1 text columns return "None"/"N/A"/"0" as
 *      *strings* (see the `project-sentinel-none-strings` note). A truthy
 *      string slips past `||`/`??`/`?` and then `"None".toFixed` throws.
 *
 * `toNum` is the single chokepoint: numbers pass through only if finite,
 * numeric strings ("12.5") are parsed so real values still render, and
 * everything else (sentinels, null, undefined, objects, NaN) falls back.
 */
export function toNum(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/**
 * Format a possibly-non-numeric value with fixed decimals, never throwing.
 * Returns `dash` for null/undefined/sentinel/empty so tables show "—"
 * instead of a fabricated "0.00". Use this for *display*; use `toNum` when
 * you need the number itself (math, color thresholds).
 */
export function fmtFixed(value: unknown, digits = 1, dash = '—'): string {
  if (value == null || value === '') return dash;
  if (typeof value === 'string' && !Number.isFinite(parseFloat(value))) return dash;
  return toNum(value).toFixed(digits);
}
