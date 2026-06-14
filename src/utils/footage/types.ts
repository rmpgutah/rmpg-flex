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
}

export interface FootageSource {
  readonly id: string;               // 'clearpathgps'
  readonly maxChunkSeconds: number;  // 40 (or larger if the cap bends)
  requestWindow(assetId: number, fromTs: number, toTs: number, channels: string[]): Promise<FootageRequestHandle[]>;
  pollChunk(assetId: number, handle: FootageRequestHandle): Promise<FootageChunkStatus>;
}

/** A footage_chunks row, narrowed to fields the pure helpers read. */
export interface ChunkRow { seq: number; status: string; r2_key: string | null; }
