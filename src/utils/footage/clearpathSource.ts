// src/utils/footage/clearpathSource.ts
import { getApiConfig, listMedia, API_BASE, type CpgClient } from '../clearpathGps';
import type { FootageSource, FootageRequestHandle, FootageChunkStatus } from './types';
import { splitWindow } from './splitWindow';

// ⚠️ Confirm against Task 0 spike findings before production use.
const CPG_MEDIA_REQUEST_PATH = '/v2.0/media/request';
const MAX_CHUNK_SECONDS = 40; // raise if the spike proves the backend honors more.

type EnvLike = { KV: KVNamespace; CPG_ENC_KEY?: string; CPG_REFRESH_TOKEN?: string; CPG_USER_ID?: string };

// ── Pure builders (exported for tests) ───────────────────────

export function buildMediaRequestPayload(assetId: number, fromTs: number, toTs: number, channel: string) {
  return {
    assetId,
    startTime: fromTs,
    duration: Math.round((toTs - fromTs) / 1000),
    cameras: channel === 'inside' ? ['driver'] : ['road'], // 'inside' → driver-facing; any other channel → road-facing ('outside')
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
    return { state: 'available', accessUrl, contentType: obj?.contentType ? String(obj.contentType) : undefined };
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

  async requestWindow(assetId: number, fromTs: number, toTs: number, channels: string[]): Promise<FootageRequestHandle[]> {
    // TODO: parallelize chunk requests per channel once the endpoint contract is confirmed (spike).
    const handles: FootageRequestHandle[] = [];
    for (const channel of channels.length ? channels : ['outside']) {
      const chunks = splitWindow(fromTs, toTs, this.maxChunkSeconds);
      for (const c of chunks) {
        const resp = await post(this.env, this.client, CPG_MEDIA_REQUEST_PATH, buildMediaRequestPayload(assetId, c.fromTs, c.toTs, channel));
        handles.push({ seq: c.seq, vendorId: parseRequestId(resp), fromTs: c.fromTs, toTs: c.toTs, channel });
      }
    }
    return handles;
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
