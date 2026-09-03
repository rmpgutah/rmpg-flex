// ============================================================
// RMPG Flex — Display Formatters
// ============================================================
// Pure formatting functions for consistent data presentation.
// These do NOT validate — use validate.ts for input checking.
// ============================================================

import { parseTimestamp } from './dateUtils';

/**
 * Normalize a snake_case / lowercase enum value for display.
 *
 * `pso_client_request` → `PSO Client Request`
 * `in_progress`        → `In Progress`
 * `Christopher Zamora` → `Christopher Zamora` (free text passes through)
 *
 * Title Case with acronym-awareness, matching every other label formatter
 * in this file (toDisplayLabel/formatLabel) — this used to shout in ALL
 * CAPS ("PSO CLIENT REQUEST"), the only formatter in the module that did,
 * which read as inconsistent shouting next to Title Case labels everywhere
 * else on the same screen (status chips, warrant/CRM/serve-job badges, etc).
 *
 * Heuristic: a value is enum-like if it's a single token of lowercase
 * letters/digits/underscores, OR if it contains an underscore. Names,
 * addresses, and free-form text pass through untouched so we don't
 * accidentally re-case data the user typed in mixed case.
 */
export function formatEnumValue(s: string | null | undefined): string {
  if (s == null) return '';
  const trimmed = String(s).trim();
  if (!trimmed) return '';
  const isEnumLike = /^[a-z][a-z0-9_]*$/.test(trimmed) || /_/.test(trimmed);
  return isEnumLike ? toDisplayLabel(trimmed) : trimmed;
}

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
 * Auto-format phone number as user types — (###) ###-####
 * Only accepts digits; automatically adds parentheses, space, and hyphen.
 * Use as onChange handler: onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
 */
export function formatPhoneInput(value: string | null | undefined): string {
  if (!value) return '';
  // Strip everything except digits
  let digits = String(value).replace(/\D/g, '');
  // Remove leading "1" country code if user types it
  if (digits.length > 10 && digits[0] === '1') digits = digits.substring(1);
  // Limit to 10 digits
  digits = digits.substring(0, 10);
  // Progressive formatting as user types
  if (digits.length === 0) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.substring(0, 3)}) ${digits.substring(3)}`;
  return `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
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
 * Format a cost compactly for dense tables: `$4.2k` at/above $1,000,
 * `$840` below. Null/undefined/NaN render as `$0`. Use this instead of
 * hand-rolling `amount >= 1000 ? `${(amount/1000).toFixed(1)}k` : amount.toFixed(0)`
 * — that pattern crashes on undefined and was guarded inconsistently across the
 * fleet tables.
 */
export function formatCostAbbrev(amount: number | null | undefined): string {
  const n = amount == null || isNaN(amount) ? 0 : amount;
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;
}

/**
 * Format a file size in human-readable format: 1.2 MB
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Format a duration in seconds to human-readable: 2h 15m, 45s, etc.
 * Useful for response times, call durations, shift lengths.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
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
  if (!Number.isFinite(minutes) || minutes < 0) minutes = 0;
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
  if (!Number.isFinite(value)) return '0.0%';
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
  const d = parseTimestamp(dob);
  if (isNaN(d.getTime())) return dob;
  const formatted = d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const mDiff = today.getMonth() - d.getMonth();
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < d.getDate())) age--;
  if (age < 0) return formatted;
  return `${formatted} (${age})`;
}

/**
 * Truncate a string with ellipsis: "This is a lon…"
 */
export function truncate(str: string, maxLength: number): string {
  if (!str || maxLength <= 0) return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 1) + '…';
}

/**
 * Convert a string to title case: "hello world" → "Hello World".
 * Acronym-aware ("pso" → "PSO") and preserves inner caps for names
 * ("McDonald" stays "McDonald").
 */
export function toTitleCase(str: string): string {
  if (!str) return '';
  return str.replace(/\b[A-Za-z0-9]+\b/g, (word) =>
    ACRONYMS.has(word.toLowerCase())
      ? word.toUpperCase()
      : word.charAt(0).toUpperCase() + word.slice(1),
  );
}

/**
 * Common law-enforcement / system acronyms that must render ALL-CAPS in
 * visual labels (never "Pso") and be SPELLED OUT letter-by-letter when
 * spoken aloud ("P. S. O.", not the word "Pso"). This is the single source
 * of truth — extend it here and every acronym-aware formatter below picks
 * it up, so labels stay proper for current AND future enum values.
 *
 * DEPRECATED for speech: use normalizeForSpeech() from speechNormalizer.ts
 * for TTS output. This set remains for visual display labels only.
 */
export const ACRONYMS = new Set([
  // Communications / systems
  'pso', 'cfs', 'cad', 'rms', 'mdt', 'mds', 'gps', 'rmpg',
  // Domestic / personal categories
  'dv', 'dl', 'dob', 'ssn', 'dlv',
  // Emergency response
  'ems', 'leo', 'swat', 'k9', 'sro', 'qrf', 'eta',
  // Records / intel
  'ncic', 'bolo', 'atl', 'fbi', 'doc', 'udc', 'sor', 'nsopw',
  // Driving-related
  'dui', 'dwi', 'cdl', 'dmv', 'vin', 'mva', 'dlc',
  // Service / process
  'sla', 'sop', 'opr', 'le', 'id', 'loc',
  // Property / corporate
  'hoa', 'llc', 'hud',
  // Tech / network
  'ip', 'pdf', 'api', 'url', 'vpn', 'alpr', 'json', 'html', 'csv', 'ui', 'ux', 'sdk',
  // Legal / enforcement
  'leo', 'ua', 'uof', 'oat', 'oatc', 'ia', 'ippa', 'ncic',
  // Court / legal
  'doc', 'dc', 'pd', 'da',
  // Medical
  'ems', 'md', 'rn',
  // Military
  'idf', 'mp', 'mos',
  // Geography / time
  'ut', 'slc', 'mt', 'utc', 'mtn',
  // Other law enforcement specific
  'cpr', 'atv', 'utv', 'vin',
  // Financial
  'atm', 'pos',
  // Investigation
  'mis', 'ped', 'vcl', 'unsub',
  // Common multi-word compound labels (specific to this app)
  'microbilt',
  'forecaws',
  'utahlex',
  'openpyxl',
]);

/**
 * Title-case ONE word, keeping a known acronym ALL-CAPS. The shared atom
 * behind every label formatter — this is what prevents "PSO" from ever
 * degrading to the weak lowercase "Pso".
 */
export function titleCaseWord(word: string): string {
  if (!word) return word;
  return ACRONYMS.has(word.toLowerCase())
    ? word.toUpperCase()
    : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Convert snake_case, kebab-case, or camelCase to a display label:
 * "pso_client_request"     → "PSO Client Request"
 * "active_warrant"         → "Active Warrant"
 * "in_progress"            → "In Progress"
 * "client_viewer"          → "Client Viewer"
 * "citizen_portal_enabled" → "Citizen Portal Enabled"
 * "underReview"            → "Under Review"
 * "offense_level"          → "Offense Level"
 * "served"                 → "Served"
 * "sub_service"            → "Sub Service"
 * "dl_status"              → "DL Status"
 * Automatically uppercases known acronyms (PSO, CFS, DV, DL, etc.)
 * Normalizes whitespace: trims and collapses multiple spaces.
 */
export function toDisplayLabel(str: string | null | undefined): string {
  if (!str) return '';
  const s = String(str).trim();
  if (!s) return '';
  // Insert space before uppercase letters in camelCase (except first char)
  const withSpaces = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return withSpaces
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b[A-Za-z0-9]+/g, titleCaseWord)
    .trim();
}

/**
 * Spoken form of a label for TTS / voice announcements: known acronyms are
 * spelled out so the voice says the LETTERS, not a mangled word.
 * "pso_client_request" → "P. S. O. Client Request"
 * "dv_in_progress"     → "D. V. In Progress"
 * Use this anywhere a label is handed to speech synthesis.
 *
 * DEPRECATED for TTS: normalizeForSpeech() from speechNormalizer.ts now
 * handles all speech normalization centrally. This function is retained
 * for voiceAlerts.ts backward compatibility but the edgeTTS speak() path
 * will apply a second pass of normalization via normalizeForSpeech()
 * which is harmless (idempotent for already-expanded text).
 */
export function toSpokenLabel(str: string): string {
  if (!str) return '';
  return str
    .replace(/[_-]/g, ' ')
    .replace(/\b[A-Za-z0-9]+\b/g, (word) =>
      ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase().split('').join('. ') + '.'
        : titleCaseWord(word)
    )
    .replace(/\s+/g, ' ')
    .trim();
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
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '—';
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
}

/**
 * Format distance in miles (from meters).
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '0 m';
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
    .map(titleCaseWord)
    .join(' ');
}

// ============================================================
// Memoization utility
// ============================================================

/**
 * Simple memoization wrapper for pure formatting functions.
 * Caches the last N results to avoid redundant computation
 * in frequently re-rendered lists and tables.
 */
export function memoize<T extends (...args: any[]) => any>(fn: T, maxSize = 200): T {
  const cache = new Map<string, ReturnType<T>>();
  return ((...args: Parameters<T>): ReturnType<T> => {
    let key: string;
    try { key = JSON.stringify(args); } catch { return fn(...args); }
    if (cache.has(key)) return cache.get(key)!;
    const result = fn(...args);
    if (cache.size >= maxSize) {
      // Evict oldest entry
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) cache.delete(firstKey);
    }
    cache.set(key, result);
    return result;
  }) as T;
}

// Memoized versions of expensive formatters
export const memoFormatPhone = memoize(formatPhone);
export const memoFormatCurrency = memoize(formatCurrency);
export const memoFormatDOBWithAge = memoize(formatDOBWithAge);
export const memoFormatVIN = memoize(formatVIN);
export const memoFormatAddress = memoize(formatAddress);
export const memoFormatName = memoize(formatName);

// ============================================================
// Additional formatters
// ============================================================

/**
 * Format a number as compact (1.2K, 3.5M, etc.)
 */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

/**
 * Format bytes per second as a human-readable speed.
 */
export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return '0 B/s';
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1048576) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / 1048576).toFixed(1)} MB/s`;
}

/**
 * Format a badge number: uppercase, trimmed, padded.
 */
export function formatBadge(badge: string | null | undefined): string {
  if (!badge) return '';
  return badge.toUpperCase().trim();
}

/**
 * Format a boolean as Yes/No.
 */
export function formatYesNo(value: boolean | number | null | undefined): string {
  if (value == null) return 'N/A';
  return value ? 'Yes' : 'No';
}

/**
 * Format an array of strings as comma-separated list.
 */
export function formatList(items: string[] | null | undefined, separator = ', '): string {
  if (!items || items.length === 0) return '';
  return items.filter(Boolean).join(separator);
}

/**
 * Mask sensitive data, showing only last N characters.
 * e.g. maskValue("1234567890", 4) → "******7890"
 */
export function maskValue(value: string, showLast = 4, maskChar = '*'): string {
  if (!value) return '';
  if (value.length <= showLast) return value;
  return maskChar.repeat(value.length - showLast) + value.slice(-showLast);
}

/**
 * Strip HTML tags and decode entities for PDF plain-text rendering.
 *
 * Decodes HTML entities first (`&lt;` → `<`) so that encoded script/style
 * blocks become real tags and are removed by the tag-strip pass.  `&amp;`
 * is decoded last so that `&amp;lt;` stays as the literal text `&lt;`.
 *
 * Tag stripping runs in a do-while loop so that tags that reform after
 * entity decoding (e.g. `<scr&lt;ipt>` → `<script>`) are caught on the
 * next pass.  A final `[<>]` cleanup catches any residual angle brackets.
 *
 * NOT a security boundary — the input has already been sanitized before
 * reaching this function.
 */
export function stripHtmlForPdf(input: string | undefined | null): string {
  if (!input) return '';
  // Phase 1: entity-decode so encoded tags become real tags.
  let result = String(input)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/(div|li|tr|h[1-6])>/gi, '\n');

  // Phase 2: strip tags in a loop — repeated passes catch tags that reform
  // after entity decoding (e.g. <scr&lt;ipt> → <script> after decode).
  let prev: string;
  do {
    prev = result;
    result = result.replace(/<[^>]+>/g, '');
  } while (result !== prev);

  // Phase 3: final cleanup — decode &amp; last, remove residual brackets,
  // collapse whitespace.
  return result
    .replace(/&amp;/g, '&')
    .replace(/[<>]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
