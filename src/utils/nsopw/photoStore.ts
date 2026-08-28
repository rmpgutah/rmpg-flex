// ============================================================
// RMPG Flex — NSOPW offender-photo storage.
// ------------------------------------------------------------
// Faithful local copy of the offender's mugshot. NSOPW's
// `imageUri` deep-links the state-of-record's image host
// (fdle.state.fl.us, meganslaw.ca.gov, wsdocs.watchsystems.com,
// sor.dps.texas.gov, etc.). Those URLs rotate when the state
// changes their CDN or the offender's record updates — leaving
// our records pointing at a 404.
//
// On every successful NSOPW match we (best-effort, fire-and-
// forget) fetch the photo bytes, store them to R2 under the
// rmpg-flex-uploads bucket at key:
//   nsopw-photos/{JURISDICTION}/{offenderId-slug}.{ext}
// and record the stored key + the Worker-served URL on the
// national_sex_offenders row.
//
// The local copy is served via GET /api/nsopw/photo/:id (auth
// required) so we don't expose R2 paths and so we can add
// access logging if the operator wants it later.
//
// Failure modes:
//   • Upstream returns non-200 → log + skip (record keeps the
//     remote imageUri only; UI falls back to that).
//   • R2 put fails → log + skip (same fallback).
//   • Content-Type doesn't smell like an image → skip with a
//     short log line (defensive: we're not storing arbitrary
//     HTML or PDFs as "photos").
// ============================================================

import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Bindings } from '../../types';
import { execute } from '../db';
import { putEncrypted } from '../encryptedR2';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 8 * 1024 * 1024;          // 8 MB ceiling per photo
const VALID_CONTENT_TYPE = /^image\/(jpeg|jpg|png|gif|webp|bmp)$/i;
// Extensions we'll honor on the R2 key. Default to `.jpg` if the
// upstream response doesn't carry a usable Content-Type header.
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg',
  'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/bmp': 'bmp',
};

export interface PhotoStoreResult {
  stored: boolean;
  key: string | null;
  bytes: number;
  contentType: string | null;
  /** Reason for skip when stored=false; null on success. */
  reason?: string;
}

/**
 * Download the photo at `photoUrl` and store it to R2. Updates the
 * national_sex_offenders row with the local key, URL, fetched
 * timestamp, size, and content type. Best-effort: never throws,
 * never blocks the caller (call via waitUntil).
 *
 * Idempotent: rate-limited internally by `photo_fetched_at` — a
 * record fetched in the last 7 days is skipped (NSOPW photos don't
 * change that often, and re-downloading wastes R2 PUTs).
 */
export async function downloadAndStorePhoto(
  env: Bindings,
  db: D1Database,
  offenderRowId: number,
  jurisdiction: string,
  offenderExtId: string,
  photoUrl: string | null,
  opts: { force?: boolean } = {},
): Promise<PhotoStoreResult> {
  if (!photoUrl) {
    return { stored: false, key: null, bytes: 0, contentType: null, reason: 'no photo url' };
  }
  const uploads = (env as { UPLOADS?: R2Bucket }).UPLOADS;
  if (!uploads) {
    return { stored: false, key: null, bytes: 0, contentType: null, reason: 'UPLOADS bucket not bound' };
  }

  // Staleness gate (skip if already downloaded recently and not forced).
  if (!opts.force) {
    const row = await db.prepare(
      `SELECT photo_fetched_at FROM national_sex_offenders WHERE id = ?`,
    ).bind(offenderRowId).first<{ photo_fetched_at: string | null }>().catch(() => null);
    if (row?.photo_fetched_at) {
      const last = Date.parse(row.photo_fetched_at.includes('T')
        ? row.photo_fetched_at
        : row.photo_fetched_at.replace(' ', 'T') + 'Z');
      const ageMs = Date.now() - last;
      if (Number.isFinite(last) && ageMs >= 0 && ageMs < 7 * 24 * 60 * 60 * 1000) {
        return { stored: false, key: null, bytes: 0, contentType: null, reason: 'fresh in last 7d' };
      }
    }
  }

  // Fetch upstream bytes with timeout + size cap.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let bytes: ArrayBuffer;
  let contentType: string;
  try {
    const res = await fetch(photoUrl, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        'accept': 'image/*',
        // Some state hosts 403 a bare Workers UA. Use a desktop browser
        // string + an Origin matching nsopw.gov for posture parity with
        // how the photo was first surfaced.
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 RMPG-Flex/1.0',
        'referer': 'https://www.nsopw.gov/',
      },
    });
    if (!res.ok) {
      return {
        stored: false, key: null, bytes: 0, contentType: null,
        reason: `upstream HTTP ${res.status}`,
      };
    }
    contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (contentType && !VALID_CONTENT_TYPE.test(contentType)) {
      return {
        stored: false, key: null, bytes: 0, contentType,
        reason: `non-image content-type: ${contentType}`,
      };
    }
    bytes = await res.arrayBuffer();
  } catch (err) {
    return {
      stored: false, key: null, bytes: 0, contentType: null,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }

  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    return {
      stored: false, key: null, bytes: bytes.byteLength, contentType,
      reason: bytes.byteLength === 0 ? 'empty body' : `too large (${bytes.byteLength} bytes)`,
    };
  }

  const ext = EXT_BY_TYPE[contentType ?? ''] ?? 'jpg';
  // Slug from external id — strip URL-unsafe chars; collide-free per jurisdiction.
  const slug = (offenderExtId || `row-${offenderRowId}`).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96);
  const key = `nsopw-photos/${(jurisdiction || 'UNK').toUpperCase()}/${slug}.${ext}`;

  // Best-effort R2 PUT.
  try {
    await putEncrypted(uploads, db, env, key, bytes, {
      httpMetadata: { contentType: contentType || 'image/jpeg' },
    });
  } catch (err) {
    return {
      stored: false, key: null, bytes: bytes.byteLength, contentType,
      reason: err instanceof Error ? err.message : 'R2 put failed',
    };
  }

  // Update the offender row with the local pointers.
  const localUrl = `/api/nsopw/photo/${offenderRowId}`;
  await execute(
    db,
    `UPDATE national_sex_offenders
        SET local_photo_key = ?,
            local_photo_url = ?,
            photo_fetched_at = datetime('now'),
            photo_size_bytes = ?,
            photo_content_type = ?
      WHERE id = ?`,
    key, localUrl, bytes.byteLength, contentType || 'image/jpeg', offenderRowId,
  ).catch((err) => console.warn('[nsopw-photo] DB update failed:', err));

  return {
    stored: true,
    key,
    bytes: bytes.byteLength,
    contentType: contentType || 'image/jpeg',
  };
}
