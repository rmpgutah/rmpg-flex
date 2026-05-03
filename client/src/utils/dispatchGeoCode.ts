// ============================================================
// RMPG Utah S/Z/B dispatch-code formatter (display-only).
//
// Renders Section / Zone / Beat codes in the format defined by
// `RMPG_Utah_S-Z-B_Dispatch_Chart_Enhanced.xlsx`:
//
//   Section  = 2-letter county prefix         (e.g. "SL")
//   Zone     = city / area code                (e.g. "SLC")
//   Beat     = single letter A-Z              (e.g. "A")
//   Dispatch = `{Section}-{Zone}/{Beat}`      (e.g. "SL-SLC/A")
//
// The codebase's underlying schema stores 3-letter sector codes
// (SLC, UTC, WBR) and city-coded zones. This module is a pure
// read-side projection — it never mutates the DB.
// ============================================================

import type { Beat, Sector, Zone } from '../types/geography';

/**
 * Reduce a 3-letter codebase sector_code (e.g. "SLC", "WBR") to the
 * chart's 2-letter county prefix (e.g. "SL", "WB"). Falls back to
 * the first 2 chars of whatever string is provided.
 */
export function sectionPrefix(sectorCode: string | null | undefined): string {
  if (!sectorCode) return '';
  const upper = sectorCode.toUpperCase().replace(/[^A-Z]/g, '');
  return upper.slice(0, 2);
}

/**
 * Format the full chart dispatch code for a beat. Requires the beat's
 * resolved zone + sector context. Returns `''` when the inputs cannot
 * produce a meaningful code (e.g. unassigned beat).
 *
 * Examples:
 *   formatBeatDispatchCode({ section: "SL", zone: "SLC", beat: "A" })
 *     → "SL-SLC/A"
 *   formatBeatDispatchCode({ section: "UT", zone: "PRO", beat: "C" })
 *     → "UT-PRO/C"
 */
export function formatBeatDispatchCode(parts: {
  section: string | null | undefined;
  zone: string | null | undefined;
  beat: string | null | undefined;
}): string {
  const section = sectionPrefix(parts.section);
  const zone = (parts.zone || '').toUpperCase();
  const beat = (parts.beat || '').toUpperCase();
  if (!section || !zone || !beat) return '';
  return `${section}-${zone}/${beat}`;
}

/**
 * Pull the chart's beat letter from a Beat row. Prefers the explicit
 * `district_letter` column; otherwise tries the trailing letter of
 * `beat_code` (e.g. "SLC-A" → "A", "BEAT_3B" → "B").
 */
export function beatLetter(beat: Pick<Beat, 'district_letter' | 'beat_code'>): string {
  if (beat.district_letter && /^[A-Za-z]$/.test(beat.district_letter)) {
    return beat.district_letter.toUpperCase();
  }
  const trailing = (beat.beat_code || '').match(/([A-Z])\s*$/i);
  return trailing ? trailing[1].toUpperCase() : '';
}

/**
 * Convenience: format a Beat row using its joined sector_code + zone_code.
 * Falls back to the persisted `dispatch_code` when context is missing —
 * preserves whatever the seeder originally stored.
 */
export function beatChartCode(beat: Beat): string {
  const synthesized = formatBeatDispatchCode({
    section: beat.sector_code,
    zone: beat.zone_code,
    beat: beatLetter(beat),
  });
  return synthesized || beat.dispatch_code || beat.beat_code || '';
}

/**
 * Display the chart-style label for a Sector row: "SL — Salt Lake County".
 */
export function sectorChartLabel(sector: Pick<Sector, 'sector_code' | 'sector_name'>): string {
  const prefix = sectionPrefix(sector.sector_code);
  if (!prefix) return sector.sector_name;
  return `${prefix} — ${sector.sector_name}`;
}

/**
 * Display the chart-style code for a Zone row: "SL/SLC".
 * (Zone-number subdivision per chart isn't in the schema — we omit it
 * rather than fabricate one.)
 */
export function zoneChartCode(
  zone: Pick<Zone, 'zone_code' | 'sector_code'>,
): string {
  const section = sectionPrefix(zone.sector_code);
  const z = (zone.zone_code || '').toUpperCase();
  if (!section || !z) return z || zone.zone_code || '';
  return `${section}/${z}`;
}
