// src/routes/carxe.ts
// ============================================================
// RMPG Flex — CarsXE vehicle-data lookup routes
// ============================================================
// Mounted at /api/carxe (auth: 'required'). Manual, officer-triggered
// lookups only — never runs automatically. Checks a D1 cache
// (carxe_lookups) before calling out to avoid re-billing CarsXE credits
// on repeat lookups. Lien & Theft results with an active theft flag are
// wired into the existing screenVehicle() critical-hit notification path
// (same one Roboflow ALPR uses).
//
// No recordAudit() calls here — matches src/routes/legalDataHunter.ts,
// which also skips it. The carxe_lookups table (requested_by_user_id +
// created_at on every row) is itself the audit trail for this route.
//
// Spec: docs/superpowers/specs/2026-07-30-carxe-api-integration-design.md
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { notConfigured } from '../utils/notConfigured';
import {
  configFromEnv,
  decodePlate,
  getSpecifications,
  getLienTheft,
  getHistory,
} from '../utils/carxe/client';
import { CarxeConfigError, CarxeError, CarxeHttpError, CarxeRateLimitError, CarxeTimeoutError } from '../utils/carxe/errors';
import { checkAndReserveCarxeCall } from '../utils/carxe/rateLimit';
import { screenVehicle } from '../utils/intelScreen';
import { log } from '../utils/logger';

const carxe = new Hono<Env>();

// Field-operational roles; client_viewer / contract_manager / human_resources
// excluded — mirrors the alpr.ts / intel.ts gate.
const operational = requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedLookupRow {
  id: number;
  response_json: string;
  created_at: string;
}

async function findFreshCache(
  db: D1Database,
  lookupType: string,
  key: { plate?: string; state?: string; vin?: string },
): Promise<CachedLookupRow | null> {
  const row = key.vin
    ? await queryFirst<CachedLookupRow>(
        db,
        'SELECT id, response_json, created_at FROM carxe_lookups WHERE lookup_type = ? AND vin = ? ORDER BY created_at DESC LIMIT 1',
        lookupType,
        key.vin,
      )
    : await queryFirst<CachedLookupRow>(
        db,
        'SELECT id, response_json, created_at FROM carxe_lookups WHERE lookup_type = ? AND plate = ? AND state = ? ORDER BY created_at DESC LIMIT 1',
        lookupType,
        key.plate ?? null,
        key.state ?? null,
      );
  if (!row) return null;
  const ageMs = Date.now() - new Date(row.created_at + 'Z').getTime();
  return ageMs <= CACHE_TTL_MS ? row : null;
}

async function persistLookup(
  db: D1Database,
  lookupType: string,
  key: { plate?: string; state?: string; vin?: string },
  response: unknown,
  userId: number | undefined,
): Promise<void> {
  await execute(
    db,
    'INSERT INTO carxe_lookups (lookup_type, plate, state, vin, response_json, requested_by_user_id) VALUES (?, ?, ?, ?, ?, ?)',
    lookupType,
    key.plate ?? null,
    key.state ?? null,
    key.vin ?? null,
    JSON.stringify(response),
    userId ?? null,
  );
}

/** Maps a CarxeError subclass to an HTTP status + client-safe body.
 *  NEVER echoes err.detail — it may carry the raw CarsXE response, which
 *  (like Fleet.io's) could theoretically echo request params back. */
function errorResponse(c: any, err: unknown) {
  if (err instanceof CarxeRateLimitError) {
    return c.json({ ok: false, code: 'rate_limited', message: err.message }, 429);
  }
  if (err instanceof CarxeTimeoutError) {
    return c.json({ ok: false, code: 'timeout', message: err.message }, 504);
  }
  if (err instanceof CarxeHttpError) {
    return c.json({ ok: false, code: 'upstream_error', message: err.message }, 502);
  }
  if (err instanceof CarxeError) {
    return c.json({ ok: false, code: 'carxe_error', message: err.message }, 500);
  }
  log.error('[carxe] unexpected error', { error: (err as any)?.message });
  return c.json({ ok: false, code: 'internal_error' }, 500);
}

carxe.post('/plate-lookup', operational, async (c) => {
  const env = c.env as Record<string, unknown> as { CARXE_API_KEY?: string; CARXE_API_BASE?: string; DB: D1Database; CARXE_RATE_KV?: KVNamespace };
  let config;
  try {
    config = configFromEnv(env);
  } catch (err) {
    if (err instanceof CarxeConfigError) return notConfigured(c, 'CARXE_API_KEY is unset');
    throw err;
  }

  const body = await c.req.json<{ plate?: string; state?: string }>().catch(() => ({} as { plate?: string; state?: string }));
  const plate = (body.plate || '').trim().toUpperCase();
  const state = (body.state || '').trim().toUpperCase() || undefined;
  if (!plate) return c.json({ ok: false, code: 'invalid_input', message: 'plate is required' }, 400);

  const db = getDb(env);
  const cached = await findFreshCache(db, 'plate', { plate, state });
  if (cached) {
    return c.json({ ok: true, cached: true, result: JSON.parse(cached.response_json) });
  }

  const rateKv = (env.CARXE_RATE_KV ?? (env as any).KV) as KVNamespace | undefined;
  if (rateKv) {
    const budget = await checkAndReserveCarxeCall(rateKv, Date.now());
    if (!budget.allowed) return c.json({ ok: false, code: 'rate_limited' }, 429);
  }

  try {
    const result = await decodePlate(config, { plate, state });
    const user = c.get('user') as { id?: number } | undefined;
    await persistLookup(db, 'plate', { plate, state }, result, user?.id);
    return c.json({ ok: true, cached: false, result });
  } catch (err) {
    return errorResponse(c, err);
  }
});

carxe.post('/vin-specs', operational, async (c) => {
  const env = c.env as Record<string, unknown> as { CARXE_API_KEY?: string; CARXE_API_BASE?: string; DB: D1Database; CARXE_RATE_KV?: KVNamespace; KV?: KVNamespace };
  let config;
  try {
    config = configFromEnv(env);
  } catch (err) {
    if (err instanceof CarxeConfigError) return notConfigured(c, 'CARXE_API_KEY is unset');
    throw err;
  }

  const body = await c.req.json<{ vin?: string }>().catch(() => ({} as { vin?: string }));
  const vin = (body.vin || '').trim().toUpperCase();
  if (!vin) return c.json({ ok: false, code: 'invalid_input', message: 'vin is required' }, 400);

  const db = getDb(env);
  const cached = await findFreshCache(db, 'vin_specs', { vin });
  if (cached) {
    return c.json({ ok: true, cached: true, result: JSON.parse(cached.response_json) });
  }

  const rateKv = (env.CARXE_RATE_KV ?? env.KV) as KVNamespace | undefined;
  if (rateKv) {
    const budget = await checkAndReserveCarxeCall(rateKv, Date.now());
    if (!budget.allowed) return c.json({ ok: false, code: 'rate_limited' }, 429);
  }

  try {
    const result = await getSpecifications(config, { vin });
    const user = c.get('user') as { id?: number } | undefined;
    await persistLookup(db, 'vin_specs', { vin }, result, user?.id);
    return c.json({ ok: true, cached: false, result });
  } catch (err) {
    return errorResponse(c, err);
  }
});

carxe.post('/lien-theft', operational, async (c) => {
  const env = c.env as Record<string, unknown> as { CARXE_API_KEY?: string; CARXE_API_BASE?: string; DB: D1Database; CARXE_RATE_KV?: KVNamespace; KV?: KVNamespace };
  let config;
  try {
    config = configFromEnv(env);
  } catch (err) {
    if (err instanceof CarxeConfigError) return notConfigured(c, 'CARXE_API_KEY is unset');
    throw err;
  }

  const body = await c.req.json<{ vin?: string }>().catch(() => ({} as { vin?: string }));
  const vin = (body.vin || '').trim().toUpperCase();
  if (!vin) return c.json({ ok: false, code: 'invalid_input', message: 'vin is required' }, 400);

  const db = getDb(env);
  let result: any;
  let fromCache = false;
  const cached = await findFreshCache(db, 'lien_theft', { vin });
  if (cached) {
    result = JSON.parse(cached.response_json);
    fromCache = true;
  } else {
    const rateKv = (env.CARXE_RATE_KV ?? env.KV) as KVNamespace | undefined;
    if (rateKv) {
      const budget = await checkAndReserveCarxeCall(rateKv, Date.now());
      if (!budget.allowed) return c.json({ ok: false, code: 'rate_limited' }, 429);
    }
    try {
      result = await getLienTheft(config, { vin });
    } catch (err) {
      return errorResponse(c, err);
    }
    const user = c.get('user') as { id?: number } | undefined;
    await persistLookup(db, 'lien_theft', { vin }, result, user?.id);
  }

  // Wire an active theft flag into the same officer-safety screening path
  // Roboflow ALPR uses. Non-theft liens are informational only — no alert.
  const hasActiveTheft = (result.events ?? []).some((e: { event?: string }) =>
    (e.event || '').toLowerCase().includes('theft'),
  );
  let screening: { vehicleId: number | null; hits: unknown[] } | undefined;
  if (hasActiveTheft) {
    const vehicleRow = await queryFirst<{ id: number }>(db, 'SELECT id FROM vehicles_records WHERE UPPER(vin) = ?', vin);
    if (vehicleRow) {
      screening = await screenVehicle(db, { vehicleId: vehicleRow.id });
    }
  }

  return c.json({ ok: true, cached: fromCache, result, ...(screening ? { screening } : {}) });
});

carxe.post('/history', operational, async (c) => {
  const env = c.env as Record<string, unknown> as { CARXE_API_KEY?: string; CARXE_API_BASE?: string; DB: D1Database; CARXE_RATE_KV?: KVNamespace; KV?: KVNamespace };
  let config;
  try {
    config = configFromEnv(env);
  } catch (err) {
    if (err instanceof CarxeConfigError) return notConfigured(c, 'CARXE_API_KEY is unset');
    throw err;
  }

  const body = await c.req.json<{ vin?: string }>().catch(() => ({} as { vin?: string }));
  const vin = (body.vin || '').trim().toUpperCase();
  if (!vin) return c.json({ ok: false, code: 'invalid_input', message: 'vin is required' }, 400);

  const db = getDb(env);
  const cached = await findFreshCache(db, 'history', { vin });
  if (cached) {
    return c.json({ ok: true, cached: true, result: JSON.parse(cached.response_json) });
  }

  const rateKv = (env.CARXE_RATE_KV ?? env.KV) as KVNamespace | undefined;
  if (rateKv) {
    const budget = await checkAndReserveCarxeCall(rateKv, Date.now());
    if (!budget.allowed) return c.json({ ok: false, code: 'rate_limited' }, 429);
  }

  try {
    const result = await getHistory(config, { vin });
    const user = c.get('user') as { id?: number } | undefined;
    await persistLookup(db, 'history', { vin }, result, user?.id);
    return c.json({ ok: true, cached: false, result });
  } catch (err) {
    return errorResponse(c, err);
  }
});

carxe.get('/lookups', operational, async (c) => {
  const env = c.env as Record<string, unknown> as { DB: D1Database };
  const db = getDb(env);
  const plate = c.req.query('plate');
  const state = c.req.query('state');
  const vin = c.req.query('vin');
  const lookupType = c.req.query('lookup_type');

  let rows;
  if (vin) {
    rows = lookupType
      ? await query(db, 'SELECT id, lookup_type, plate, state, vin, response_json, created_at FROM carxe_lookups WHERE vin = ? AND lookup_type = ? ORDER BY created_at DESC LIMIT 20', vin.toUpperCase(), lookupType)
      : await query(db, 'SELECT id, lookup_type, plate, state, vin, response_json, created_at FROM carxe_lookups WHERE vin = ? ORDER BY created_at DESC LIMIT 20', vin.toUpperCase());
  } else if (plate) {
    rows = await query(
      db,
      'SELECT id, lookup_type, plate, state, vin, response_json, created_at FROM carxe_lookups WHERE plate = ? AND state = ? ORDER BY created_at DESC LIMIT 20',
      plate.toUpperCase(),
      (state || '').toUpperCase() || null,
    );
  } else {
    return c.json({ ok: false, code: 'invalid_input', message: 'plate or vin is required' }, 400);
  }

  return c.json({ ok: true, lookups: rows });
});

export default carxe;
