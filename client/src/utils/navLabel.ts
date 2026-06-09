// ============================================================
// RMPG Flex — Address / Coords Label Normalizer
// Produces consistent short labels for recents/favorites/chips and
// a canonical coordinate label. Handles the live "None"/"N/A"/"0"
// sentinel strings (see project-sentinel-none-strings). Pure — no
// React, no DOM.
// ============================================================

const SENTINELS = new Set(['none', 'n/a', 'na', 'null', 'undefined', '0', '-', '--']);

/** True when a value is empty or a known DB sentinel masquerading as text. */
function isBlankOrSentinel(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim();
  if (!s) return true;
  return SENTINELS.has(s.toLowerCase());
}

/**
 * First-line, trimmed, length-capped label for a place string.
 *   shortLabel('123 S Main St\nSalt Lake City, UT') -> '123 S Main St'
 *   shortLabel('None') -> '' (sentinel)
 * Long single lines are truncated with an ellipsis (default 48 chars).
 */
export function shortLabel(place: unknown, maxLen = 48): string {
  if (isBlankOrSentinel(place)) return '';
  // first non-blank line, comma-trimmed of trailing region noise kept intact
  const firstLine = String(place)
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(l => l.length > 0) ?? '';
  if (isBlankOrSentinel(firstLine)) return '';
  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLen) return collapsed;
  return `${collapsed.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

/**
 * Canonical coordinate label, 4-decimal precision.
 *   coordLabel(40.76083, -111.89105) -> '40.7608, -111.8910'
 * Invalid coords → '' .
 */
export function coordLabel(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}
