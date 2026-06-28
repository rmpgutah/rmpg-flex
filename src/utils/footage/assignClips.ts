// src/utils/footage/assignClips.ts
//
// Pure assignment helper for the per-request poll rewrite. Given the clips
// ClearPath returned for a request's FULL time window + the request's pending
// chunks, greedy-assign each clip to exactly one chunk (closest by midpoint).
//
// Why this exists: the prior per-chunk poll path queried listMedia once per
// chunk and used pickBestClip with a per-tick "claimedUrls" set. Sibling
// chunks polled within the same cron tick competed for the same handful of
// clips ClearPath returns for overlapping windows — most chunks lost the
// race, stayed in 'requested', and eventually expired to 'missing'. By
// fetching the request window's media ONCE and assigning greedily across
// ALL pending chunks at once, every clip lands on the chunk that best wants
// it, no starvation.
//
// The caller (pollAndDownload) is responsible for upstream filtering:
//   - drop clips already in `source_url` on any chunk in this request (D1
//     dedup vs prior ticks)
//   - drop trigger/event clips (per-source classifier; ClearPath uses
//     isTriggerClip in clearpathSource.ts)
//   - drop non-AVAILABLE clips
// The pure helper just does the assignment math.

export interface PendingChunkForAssign {
  id: number;
  from_ts: number;
  to_ts: number;
  channel: string;
}

export interface AvailableClip {
  eventTimestamp: number;
  channel: string;
  accessUrl: string;
  contentType?: string;
  thumbnailUrl?: string;
}

export interface AssignedClip {
  accessUrl: string;
  contentType?: string;
  thumbnailUrl?: string;
}

export interface AssignOptions {
  /** Tolerance for clip eventTimestamp vs chunk midpoint, in ms. */
  slopMs: number;
}

export function assignClipsToChunks(
  clips: AvailableClip[],
  chunks: PendingChunkForAssign[],
  opts: AssignOptions,
): Map<number, AssignedClip> {
  const out = new Map<number, AssignedClip>();
  if (!clips.length || !chunks.length) return out;

  const sorted = [...clips].sort((a, b) => a.eventTimestamp - b.eventTimestamp);
  const usedUrls = new Set<string>();

  for (const clip of sorted) {
    if (!clip.accessUrl || usedUrls.has(clip.accessUrl)) continue;
    let best: PendingChunkForAssign | null = null;
    let bestDelta = Infinity;
    for (const ch of chunks) {
      if (out.has(ch.id)) continue; // chunk already taken
      if (!channelMatches(ch.channel, clip.channel)) continue;
      const chunkMid = (ch.from_ts + ch.to_ts) / 2;
      const chunkSpan = ch.to_ts - ch.from_ts;
      const delta = Math.abs(clip.eventTimestamp - chunkMid);
      if (delta > chunkSpan + opts.slopMs) continue;
      if (delta < bestDelta) { best = ch; bestDelta = delta; }
    }
    if (best) {
      out.set(best.id, {
        accessUrl: clip.accessUrl,
        contentType: clip.contentType,
        thumbnailUrl: clip.thumbnailUrl,
      });
      usedUrls.add(clip.accessUrl);
    }
  }
  return out;
}

/** Mirror of the per-chunk channel-matching rule in clearpathSource.pickBestClip:
 *  an 'inside' chunk only takes 'inside' clips; an 'outside' (or any other)
 *  chunk takes any non-'inside' clip. ClearPath returns 'inside', 'outside',
 *  'rear', etc. — anything not 'inside' is treated as an outside-facing view. */
function channelMatches(chunkChannel: string, clipChannel: string): boolean {
  return chunkChannel === 'inside'
    ? clipChannel === 'inside'
    : clipChannel !== 'inside';
}
