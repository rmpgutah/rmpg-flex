// src/utils/footage/pacing.ts
// Pure pacing helpers for the FlexCam capture orchestrator: how many chunks a
// request may hold (length cap) and how many vendor requests/downloads to do per
// cron tick. No I/O. Unit-tested in tests/footagePacing.test.ts.

/** Cap a chunk count to the configured max. max<=0 / NaN means unlimited. */
export function capChunkCount(count: number, max: number): number {
  if (!Number.isFinite(max) || max <= 0) return count;
  return Math.min(count, max);
}

/** Clamp a per-tick batch size into [1, hardMax]; fall back to def when unset. */
export function batchLimit(configured: number | undefined, hardMax: number, def = hardMax): number {
  const n = Number.isFinite(configured as number) ? (configured as number) : def;
  return Math.max(1, Math.min(hardMax, Math.round(n)));
}
