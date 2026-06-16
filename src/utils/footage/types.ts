// src/utils/footage/types.ts
export interface ChunkSpec { seq: number; fromTs: number; toTs: number; }

export interface FootageRequestHandle {
  seq: number;
  vendorId: string | null;   // vendor media/request id (null until accepted)
  fromTs: number;
  toTs: number;
  channel: string;           // 'outside' | 'inside'
}

export interface FootageChunkStatus {
  state: 'requested' | 'available' | 'missing' | 'error';
  accessUrl?: string;        // pre-signed download URL when available
  contentType?: string;
  thumbnailUrl?: string;     // per-segment still — fed to the free Workers-AI footage ALPR
}

export interface FootageSource {
  readonly id: string;               // 'clearpathgps'
  readonly maxChunkSeconds: number;  // 40 (or larger if the cap bends)
  /** Fire ONE vendor request for a single [fromTs,toTs] chunk; returns the vendor
   *  media/request id (null if the vendor didn't echo one). The orchestrator paces
   *  these across cron ticks so any-length drives stay inside Worker limits. */
  requestChunk(assetId: number, fromTs: number, toTs: number, channel: string): Promise<string | null>;
  pollChunk(assetId: number, handle: FootageRequestHandle): Promise<FootageChunkStatus>;
}

/** A footage_chunks row, narrowed to fields the pure helpers read. */
export interface ChunkRow { seq: number; status: string; r2_key: string | null; }
