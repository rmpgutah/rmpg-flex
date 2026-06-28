// ============================================================
// RMPG Flex — Scheduler drag math (pure, no React, no DOM)
// ============================================================
// Bands are 2-hour rows mapping 06:00–24:00 onto rows 1–9 of the
// WeekTimeline CSS grid. snapToBand inverts the band index back to
// an HH:MM window pair the API expects.
// ============================================================

export interface DragPayload {
  slot_id: number;
  originating_date: string;
  officer_id: number | null;
}

export interface DropTarget {
  date: string;
  row: number;
}

export interface DropOrigin {
  row: number;
}

export type DropValidation =
  | { ok: true }
  | { ok: false; reason: 'no-op' | 'no-payload' };

// Row → (window_start, window_end). Row 9 is special-cased to 22:00–23:59
// because the schema's TEXT comparison treats 24:00 as undefined.
export function snapToBand(row: number): { window_start: string; window_end: string } {
  const clamped = Math.max(1, Math.min(9, row));
  if (clamped === 9) return { window_start: '22:00', window_end: '23:59' };
  const startH = 6 + (clamped - 1) * 2;
  const endH = startH + 2;
  return {
    window_start: `${String(startH).padStart(2, '0')}:00`,
    window_end: `${String(endH).padStart(2, '0')}:00`,
  };
}

export function validateDrop(
  payload: DragPayload | null,
  target: DropTarget,
  origin: DropOrigin,
): DropValidation {
  if (!payload) return { ok: false, reason: 'no-payload' };
  if (payload.originating_date === target.date && origin.row === target.row) {
    return { ok: false, reason: 'no-op' };
  }
  return { ok: true };
}
