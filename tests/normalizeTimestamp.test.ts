// ============================================================
// normalizeToUtcTimestamp — operator/import timestamp canonicalization
// ============================================================
// Every case below is a REAL format found in live fleet_fuel_log on
// 2026-07-31, where one column held four incompatible representations
// because all three write paths stored the caller's string verbatim.
// ============================================================

import { describe, it, expect } from 'vitest';
import { normalizeToUtcTimestamp } from '../src/utils/denverTime';

describe('normalizeToUtcTimestamp', () => {
  describe('the four formats found live in fleet_fuel_log', () => {
    it('ISO with -06:00 offset (22 rows) — instant is unambiguous, convert to UTC', () => {
      // 20:33:39 MDT == 02:33:39 UTC the NEXT day. This day-rollover is the
      // whole bug: date() bucketed evening fills into tomorrow.
      expect(normalizeToUtcTimestamp('2026-07-28T20:33:39.000000-06:00'))
        .toBe('2026-07-29 02:33:39');
    });

    it('ISO with no offset (87 rows) — treated as DENVER wall-clock, not UTC', () => {
      // Evidenced: promptly-entered rows sat 6.06h/6.11h ahead of their UTC
      // created_at, i.e. exactly the MDT offset. Reading these as UTC is what
      // made them 6h early in every aggregation.
      expect(normalizeToUtcTimestamp('2026-06-25T14:14:50')).toBe('2026-06-25 20:14:50');
    });

    it('naive space-separated (3 rows) — ALREADY UTC, must not be shifted', () => {
      // The separator identifies the producer:
      //   space -> SQLite datetime('now')  => UTC
      //   T     -> toDenverWallClock()     => Denver local
      // Proven by the three double-logged fills, where the same fill exists
      // once with an explicit -06:00 offset and once space-separated:
      //   id 114 20:33:39-06:00 -> 02:33:39Z  vs  id 115 '2026-07-29 02:33:03'
      // They align ONLY if the space form is UTC. An earlier revision treated
      // it as Denver and would have pushed those rows a further +6h.
      expect(normalizeToUtcTimestamp('2026-07-29 02:33:03')).toBe('2026-07-29 02:33:03');
    });

    it('the two offset-less forms are NOT interchangeable', () => {
      const sameWallClock = '2026-07-29 02:33:03';
      const asT = normalizeToUtcTimestamp(sameWallClock.replace(' ', 'T'));
      const asSpace = normalizeToUtcTimestamp(sameWallClock);
      expect(asSpace).toBe('2026-07-29 02:33:03');  // UTC, untouched
      expect(asT).toBe('2026-07-29 08:33:03');      // Denver -> UTC, +6
      expect(asT).not.toBe(asSpace);
    });

    it('reconciles the live duplicate pairs to the same instant', () => {
      // Each pair is one real fill stored twice in different formats.
      const pairs: Array<[string, string]> = [
        ['2026-07-28T20:33:39.000000-06:00', '2026-07-29 02:33:03'],
        ['2026-07-21T14:42:00.000000-06:00', '2026-07-21 20:42:31'],
        ['2026-07-17T19:28:00.000000-06:00', '2026-07-18 01:28:47'],
      ];
      for (const [offsetForm, spaceForm] of pairs) {
        const a = normalizeToUtcTimestamp(offsetForm)!;
        const b = normalizeToUtcTimestamp(spaceForm)!;
        // Within a minute of each other — same fill, logged seconds apart.
        const deltaSec = Math.abs(Date.parse(a.replace(' ', 'T') + 'Z') - Date.parse(b.replace(' ', 'T') + 'Z')) / 1000;
        expect(deltaSec, `${offsetForm} vs ${spaceForm}`).toBeLessThan(60);
      }
    });

    it('date only (1 row) — Denver midnight, not UTC midnight', () => {
      expect(normalizeToUtcTimestamp('2026-07-17')).toBe('2026-07-17 06:00:00');
    });
  });

  describe('DST correctness', () => {
    it('uses MST (-07:00) in winter', () => {
      expect(normalizeToUtcTimestamp('2026-01-15T12:00:00')).toBe('2026-01-15 19:00:00');
    });

    it('uses MDT (-06:00) in summer', () => {
      expect(normalizeToUtcTimestamp('2026-07-15T12:00:00')).toBe('2026-07-15 18:00:00');
    });

    it('is per-value DST-aware, not a fixed offset', () => {
      // Same wall-clock time, six months apart, must differ by an hour in UTC.
      const winter = normalizeToUtcTimestamp('2026-01-15T12:00:00')!;
      const summer = normalizeToUtcTimestamp('2026-07-15T12:00:00')!;
      expect(winter.slice(11, 13)).toBe('19');
      expect(summer.slice(11, 13)).toBe('18');
    });
  });

  describe('zone detection', () => {
    it('accepts a Z suffix', () => {
      expect(normalizeToUtcTimestamp('2026-07-28T20:33:39Z')).toBe('2026-07-28 20:33:39');
    });

    it('accepts +HH:MM', () => {
      expect(normalizeToUtcTimestamp('2026-07-28T20:33:39+02:00')).toBe('2026-07-28 18:33:39');
    });

    it('does NOT mistake a bare date for an offset-bearing value', () => {
      // A naive substring search for '-' matches '2026-07-17'. If that were
      // treated as zoned, the value would be read as UTC midnight and the
      // Denver shift silently skipped.
      expect(normalizeToUtcTimestamp('2026-07-17')).toBe('2026-07-17 06:00:00');
      expect(normalizeToUtcTimestamp('2026-07-17')).not.toBe('2026-07-17 00:00:00');
    });
  });

  describe('output shape', () => {
    it('always emits canonical SQL UTC with no T and no fractional seconds', () => {
      for (const input of [
        '2026-07-28T20:33:39.000000-06:00',
        '2026-06-25T14:14:50',
        '2026-07-29 02:33:03',
        '2026-07-17',
      ]) {
        expect(normalizeToUtcTimestamp(input)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      }
    });

    it('accepts HH:MM without seconds', () => {
      expect(normalizeToUtcTimestamp('2026-07-15T12:00')).toBe('2026-07-15 18:00:00');
    });
  });

  describe('bad input returns null rather than throwing', () => {
    // A bad import row must be skippable without failing the whole batch.
    for (const bad of [null, undefined, '', '   ', 'not a date', '07/15/2026', '2026-13-45T99:99:99']) {
      it(`returns null for ${JSON.stringify(bad)}`, () => {
        expect(normalizeToUtcTimestamp(bad)).toBeNull();
      });
    }
  });
});
