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
