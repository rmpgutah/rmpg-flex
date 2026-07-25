// ============================================================
// RMPG Flex — canonical calls_for_service status vocabulary
//
// WHY THIS EXISTS
// The "which statuses mean the call is finished" list was duplicated inline
// across ~18 query sites and drifted. Six of them still used the pre-`archived`
// three-status form, which is why the Dashboard reported 96 ACTIVE CALLS on
// 2026-07-24 while the header badge (correctly) reported 0 — all 96 were
// archived. Two spellings of cancelled are also in circulation.
//
// Import from here instead of writing the list inline. A new terminal status
// then needs exactly one edit, and no surface can silently disagree with
// another about what "active" means.
// ============================================================

/**
 * Statuses that mean a call is finished and must NOT count as active.
 *
 * Both `cancelled` and `canceled` are listed deliberately: the codebase has
 * written both spellings over time (see the former local list in
 * `dispatcherAwareness.ts`). Matching both is harmless — a status can only be
 * one of them — and missing one silently inflates every "active" count.
 *
 * `completed` came from a fifth variant found in `reports.ts` during the same
 * audit; no other copy of the list knew about it.
 *
 * This vocabulary is for `calls_for_service` ONLY. The `incidents` and
 * `warrants` tables have their own lifecycles (`served`, `recalled`, `quashed`,
 * …) and must not be filtered with this.
 */
export const TERMINAL_CALL_STATUSES = [
  'cleared',
  'closed',
  'cancelled',
  'canceled',
  'archived',
  'completed',
] as const;

const quoted = TERMINAL_CALL_STATUSES.map((s) => `'${s}'`).join(',');

/**
 * SQL predicate selecting calls that are still active.
 *
 * Uses `COALESCE(status,'')` so a NULL status counts as active rather than
 * being silently dropped by SQL's three-valued logic — a call with no status
 * is a data problem an operator should see, not one the dashboard should hide.
 *
 * @param column — table alias qualified column, e.g. `c.status`. Callers pass a
 *   literal, never user input; this is string interpolation into SQL by design
 *   (D1 cannot bind an IN-list).
 */
export function activeCallFilter(column = 'status'): string {
  return `COALESCE(${column},'') NOT IN (${quoted})`;
}

/** Inverse of {@link activeCallFilter} — calls that are finished. */
export function terminalCallFilter(column = 'status'): string {
  return `COALESCE(${column},'') IN (${quoted})`;
}
