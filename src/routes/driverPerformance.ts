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
import { computeScore, MIN_EXPOSURE_MILES, SCORE_VERSION, SCORING_ENABLED } from '../utils/driverPerformance/score';
import { rollupDay } from '../utils/driverPerformance/rollup';
import { SPEED_THRESHOLDS } from '../utils/driverPerformance/speedEvents';
import { renderDriverPerformancePdf } from '../utils/driverPerformance/pdf';

const driverPerformance = new Hono<Env>();

const VIEW_ROLES = ['admin', 'manager', 'supervisor', 'human_resources'] as const;
const canView = requireRole(...VIEW_ROLES);

/**
 * Runtime gate on CALL CONTEXT, not on weights. Scoring is technically live
 * (weights approved, SCORE_VERSION 'v1-speed') but a live audit found patrol
 * officers lawfully driving code-3 have no way to be excluded — the fields
 * that would do it (`current_call_id`, `unit_status`) are populated in ZERO
 * of 91,382 live gps_breadcrumbs rows. Publishing a score computed without
 * that exclusion risks a false accusation against a named officer, so this
 * gate runs on every read path until SCORING_ENABLED flips (see
 * src/utils/driverPerformance/score.ts for the two preconditions).
 *
 * Follows the house not_configured convention: 200 with ok:false and a code,
 * never a 503, so the client can render an explanatory banner instead of an
 * error state.
 *
 * ⚠️ MUST be called AFTER `canView` at every mount site below, never before.
 * A gate ahead of RBAC would return this 200 to a denied role — client_viewer
 * included — instead of a 403, and would make the RBAC test pass for the
 * wrong reason (never reaching the check it claims to prove).
 */
function callContextGate(c: { json: (o: unknown) => Response }): Response | null {
  if (SCORING_ENABLED) return null;
  return c.json({
    ok: false,
    code: 'awaiting_call_context',
    message: 'Driver performance scoring is unavailable: emergency-response context ' +
      '(current call / unit status) is not yet captured on GPS breadcrumbs, so scores ' +
      'cannot distinguish lawful code-3 driving from violations.',
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
  // An inverted window is not a smaller window — every BETWEEN below matches
  // nothing, so the caller silently receives an empty roster, which reads as
  // "nobody had events" i.e. everybody drove well. Reject it.
  if (from > to) {
    return {
      error: Response.json(
        { error: 'Invalid window: from must not be after to', code: 'INVALID_WINDOW' },
        { status: 400 },
      ),
    };
  }
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
  speed_high: number; speed_very_high: number; speed_extreme: number;
  breadcrumb_samples: number;
  sev_critical: number; sev_high: number; sev_moderate: number; sev_low: number;
  recorded_events: number; inferred_events: number;
  unattributed_events: number;
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
         COALESCE(SUM(d.events_speed_high),0)      AS speed_high,
         COALESCE(SUM(d.events_speed_very_high),0) AS speed_very_high,
         COALESCE(SUM(d.events_speed_extreme),0)   AS speed_extreme,
         COALESCE(SUM(d.breadcrumb_samples),0)     AS breadcrumb_samples,
         COALESCE(SUM(d.events_critical),0)  AS sev_critical,
         COALESCE(SUM(d.events_high),0)      AS sev_high,
         COALESCE(SUM(d.events_moderate),0)  AS sev_moderate,
         COALESCE(SUM(d.events_low),0)       AS sev_low,
         COALESCE(SUM(d.unattributed_events),0) AS unattributed_events,
         COALESCE(SUM(d.attribution_recorded_pct * (
           d.events_speed_high + d.events_speed_very_high + d.events_speed_extreme)),0) AS recorded_events,
         COALESCE(SUM(d.attribution_inferred_pct * (
           d.events_speed_high + d.events_speed_very_high + d.events_speed_extreme)),0) AS inferred_events,
         COALESCE(SUM(d.fuel_cost),0)        AS fuel_cost,
         COALESCE(SUM(d.fuel_gallons),0)     AS fuel_gallons,
         COALESCE(SUM(d.maintenance_cost),0) AS maintenance_cost
    FROM driver_performance_daily d
    LEFT JOIN users u ON u.id = d.officer_id
   WHERE d.perf_date >= ? AND d.perf_date <= ?
   GROUP BY d.officer_id`;

// Exported so query-layer tests can exercise AGG_SQL + shape() directly
// against a real D1, without going through the HTTP route — the route's
// three read endpoints are gated on call context (see callContextGate
// above) and a direct call is the only way left to test this shaping logic
// end-to-end against real data.
export function shape(r: AggRow) {
  const totalEvents = r.recorded_events + r.inferred_events;
  const recordedPct = totalEvents > 0 ? r.recorded_events / totalEvents : 1;
  const computed = computeScore({
    milesDriven: r.miles,
    events: {
      speedHigh: r.speed_high,
      speedVeryHigh: r.speed_very_high,
      speedExtreme: r.speed_extreme,
    },
    recordedPct,
    // ⚠️ Passed through explicitly. Miles come from unit_trips and samples
    // from the MDT feed; miles with zero samples is a dead feed, and a dead
    // feed produces zero events, which scores 100. computeScore refuses to
    // score that case — but only because this number reaches it.
    breadcrumbSamples: r.breadcrumb_samples,
  });
  // Legacy dashcam-era doubt. New snapshots always write 0 here (breadcrumbs
  // are officer-stamped at capture, so there is no unattributed bucket left),
  // but pre-'v1-speed' rows can still carry a non-zero count and must not be
  // reported as confidently clean.
  const unattributed = r.unattributed_events ?? 0;
  const result = computed.status === 'scored' && unattributed > 0
    ? { ...computed, confidence: 'inferred' as const }
    : computed;
  return {
    officer_id: r.officer_id,
    officer_name: r.officer_name,
    badge_number: r.badge_number,
    miles_driven: Math.round(r.miles * 10) / 10,
    drive_minutes: Math.round(r.minutes),
    trip_count: r.trips,
    event_count: r.speed_high + r.speed_very_high + r.speed_extreme,
    events: {
      speed_high: r.speed_high,
      speed_very_high: r.speed_very_high,
      speed_extreme: r.speed_extreme,
    },
    /** GPS samples behind the counts above. 0 with miles > 0 means a dead feed. */
    breadcrumb_samples: r.breadcrumb_samples,
    severity: { critical: r.sev_critical, high: r.sev_high,
                moderate: r.sev_moderate, low: r.sev_low },
    /** Legacy: dashcam-era events that could not be tied to a driver. Always 0 for 'v1-speed' rows. */
    unattributed_events: unattributed,
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
  // a generic "awaiting call context" that never even looked at its input.
  const win = windowFrom(c); if (win.error) return win.error;
  const { from, to } = win;
  const gated = callContextGate(c); if (gated) return gated;
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
      // Published so the UI LABELS the tiers from the same constants that
      // COUNTED them. A client-side "70+ mph" caption over counts derived at
      // an 85 mph floor is a specific, quotable, false claim about a named
      // officer — the drift is invisible precisely because both sides compile.
      speed_thresholds: SPEED_THRESHOLDS,
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
  const gated = callContextGate(c); if (gated) return gated;
  const db = getDb(c.env);
  await ensureDriverPerformanceColumns(db);
  try {
    const agg = await queryFirst<AggRow>(db, `${AGG_SQL} HAVING d.officer_id = ?`, from, to, officerId);
    const daily = await query(
      db,
      `SELECT perf_date, miles_driven, score, score_version,
              attribution_recorded_pct, attribution_inferred_pct,
              unattributed_events, breadcrumb_samples,
              events_speed_high, events_speed_very_high, events_speed_extreme,
              events_critical, events_high, events_moderate, events_low
         FROM driver_performance_daily
        WHERE officer_id = ? AND perf_date >= ? AND perf_date <= ?
        ORDER BY perf_date`,
      officerId, from, to,
    );
    return c.json({
      from, to,
      min_exposure_miles: MIN_EXPOSURE_MILES,
      speed_thresholds: SPEED_THRESHOLDS,
      summary: agg ? shape(agg) : null,
      daily,
    });
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
  const gated = callContextGate(c); if (gated) return gated;
  const db = getDb(c.env);
  await ensureDriverPerformanceColumns(db);
  try {
    const agg = await queryFirst<AggRow>(db, `${AGG_SQL} HAVING d.officer_id = ?`, from, to, officerId);
    if (!agg) return c.json({ error: 'No data for this officer in the window' }, 404);
    const summary = shape(agg);

    // ⚠️ I4 — THE STAMPED VERSION MUST BE THE ONE THAT PRODUCED THE PRINTED
    // NUMBER. This previously read score_version off the LAST STORED SNAPSHOT
    // in the window, while the score on the page is recomputed live by
    // shape()/computeScore under TODAY's weights. Retune the weights and the
    // document would print a new score under an old version string, beneath a
    // footer asserting "Reproducible for this window under this score version"
    // — a false statement on a litigation document.
    const printedVersion = summary.result.status === 'scored'
      ? summary.result.scoreVersion
      : SCORE_VERSION;

    // Separately: the window's stored snapshots may themselves span several
    // score versions (a retune mid-window). Silently picking one hides that
    // the days behind this total were not all computed the same way, so it is
    // stated on the document instead.
    const versionRows = await query<{ v: string }>(
      db,
      `SELECT DISTINCT score_version AS v FROM driver_performance_daily
        WHERE officer_id = ? AND perf_date >= ? AND perf_date <= ?
        ORDER BY score_version`,
      officerId, from, to,
    );
    const storedVersions = versionRows.map((r) => r.v).filter(Boolean);

    const bytes = await renderDriverPerformancePdf({
      summary,
      window: { from, to },
      scoreVersion: printedVersion,
      storedVersions,
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
  // Reuse the SAME validator the GET handlers use. `Date.parse('yesterday')`
  // is NaN, the loop condition `NaN <= NaN` is false, and the handler returned
  // 200 {days: 0} — indistinguishable from a successful no-op recompute.
  if (!isValidCalendarDate(body.from) || !isValidCalendarDate(body.to)) {
    return c.json(
      { error: 'from and to must be real calendar dates in YYYY-MM-DD format', code: 'INVALID_WINDOW' },
      400,
    );
  }
  if (body.from > body.to) {
    return c.json({ error: 'from must not be after to', code: 'INVALID_WINDOW' }, 400);
  }
  // Each day is a SEQUENTIAL full rollup. `from=2000-01-01` would enqueue
  // ~9,500 of them inside one request and blow the Worker's CPU wall long
  // before finishing, leaving a partial recompute with no error.
  const MAX_RECOMPUTE_DAYS = 366;
  const spanDays = Math.round((Date.parse(body.to) - Date.parse(body.from)) / 86400000) + 1;
  if (spanDays > MAX_RECOMPUTE_DAYS) {
    return c.json({
      error: `Window too large: ${spanDays} days requested, maximum is ${MAX_RECOMPUTE_DAYS}`,
      code: 'WINDOW_TOO_LARGE',
      max_days: MAX_RECOMPUTE_DAYS,
    }, 400);
  }
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
