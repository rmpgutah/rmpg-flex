// ============================================================
// RMPG Flex — Serve schedule slot edit helpers (pure)
// ============================================================
// Used by PATCH /serve-intake/schedule/:slotId. The route reads
// existing slots from D1 and asks these helpers whether a proposed
// edit collides with another slot or against a stale read.
// ============================================================

export interface SlotRow {
  id: number;
  queue_id: number;
  officer_id: number | null;
  scheduled_date: string;
  window_start: string;
  window_end: string;
  updated_at: string;
}

export interface CandidateSlot {
  officer_id: number | null;
  scheduled_date: string;
  window_start: string;
  window_end: string;
}

// Open-interval overlap: A end <= B start means edge-touching, no overlap.
// Returns the existing rows that would collide with the candidate.
export function detectSlotOverlap(
  existing: SlotRow[],
  candidate: CandidateSlot,
  selfId: number,
): SlotRow[] {
  return existing.filter((s) => {
    if (s.id === selfId) return false;
    if (s.officer_id !== candidate.officer_id) return false;
    if (s.scheduled_date !== candidate.scheduled_date) return false;
    return !(s.window_end <= candidate.window_start || s.window_start >= candidate.window_end);
  });
}

// Optimistic concurrency check. When the client sends If-Unmodified-Since,
// we compare against the DB's current updated_at; mismatch means another
// dispatcher already moved this slot — surface a 409 so the client can refetch.
export function isStaleUpdate(
  clientUnmodifiedSince: string | null,
  currentUpdatedAt: string,
): boolean {
  if (!clientUnmodifiedSince) return false;
  return clientUnmodifiedSince !== currentUpdatedAt;
}

const HHMM = /^(\d{1,2}):(\d{2})$/;

// Pads single-digit hours and validates the window. Throws on malformed input.
export function normalizeWindow(
  start: string, end: string,
): { window_start: string; window_end: string } {
  const padded = (s: string) => {
    const m = HHMM.exec(s);
    if (!m) throw new Error(`invalid window time: ${s}`);
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) throw new Error(`invalid window time: ${s}`);
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  };
  const result = { window_start: padded(start), window_end: padded(end) };
  if (result.window_start >= result.window_end) {
    throw new Error(`invalid window time: end must be after start (${result.window_start} → ${result.window_end})`);
  }
  return result;
}
