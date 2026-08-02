// ============================================================
// RMPG Flex — Serve mileage attribution (Cloudflare Worker)
// ============================================================
// Single source of truth for GPS-derived process-server mileage. Both the
// billing line-item generator (serveBillingEnhanced.ts) and the officer-
// facing "mileage today" surface (serve.ts /mileage/mine, /stats/summary)
// read from computeOfficerMileageSegments so a client is never billed for
// driving the officer can't also see on their own run.
//
// Segment rule: an officer's gps_breadcrumbs trail for a day is partitioned
// into one segment per serve_attempts row (across ALL that officer's jobs
// that day, not just one), where segment i's window is
//   [attempt[i].attempt_at, min(attempt[i+1].attempt_at, attempt[i].attempt_at + 2h))
// — bounded by whichever comes first: the next attempt (any job) or the
// existing 2-hour cap. This is a strict tightening of the prior
// `attempt_at -> attempt_at + 2h` window (which had no awareness of a
// next attempt), so:
//   - Segments can never overlap -> no breadcrumb is ever double-counted
//     across two jobs (the prior bug: two attempts by the same officer
//     less than 2h apart billed the same driven miles to both clients).
//   - A single-attempt day (nothing to shorten the window) computes
//     identically to the prior behavior.
// Breadcrumbs before the officer's first attempt of the day, or after their
// last attempt's capped window, are not attributed to any job -- getting to
// the first stop of the day isn't "for" that job any more than it's for any
// other, and inventing an attribution rule for it is out of scope here.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query } from './db';

export interface AttemptMileageSegment {
  attemptId: number;
  serveQueueId: number;
  officerId: number;
  attemptAt: string;
  miles: number;
}

/** Haversine distance in miles between two lat/lng points. */
export function haversineMiles(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Compute non-overlapping per-attempt mileage segments for one officer over
 * [from, to] (inclusive TEXT datetimes, same lexical-comparison convention
 * used elsewhere against these UTC-naive `datetime('now')` columns).
 */
export async function computeOfficerMileageSegments(
  db: D1Database,
  officerId: number,
  from: string,
  to: string,
): Promise<AttemptMileageSegment[]> {
  const attempts = await query<{
    id: number;
    serve_queue_id: number;
    attempt_at: string;
  }>(
    db,
    `SELECT id, serve_queue_id, attempt_at
     FROM serve_attempts
     WHERE officer_id = ? AND attempt_at >= ? AND attempt_at <= ?
     ORDER BY attempt_at ASC, id ASC`,
    officerId, from, to,
  ).catch(() => []);

  if (attempts.length === 0) return [];

  const segments: AttemptMileageSegment[] = attempts.map((a) => ({
    attemptId: a.id,
    serveQueueId: a.serve_queue_id,
    officerId,
    attemptAt: a.attempt_at,
    miles: 0,
  }));

  // The next attempt's start (or null for the officer's last attempt of the
  // window) — one operand of segmentEndFor's min(next, +2h cap) below.
  const nextAttemptAt = attempts.map((a, i) =>
    i + 1 < attempts.length ? attempts[i + 1].attempt_at : null,
  );

  const breadcrumbs = await query<{
    latitude: number;
    longitude: number;
    recorded_at: string;
  }>(
    db,
    `SELECT latitude, longitude, recorded_at
     FROM gps_breadcrumbs
     WHERE officer_id = ? AND recorded_at >= ? AND recorded_at <= ?
       AND latitude IS NOT NULL AND longitude IS NOT NULL
     ORDER BY recorded_at ASC`,
    officerId, from, to,
  ).catch(() => []);

  let attemptIdx = 0;

  function cappedEnd(attemptAt: string): string {
    const d = new Date(attemptAt.replace(' ', 'T') + 'Z');
    d.setUTCHours(d.getUTCHours() + 2);
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }

  function segmentEndFor(idx: number): string {
    const next = nextAttemptAt[idx];
    const cap = cappedEnd(attempts[idx].attempt_at);
    if (next === null) return cap;
    return next < cap ? next : cap;
  }

  for (let i = 1; i < breadcrumbs.length; i++) {
    const prev = breadcrumbs[i - 1];
    const curr = breadcrumbs[i];
    const dist = haversineMiles(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    if (dist > 50) continue; // GPS jump guard (device restart / data gap), same as before

    // Advance to the attempt whose window covers curr.recorded_at. A
    // breadcrumb before the officer's first attempt never enters this loop
    // body meaningfully attributed (attemptIdx stays 0 but curr must also be
    // >= attempts[0].attempt_at to be attributed — checked below).
    while (attemptIdx < attempts.length && curr.recorded_at >= segmentEndFor(attemptIdx)) {
      attemptIdx++;
    }
    if (attemptIdx >= attempts.length) break; // past every attempt's window — unattributed, rest is too

    if (curr.recorded_at < attempts[attemptIdx].attempt_at) continue; // curr is before this segment — truly unattributed

    segments[attemptIdx].miles += dist;
  }

  return segments;
}

/** Sum of segments belonging to one serve_queue_id — used by the billing
 *  line-item generator. Scopes the underlying segment computation to every
 *  distinct (officer, day) pair touched by this job, so mileage from a job
 *  reassigned between officers, or spanning multiple attempt dates, is
 *  still computed against each officer's FULL day (preventing the
 *  cross-job double-count this module exists to fix) before filtering
 *  down to just this job's share. */
export async function computeMileageForQueue(
  db: D1Database,
  queueId: number,
): Promise<number> {
  const officerDays = await query<{ officer_id: number; day: string }>(
    db,
    `SELECT DISTINCT officer_id, date(attempt_at) as day
     FROM serve_attempts
     WHERE serve_queue_id = ? AND officer_id IS NOT NULL`,
    queueId,
  ).catch(() => []);

  let total = 0;
  for (const { officer_id, day } of officerDays) {
    const segments = await computeOfficerMileageSegments(
      db, officer_id, `${day} 00:00:00`, `${day} 23:59:59`,
    );
    total += segments
      .filter((s) => s.serveQueueId === queueId)
      .reduce((sum, s) => sum + s.miles, 0);
  }
  return total;
}

/** Sum of every segment for one officer on one calendar day (America/Denver
 *  day boundary handling matches the existing `date(attempt_at) = ?`
 *  convention already used by /stats/summary's other day-bucketed queries
 *  in serve.ts — not fixed here, kept consistent). Powers the daily Stats
 *  aggregate and the officer-facing "mileage today" endpoint. */
export async function computeOfficerMileageForDay(
  db: D1Database,
  officerId: number,
  day: string,
): Promise<number> {
  const segments = await computeOfficerMileageSegments(
    db, officerId, `${day} 00:00:00`, `${day} 23:59:59`,
  );
  return segments.reduce((sum, s) => sum + s.miles, 0);
}
