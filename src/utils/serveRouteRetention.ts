/**
 * serve_routes retention sweep.
 *
 * `POST /api/process-server/routes` is APPEND-ONLY by design: every time an
 * operator re-plans a day (a rush job lands, an address gets corrected, a stop
 * is dropped) a new row is written rather than overwriting the previous plan.
 * That history is the point — it is what lets RMPG show how a day's run
 * actually evolved when defending diligence, rather than only the final state.
 *
 * The cost is unbounded growth: a heavily re-planned day can leave a dozen rows
 * for one officer, and readers take the newest row (ORDER BY id DESC).
 *
 * This sweep collapses that cost WITHOUT ever discarding what was run:
 *
 *   - The newest row per (officer_id, route_date) is kept FOREVER. That row is
 *     the plan of record for the day and is what every reader resolves to.
 *   - Superseded intra-day revisions are deleted only once the date is older
 *     than REVISION_RETENTION_DAYS, by which point the revision history has
 *     stopped being operationally useful.
 *
 * Deliberately NOT a blanket "delete rows older than N days": that would
 * destroy the plan of record for old dates, which is exactly the artifact a
 * diligence challenge asks for and which may be years old.
 */

/** Keep every intra-day revision this recent. Beyond it, only the plan of record survives. */
export const REVISION_RETENTION_DAYS = 90;

export interface ServeRouteRetentionResult {
  /** Superseded revision rows deleted. */
  deleted: number;
  /** Cutoff date (inclusive-exclusive: rows with route_date < this were eligible). */
  cutoff: string;
}

/**
 * Delete superseded serve_routes revisions older than the cutoff.
 *
 * `nowMs` is injectable so tests don't depend on the wall clock — and because
 * `Date.now()` is unavailable inside workflow scripts.
 */
export async function sweepServeRouteRevisions(
  db: D1Database,
  nowMs: number = Date.now(),
  retentionDays: number = REVISION_RETENTION_DAYS,
): Promise<ServeRouteRetentionResult> {
  const cutoff = new Date(nowMs - retentionDays * 86400000).toISOString().slice(0, 10);

  // Keep the MAX(id) per (officer_id, route_date) — the plan of record — and
  // drop the rest for dates before the cutoff.
  //
  // NOT expressed as a correlated `id NOT IN (SELECT MAX(id) ...)` over the
  // whole table: that subquery is unbounded and would be re-evaluated per row.
  // The GROUP BY form is a single scan of the eligible partition, and it stays
  // clear of D1's 100-bound-parameter cap because the id list never crosses the
  // SQL/JS boundary — it is computed inside the statement. (See the D1 param-cap
  // notes in CLAUDE.md: any IN-list built from a JS array is a latent failure
  // that only shows up once real data crosses 100 rows.)
  const res = await db.prepare(
    `DELETE FROM serve_routes
      WHERE route_date IS NOT NULL
        AND route_date < ?
        AND id NOT IN (
          SELECT MAX(id) FROM serve_routes
           WHERE route_date IS NOT NULL AND route_date < ?
           GROUP BY officer_id, route_date
        )`,
  ).bind(cutoff, cutoff).run();

  return { deleted: res.meta?.changes ?? 0, cutoff };
}
