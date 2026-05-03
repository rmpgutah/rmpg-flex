// ============================================================
// RMPG Flex — Dispatch chart-code parsers (display-only).
//
// Stored chart codes embed parent context:
//   sector_code = "SL1"
//   zone_code   = "SL1-HER"      → child = "HER"
//   beat_code   = "SL1-HER/C"    → child = "C"
//
// On a printout where Section / Zone / Beat each have their own
// column, the parent context is redundant inside the child cell.
// These parsers strip parents so columns render cleanly:
//
//   Section: SL1 | Zone: HER | Beat: C | Combined: SL1/HER/C
//
// All-slash combined form differs from the raw beat_code on
// purpose — printout convention per the dispatch chart.
// ============================================================

/** Strip leading "SECTION-" from a zone_code. */
export function zoneLeaf(zoneCode: string | null | undefined): string {
  if (!zoneCode) return '';
  const idx = zoneCode.indexOf('-');
  return idx >= 0 ? zoneCode.slice(idx + 1) : zoneCode;
}

/** Strip everything up to and including the last "/" from a beat_code. */
export function beatLeaf(beatCode: string | null | undefined): string {
  if (!beatCode) return '';
  const idx = beatCode.lastIndexOf('/');
  return idx >= 0 ? beatCode.slice(idx + 1) : beatCode;
}

/**
 * Render the "Section/Zone/Beat" combined cell with slash separators
 * (e.g. "SL1/HER/C"). Returns '' when no parts are present.
 *
 * Prefers the stored beat_code as the source of truth (it carries all
 * three parts) and rewrites its single dash separator into a slash.
 */
export function sectionZoneBeatCombined(
  sectorId: string | null | undefined,
  zoneId: string | null | undefined,
  beatId: string | null | undefined,
): string {
  if (beatId) {
    // beat_code = "SL1-HER/C" → "SL1/HER/C"
    return beatId.replace('-', '/');
  }
  if (zoneId) {
    return zoneId.replace('-', '/');
  }
  return sectorId || '';
}
