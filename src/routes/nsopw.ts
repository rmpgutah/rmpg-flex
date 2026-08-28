// ============================================================
// RMPG Flex — NSOPW screening route.
// ------------------------------------------------------------
// Dedicated NSOPW endpoints that complement the framework's generic
// /api/screening/search. The framework's search route doesn't accept
// a `dob` parameter (its SearchParams predates the strict-match-with-
// DOB policy); these endpoints carry it through end-to-end so officers
// can cross-reference by name + DOB as a first-class operation.
//
// Routes:
//   GET  /api/nsopw/search?name=&forename=&dob=    on-demand cross-ref
//   POST /api/nsopw/screen-person/:id              re-screen one person now
//   GET  /api/nsopw/runs                           recent run log
//   GET  /api/nsopw/cache                          recent cached queries
//   POST /api/nsopw/cache/vacuum                   admin-only cache trim
//   GET  /api/nsopw/status                         coverage + configured flag
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';
import { requireRole } from '../middleware/auth';
import {
  runNsopwScreening, screenPersonForSor, ensureNsopwColumns,
} from '../utils/nsopw';
import { isConfigured } from '../utils/nsopw/client';
import { getDecrypted, FileEncryptionError } from '../utils/encryptedR2';
import { log } from '../utils/logger';
import { listRecentQueries, vacuumCache } from '../utils/nsopw/cache';
import { recordAudit } from '../utils/auditLog';
import { enrichPendingOffenders } from '../utils/sorEnrichment/runner';
import { lookupFailedCoverage } from '../utils/screening/coverage';

const nsopw = new Hono<Env>();

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;
const ADMIN_ROLES = ['admin', 'manager', 'supervisor'] as const;

// ── GET /api/nsopw/status ───────────────────────────────────
// Returns the coverage state. Powers the SOR Status panel header
// + the "NSOPW key not set" warning banner on the Sex Offender
// Registry page.
nsopw.get('/status', requireRole(...READ_ROLES), async (c) => {
  await ensureNsopwColumns(c.env).catch(() => {});
  const db = getDb(c.env);
  const configured = isConfigured(c.env);
  const offenderCount = await queryFirst<{ n: number }>(
    db, 'SELECT COUNT(*) n FROM national_sex_offenders',
  ).catch(() => null);
  const recentRun = await queryFirst<Record<string, unknown>>(
    db, 'SELECT * FROM nsopw_runs ORDER BY id DESC LIMIT 1',
  ).catch(() => null);
  return c.json({
    configured,
    // null means the COUNT query itself failed — distinct from a genuine 0. The
    // old shape collapsed both to 0 while reporting coverage OK, so a broken
    // lookup read as "configured, 0 offenders on file".
    offenderCount: offenderCount?.n ?? 0,
    offenderCountKnown: offenderCount !== null,
    lastRun: recentRun,
    coverage: !configured
      ? {
          available: false,
          severity: 'warning' as const,
          message:
            'NSOPW is not configured (NSOPW_API_KEY unset). Set the secret ' +
            'once the DOJ MOU is in place. Until then, an empty search ' +
            'result CANNOT confirm a subject is not nationally registered.',
        }
      : offenderCount === null
        ? lookupFailedCoverage('The national sex-offender record count')
        : { available: true, severity: 'ok' as const },
  });
});

// ── GET /api/nsopw/search?name=&forename=&dob= ──────────────
// The user-facing nationwide cross-reference. Returns ranked
// confirmed / possible / excluded counts.
nsopw.get('/search', requireRole(...READ_ROLES), async (c) => {
  const surname = (c.req.query('name') ?? '').trim();
  const forename = (c.req.query('forename') ?? '').trim();
  const dob = (c.req.query('dob') ?? '').trim();
  const middleName = (c.req.query('middleName') ?? '').trim();
  if (!surname || !forename) {
    return c.json({ error: 'name (surname) and forename are required' }, 400);
  }
  const user = c.get('user');
  const result = await runNsopwScreening(c.env, {
    surname, forename, middleName: middleName || undefined, dob: dob || undefined,
  }, {
    triggeredBy: user?.id ? `manual:${user.id}` : 'manual',
    executionCtx: c.executionCtx,
  });

  // Light audit. Confirmed-hit-only audit (we don't want to log every
  // common-name fishing expedition by an officer to audit_log).
  if (result.confirmed.length > 0) {
    try {
      await recordAudit(c, {
        action: 'NSOPW_LOOKUP_HIT',
        entityType: 'person',
        entityId: null,
        details: {
          surname, forename, dob,
          confirmed_count: result.confirmed.length,
          possible_count: result.possible.length,
          cache_hit: result.cacheHit,
        },
      });
    } catch (err) { console.warn('[nsopw] audit failed:', err); }
  }

  return c.json(result);
});

// ── POST /api/nsopw/screen-person/:id ───────────────────────
// Re-screen an existing local person against NSOPW now. Same
// hook the auto-triggers use, exposed manually for ops.
nsopw.post('/screen-person/:id', requireRole(...READ_ROLES), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);
  const user = c.get('user');
  const r = await screenPersonForSor(c.env, id, {
    triggeredBy: user?.id ? `rescreen:${user.id}` : 'rescreen',
    skipCache: true,
  });
  if (!r) return c.json({ error: 'person not found or missing name' }, 404);
  return c.json(r);
});

// ── GET /api/nsopw/runs ─────────────────────────────────────
nsopw.get('/runs', requireRole(...READ_ROLES), async (c) => {
  await ensureNsopwColumns(c.env).catch(() => {});
  const rows = await query<Record<string, unknown>>(
    getDb(c.env),
    `SELECT id, kind, triggered_by, query_surname, query_forename, query_dob,
            cache_hit, candidates_returned, confirmed_matches, possible_matches,
            excluded_matches, http_status, latency_ms, error, ran_at
       FROM nsopw_runs
      ORDER BY id DESC LIMIT 100`,
  ).catch(() => []);
  return c.json({ data: rows });
});

// ── GET /api/nsopw/cache ────────────────────────────────────
nsopw.get('/cache', requireRole(...ADMIN_ROLES), async (c) => {
  await ensureNsopwColumns(c.env).catch(() => {});
  const rows = await listRecentQueries(c.env, 100).catch(() => []);
  return c.json({ data: rows });
});

// ── POST /api/nsopw/cache/vacuum ────────────────────────────
nsopw.post('/cache/vacuum', requireRole(...ADMIN_ROLES), async (c) => {
  const n = await vacuumCache(c.env).catch(() => 0);
  return c.json({ ok: true, removed: n });
});

// ── POST /api/nsopw/enrich ──────────────────────────────────
// Admin-triggered batch run of the per-state SOR detail-page enrichment
// (see src/utils/sorEnrichment/). Also rides the */30 cron tick — see
// src/index.ts — this route exists for on-demand/manual runs.
nsopw.post('/enrich', requireRole(...ADMIN_ROLES), async (c) => {
  const db = getDb(c.env);
  const summary = await enrichPendingOffenders(db);
  return c.json(summary);
});

// ── GET /api/nsopw/offender/:id ─────────────────────────────
// Full offender detail (national_sex_offenders row + parsed
// detail_json). Used by the review queue's offender drawer.
nsopw.get('/offender/:id', requireRole(...READ_ROLES), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);
  const row = await queryFirst<Record<string, unknown>>(
    getDb(c.env),
    'SELECT * FROM national_sex_offenders WHERE id = ?', id,
  ).catch(() => null);
  if (!row) return c.json({ error: 'not found' }, 404);
  let detail: unknown = null;
  if (typeof row.detail_json === 'string') {
    try { detail = JSON.parse(row.detail_json as string); } catch { /* ignore */ }
  }
  return c.json({ ...row, detail });
});

// ── GET /api/nsopw/photo/:offenderRowId ─────────────────────
// Serve the locally-stored offender photograph. The R2 object key
// lives on the national_sex_offenders row (local_photo_key, set
// by photoStore.downloadAndStorePhoto). Auth-gated; only sworn
// users see it. Returns the bytes with the original content-type
// and a 1-hour edge cache (immutable: NSOPW photos rotate with
// the offender's record, not with time).
nsopw.get('/photo/:offenderRowId', requireRole(...READ_ROLES), async (c) => {
  const id = parseInt(c.req.param('offenderRowId') ?? '', 10);
  if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);
  const row = await queryFirst<{
    local_photo_key: string | null;
    photo_content_type: string | null;
  }>(
    getDb(c.env),
    'SELECT local_photo_key, photo_content_type FROM national_sex_offenders WHERE id = ?',
    id,
  ).catch(() => null);
  if (!row?.local_photo_key) return c.json({ error: 'no local photo' }, 404);

  try {
    const decrypted = await getDecrypted(c.env.UPLOADS, getDb(c.env), c.env, row.local_photo_key);
    if (decrypted) {
      return new Response(decrypted.bytes, {
        headers: {
          'content-type': row.photo_content_type || decrypted.httpMetadata?.contentType || 'image/jpeg',
          'cache-control': 'private, max-age=3600',
          'content-length': String(decrypted.bytes.length),
        },
      });
    }
    // getDecrypted() returns null both for "object never existed" and for a
    // genuinely crypto-shredded object with no key row -- neither is
    // distinguishable here from a LEGACY object stored before this feature
    // shipped (also "object exists, no key row"). Fall back to serving the
    // raw R2 bytes as-is, mirroring fieldPhotos.ts's GET /file/* route. Safe
    // today because nothing in this codebase does standalone crypto-shredding
    // of nsopw-photos/ objects, so "object present, row absent" can currently
    // only mean "predates encryption," never "was shredded."
    const legacy = await c.env.UPLOADS.get(row.local_photo_key).catch(() => null);
    if (!legacy) return c.json({ error: 'photo bytes missing' }, 404);
    return new Response(legacy.body, {
      headers: {
        'content-type': row.photo_content_type || legacy.httpMetadata?.contentType || 'image/jpeg',
        'cache-control': 'private, max-age=3600',
        'content-length': String(legacy.size),
      },
    });
  } catch (err) {
    // A genuine decrypt failure (malformed/rotated KEK, tampered ciphertext)
    // must not fall through to the legacy raw-R2 path — that would serve
    // AES-GCM ciphertext as image/jpeg. Catch here so the Worker test isolate
    // does not also see an unhandled rejection (Hono onError is not mounted
    // on the isolated nsopw test app, and workerd reports the throw anyway).
    log.error('GET /api/nsopw/photo/:id failed', { src: 'src/routes/nsopw.ts' }, err);
    const message = err instanceof FileEncryptionError ? err.message : (err instanceof Error ? err.message : 'photo decrypt failed');
    return c.json({ error: message }, 500);
  }
});

// ── GET /api/nsopw/person/:id/hits ──────────────────────────
// Active NSOPW screening_hits for one person. Powers the SOR
// Status panel on PersonIntelPanel.
nsopw.get('/person/:id/hits', requireRole(...READ_ROLES), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);
  const rows = await query<Record<string, unknown>>(
    getDb(c.env),
    `SELECT id, source_key, external_id, match_score, matched_fields, status,
            display_name, summary, photo_url, country, list_type,
            reviewed_by, reviewed_at, first_seen_at, last_seen_at, is_active
       FROM screening_hits
      WHERE source_key = 'nsopw' AND person_id = ? AND is_active = 1
      ORDER BY id DESC LIMIT 25`,
    id,
  ).catch(() => []);
  return c.json({ data: rows });
});

export default nsopw;
