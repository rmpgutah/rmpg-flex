import { describe, it, expect } from 'vitest';
import {
  detectSlotOverlap,
  isStaleUpdate,
  normalizeWindow,
  type SlotRow,
} from '../src/utils/serveScheduleEdit';

const row = (over: Partial<SlotRow> = {}): SlotRow => ({
  id: 1, queue_id: 10, officer_id: 1,
  scheduled_date: '2026-06-21', window_start: '17:00', window_end: '20:30',
  updated_at: '2026-06-21T12:00:00',
  ...over,
});

describe('detectSlotOverlap', () => {
  it('returns empty array when no other slots share the (officer, date)', () => {
    const candidate = { officer_id: 1, scheduled_date: '2026-06-22', window_start: '08:00', window_end: '10:00' };
    expect(detectSlotOverlap([row()], candidate, /* selfId */ 1)).toEqual([]);
  });

  it('returns the conflict when proposed window overlaps an existing one on the same officer + date', () => {
    const existing = row({ id: 5, window_start: '15:00', window_end: '17:30' });
    const candidate = { officer_id: 1, scheduled_date: '2026-06-21', window_start: '17:00', window_end: '20:30' };
    expect(detectSlotOverlap([existing], candidate, /* selfId */ 99).map((r) => r.id)).toEqual([5]);
  });

  it('does NOT flag the slot being edited as a conflict with itself', () => {
    const existing = row({ id: 5, window_start: '17:00', window_end: '20:30' });
    const candidate = { officer_id: 1, scheduled_date: '2026-06-21', window_start: '17:00', window_end: '20:30' };
    expect(detectSlotOverlap([existing], candidate, /* selfId */ 5)).toEqual([]);
  });

  it('treats edge-touching windows (end == next start) as NON-overlapping', () => {
    const existing = row({ id: 5, window_start: '15:00', window_end: '17:00' });
    const candidate = { officer_id: 1, scheduled_date: '2026-06-21', window_start: '17:00', window_end: '19:00' };
    expect(detectSlotOverlap([existing], candidate, /* selfId */ 99)).toEqual([]);
  });
});

describe('isStaleUpdate', () => {
  it('returns false when the provided timestamp matches the row\'s updated_at', () => {
    expect(isStaleUpdate('2026-06-21T12:00:00', '2026-06-21T12:00:00')).toBe(false);
  });

  it('returns true when the row was updated after the client read it', () => {
    expect(isStaleUpdate('2026-06-21T12:00:00', '2026-06-21T12:30:00')).toBe(true);
  });

  it('returns false when the client did NOT send an If-Unmodified-Since header', () => {
    expect(isStaleUpdate(null, '2026-06-21T12:00:00')).toBe(false);
  });
});

describe('normalizeWindow', () => {
  it('returns HH:MM strings unchanged when already in 24-h format', () => {
    expect(normalizeWindow('14:00', '16:30')).toEqual({ window_start: '14:00', window_end: '16:30' });
  });

  it('pads single-digit hours', () => {
    expect(normalizeWindow('9:00', '11:30')).toEqual({ window_start: '09:00', window_end: '11:30' });
  });

  it('rejects malformed input by throwing', () => {
    expect(() => normalizeWindow('hello', '14:00')).toThrow(/invalid window/i);
    expect(() => normalizeWindow('14:00', '99:99')).toThrow(/invalid window/i);
  });

  it('rejects a reversed window (end <= start) by throwing', () => {
    expect(() => normalizeWindow('17:00', '10:00')).toThrow(/end must be after start/i);
    expect(() => normalizeWindow('14:00', '14:00')).toThrow(/end must be after start/i);
  });
});
