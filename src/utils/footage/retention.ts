// src/utils/footage/retention.ts
// Pure helpers behind the FlexCam footage retention sweep. No I/O — the
// orchestrator (captureOrchestrator.purgeExpiredFootage) supplies the rows and
// performs the R2/D1 deletes. Unit-tested in tests/footageRetention.test.ts.

/** Epoch-ms cutoff: rows created before this are past retention. null = keep forever. */
export function retentionCutoffMs(nowMs: number, retentionDays: number): number | null {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return null;
  return nowMs - retentionDays * 86_400_000;
}

/** A footage_requests row is purgeable when it is older than the cutoff AND not
 *  locked as evidence. null/undefined evidence_locked counts as unlocked. */
export function isPurgeable(
  row: { created_ms: number; evidence_locked: number | null | undefined },
  cutoffMs: number,
): boolean {
  if (row.evidence_locked === 1) return false;
  return Number.isFinite(row.created_ms) && row.created_ms < cutoffMs;
}
