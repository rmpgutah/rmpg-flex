// ============================================================
// serveDiligenceChain — Rule 4(d) assessment + the UTC/Mountain trap
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  assessDiligence,
  bandForHour,
  mountainParts,
  diligenceSummary,
} from '../serveDiligenceChain';
import type { ServeAttempt } from '../../types';

/** `attempt_at` is stored naive UTC — these fixtures are UTC, as D1 holds them. */
function att(attempt_at: string, result: ServeAttempt['result'] = 'no_answer', n = 1): ServeAttempt {
  return { id: n, serve_queue_id: 1, attempt_number: n, attempt_at, result } as unknown as ServeAttempt;
}

describe('mountainParts — the UTC storage trap', () => {
  // 2026-07-28 01:30 UTC is 2026-07-27 19:30 MDT (UTC-6).
  // Naive getHours() would call this hour 1 ("morning") on the 28th (Tuesday);
  // correct reading is hour 19 ("evening") on the 27th (Monday).
  it('reads a late-evening MDT attempt as evening on the PREVIOUS calendar day', () => {
    const p = mountainParts('2026-07-28 01:30:00');
    expect(p.hour).toBe(19);
    expect(p.ymd).toBe('2026-07-27');
    expect(p.dow).toBe(1); // Monday
  });

  // 2026-07-26 is a Sunday. 2026-07-27 04:00 UTC = 2026-07-26 22:00 MDT (Sun).
  // Naive parsing would call this Monday and lose the weekend credit entirely.
  it('keeps a Sunday-night attempt on the weekend', () => {
    const p = mountainParts('2026-07-27 04:00:00');
    expect(p.dow).toBe(0);
    expect(p.ymd).toBe('2026-07-26');
  });
});

describe('bandForHour', () => {
  it.each([
    [8, 'morning'], [11, 'morning'], [12, 'afternoon'],
    [16, 'afternoon'], [17, 'evening'], [21, 'evening'],
  ])('hour %i -> %s', (h, band) => expect(bandForHour(h as number)).toBe(band));
});

describe('assessDiligence', () => {
  it('reports none with no attempts', () => {
    const a = assessDiligence([]);
    expect(a.strength).toBe('none');
    expect(a.failedAttempts).toBe(0);
    expect(a.meetsRule4dFloor).toBe(false);
    expect(a.gaps).toContain('No documented attempts yet.');
  });

  it('does not credit a successful service as a failed attempt', () => {
    const a = assessDiligence([att('2026-07-20 16:00:00', 'served')]);
    expect(a.failedAttempts).toBe(0);
    expect(a.strength).toBe('none');
  });

  // An attempt at the wrong house proves nothing about the right one.
  it('does not credit wrong_address / moved toward the chain', () => {
    const a = assessDiligence([
      att('2026-07-20 16:00:00', 'wrong_address', 1),
      att('2026-07-21 16:00:00', 'moved', 2),
    ]);
    expect(a.failedAttempts).toBe(0);
    expect(a.meetsRule4dFloor).toBe(false);
  });

  it('is weak below the Rule 4(d) floor', () => {
    const a = assessDiligence([att('2026-07-20 16:00:00')]);
    expect(a.failedAttempts).toBe(1);
    expect(a.meetsRule4dFloor).toBe(false);
    expect(a.strength).toBe('weak');
    expect(a.gaps).toContain('Fewer than 2 attempts — Rule 4(d) floor not met.');
  });

  // Three knocks at the same hour is the textbook weak-but-numerous record.
  it('stays weak when every attempt sits in one time band', () => {
    const a = assessDiligence([
      att('2026-07-14 20:00:00', 'no_answer', 1), // 14:00 MDT — afternoon
      att('2026-07-21 20:00:00', 'no_answer', 2),
      att('2026-07-28 20:00:00', 'no_answer', 3),
    ]);
    expect(a.failedAttempts).toBe(3);
    expect(a.meetsRule4dFloor).toBe(true);
    expect(a.bandsCovered).toEqual(['afternoon']);
    expect(a.strength).toBe('weak');
    expect(a.gaps).toContain('All attempts fall in one time-of-day band — vary morning / afternoon / evening.');
  });

  it('is adequate at 2 attempts across 2 bands, and still flags the missing weekend', () => {
    const a = assessDiligence([
      att('2026-07-20 15:00:00', 'no_answer', 1), // 09:00 MDT Mon — morning
      att('2026-07-22 01:00:00', 'no_answer', 2), // 19:00 MDT Tue — evening
    ]);
    expect(a.strength).toBe('adequate');
    expect(a.bandsCovered).toEqual(['morning', 'evening']);
    expect(a.hasWeekendAttempt).toBe(false);
    expect(a.gaps).toContain('No weekend attempt on the record.');
  });

  it('is strong at 3+ attempts, 2+ bands, with a weekend attempt', () => {
    const a = assessDiligence([
      att('2026-07-20 15:00:00', 'no_answer', 1), // Mon 09:00 MDT morning
      att('2026-07-22 01:00:00', 'no_answer', 2), // Tue 19:00 MDT evening
      att('2026-07-25 19:00:00', 'no_answer', 3), // Sat 13:00 MDT afternoon
    ]);
    expect(a.strength).toBe('strong');
    expect(a.hasWeekendAttempt).toBe(true);
    expect(a.distinctDays).toBe(3);
    expect(a.gaps).toHaveLength(0);
  });

  it('flags same-day stacking even when the count looks fine', () => {
    const a = assessDiligence([
      att('2026-07-20 15:00:00', 'no_answer', 1), // 09:00 MDT
      att('2026-07-20 23:00:00', 'no_answer', 2), // 17:00 MDT, same MDT day
    ]);
    expect(a.distinctDays).toBe(1);
    expect(a.largestGapDays).toBe(0);
    expect(a.gaps).toContain('All attempts on the same day — courts expect reasonable intervals.');
  });

  it('summarises for the chip', () => {
    const a = assessDiligence([
      att('2026-07-20 15:00:00', 'no_answer', 1),
      att('2026-07-25 19:00:00', 'no_answer', 2),
    ]);
    expect(diligenceSummary(a)).toBe('2 attempts · 2 bands · weekend');
    expect(diligenceSummary(assessDiligence([]))).toBe('No attempts');
  });
});
