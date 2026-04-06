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
