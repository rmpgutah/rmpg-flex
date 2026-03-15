// ============================================================
// ClearPathGPS v2.0 Media API Client
// ============================================================
// Thin client for the v2.0 /media/* endpoints.  Reuses JWT auth
// from the v1.0 client so we never duplicate credential logic.
//
// Endpoints used:
//   GET  /v2.0/media/cameras                             — list cameras
//   GET  /v2.0/media/cameras/{cameraId}                  — camera details
//   GET  /v2.0/media/legacy/cameras/{cameraId}/data      — list clips
//
// Videos are stored as pre-signed S3 URLs in `accessUrl` —
// download directly from S3, no separate /download endpoint needed.

import { Readable } from 'node:stream';
import { getAuthToken, clearCachedAuth } from './clearPathGpsClient';

const API_BASE_URL = 'https://api.clearpathgps.com';

// ── Types ────────────────────────────────────────────────────

export interface CpgMediaObject {
  channel: string;                  // "outside" | "inside"
  type: string;                     // "VIDEO" | "IMAGE"
  title: string;
  thumbnailUrl: string;             // Pre-signed S3 URL (1h expiry)
  accessUrl: string;                // Pre-signed S3 URL (1h expiry)
  status: string;                   // "AVAILABLE" | "PROCESSING" | etc.
  lastUpdate: number;               // epoch ms
  expiringSoon: boolean;
  eventType: string;                // "Frontal Collision Warning" | "Harsh Braking" | etc.
  location: { lat: number; lng: number } | null;
  gps?: Array<{
    latitude: number;
    longitude: number;
    speed: number;
    altitude: number;
    timestamp: number;
  }>;
  cameraId?: number;
  [key: string]: any;
}

export interface CpgMediaEvent {
  address: string;
  batchId: string;
  eventTimestamp: number;            // epoch ms
  lastUpdate: number;
  expiringSoon: boolean;
  status: string;                    // "AVAILABLE" | "PROCESSING" | "REQUESTED"
  mediaObject: CpgMediaObject[];
}

export interface CpgMediaListResponse {
  total: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
  items: CpgMediaEvent[];
}

export interface CpgCamera {
  id: number;                        // Numeric camera ID for media API
  provider: string;                  // "smartwitness"
  name: string;                      // Display name (e.g. "S19")
  providerId: string;                // Camera unique ID
  notes: string;
  lastCommunication: number;         // epoch ms
}

export interface CpgCameraListResponse {
  total: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
  items: CpgCamera[];
}

export class RateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfter: number) {
    super(`ClearPathGPS rate limited — retry after ${retryAfter}s`);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfter;
  }
}

// ── Internal fetch wrapper ───────────────────────────────────

/** Fetch with Bearer auth, 401 retry, and 429 detection.
 *  For JSON endpoints — returns parsed response. */
async function cpgMediaFetch<T>(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
  const doFetch = async (token: string) => {
    const resp = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (resp.status === 429) {
      const retryAfter = parseInt(resp.headers.get('Retry-After') || '60', 10);
      throw new RateLimitError(retryAfter);
    }

    if (resp.status === 401) {
      const body = await resp.text().catch(() => '');
      throw { status: 401, body, url: resp.url };
    }

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`ClearPathGPS Media API error (${resp.status}): ${text}`);
    }

    return resp.json() as Promise<T>;
  };

  const token = await getAuthToken();
  try {
    return await doFetch(token);
  } catch (err: any) {
    if (err instanceof RateLimitError) throw err;
    if (err?.status === 401) {
      console.warn(
        `[ClearPathGPS Media] 401 — clearing cache and re-authenticating. Body: ${err.body || '(empty)'}`,
      );
      clearCachedAuth();
      const newToken = await getAuthToken();
      return doFetch(newToken);
    }
    throw err;
  }
}

// ── Public API methods ───────────────────────────────────────

/** List all cameras associated with the account.
 *  Endpoint: GET /v2.0/media/cameras */
export async function listCameras(): Promise<CpgCamera[]> {
  const resp = await cpgMediaFetch<CpgCameraListResponse>(
    '/v2.0/media/cameras',
  );
  return resp.items || [];
}

/** Get camera details by numeric camera ID.
 *  Endpoint: GET /v2.0/media/cameras/{cameraId} */
export async function getCameraDetails(
  cameraId: number,
): Promise<CpgCamera> {
  return cpgMediaFetch<CpgCamera>(
    `/v2.0/media/cameras/${cameraId}`,
  );
}

/** List media clips for a camera within a time range.
 *  Endpoint: GET /v2.0/media/legacy/cameras/{cameraId}/data
 *  @param cameraId  Numeric camera ID (e.g. 140702)
 *  @param from      UTC epoch milliseconds — start of range
 *  @param to        UTC epoch milliseconds — end of range
 *  @param page      Page number (0-based)
 *  @param pageSize  Items per page */
export async function listMedia(
  cameraId: number,
  from: number,
  to: number,
  page = 0,
  pageSize = 50,
): Promise<CpgMediaListResponse> {
  const params = new URLSearchParams({
    from: String(from),
    to: String(to),
    page: String(page),
    pageSize: String(pageSize),
  });
  return cpgMediaFetch<CpgMediaListResponse>(
    `/v2.0/media/legacy/cameras/${cameraId}/data?${params}`,
  );
}

/** List ALL media clips across all pages. Auto-paginates.
 *  @param cameraId  Numeric camera ID
 *  @param from      UTC epoch ms
 *  @param to        UTC epoch ms */
export async function listAllMedia(
  cameraId: number,
  from: number,
  to: number,
): Promise<CpgMediaEvent[]> {
  const allEvents: CpgMediaEvent[] = [];
  let page = 0;
  const pageSize = 50;

  while (true) {
    const resp = await listMedia(cameraId, from, to, page, pageSize);
    if (resp.items && resp.items.length > 0) {
      allEvents.push(...resp.items);
    }
    if (page >= resp.totalPages - 1 || !resp.items?.length) break;
    page++;
  }

  return allEvents;
}

/** Download a media file from its pre-signed S3 URL.
 *  @param accessUrl  The pre-signed S3 URL from CpgMediaObject.accessUrl
 *  @returns  { stream, contentType, contentLength } */
export async function downloadFromAccessUrl(
  accessUrl: string,
): Promise<{
  stream: Readable;
  contentType: string;
  contentLength: number;
}> {
  // S3 pre-signed URLs don't need Bearer auth — they have embedded credentials
  const resp = await fetch(accessUrl, {
    signal: AbortSignal.timeout(5 * 60_000), // 5 minutes for large video downloads
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`S3 download error (${resp.status}): ${text}`);
  }

  const contentType = resp.headers.get('content-type') || 'video/mp4';
  const contentLength = parseInt(resp.headers.get('content-length') || '0', 10);

  if (!resp.body) {
    throw new Error('S3 download returned empty body');
  }
  const stream = Readable.fromWeb(resp.body as any);

  return { stream, contentType, contentLength };
}
