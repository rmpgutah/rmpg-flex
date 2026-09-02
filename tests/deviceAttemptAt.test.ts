// ============================================================
// deviceAttemptAt — device-stamped serve attempt times
// ============================================================
// The officer's device is the authority on WHEN an attempt happened; the
// column default stamps at request-receipt, which drifts from the real
// attempt time on any delayed or queued submit from the field.
//
// These tests pin the storage format (naive UTC, matching parseTimestamp's
// contract) and the skew guards that keep a wrong device clock from printing
// a false time onto a legal notice.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deviceAttemptAt } from '../src/routes/serve';

// Pin Date.now() so the 30-day guard is deterministic across CI runs.
const PINNED_NOW = new Date('2026-08-15T12:00:00Z').getTime(); // 2026-08-15 — safely inside the window for 2026-07-27
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(PINNED_NOW); });
afterEach(() => { vi.restoreAllMocks(); });

describe('deviceAttemptAt', () => {
  it('converts a device ISO instant to naive UTC storage format', () => {
    // 07:35 MDT === 13:35Z. The client resolves the zone; we just store UTC.
    expect(deviceAttemptAt('2026-07-27T13:35:00.000Z')).toBe('2026-07-27 13:35:00');
  });

  it('honors an explicit non-UTC offset rather than dropping it', () => {
    // A device reporting -06:00 wall-clock must land on the same instant.
    expect(deviceAttemptAt('2026-07-27T07:35:00-06:00')).toBe('2026-07-27 13:35:00');
  });

  it('never emits a trailing Z or T — parseTimestamp expects naive UTC', () => {
    const out = deviceAttemptAt(new Date(PINNED_NOW).toISOString())!;
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('falls back to server time when nothing usable was sent', () => {
    expect(deviceAttemptAt(undefined)).toBeNull();
    expect(deviceAttemptAt(null)).toBeNull();
    expect(deviceAttemptAt('')).toBeNull();
    expect(deviceAttemptAt('   ')).toBeNull();
    expect(deviceAttemptAt('not a date')).toBeNull();
    expect(deviceAttemptAt(1761572100000)).toBeNull(); // epoch number, not a string
  });

  it('tolerates benign clock drift a few minutes into the future', () => {
    const soon = new Date(Date.now() + 2 * 60_000).toISOString();
    expect(deviceAttemptAt(soon)).not.toBeNull();
  });

  it('rejects a device clock set well into the future', () => {
    // An attempt cannot have happened after it was reported.
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    expect(deviceAttemptAt(future)).toBeNull();
  });

  it('accepts a genuinely delayed offline submit from hours ago', () => {
    const earlier = new Date(Date.now() - 6 * 60 * 60_000).toISOString();
    expect(deviceAttemptAt(earlier)).not.toBeNull();
  });

  it('rejects a stamp so old it means a broken clock, not a delayed sync', () => {
    const ancient = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();
    expect(deviceAttemptAt(ancient)).toBeNull();
  });
});
