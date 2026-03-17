// ============================================================
// RMPG Flex — HTML Sanitization Utility
// Prevents XSS when interpolating user data into HTML strings
// ============================================================

/**
 * Escape special HTML characters to prevent XSS injection.
 * Use this whenever interpolating user-supplied data into raw HTML strings
 * (e.g., Google Maps InfoWindow content).
 */
export function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Safely parse a JSON string array from localStorage.
 * Returns the fallback on any parse failure, non-array result, or if
 * array elements fail the optional type guard. Prevents prototype pollution
 * and type confusion from tampered localStorage values.
 */
export function safeParseStringArray(raw: string | null, fallback: string[] = []): string[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    // Only keep string elements — reject injected objects/numbers
    return parsed.filter((item): item is string => typeof item === 'string').slice(0, 100);
  } catch {
    return fallback;
  }
}
