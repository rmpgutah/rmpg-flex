// src/utils/footage/queueDrain.ts
//
// Pure helpers for the FlexCam queue-drain sweeper. Two responsibilities:
//
//   1. Stale-request bail-out — when a fulfilling request hasn't made progress
//      in `staleThresholdMs`, decide whether it should transition to 'failed'
//      (zero clips) or 'partial' (some clips). Without this, requests where
//      ClearPath never returns any clips sit in 'fulfilling' forever and starve
//      the cron's MAX_DOWNLOADS_PER_RUN budget for newer requests.
//
//   2. Per-request duplicate prune — pickBestClip's dedup is per-tick, so
//      sibling chunks polling the same window in one cron run can each claim
//      the same source URL and download byte-identical clips. The prune pass
//      keeps the lowest-seq instance and marks the rest 'missing' so the
//      player's timeline stops repeating the same 40s.

export interface StaleRequestInput {
  status: string;
  updatedAtMs: number;
  chunkCount: number;
  downloadedCount: number;
}

export interface StaleRequestVerdict {
  next: 'failed' | 'partial';
  reason: string;
}

export function evaluateStaleRequest(
  r: StaleRequestInput, nowMs: number, staleThresholdMs: number,
): StaleRequestVerdict | null {
  if (r.status === 'complete' || r.status === 'failed') return null;
  const ageMs = nowMs - r.updatedAtMs;
  if (ageMs < staleThresholdMs) return null;
  const ageH = Math.floor(ageMs / (60 * 60 * 1000));
  if (r.downloadedCount <= 0) {
    return { next: 'failed', reason: `no_clips_after_${ageH}h` };
  }
  // Some clips landed but the request stalled — only escalate fulfilling rows.
  // A row already classified as 'partial' is in its terminal-ish state.
  if (r.status === 'partial') return null;
  return { next: 'partial', reason: `partial_after_${ageH}h` };
}

export interface ChunkForPrune {
  id: number;
  seq: number;
  source_url: string | null;
  status: string;
  r2_key: string | null;
}

export function pickDuplicatesToPrune(
  chunks: ChunkForPrune[],
): { keep: number[]; prune: number[] } {
  const keep: number[] = [];
  const prune: number[] = [];
  // Only downloaded chunks participate; a 'requested' chunk with a stray
  // source_url is not yet a real duplicate of anything in R2.
  const downloaded = chunks.filter((c) => c.status === 'downloaded');
  const byUrl = new Map<string, ChunkForPrune[]>();
  for (const c of downloaded) {
    if (!c.source_url) {
      // Untracked source — assume unique; keep.
      keep.push(c.id);
      continue;
    }
    const list = byUrl.get(c.source_url);
    if (list) list.push(c);
    else byUrl.set(c.source_url, [c]);
  }
  for (const group of byUrl.values()) {
    group.sort((a, b) => a.seq - b.seq);
    keep.push(group[0].id);
    for (let i = 1; i < group.length; i++) prune.push(group[i].id);
  }
  return { keep, prune };
}
