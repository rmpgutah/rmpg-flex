// ============================================================
// Evidence-lock — positive hold-list check shared by client + server
// ============================================================
// The 2026-06-21 follow-up audit caught a vocabulary mismatch in PR #1476:
//
//   • Client `VideoRetention` was declared as
//     `'active' | 'archived' | 'pending_deletion'`.
//   • Server's retention dashboard
//     (src/routes/personnel/bodyCameras.ts:327-330) writes/reports
//     `'active' | 'expired' | 'purged'` and explicitly treats `expired`
//     as `eligible_for_purge` (the retention period elapsed →
//     destruction is lawful, in fact mandated).
//
// The original guard was a NEGATIVE check ("anything != 'active' is
// locked"), which therefore blocked the exact lawful destruction the
// retention workflow exists to complete. Worse, an admin could still
// destroy a video on legal hold via curl because the entire guard was
// client-side.
//
// Fix: replace with a POSITIVE hold-list. Only retention values that
// indicate an active legal/IA/court hold lock the row. Any other value
// — `active`, `expired`, `archived`, `purged`, `pending_deletion`,
// undefined, unknown — stays deletable from the UI. The server gets the
// same list at src/utils/evidenceLock.ts so the rule lives in one
// vocabulary on both sides.

/** Values that mean "this video / record carries an active hold and
 *  must NOT be destroyed from the UI." Anything not in this set is
 *  treated as eligible for the lawful destruction workflow. */
export const EVIDENCE_HOLD_VALUES = new Set<string>([
  'legal_hold',
  'court_hold',
  'ia_review',
  'open_case',
  'litigation_hold',
  'subpoena_hold',
]);

export function isEvidenceLocked(retentionStatus?: string | null): boolean {
  if (!retentionStatus) return false;
  return EVIDENCE_HOLD_VALUES.has(String(retentionStatus).toLowerCase().trim());
}

/** Human-readable explanation for the modal's red Locked notice. */
export function evidenceLockReason(retentionStatus?: string | null): string | undefined {
  if (!retentionStatus) return undefined;
  const v = String(retentionStatus).toLowerCase().trim();
  switch (v) {
    case 'legal_hold': return 'Under legal hold — destruction is blocked until counsel releases the hold.';
    case 'court_hold': return 'Under court-issued preservation order.';
    case 'litigation_hold': return 'Under active litigation hold.';
    case 'subpoena_hold': return 'Held under subpoena.';
    case 'ia_review': return 'Under Internal Affairs review.';
    case 'open_case': return 'Linked to an open case — close the case first.';
    default: return undefined;
  }
}
