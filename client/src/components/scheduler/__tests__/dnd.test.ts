import { describe, it, expect } from 'vitest';
import { snapToBand, validateDrop, type DragPayload } from '../dnd';

describe('snapToBand', () => {
  it('returns HH:MM window-start for the target band', () => {
    // Row 1 → 06:00, Row 2 → 08:00, ..., Row 9 → 22:00.
    expect(snapToBand(1)).toEqual({ window_start: '06:00', window_end: '08:00' });
    expect(snapToBand(6)).toEqual({ window_start: '16:00', window_end: '18:00' });
    expect(snapToBand(9)).toEqual({ window_start: '22:00', window_end: '23:59' });
  });

  it('clamps an out-of-range row to row 1', () => {
    expect(snapToBand(0)).toEqual({ window_start: '06:00', window_end: '08:00' });
    expect(snapToBand(-3)).toEqual({ window_start: '06:00', window_end: '08:00' });
  });

  it('clamps a row past 9 to row 9', () => {
    expect(snapToBand(10)).toEqual({ window_start: '22:00', window_end: '23:59' });
    expect(snapToBand(99)).toEqual({ window_start: '22:00', window_end: '23:59' });
  });
});

describe('validateDrop', () => {
  const drag: DragPayload = { slot_id: 42, originating_date: '2026-06-21', officer_id: 1 };

  it('rejects a drop on the same band the chip came from', () => {
    expect(validateDrop(drag, { date: '2026-06-21', row: 6 }, { row: 6 })).toEqual({
      ok: false, reason: 'no-op',
    });
  });

  it('accepts a drop on a different day', () => {
    expect(validateDrop(drag, { date: '2026-06-22', row: 6 }, { row: 6 })).toEqual({
      ok: true,
    });
  });

  it('accepts a drop on a different band of the same day', () => {
    expect(validateDrop(drag, { date: '2026-06-21', row: 7 }, { row: 6 })).toEqual({
      ok: true,
    });
  });

  it('rejects a drop with no payload', () => {
    expect(validateDrop(null, { date: '2026-06-21', row: 6 }, { row: 6 })).toEqual({
      ok: false, reason: 'no-payload',
    });
  });
});
