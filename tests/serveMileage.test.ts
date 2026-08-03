import { describe, it, expect } from 'vitest';
import { computeOfficerMileageSegments, computeMileageForQueue, computeOfficerMileageForDay, haversineMiles } from '../src/utils/serveMileage';

// In-memory fake D1: enough of the query() surface for these tests. Mirrors
// the fake used by other serveBillingEnhanced tests in this repo (a plain
// object with a `prepare().bind().all()` chain that `query()`/`queryFirst()`
// in src/utils/db.ts call into).
function fakeDb(tables: { serve_attempts?: any[]; gps_breadcrumbs?: any[] }) {
  return {
    prepare(sql: string) {
      const isAttempts = sql.includes('FROM serve_attempts');
      return {
        bind(..._args: unknown[]) {
          return {
            all: async () => ({
              results: isAttempts ? (tables.serve_attempts ?? []) : (tables.gps_breadcrumbs ?? []),
            }),
          };
        },
      };
    },
  } as any;
}

describe('haversineMiles', () => {
  it('is zero for identical points', () => {
    expect(haversineMiles(40.76, -111.89, 40.76, -111.89)).toBeCloseTo(0, 5);
  });

  it('matches a known distance (Salt Lake City to Provo, ~43 miles)', () => {
    const d = haversineMiles(40.7608, -111.8910, 40.2338, -111.6585);
    expect(d).toBeGreaterThan(35);
    expect(d).toBeLessThan(50);
  });
});

describe('computeOfficerMileageSegments — cross-job double counting', () => {
  it('does not double-count breadcrumbs shared by two overlapping-window attempts', async () => {
    // Officer drives a continuous line: 4 points, ~1 mile apart each (~3 mi total).
    // Two attempts on DIFFERENT serve_queue_id, 30 minutes apart — well inside
    // the old +2h window, so the old code would have summed the whole 3-mile
    // trail into BOTH jobs (6mi billed for 3mi driven). The fix must split
    // the trail so the two jobs' totals sum to the trail total, not double it.
    const db = fakeDb({
      serve_attempts: [
        { id: 1, serve_queue_id: 100, attempt_at: '2026-08-01 09:00:00' },
        { id: 2, serve_queue_id: 200, attempt_at: '2026-08-01 09:30:00' },
      ],
      gps_breadcrumbs: [
        { latitude: 40.7000, longitude: -111.8900, recorded_at: '2026-08-01 08:50:00' },
        { latitude: 40.7150, longitude: -111.8900, recorded_at: '2026-08-01 09:05:00' },
        { latitude: 40.7300, longitude: -111.8900, recorded_at: '2026-08-01 09:20:00' },
        { latitude: 40.7450, longitude: -111.8900, recorded_at: '2026-08-01 09:40:00' },
        { latitude: 40.7600, longitude: -111.8900, recorded_at: '2026-08-01 09:45:00' },
      ],
    });

    const segments = await computeOfficerMileageSegments(
      db, 7, '2026-08-01 00:00:00', '2026-08-01 23:59:59',
    );

    const job100 = segments.find(s => s.serveQueueId === 100)!;
    const job200 = segments.find(s => s.serveQueueId === 200)!;

    // Attributable trail = the hops whose BOTH endpoints sit inside a single
    // segment's window. The 08:50->09:05 hop is the commute to the first stop
    // and the 09:20->09:40 hop straddles the 09:30 segment boundary, so
    // neither is attributed (see serveMileage.ts header).
    const attributableTrail =
      haversineMiles(40.7150, -111.8900, 40.7300, -111.8900) + // job100, inside 09:00-09:30
      haversineMiles(40.7450, -111.8900, 40.7600, -111.8900);  // job200, inside 09:30-11:30

    // The two jobs' totals must sum to the attributable trail (never double
    // it) — this is the assertion that fails against the old +-2h-window
    // code, which gave job100 the FULL trail (all points fall inside its
    // window) and job200 a partial re-count of the same points.
    expect(job100.miles + job200.miles).toBeCloseTo(attributableTrail, 5);
    expect(job100.miles).toBeGreaterThan(0);
    expect(job200.miles).toBeGreaterThan(0);
  });

  it('excludes breadcrumbs before the first attempt and after the last', async () => {
    const db = fakeDb({
      serve_attempts: [
        { id: 1, serve_queue_id: 100, attempt_at: '2026-08-01 09:00:00' },
      ],
      gps_breadcrumbs: [
        // Before the attempt: the commute to the first job of the day.
        { latitude: 40.60, longitude: -111.90, recorded_at: '2026-08-01 08:00:00' },
        { latitude: 40.70, longitude: -111.90, recorded_at: '2026-08-01 08:59:00' },
        // After the attempt's 2h cap: unrelated later driving.
        { latitude: 40.80, longitude: -111.90, recorded_at: '2026-08-01 12:00:00' },
      ],
    });

    const segments = await computeOfficerMileageSegments(
      db, 7, '2026-08-01 00:00:00', '2026-08-01 23:59:59',
    );

    expect(segments).toHaveLength(1);
    expect(segments[0].miles).toBe(0);
  });

  it('excludes the commute hop that ends inside the first attempt window', async () => {
    // The 08:50 -> 09:05 hop is the officer's drive TO the first stop: `curr`
    // is inside the window but `prev` predates attempt_at, so the whole hop
    // is unattributed. Only the 09:05 -> 09:20 movement is billed.
    const db = fakeDb({
      serve_attempts: [
        { id: 1, serve_queue_id: 100, attempt_at: '2026-08-01 09:00:00' },
      ],
      gps_breadcrumbs: [
        { latitude: 40.6000, longitude: -111.8900, recorded_at: '2026-08-01 08:50:00' },
        { latitude: 40.7000, longitude: -111.8900, recorded_at: '2026-08-01 09:05:00' },
        { latitude: 40.7100, longitude: -111.8900, recorded_at: '2026-08-01 09:20:00' },
      ],
    });

    const segments = await computeOfficerMileageSegments(
      db, 7, '2026-08-01 00:00:00', '2026-08-01 23:59:59',
    );

    expect(segments).toHaveLength(1);
    expect(segments[0].miles).toBeCloseTo(
      haversineMiles(40.7000, -111.8900, 40.7100, -111.8900),
      5,
    );
  });
});

describe('error propagation vs. fail-open billing', () => {
  // A fakeDb whose gps_breadcrumbs query throws, while serve_attempts works.
  function failingBreadcrumbsDb() {
    return {
      prepare(sql: string) {
        if (sql.includes('FROM gps_breadcrumbs')) {
          throw new Error('D1_ERROR: no such table: gps_breadcrumbs');
        }
        const isAttempts = sql.includes('FROM serve_attempts');
        return {
          bind(..._args: unknown[]) {
            return {
              all: async () => ({
                results: isAttempts
                  ? [{ id: 1, serve_queue_id: 100, officer_id: 7, attempt_at: '2026-08-01 09:00:00', day: '2026-08-01' }]
                  : [],
              }),
            };
          },
        };
      },
    } as any;
  }

  it('computeOfficerMileageSegments propagates a breadcrumb query failure', async () => {
    await expect(
      computeOfficerMileageSegments(failingBreadcrumbsDb(), 7, '2026-08-01 00:00:00', '2026-08-01 23:59:59'),
    ).rejects.toThrow();
  });

  it('computeOfficerMileageForDay propagates the same failure (so /stats/summary can show null)', async () => {
    await expect(
      computeOfficerMileageForDay(failingBreadcrumbsDb(), 7, '2026-08-01'),
    ).rejects.toThrow();
  });

  it('computeMileageForQueue fails open and still returns a number', async () => {
    const total = await computeMileageForQueue(failingBreadcrumbsDb(), 100);
    expect(typeof total).toBe('number');
    expect(total).toBe(0);
  });
});

describe('computeMileageForQueue — unchanged for a single-attempt job', () => {
  it('matches the sum of consecutive-breadcrumb distances inside attempt_at -> +2h', async () => {
    const db = fakeDb({
      serve_attempts: [
        { id: 1, serve_queue_id: 100, officer_id: 7, attempt_at: '2026-08-01 09:00:00', day: '2026-08-01' },
      ],
      gps_breadcrumbs: [
        { latitude: 40.70, longitude: -111.89, recorded_at: '2026-08-01 09:05:00' },
        { latitude: 40.71, longitude: -111.89, recorded_at: '2026-08-01 09:30:00' },
        { latitude: 40.72, longitude: -111.89, recorded_at: '2026-08-01 09:50:00' },
      ],
    });

    const total = await computeMileageForQueue(db, 100);
    const expected =
      haversineMiles(40.70, -111.89, 40.71, -111.89) +
      haversineMiles(40.71, -111.89, 40.72, -111.89);

    expect(total).toBeCloseTo(expected, 5);
  });
});

describe('computeOfficerMileageForDay', () => {
  it('sums every job segment for the officer that day', async () => {
    const db = fakeDb({
      serve_attempts: [
        { id: 1, serve_queue_id: 100, attempt_at: '2026-08-01 09:00:00' },
        { id: 2, serve_queue_id: 200, attempt_at: '2026-08-01 11:00:00' },
      ],
      gps_breadcrumbs: [
        { latitude: 40.70, longitude: -111.89, recorded_at: '2026-08-01 09:10:00' },
        { latitude: 40.71, longitude: -111.89, recorded_at: '2026-08-01 09:20:00' },
        { latitude: 40.72, longitude: -111.89, recorded_at: '2026-08-01 11:10:00' },
        { latitude: 40.73, longitude: -111.89, recorded_at: '2026-08-01 11:20:00' },
      ],
    });

    const total = await computeOfficerMileageForDay(db, 7, '2026-08-01');
    // Only the edges wholly inside one attempt's window count. The middle
    // edge (09:20 -> 11:10) straddles the job-1/job-2 boundary and is
    // unattributed, so the daily total is edge 1 + edge 3.
    const expected =
      haversineMiles(40.70, -111.89, 40.71, -111.89) +
      haversineMiles(40.72, -111.89, 40.73, -111.89);

    expect(total).toBeCloseTo(expected, 5);
  });
});
