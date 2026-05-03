// ============================================================
// Server-side mirror of client/src/utils/dispatchGeoCode.ts.
//
// Renders Section / Zone / Beat codes in the format defined by
// `RMPG_Utah_S-Z-B_Dispatch_Chart_Enhanced.xlsx`:
//
//   Section  = 2-letter county prefix      (e.g. "SL")
//   Zone     = city / area code             (e.g. "SLC")
//   Beat     = single letter A-Z           (e.g. "A")
//   Dispatch = `{Section}-{Zone}/{Beat}`   (e.g. "SL-SLC/A")
//
// The codebase persists `sector_code` as 3-letter (SLC, UTC, WBR);
// this helper reduces it to the chart's 2-letter prefix at the
// write site so the persisted `dispatch_code` is chart-shaped.
// ============================================================

/**
 * Reduce a 3-letter `sector_code` (e.g. "SLC", "WBR") to the chart's
 * 2-letter county prefix (e.g. "SL", "WB"). Falls back to the first
 * 2 alpha chars of whatever string is provided.
 */
export function sectionPrefix(sectorCode: string | null | undefined): string {
  if (!sectorCode) return '';
  const upper = String(sectorCode).toUpperCase().replace(/[^A-Z]/g, '');
  return upper.slice(0, 2);
}

/**
 * Pull the chart beat letter from a beat code. Returns the trailing
 * single letter ("SLC-A" → "A", "B" → "B", "BEAT_3C" → "C"). Returns
 * empty string when no letter can be derived.
 */
export function beatLetter(beatCode: string | null | undefined): string {
  if (!beatCode) return '';
  const s = String(beatCode);
  if (/^[A-Za-z]$/.test(s)) return s.toUpperCase();
  const trailing = s.match(/([A-Za-z])\s*$/);
  return trailing ? trailing[1].toUpperCase() : '';
}

/**
 * Compose the chart's full dispatch code from sector / zone / beat
 * code parts. Returns `''` when any required component is missing.
 *
 *   formatChartDispatchCode("SLC", "SLC", "A") → "SL-SLC/A"
 *   formatChartDispatchCode("UTC", "PRO", "C") → "UT-PRO/C"
 *   formatChartDispatchCode("",    "PRO", "A") → ""
 */
export function formatChartDispatchCode(
  sectorCode: string | null | undefined,
  zoneCode: string | null | undefined,
  beatCode: string | null | undefined,
): string {
  const section = sectionPrefix(sectorCode);
  const zone = (zoneCode || '').toString().toUpperCase();
  const beat = beatLetter(beatCode);
  if (!section || !zone || !beat) return '';
  return `${section}-${zone}/${beat}`;
}
