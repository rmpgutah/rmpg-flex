// src/utils/footage/types.ts
export interface ChunkSpec { seq: number; fromTs: number; toTs: number; }

export interface FootageRequestHandle {
  seq: number;
  vendorId: string | null;   // vendor media/request id (null until accepted)
  fromTs: number;
  toTs: number;
  channel: string;           // 'outside' | 'inside'
  /** Source URLs already claimed by other chunks in this request. pollChunk MUST
   *  skip clips matching any of these — ClearPath's listMedia returns the same
   *  clips to every chunk's poll, so without dedup the closest-to-midpoint clip
   *  is repeated across adjacent chunks (segment-to-segment copy bug). */
  claimedUrls?: Set<string>;
}

export interface FootageChunkStatus {
  state: 'requested' | 'available' | 'missing' | 'error';
  accessUrl?: string;        // pre-signed download URL when available
  contentType?: string;
  thumbnailUrl?: string;     // per-segment still — fed to the free Workers-AI footage ALPR
}

/** A clip the vendor has marked AVAILABLE and which is safe to pass to the
 *  greedy-assigner. Trigger clips, non-VIDEO entries, and rows missing accessUrl
 *  are pre-filtered by listRequestWindow before the orchestrator sees them. */
export interface AvailableRequestClip {
  eventTimestamp: number;
  channel: string;
  accessUrl: string;
  contentType?: string;
  thumbnailUrl?: string;
}

export interface FootageSource {
  readonly id: string;               // 'clearpathgps'
  readonly maxChunkSeconds: number;  // 40 (or larger if the cap bends)
  /** Fire ONE vendor request for a single [fromTs,toTs] chunk; returns the vendor
   *  media/request id (null if the vendor didn't echo one). The orchestrator paces
   *  these across cron ticks so any-length drives stay inside Worker limits. */
  requestChunk(assetId: number, fromTs: number, toTs: number, channel: string): Promise<string | null>;
  /** LEGACY: per-chunk poll. Kept for on-demand single-clip pulls / diagnostics.
   *  pollAndDownload's hot path uses listRequestWindow + assignClipsToChunks
   *  instead — one listMedia call per request, greedy match across all pending
   *  chunks at once, avoids the dedup starvation that left 5800+ chunks stuck. */
  pollChunk(assetId: number, handle: FootageRequestHandle): Promise<FootageChunkStatus>;
  /** Fetch every available clip in the request's full [fromTs, toTs] window
   *  (with slop). Pre-filtered: VIDEO type, AVAILABLE/READY, has accessUrl,
   *  non-trigger. The orchestrator dedups against D1 source_url before
   *  passing to the greedy assigner. */
  listRequestWindow(assetId: number, fromTs: number, toTs: number): Promise<AvailableRequestClip[]>;
}

/** A footage_chunks row, narrowed to fields the pure helpers read. */
export interface ChunkRow { seq: number; status: string; r2_key: string | null; }
