// Driver Performance API — supervisor-only.
//
// ⚠️ RBAC is enforced on the GET handlers directly, NOT left to
// readOnlyRoleGuard, which backstops MUTATIONS only. An ungated GET in this
// codebase is reachable by every authenticated role including client_viewer
// (an external contract client with a login). Leaking named officer risk
// scores to a contract client is the worst failure this route can have.

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, ensureDriverPerformanceColumns } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { log } from '../utils/logger';
import { computeScore, MIN_EXPOSURE_MILES, weightsPendingReview, SCORE_VERSION } from '../utils/driverPerformance/score';
import { rollupDay } from '../utils/driverPerformance/rollup';
import { renderDriverPerformancePdf } from '../utils/driverPerformance/pdf';

const driverPerformance = new Hono<Env>();

const VIEW_ROLES = ['admin', 'manager', 'supervisor', 'human_resources'] as const;
const canView = requireRole(...VIEW_ROLES);

/**
 * Runtime owner gate. While the severity weights are placeholders, no score
 * is served — a number from unreviewed weights is indistinguishable from a
 * reviewed one once it is on a supervisor's screen, and this feature's whole
 * risk is confident wrong numbers about named people.
 *
 * Follows the house not_configured convention: 200 with ok:false and a code,
 * never a 503, so the client can render an explanatory banner instead of an
 * error state.
 */
function weightsGate(c: { json: (o: unknown) => Response }): Response | null {
  if (!weightsPendingReview()) return null;
  return c.json({
    ok: false,
    code: 'weights_pending_review',
    message: 'Driver performance scoring is unavailable: severity weights have not been reviewed and approved by Rocky Mountain Protective Group.',
    score_version: SCORE_VERSION,
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Strict `YYYY-MM-DD` validation, including real-calendar-date rejection
 * (e.g. 2026-13-45). `Date.parse` alone is not enough — it silently rolls
 * an invalid day/month forward (2026-02-30 → 2026-03-02) rather than
 * rejecting it, which would substitute a different window than the one
 * an evidence-grade PDF claims to cover.
 */
function isValidCalendarDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Default window: trailing 30 days. `from`/`to` are caller-controlled query
 * params that flow into a Content-Disposition header (export route) and
 * onto the printed PDF itself — an evidence-grade document that may be read
 * in litigation. Anything not a real `YYYY-MM-DD` date is rejected with a
 * 400 rather than silently substituted, so a caller who passes garbage is
 * told, not quietly given a different window than they asked for.
 */
function windowFrom(
  c: { req: { query: (k: string) => string | undefined } },
): { from: string; to: string; error?: undefined } | { from?: undefined; to?: undefined; error: Response } {
  const toParam = c.req.query('to');
  const fromParam = c.req.query('from');
  if (toParam !== undefined && !isValidCalendarDate(toParam)) {
    return { error: badWindowResponse('to') };
  }
  if (fromParam !== undefined && !isValidCalendarDate(fromParam)) {
    return { error: badWindowResponse('from') };
  }
  const to = toParam || new Date().toISOString().slice(0, 10);
  const from = fromParam
    || new Date(Date.parse(to) - 29 * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

function badWindowResponse(field: 'from' | 'to'): Response {
  return Response.json(
    { error: `Invalid ${field}: must be a real calendar date in YYYY-MM-DD format`, code: 'INVALID_WINDOW' },
    { status: 400 },
  );
}

interface AggRow {
  officer_id: number;
  officer_name: string | null;
  badge_number: string | null;
  miles: number; minutes: number; trips: number;
  fc: number; ld: number; cf: number; hb: number; ha: number; sp: number;
  recorded_events: number; inferred_events: number;
  fuel_cost: number; fuel_gallons: number; maintenance_cost: number;
}

/**
 * Exported (not just used internally) so tests can execute the EXACT SQL the
 * route runs against a real D1, rather than duplicating the string and
 * risking a passing test that verifies nothing about the live query.
 */
export const AGG_SQL = `
  SELECT d.officer_id,
         u.full_name AS officer_name, u.badge_number,
         COALESCE(SUM(d.miles_driven),0)  AS miles,
         COALESCE(SUM(d.drive_minutes),0) AS minutes,
         COALESCE(SUM(d.trip_count),0)    AS trips,
         COALESCE(SUM(d.events_forward_collision),0) AS fc,
         COALESCE(SUM(d.events_lane_departure),0)    AS ld,
         COALESCE(SUM(d.events_close_following),0)   AS cf,
         COALESCE(SUM(d.events_harsh_brake),0)       AS hb,
         COALESCE(SUM(d.events_harsh_accel),0)       AS ha,
         COALESCE(SUM(d.events_speeding),0)          AS sp,
         COALESCE(SUM(d.attribution_recorded_pct * (
           d.events_forward_collision + d.events_lane_departure + d.events_close_following +
           d.events_harsh_brake + d.events_harsh_accel + d.events_speeding)),0) AS recorded_events,
         COALESCE(SUM(d.attribution_inferred_pct * (
           d.events_forward_collision + d.events_lane_departure + d.events_close_following +
           d.events_harsh_brake + d.events_harsh_accel + d.events_speeding)),0) AS inferred_events,
         COALESCE(SUM(d.fuel_cost),0)        AS fuel_cost,
         COALESCE(SUM(d.fuel_gallons),0)     AS fuel_gallons,
         COALESCE(SUM(d.maintenance_cost),0) AS maintenance_cost
    FROM driver_performance_daily d
    LEFT JOIN users u ON u.id = d.officer_id
   WHERE d.perf_date >= ? AND d.perf_date <= ?
   GROUP BY d.officer_id`;

function shape(r: AggRow) {
  const totalEvents = r.recorded_events + r.inferred_events;
  const recordedPct = totalEvents > 0 ? r.recorded_events / totalEvents : 1;
  const result = computeScore({
    milesDriven: r.miles,
    events: {
      forwardCollision: r.fc, laneDeparture: r.ld, closeFollowing: r.cf,
      harshBrake: r.hb, harshAccel: r.ha, speeding: r.sp,
    },
    recordedPct,
  });
  return {
    officer_id: r.officer_id,
    officer_name: r.officer_name,
    badge_number: r.badge_number,
    miles_driven: Math.round(r.miles * 10) / 10,
    drive_minutes: Math.round(r.minutes),
    trip_count: r.trips,
    event_count: r.fc + r.ld + r.cf + r.hb + r.ha + r.sp,
    events: { forward_collision: r.fc, lane_departure: r.ld, close_following: r.cf,
              harsh_brake: r.hb, harsh_accel: r.ha, speeding: r.sp },
    cost: { fuel: r.fuel_cost, fuel_gallons: r.fuel_gallons,
            maintenance: r.maintenance_cost },
    result,
  };
}

// GET /roster — ranked scored officers; insufficient-exposure officers returned
// SEPARATELY so they can never sort to the bottom of a leaderboard.
driverPerformance.get('/roster', canView, async (c) => {
  // Input validation before the (unconditional-once-tripped) business gate,
  // so a malformed request is told what's wrong with it rather than getting
  // a generic "weights pending review" that never even looked at its input.
  const win = windowFrom(c); if (win.error) return win.error;
  const { from, to } = win;
  const gated = weightsGate(c); if (gated) return gated;
  const db = getDb(c.env);
  await ensureDriverPerformanceColumns(db);
  try {
    const rows = await query<AggRow>(db, AGG_SQL, from, to);
    const shaped = rows.map(shape);
    const ranked = shaped
      .filter((s) => s.result.status === 'scored')
      .sort((a, b) => (b.result as { score: number }).score - (a.result as { score: number }).score)
      .map((s, i) => ({ ...s, rank: i + 1 }));
    const insufficient = shaped.filter((s) => s.result.status === 'insufficient_data');
    return c.json({
      from, to,
      min_exposure_miles: MIN_EXPOSURE_MILES,
      ranked,
      insufficient_data: insufficient,
    });
  } catch (err) {
    // Never return an empty roster on error — an empty list reads as
    // "nobody had events", i.e. everyone drove well.
    log.error('driver-performance roster failed', { from, to }, err as Error);
    return c.json({ error: 'Failed to compute roster', code: 'ROSTER_FAILED' }, 500);
  }
});

driverPerformance.get('/officer/:id', canView, async (c) => {
  const officerId = Number(c.req.param('id'));
  if (!Number.isInteger(officerId)) return c.json({ error: 'Invalid officer id' }, 400);
  const win = windowFrom(c); if (win.error) return win.error;
  const { from, to } = win;
  const gated = weightsGate(c); if (gated) return gated;
  const db = getDb(c.env);
  await ensureDriverPerformanceColumns(db);
  try {
    const agg = await queryFirst<AggRow>(db, `${AGG_SQL} HAVING d.officer_id = ?`, from, to, officerId);
    const daily = await query(
      db,
      `SELECT perf_date, miles_driven, score, score_version,
              attribution_recorded_pct, attribution_inferred_pct
         FROM driver_performance_daily
        WHERE officer_id = ? AND perf_date >= ? AND perf_date <= ?
        ORDER BY perf_date`,
      officerId, from, to,
    );
    return c.json({ from, to, min_exposure_miles: MIN_EXPOSURE_MILES, summary: agg ? shape(agg) : null, daily });
  } catch (err) {
    log.error('driver-performance officer detail failed', { officerId, from, to }, err as Error);
    return c.json({ error: 'Failed to load officer detail', code: 'DETAIL_FAILED' }, 500);
  }
});

// GET /officer/:id/export — evidence-grade PDF snapshot. Liability lens: this
// document may outlive the session that generated it and be read by someone
// who never saw the UI (insurer, counsel). Every element that affects
// interpretation — window, score_version, attribution confidence, generation
// time — is stamped on the page, and the unscored case is handled explicitly
// (see renderDriverPerformancePdf) rather than printing a bare/blank score.
driverPerformance.get('/officer/:id/export', canView, async (c) => {
  const officerId = Number(c.req.param('id'));
  if (!Number.isInteger(officerId)) return c.json({ error: 'Invalid officer id' }, 400);
  const win = windowFrom(c); if (win.error) return win.error;
  const { from, to } = win;
  const gated = weightsGate(c); if (gated) return gated;
  const db = getDb(c.env);
  await ensureDriverPerformanceColumns(db);
  try {
    const agg = await queryFirst<AggRow>(db, `${AGG_SQL} HAVING d.officer_id = ?`, from, to, officerId);
    if (!agg) return c.json({ error: 'No data for this officer in the window' }, 404);
    const summary = shape(agg);
    const versionRow = await queryFirst<{ v: string }>(
      db,
      `SELECT score_version AS v FROM driver_performance_daily
        WHERE officer_id = ? AND perf_date >= ? AND perf_date <= ?
        ORDER BY perf_date DESC LIMIT 1`,
      officerId, from, to,
    );
    const bytes = await renderDriverPerformancePdf({
      summary,
      window: { from, to },
      scoreVersion: versionRow?.v ?? SCORE_VERSION,
      generatedAt: new Date().toISOString(),
      organization: 'Rocky Mountain Protective Group',
    });
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="driver-performance-${officerId}-${from}-to-${to}.pdf"`,
      },
    });
  } catch (err) {
    log.error('driver-performance export failed', { officerId, from, to }, err as Error);
    return c.json({ error: 'Failed to generate export', code: 'EXPORT_FAILED' }, 500);
  }
});

driverPerformance.post('/recompute', requireRole('admin'), async (c) => {
  const db = getDb(c.env);
  await ensureDriverPerformanceColumns(db);
  const body = await c.req.json<{ from?: string; to?: string }>().catch(() => ({} as { from?: string; to?: string }));
  if (!body.from || !body.to) return c.json({ error: 'from and to are required' }, 400);
  const days: string[] = [];
  for (let t = Date.parse(body.from); t <= Date.parse(body.to); t += 86400000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  let processed = 0, failures = 0;
  for (const d of days) {
    const r = await rollupDay(db, d);
    processed += r.officersProcessed;
    failures += r.failures;
  }
  return c.json({ days: days.length, officers_processed: processed, failures });
});

export default driverPerformance;
