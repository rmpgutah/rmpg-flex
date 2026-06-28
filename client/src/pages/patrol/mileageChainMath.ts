// ============================================================
// mileageChainMath — pure calculations for the Mileage Audit UI
//
// Kept free of React/fetch so the chain-continuity math is unit-testable.
// Used by MileageAuditTab for:
//   • chain-gap detection (row N starts ≠ row N-1 ends → odometer gap)
//   • live "row distance becomes X" preview while editing a fix value
// ============================================================

export interface ChainMathRow {
  id: number;
  source?: 'call' | 'unit_trip';
  call_number: string | null;
  starting_mileage: number | null;
  ending_mileage: number | null;
}

/** Stable identity for a chain row — CFS ids and unit_trip ids come from
 *  DIFFERENT tables, so the raw id alone can collide across sources. */
export function chainRowKey(row: Pick<ChainMathRow, 'id' | 'source'>): string {
  return `${row.source || 'call'}-${row.id}`;
}

export interface ChainGap {
  /** row.starting − previous reading's ending (mi). >0 = unrecorded miles
   *  between events; <0 = odometer went backwards (a data error). */
  gap: number;
  /** Human ref of the previous mileage-bearing event ("CFS26-00047", "PATROL-12"). */
  prevRef: string;
}

/** Ignore sub-tenth differences — odometers are entered to 0.1 mi. */
const GAP_TOLERANCE_MI = 0.1;

/**
 * Walk the chronologically-ordered chain and flag every row whose
 * starting_mileage doesn't continue from the previous ending_mileage.
 * Returns a map keyed by chainRowKey(row).
 */
export function computeChainGaps(rows: ChainMathRow[]): Map<string, ChainGap> {
  const gaps = new Map<string, ChainGap>();
  let prevEnd: { value: number; ref: string } | null = null;
  for (const row of rows) {
    if (prevEnd && row.starting_mileage != null) {
      const gap = Number(row.starting_mileage) - prevEnd.value;
      if (Math.abs(gap) > GAP_TOLERANCE_MI) {
        gaps.set(chainRowKey(row), { gap: Math.round(gap * 10) / 10, prevRef: prevEnd.ref });
      }
    }
    if (row.ending_mileage != null) {
      prevEnd = { value: Number(row.ending_mileage), ref: row.call_number || `#${row.id}` };
    }
  }
  return gaps;
}

/**
 * What this row's start→end distance becomes if `after` is applied to
 * `field`. Null when the opposite endpoint is missing or `after` isn't a
 * number. Negative results are returned as-is so the UI can warn — an
 * ending below the start (or a start above the end) is always a data error.
 */
export function computeNewRowDistance(
  field: 'starting_mileage' | 'ending_mileage',
  after: number,
  startingMileage: number | null,
  endingMileage: number | null,
): number | null {
  if (!Number.isFinite(after)) return null;
  if (field === 'ending_mileage') {
    if (startingMileage == null) return null;
    return Math.round((after - Number(startingMileage)) * 10) / 10;
  }
  if (endingMileage == null) return null;
  return Math.round((Number(endingMileage) - after) * 10) / 10;
}
