// Canonical warrant lifecycle. Matches WarrantsPage.tsx's Warrant['status']
// TS union exactly (client/src/pages/WarrantsPage.tsx:56) — do not add a
// 6th value without updating the frontend type in lockstep.
//
// archived_at (a separate warrants column) is an orthogonal soft-delete
// flag, not part of this state machine — a warrant can be archived from
// any status.

export type WarrantStatus = 'active' | 'served' | 'recalled' | 'expired' | 'quashed';

export const WARRANT_STATUSES: readonly WarrantStatus[] = [
  'active', 'served', 'recalled', 'expired', 'quashed',
] as const;

// served/recalled/expired/quashed are terminal: reachable from active (or
// from each other only via the same value, i.e. a no-op re-save), and the
// only way back to active is the explicit /reopen endpoint — never a plain
// PUT /:id status-field edit.
export const TERMINAL_STATUSES: ReadonlySet<WarrantStatus> = new Set([
  'served', 'recalled', 'expired', 'quashed',
]);

export function isValidStatus(value: unknown): value is WarrantStatus {
  return typeof value === 'string' && (WARRANT_STATUSES as readonly string[]).includes(value);
}

// Allowed transitions for PUT /:id and the dedicated action routes:
//   - staying on the same status is always allowed (a plain field edit
//     that happens to re-send the current status)
//   - active -> any of the 4 terminal statuses
//   - a terminal status -> active is NOT allowed here; that's /reopen's job
//   - a terminal status -> a different terminal status is not allowed;
//     the operator must reopen first, then re-transition
export function isValidTransition(from: WarrantStatus, to: WarrantStatus): boolean {
  if (from === to) return true;
  if (from === 'active') return TERMINAL_STATUSES.has(to);
  return false;
}

// ── Auto-expiry ───────────────────────────────────────────────────────────
// Design spec (2026-07-21 warrant-tab-backend-rebuild): any active warrant
// past its expires_at should transition to 'expired' — via a lazy check on
// read (GET /, GET /:id) plus a light cron tick, so records expire even if
// nobody reads them. active -> expired is a valid transition per the state
// machine above.

/**
 * Runs the single sweep UPDATE against D1: any warrant still 'active' whose
 * expires_at has passed flips to 'expired'. Pure "run this against env.DB"
 * shape so it's usable from both the lazy-read helper below and the cron
 * tick in src/index.ts. Returns the number of rows flipped.
 */
export async function expireOverdueWarrants(db: D1Database): Promise<number> {
  // expires_at is usually DATE-ONLY ('YYYY-MM-DD', from the warrant form's
  // <input type="date">). A raw lexical `expires_at < datetime('now')` flipped
  // a warrant to expired at 00:00 UTC ON its expiry date — the previous
  // evening in Denver. A warrant is valid THROUGH its expiry date, so
  // date-only values expire at the start of the following day.
  const result = await db.prepare(
    `UPDATE warrants SET status = 'expired', updated_at = datetime('now')
     WHERE status = 'active' AND expires_at IS NOT NULL
       AND (CASE WHEN length(expires_at) = 10
                 THEN datetime(expires_at, '+1 day')
                 ELSE datetime(expires_at) END) <= datetime('now')`,
  ).run();
  return result.meta?.changes ?? 0;
}

/**
 * Lazy-check helper for GET /warrants and GET /warrants/:id: given the rows
 * about to be returned to the client, flips any overdue-active row to
 * 'expired' in D1 AND mutates the in-memory row so the HTTP response is
 * never stale relative to the write. Only touches rows that actually need
 * it (single UPDATE per overdue id, scoped to just the current page) —
 * cheap for list/detail response sizes and avoids a full-table sweep on
 * every read.
 */
export async function applyLazyWarrantExpiry(
  db: D1Database,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const now = Date.now();
  const overdue = rows.filter((r) => {
    if (r.status !== 'active') return false;
    const expiresAt = r.expires_at;
    if (typeof expiresAt !== 'string' || !expiresAt) return false;
    let ms = Date.parse(expiresAt);
    // Date-only values are valid through the expiry date (see sweep above).
    if (expiresAt.length === 10) ms += 86_400_000;
    return !Number.isNaN(ms) && ms < now;
  });
  if (!overdue.length) return;
  for (const row of overdue) {
    try {
      await db.prepare(
        `UPDATE warrants SET status = 'expired', updated_at = datetime('now')
         WHERE id = ? AND status = 'active' AND expires_at IS NOT NULL
           AND (CASE WHEN length(expires_at) = 10
                     THEN datetime(expires_at, '+1 day')
                     ELSE datetime(expires_at) END) <= datetime('now')`,
      ).bind(row.id).run();
      row.status = 'expired';
    } catch {
      // Non-fatal: if the write fails, leave the row's status as-read rather
      // than lying about a state change that didn't land in D1.
    }
  }
}
