// ============================================================
// RMPG Flex — Display Formatters
// ============================================================
// Pure formatting functions for consistent data presentation.
// These do NOT validate — use validate.ts for input checking.
// ============================================================

/**
 * Format a US phone number: (801) 555-1234
 * Strips non-digits, handles 10 or 11 digit numbers.
 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  const d = digits.length === 11 && digits[0] === '1' ? digits.substring(1) : digits;
  if (d.length !== 10) return phone; // Return raw if can't format
  return `(${d.substring(0, 3)}) ${d.substring(3, 6)}-${d.substring(6)}`;
}

/**
 * Format a SSN with masking: ***-**-1234
 * Shows only last 4 digits by default. Pass `full: true` to show all.
 */
export function formatSSN(ssn: string | null | undefined, options?: { full?: boolean }): string {
  if (!ssn) return '';
  const digits = ssn.replace(/\D/g, '');
  if (digits.length !== 9) return ssn;
  if (options?.full) {
    return `${digits.substring(0, 3)}-${digits.substring(3, 5)}-${digits.substring(5)}`;
  }
  return `***-**-${digits.substring(5)}`;
}

/**
 * Format currency: $1,234.56
 */
export function formatCurrency(
  amount: number | null | undefined,
  options?: { decimals?: number; showSign?: boolean },
): string {
  if (amount == null || isNaN(amount)) return '$0.00';
  const decimals = options?.decimals ?? 2;
  const formatted = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sign = amount < 0 ? '-' : options?.showSign && amount > 0 ? '+' : '';
  return `${sign}$${formatted}`;
}

/**
 * Format a file size in human-readable format: 1.2 MB
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Format a duration in seconds to human-readable: 2h 15m, 45s, etc.
 * Useful for response times, call durations, shift lengths.
 */
export function formatDuration(seconds: number): string {
  if (seconds < 0) seconds = 0;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Format a duration in minutes to a shift-style format: 8:30 hrs
 */
export function formatShiftDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${String(m).padStart(2, '0')} hrs`;
}

/**
 * Format a number with comma separators: 1,234,567
 */
export function formatNumber(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '0';
  return n.toLocaleString('en-US');
}

/**
 * Format a percentage: 85.5%
 */
export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format a VIN with standard spacing: 1HGBH 41JXM N109186
 * Adds visual grouping for readability.
 */
export function formatVIN(vin: string | null | undefined): string {
  if (!vin) return '';
  const v = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
  if (v.length !== 17) return vin.toUpperCase();
  return `${v.substring(0, 5)} ${v.substring(5, 12)} ${v.substring(12)}`;
}

/**
 * Format a license plate: uppercase, trimmed.
 */
export function formatPlate(plate: string | null | undefined): string {
  if (!plate) return '';
  return plate.toUpperCase().trim();
}

/**
 * Format a name: First Last (trims, capitalizes properly).
 */
export function formatName(first?: string | null, last?: string | null, middle?: string | null): string {
  const parts = [first, middle, last].filter(Boolean).map((p) =>
    (p as string).trim().replace(/\b\w/g, (c) => c.toUpperCase()),
  );
  return parts.join(' ');
}

/**
 * Format an address on one line: 123 Main St, Salt Lake City, UT 84101
 */
export function formatAddress(
  parts: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null },
): string {
  const segments = [
    parts.address?.trim(),
    [parts.city?.trim(), parts.state?.toUpperCase().trim()].filter(Boolean).join(', '),
    parts.zip?.trim(),
  ].filter(Boolean);
  // Join city/state and zip with space, but use comma before city
  if (segments.length <= 1) return segments.join('');
  return `${segments[0]}, ${segments.slice(1).join(' ')}`;
}

/**
 * Format a date of birth with age: 01/15/1985 (39)
 */
export function formatDOBWithAge(dob: string | null | undefined): string {
  if (!dob) return '';
  // Normalize date input: handle both YYYY-MM-DD and MM/DD/YYYY formats
  let d: Date;
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  if (isoMatch) {
    // ISO format: parse as local date components to avoid UTC midnight shift
    d = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  } else {
    d = new Date(dob + 'T00:00:00');
  }
  if (isNaN(d.getTime())) return dob;
  const formatted = d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  // Use local date for age comparison to avoid timezone offset issues
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const mDiff = today.getMonth() - d.getMonth();
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < d.getDate())) age--;
  if (age < 0) return formatted; // Future DOB — don't show negative age
  return `${formatted} (${age})`;
}

/**
 * Truncate a string with ellipsis: "This is a lon…"
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 1) + '…';
}

/**
 * Convert a string to title case: "hello world" → "Hello World"
 */
export function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Common law-enforcement / system acronyms that should remain ALL-CAPS */
const ACRONYMS = new Set([
  'pso', 'cfs', 'dv', 'ems', 'leo', 'ncic', 'bolo', 'atl', 'mdt',
  'sla', 'id', 'dui', 'dwi', 'hoa', 'llc', 'eta', 'rmpg', 'gps',
  'ip', 'pdf', 'api', 'url', 'vpn', 'opr', 'le', 'sop',
]);

/**
 * Convert snake_case or kebab-case to a display label:
 * "pso_client_request" → "PSO Client Request"
 * "active_warrant"     → "Active Warrant"
 * Automatically uppercases known acronyms (PSO, CFS, DV, etc.)
 */
export function toDisplayLabel(str: string): string {
  return str
    .replace(/[_-]/g, ' ')
    .replace(/\b\w+/g, (word) =>
      ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    );
}

/**
 * Pluralize a word based on count: "1 warrant", "3 warrants"
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  const word = count === 1 ? singular : (plural || singular + 's');
  return `${formatNumber(count)} ${word}`;
}

/**
 * Format coordinates for display: 40.7608° N, 111.8910° W
 */
export function formatCoordinates(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
}

/**
 * Format distance in miles (from meters).
 */
export function formatDistance(meters: number): string {
  const miles = meters * 0.000621371;
  if (miles < 0.1) return `${Math.round(meters)} m`;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

/**
 * Convert a snake_case or raw label into "Title Case" display text.
 * e.g. "client_viewer" → "Client Viewer"
 *      "on_scene"         → "On Scene"
 *      "dispatcher"       → "Dispatcher"
 */
export function formatLabel(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
