// src/utils/footage/clearpathSource.ts
import { getApiConfig, listMedia, getCameraIdForAsset, API_BASE, type CpgClient } from '../clearpathGps';
import type { FootageSource, FootageRequestHandle, FootageChunkStatus } from './types';

// Confirmed 2026-06-15 via HAR capture: on-demand clips use the camera-service
// entity ID (camera.id from /v1.0/assets/ids), NOT the fleet assetId.
const MAX_CHUNK_SECONDS = 40;

type EnvLike = { KV: KVNamespace; CPG_ENC_KEY?: string; CPG_REFRESH_TOKEN?: string; CPG_USER_ID?: string };

// ── Pure builders (exported for tests) ───────────────────────

export function buildMediaRequestPayload(fromTs: number, toTs: number, channel: string) {
  return {
    timestamp: fromTs,
    cameraTypes: [channel === 'inside' ? 'INSIDE' : 'OUTSIDE'],
    duration: Math.round((toTs - fromTs) / 1000),
  };
}

export function parseRequestId(resp: Record<string, unknown>): string | null {
  for (const k of ['requestId', 'mediaRequestId', 'id', 'batchId']) {
    const v = resp?.[k];
    if (v != null && v !== '') return String(v);
  }
  return null;
}

export function classifyChunkStatus(obj: Record<string, unknown>): FootageChunkStatus {
  const status = String(obj?.status ?? '').toUpperCase();
  const accessUrl = obj?.accessUrl ? String(obj.accessUrl) : undefined;
  if (status === 'NO_MEDIA' || status === 'UNAVAILABLE') return { state: 'missing' };
  if (status === 'ERROR' || status === 'FAILED') return { state: 'error' };
  if (accessUrl && (status === 'AVAILABLE' || status === 'READY')) {
    return { state: 'available', accessUrl, contentType: obj?.contentType ? String(obj.contentType) : undefined,
      thumbnailUrl: obj?.thumbnailUrl ? String(obj.thumbnailUrl) : undefined };
  }
  return { state: 'requested' };
}

// ── IO helpers ───────────────────────────────────────────────

async function post(env: EnvLike, client: CpgClient, path: string, body: unknown): Promise<Record<string, unknown>> {
  const attempt = async (retried: boolean): Promise<Record<string, unknown>> => {
    const token = await client.getToken();
    const res = await fetch(new URL(path, API_BASE).toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 && !retried) {
      try { await env.KV.delete('cpg:access_token'); } catch { /* KV optional */ }
      return attempt(true);
    }
    if (!res.ok) throw new Error(`ClearPath media-request ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  };
  return attempt(false);
}

// ── The source ───────────────────────────────────────────────

export class ClearPathSource implements FootageSource {
  readonly id = 'clearpathgps';
  readonly maxChunkSeconds = MAX_CHUNK_SECONDS;
  constructor(private env: EnvLike, private client: CpgClient) {}

  async requestChunk(assetId: number, fromTs: number, toTs: number, channel: string): Promise<string | null> {
    const cameraId = await getCameraIdForAsset(this.env, this.client, assetId);
    if (!cameraId) throw new Error(`ClearPath: no camera ID for asset ${assetId}`);
    const path = `/v2.0/media/cameras/${cameraId}/request-media`;
    const resp = await post(this.env, this.client, path, buildMediaRequestPayload(fromTs, toTs, channel));
    return parseRequestId(resp) ?? String(cameraId);
  }

  async pollChunk(assetId: number, handle: FootageRequestHandle): Promise<FootageChunkStatus> {
    // Availability shows up in the existing media list for the window.
    const page = await listMedia(this.env, this.client, assetId, handle.fromTs, handle.toTs, 0, 50);
    for (const ev of page.items) {
      for (const mo of ev.mediaObject) {
        // 'inside' matches driver-facing; everything else is treated as road-facing.
      const matchChannel = handle.channel === 'inside' ? mo.channel === 'inside' : mo.channel !== 'inside';
        if (matchChannel && mo.type === 'VIDEO') {
          const st = classifyChunkStatus(mo as unknown as Record<string, unknown>);
          if (st.state !== 'requested') return st;
        }
      }
    }
    return { state: 'requested' };
  }
}

/** Resolve a ClearPath source from config, or null if not configured. */
export async function getClearPathSource(db: D1Database, env: EnvLike): Promise<ClearPathSource | null> {
  const client = await getApiConfig(db, env).catch(() => null);
  return client ? new ClearPathSource(env, client) : null;
}
