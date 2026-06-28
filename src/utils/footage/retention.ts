// src/utils/footage/retention.ts
// Pure helpers behind the FlexCam footage retention sweep. No I/O — the
// orchestrator (captureOrchestrator.purgeExpiredFootage) supplies the rows and
// performs the R2/D1 deletes. Unit-tested in tests/footageRetention.test.ts.

/** Epoch-ms cutoff: rows created before this are past retention. null = keep forever. */
export function retentionCutoffMs(nowMs: number, retentionDays: number): number | null {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return null;
  return nowMs - retentionDays * 86_400_000;
}

/** Upstream request-horizon check (distinct from the purge retention above).
 *  ClearPath only serves on-demand clips for RECENT footage — windows older than
 *  a few days are off the camera SD or from parked time, so requestChunk ~99%
 *  returns 500 ("footage unavailable") and the chunk dies as 'missing'. True when
 *  a window's start is older than `maxAgeDays` before `nowMs`, so enqueueFootage
 *  can skip it instead of flooding the queue with doomed chunks. Reuses
 *  retentionCutoffMs for the cutoff math; `maxAgeDays<=0` → no horizon (never
 *  beyond), i.e. the cap is disabled. */
export function isBeyondRequestHorizon(fromTs: number, nowMs: number, maxAgeDays: number): boolean {
  const cutoff = retentionCutoffMs(nowMs, maxAgeDays);
  return cutoff !== null && fromTs < cutoff;
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
