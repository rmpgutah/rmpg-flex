// ============================================================
// Server-side evidence-lock check — must match client/src/utils/evidenceLock.ts
// ============================================================
// The 2026-06-21 follow-up audit caught that the client-only retention
// guard in PR #1476 was bypassable with one curl DELETE — admin/manager
// sessions could destroy locked evidence by going around the modal.
// This file gives every server DELETE handler a single source of truth
// for "is this record currently on hold?"

export const EVIDENCE_HOLD_VALUES: ReadonlySet<string> = new Set([
  'legal_hold',
  'court_hold',
  'ia_review',
  'open_case',
  'litigation_hold',
  'subpoena_hold',
]);

export function isEvidenceLocked(retentionStatus: unknown): boolean {
  if (retentionStatus == null) return false;
  return EVIDENCE_HOLD_VALUES.has(String(retentionStatus).toLowerCase().trim());
}
