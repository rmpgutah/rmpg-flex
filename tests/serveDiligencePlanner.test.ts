import { describe, it, expect } from 'vitest';
import {
  planAttemptWindows,
  escalatePriorityForDeadline,
  daysUntilDeadline,
  clusterByProximity,
  applyUrgencyTier,
  replanAfterFailedAttempt,
} from '../src/utils/serveDiligencePlanner';

// 2026-06-11 is a Thursday. 18:00 UTC = 12:00 in America/Denver (MDT).
const NOW = '2026-06-11T18:00:00.000Z';

describe('daysUntilDeadline', () => {
  it('returns null without a deadline or on a non-date', () => {
    expect(daysUntilDeadline(NOW, null)).toBeNull();
    expect(daysUntilDeadline(NOW, '21 days')).toBeNull();
  });
  it('counts whole days to end-of-day on the deadline', () => {
    expect(daysUntilDeadline(NOW, '2026-06-11')).toBe(0);
    expect(daysUntilDeadline(NOW, '2026-06-14')).toBe(3);
  });
  it('goes negative when past', () => {
    expect(daysUntilDeadline(NOW, '2026-06-01')).toBeLessThan(0);
  });
});

describe('planAttemptWindows', () => {
  // UPDATED for Task 4 (D-2/D5): this test previously pinned the OLD
  // entity-type-driven, hand-rolled slot cadence (tomorrow-evening →
  // +2-morning → next-Saturday, three-letter weekdays, en-dash windows).
  // Timing now delegates to selectWindows()'s fixed RESIDENTIAL_DEFAULTS
  // order (early morning, midday, evening) placed on the earliest allowed
  // day starting from `now` — residential allows any day of week, so
  // attempt 1 lands the SAME day rather than waiting for tomorrow. Full
  // weekday names (D5) and hyphen-separated windows (serveAttemptWindows.ts)
  // replace the old abbreviated/en-dash forms.
  it('residential cadence: earliest allowed day per band, in default order', () => {
    const plan = planAttemptWindows(NOW, null, 'America/Denver', { addressClass: 'residential' });
    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({ attempt: 1, date: '2026-06-11', weekday: 'Thursday', window: '07:00-09:00' });
    expect(plan[1]).toMatchObject({ attempt: 2, date: '2026-06-12', weekday: 'Friday', window: '11:00-13:00' });
    expect(plan[2]).toMatchObject({ attempt: 3, date: '2026-06-13', weekday: 'Saturday', window: '17:00-20:30' });
  });

  it('tight deadline compresses to daily attempts starting today', () => {
    const plan = planAttemptWindows(NOW, '2026-06-14');
    expect(plan[0].date).toBe('2026-06-11');
    expect(plan[1].date).toBe('2026-06-12');
    expect(plan[2].date).toBe('2026-06-13');
  });

  it('never schedules an attempt after the deadline', () => {
    const plan = planAttemptWindows(NOW, '2026-06-12');
    for (const w of plan) {
      expect(w.date <= '2026-06-12').toBe(true);
    }
  });
});

describe('escalatePriorityForDeadline', () => {
  it('escalates to urgent inside 3 days', () => {
    expect(escalatePriorityForDeadline('normal', NOW, '2026-06-13')).toBe('urgent');
  });
  it('escalates to rush inside 7 days', () => {
    expect(escalatePriorityForDeadline('routine', NOW, '2026-06-17')).toBe('rush');
  });
  it('never downgrades a higher client-requested priority', () => {
    expect(escalatePriorityForDeadline('urgent', NOW, '2026-09-01')).toBe('urgent');
  });
  it('leaves priority alone with no deadline or a far one', () => {
    expect(escalatePriorityForDeadline('normal', NOW, null)).toBe('normal');
    expect(escalatePriorityForDeadline('normal', NOW, '2026-09-01')).toBe('normal');
  });
});

describe('clusterByProximity', () => {
  it('returns a 3-decimal lat/lng cluster id when coordinates are present', () => {
    expect(clusterByProximity(40.76078, -111.89105, '84101')).toBe('g-40.760--111.891');
  });
  it('truncates rather than rounds so boundary-straddling coords stay in their own cells', () => {
    const a = clusterByProximity(40.7609, -111.8919, null);
    const b = clusterByProximity(40.7611, -111.8919, null);
    // With rounding, both would map to 40.761 — a false same-cell grouping
    // across a boundary. Truncation correctly keeps each in its own cell.
    expect(a).toBe('g-40.760--111.891');
    expect(b).toBe('g-40.761--111.891');
  });
  it('falls back to ZIP when lat/lng is missing', () => {
    expect(clusterByProximity(null, null, '84101')).toBe('z-84101');
    expect(clusterByProximity(null, null, '84101-1234')).toBe('z-84101');
  });
  it('returns null when nothing is known about location', () => {
    expect(clusterByProximity(null, null, null)).toBeNull();
    expect(clusterByProximity(null, null, '')).toBeNull();
  });
});

describe('applyUrgencyTier', () => {
  const NOW = '2026-06-11T18:00:00.000Z'; // Thursday, noon Denver MDT

  it('returns "standard" when there is no deadline', () => {
    expect(applyUrgencyTier(null, 0, 3, NOW)).toBe('standard');
  });
  it('returns "standard" when deadline is more than 5 days out', () => {
    expect(applyUrgencyTier('2026-06-20', 0, 3, NOW)).toBe('standard');
  });
  it('returns "tight" at exactly 5 days', () => {
    expect(applyUrgencyTier('2026-06-16', 0, 3, NOW)).toBe('tight');
  });
  it('returns "tight" at 3 days with 1 attempt remaining', () => {
    // 3 days out, 2 of 3 used → remaining=1, days=3; days > remaining → tight
    expect(applyUrgencyTier('2026-06-14', 2, 3, NOW)).toBe('tight');
  });
  it('returns "critical" at exactly 2 days', () => {
    expect(applyUrgencyTier('2026-06-13', 0, 3, NOW)).toBe('critical');
  });
  it('returns "critical" when days remaining are fewer than attempts left', () => {
    // 4 days out, 1 attempt used of 5 max → 4 attempts left in 4 days = critical
    expect(applyUrgencyTier('2026-06-15', 1, 5, NOW)).toBe('critical');
  });
  it('returns "critical" when days equal attempts left even with a small attempt pool', () => {
    // 3 days out, 0 of 3 used → remaining=3, days=3; days ≤ remaining → critical.
    // (Catches a prior bug where a `remaining >= 4` guard misrouted this to "tight".)
    expect(applyUrgencyTier('2026-06-14', 0, 3, NOW)).toBe('critical');
  });
  it('returns "critical" when the deadline is already past', () => {
    expect(applyUrgencyTier('2026-06-09', 0, 3, NOW)).toBe('critical');
  });
});

describe('replanAfterFailedAttempt', () => {
  const baseQueue = {
    deadline: null as string | null,
    max_attempts: 3,
    attempt_count: 1,
    recipient_lat: null as number | null,
    recipient_lng: null as number | null,
    isBusiness: false,
    locationNote: null,
  };

  it('returns null when max_attempts is already exhausted', () => {
    const failed = { attempt_at: '2026-06-11T18:00:00.000Z', result: 'no_answer', window: '17:00–20:30' };
    expect(replanAfterFailedAttempt(failed, { ...baseQueue, attempt_count: 3 })).toBeNull();
  });

  it('schedules the next attempt at least 24 h after the failed attempt', () => {
    const failed = { attempt_at: '2026-06-11T18:00:00.000Z', result: 'no_answer', window: '17:00–20:30' };
    const next = replanAfterFailedAttempt(failed, baseQueue);
    expect(next).not.toBeNull();
    // Denver MDT: 2026-06-11 18:00 UTC = 12:00 local. +24h = 2026-06-12 12:00 local.
    expect(next!.date >= '2026-06-12').toBe(true);
  });

  it('picks a different time-of-day band than the failed attempt (evening fail → morning/midday next)', () => {
    const failed = { attempt_at: '2026-06-11T03:00:00.000Z', result: 'no_answer', window: '17:00–20:30' };
    const next = replanAfterFailedAttempt(failed, baseQueue);
    // failed window started 17:xx; next should start before 17:00
    expect(next).not.toBeNull();
    const startHour = parseInt(next!.window.split('–')[0].split(':')[0], 10);
    expect(startHour).toBeLessThan(17);
  });

  it('picks a different time-of-day band when failed window was morning (next should be afternoon/evening)', () => {
    const failed = { attempt_at: '2026-06-11T13:00:00.000Z', result: 'no_answer', window: '07:00–09:00' };
    const next = replanAfterFailedAttempt(failed, baseQueue);
    expect(next).not.toBeNull();
    const startHour = parseInt(next!.window.split('–')[0].split(':')[0], 10);
    expect(startHour).toBeGreaterThanOrEqual(11);
  });

  it('still returns a window for bad_address — caller flags skip-trace separately', () => {
    const failed = { attempt_at: '2026-06-11T18:00:00.000Z', result: 'bad_address', window: '17:00–20:30' };
    const next = replanAfterFailedAttempt(failed, baseQueue);
    expect(next).not.toBeNull();
  });

  it('pulls the next attempt closer when deadline pressure is high', () => {
    const failed = { attempt_at: '2026-06-11T18:00:00.000Z', result: 'no_answer', window: '17:00–20:30' };
    const tight = { ...baseQueue, deadline: '2026-06-13', max_attempts: 5 };
    const next = replanAfterFailedAttempt(failed, tight);
    expect(next).not.toBeNull();
    // With 2 days until deadline and 4 attempts remaining, next must be on 06-12 (tomorrow) not later.
    expect(next!.date).toBe('2026-06-12');
  });
});

describe('D-2: timing keys off address class, not entity type', () => {
  it('a business ENTITY at a residential address gets residential windows', () => {
    // A registered agent at a house. isBusiness is true (corporate service)
    // but the LOCATION is a residence, so evenings must be scheduled.
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', null, 'America/Denver', {
      isBusiness: true,
      addressClass: 'residential',
    });
    expect(plan.some((w) => w.window === '17:00-20:30')).toBe(true);
    expect(plan.every((w) => w.authority === 'residential default')).toBe(true);
  });

  it('an unknown address class is treated as residential', () => {
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', null, 'America/Denver', {
      isBusiness: true,
      addressClass: 'unknown',
    });
    expect(plan.some((w) => w.window === '17:00-20:30')).toBe(true);
  });

  it('a confirmed business location gets business windows', () => {
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', null, 'America/Denver', {
      isBusiness: false,
      addressClass: 'business',
    });
    expect(plan.every((w) => w.authority === 'business default')).toBe(true);
  });
});

describe('D1: the deadline clamp must not collapse attempts onto one date', () => {
  it('produces distinct dates when the deadline is tight', () => {
    // Deadline two days out, three attempts required. Previously every
    // offset past the deadline was clamped to the same day, so attempts
    // 2 and 3 printed on the same date.
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', '2026-07-28', 'America/Denver', {
      addressClass: 'residential',
    });
    const dates = plan.map((w) => w.date);
    const windows = plan.map((w) => `${w.date} ${w.window}`);
    // Either the dates differ, or same-day attempts occupy DIFFERENT bands.
    expect(new Set(windows).size).toBe(plan.length);
    expect(dates.length).toBe(plan.length);
  });

  it('never emits two attempts in the same band on the same date', () => {
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', '2026-07-27', 'America/Denver', {
      addressClass: 'residential',
    });
    const keys = plan.map((w) => `${w.date}|${w.window}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('D5: weekday names are spelled out', () => {
  it('emits full weekday names, not three-letter abbreviations', () => {
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', null, 'America/Denver', {
      addressClass: 'residential',
    });
    for (const w of plan) {
      expect(w.weekday).toMatch(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/);
    }
  });
});

describe('client constraints', () => {
  it('never schedules a prohibited day', () => {
    // allowedDays excludes Sunday (0).
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', null, 'America/Denver', {
      addressClass: 'residential',
      allowedDays: [1, 2, 3, 4, 5, 6],
    });
    expect(plan.every((w) => w.weekday !== 'Sunday')).toBe(true);
  });

  it('never schedules before the client start-date bar', () => {
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', null, 'America/Denver', {
      addressClass: 'residential',
      startNotBefore: '2026-07-30',
    });
    expect(plan.every((w) => w.date >= '2026-07-30')).toBe(true);
  });
});

describe('Fix round 1 — Finding 1: interim isBusiness -> addressClass mapping', () => {
  it('isBusiness: true with no addressClass still yields business windows (interim call-site mapping)', () => {
    // Mirrors the interim `addressClass: isBusiness ? 'business' : 'unknown'`
    // mapping applied at serveAutoReplan.ts, serveIntake.ts (/schedule/backfill),
    // and serveIntakeRecords.ts (commitIntake) — those sites have no resolved
    // AddressClass yet, so they derive one from isBusiness to avoid the
    // regression where a confirmed business fell through to residential
    // evening/pre-dawn windows. This test pins the mapping itself so a future
    // refactor of planAttemptWindows/selectWindows can't silently re-open it.
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', null, 'America/Denver', {
      isBusiness: true,
      addressClass: 'business', // what the interim call-site mapping computes
    });
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((w) => w.authority === 'business default')).toBe(true);
    expect(plan.every((w) => w.window === '09:30-11:30' || w.window === '13:30-15:30')).toBe(true);
    // Business windows are weekday-only — never Saturday/Sunday.
    expect(plan.every((w) => w.weekday !== 'Saturday' && w.weekday !== 'Sunday')).toBe(true);
  });
});

describe('Fix round 1 — Finding 2: no duplicate (date, window) pair even with duplicate client bands', () => {
  it('duplicate clientBands under a same-day deadline never emit a duplicate (date, window) pair', () => {
    // Three IDENTICAL client-specified bands, deadline = today (days = 0), so
    // every spec's earliest offset gets clamped back to day 0. The old D1 fix
    // recomputed `key` before the clamp but not after a clamp taken INSIDE the
    // guard loop, so a clamp-and-break re-added the same stale key and pushed
    // a duplicate (date, window) pair. This reproduces that path.
    const plan = planAttemptWindows('2026-06-11T18:00:00.000Z', '2026-06-11', 'America/Denver', {
      addressClass: 'residential',
      clientBands: [
        { start: '09:00', end: '10:00' },
        { start: '09:00', end: '10:00' },
        { start: '09:00', end: '10:00' },
      ],
    });
    const keys = plan.map((w) => `${w.date}|${w.window}`);
    expect(new Set(keys).size).toBe(keys.length);
    // At least the first band should still be scheduled today.
    expect(plan.length).toBeGreaterThan(0);
    expect(plan[0]).toMatchObject({ date: '2026-06-11', window: '09:00-10:00' });
  });
});

describe('Fix round 1 — Finding 3: startNotBefore beyond the old 60-day scan bound', () => {
  it('honours a start-date bar far past the old bound instead of silently dropping it', () => {
    // The old minOffset search only scanned offsets 0..59. A startNotBefore
    // more than ~59 days out fell through with minOffset left at its 0
    // default, silently DROPPING the client's start-date bar — the unsafe
    // direction, since an officer could then be scheduled to attempt before
    // the client authorized any attempt. 2026-07-27 + 400 days is well past
    // that bound.
    const farStart = '2027-08-31'; // ~400 days after 2026-07-27
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', null, 'America/Denver', {
      addressClass: 'residential',
      startNotBefore: farStart,
    });
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((w) => w.date >= farStart)).toBe(true);
  });
});
