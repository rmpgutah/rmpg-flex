/**
 * Single source of truth for "is this call still on the active board?".
 *
 * This list used to live as a module-private const in dispatcherAwareness.ts
 * while six other queries hand-rolled their own shorter version. The 2026-07-24
 * live audit found the consequence: /api/reports/dashboard reported
 * `activeCalls: 96` while its own `callsByStatus` showed all 96 rows were
 * status='archived'. The main CAD dashboard was showing a dispatcher 96 phantom
 * active calls, a fake P2/P3/P4 breakdown, and an avg-response figure computed
 * from archived records — because those queries excluded only
 * ('cleared','closed','cancelled') and forgot 'archived'.
 *
 * Anything that needs "active calls" MUST use this module. Do not re-inline a
 * status list.
 */

/** Statuses that mean a call is no longer on the active board. */
export const CLOSED_CALL_STATUSES = [
  'closed',
  'cleared',
  'archived',
  // Both spellings occur in live data.
  'cancelled',
  'canceled',
  // reports.ts's KPI queries (`active_calls`, the recent-calls list) carried
  // their own longer variant that alone excluded 'completed'. Folding those
  // call sites into this module would have silently started counting completed
  // calls as active, so the status belongs here rather than being dropped.
  'completed',
] as const;

/** A plain column reference: `status` or `alias.status`. Nothing else. */
const COLUMN_REF = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

const QUOTED = CLOSED_CALL_STATUSES.map((s) => `'${s}'`).join(',');

/**
 * SQL predicate selecting calls that are still active.
 *
 * Interpolated directly into query strings, so it is built only from the fixed
 * literals above — never from caller input. `column` is validated against
 * COLUMN_REF so this can't become an injection seam if a future caller passes
 * something request-derived.
 *
 * The COALESCE is load-bearing, not decoration. SQL uses three-valued logic:
 * for a row with `status IS NULL`, `status NOT IN ('closed', …)` evaluates to
 * NULL rather than TRUE, so the row satisfies neither this predicate nor its
 * negation and silently disappears from BOTH the active and the closed counts.
 * A call with no status is a data problem a dispatcher should see on the board,
 * not one the dashboard should hide. Coalescing to '' makes such a row count as
 * active, which surfaces it.
 */
export function activeCallWhere(column = 'status'): string {
  if (!COLUMN_REF.test(column)) {
    throw new Error(`activeCallWhere: unsafe column reference ${JSON.stringify(column)}`);
  }
  return `COALESCE(${column},'') NOT IN (${QUOTED})`;
}

/** Convenience constant for the common unqualified `status` case. */
export const ACTIVE_CALL_WHERE = activeCallWhere();
