// src/utils/footage/earlyAbandon.ts
//
// Pure helper for the per-request early-abandon guard in pollAndDownload.
//
// Why this exists: even after Plan B's per-request poll rewrite eliminated
// the dedup-starvation, a request whose camera simply never uploaded any
// clips for the window will still grind one poll per chunk per cron tick
// until each chunk hits MAX_POLL_ATTEMPTS (60 post-Plan-C). That's ~1 hour
// of wasted poll budget per chronically-failing request.
//
// The early-abandon rule: if the source returns ZERO clips for the request's
// full window AND any chunk in that request has already polled `threshold`
// times (default 10 ≈ ~10 min of real time on a healthy cron), give up on
// the remaining chunks immediately. The camera either isn't online for this
// window or doesn't have the footage. Either way, more polling won't help.
//
// A non-zero clipCount means SOMETHING is happening — keep polling, even
// if some chunks are unmatched (they might be on a different upload
// schedule). Only zero clips is the give-up signal.

export interface EarlyAbandonInput {
  /** Total clips returned by source.listRequestWindow for this request. */
  clipCount: number;
  /** Max attempts across all this request's pending chunks. */
  maxChunkAttempts: number;
  /** Min attempts before zero-clip count counts as "given enough time". */
  threshold: number;
}

export function shouldEarlyAbandon(s: EarlyAbandonInput): boolean {
  if (s.clipCount > 0) return false;
  const attempts = Number.isFinite(s.maxChunkAttempts) ? Math.max(0, s.maxChunkAttempts) : 0;
  return attempts >= s.threshold;
}
