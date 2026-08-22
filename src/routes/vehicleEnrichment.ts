// src/routes/vehicleEnrichment.ts
//
// Vehicle enrichment HTTP surface.
//   GET  /health          — key availability probe (all roles)
//   GET  /cache/:plate    — read cached enrichment data (all roles)
//   POST /enrich/:vehicleId — run enrichment chain (all roles except client_viewer)
//
// Returns 503 `{ ok: false, code: 'not_configured' }` only when ALL THREE
// keys are unset — at least one active provider is enough.
import { Hono } from 'hono';
import type { Env } from '../types';
import { enrichVehicleRecord } from '../utils/vehicleEnrichment/enrichChain';
import { queryFirst } from '../utils/db';
import { log, logErrorToDb } from '../utils/logger';

// Hono's `c.executionCtx` throws (not returns undefined) when no ExecutionContext
// was set — the case in plain Node/vitest mocks. logErrorToDb ctx is optional.
function safeCtx(c: any): any {
  try { return c.executionCtx; } catch { return undefined; }
}

const app = new Hono<Env>();

// ── GET /health ──────────────────────────────────────────────────────────────
app.get('/health', async (c) => {
  return c.json({
    ok: true,
    apis: {
      plateToVin: !!c.env.PLATE_TO_VIN_API_KEY,
      vinDecoder: !!c.env.VIN_DECODER_API_KEY,
      plateDecoder: !!c.env.PLATE_DECODER_API_KEY,
    },
  });
});

// ── GET /cache/:plate ────────────────────────────────────────────────────────
app.get('/cache/:plate', async (c) => {
  const plate = c.req.param('plate').trim().toUpperCase();
  const state = (c.req.query('state') ?? '').trim().toUpperCase();
  const plateKey = `${plate}|${state}`;
  const row = await queryFirst<{
    plate_number: string;
    state: string | null;
    vin: string | null;
    make: string | null;
    model: string | null;
    year: number | null;
    trim: string | null;
    color: string | null;
    vehicle_type: string | null;
    enriched_at: string;
  }>(
    c.env.DB,
    'SELECT plate_number, state, vin, make, model, year, trim, color, vehicle_type, enriched_at FROM vehicle_enrichment_cache WHERE plate_key = ?',
    plateKey,
  );
  if (!row) return c.json({ ok: false, cached: false });
  return c.json({ ok: true, cached: row });
});

// ── POST /enrich/:vehicleId ──────────────────────────────────────────────────
app.post('/enrich/:vehicleId', async (c) => {
  // Exclude client_viewer from enrichment writes (same pattern as legalDataHunter.ts)
  const user = c.get('user');
  if (user?.role === 'client_viewer') return c.json({ error: 'Forbidden' }, 403);

  const vehicleId = Number(c.req.param('vehicleId'));
  if (!vehicleId) return c.json({ ok: false, code: 'invalid_id' }, 400);

  const allUnset = !c.env.PLATE_TO_VIN_API_KEY && !c.env.VIN_DECODER_API_KEY && !c.env.PLATE_DECODER_API_KEY;
  if (allUnset) {
    return c.json({
      ok: false,
      code: 'not_configured',
      missing: ['PLATE_TO_VIN_API_KEY', 'VIN_DECODER_API_KEY', 'PLATE_DECODER_API_KEY'],
    });
  }

  const vehicle = await queryFirst<{ plate_number: string; state: string | null }>(
    c.env.DB,
    'SELECT plate_number, state FROM vehicles_records WHERE id = ?',
    vehicleId,
  );
  if (!vehicle?.plate_number) {
    return c.json({ ok: false, code: 'vehicle_not_found' }, 404);
  }

  const force = c.req.query('force') === 'true';
  try {
    const ctx = safeCtx(c);
    const result = await enrichVehicleRecord(
      vehicle.plate_number,
      vehicle.state ?? '',
      c.env.DB,
      c.env,
      ctx,
      { force },
    );
    return c.json({ ok: true, enriched: result, fromCache: result.fromCache });
  } catch (err) {
    log.error('vehicle-enrichment route error', { vehicleId }, err as Error);
    logErrorToDb(
      c.env.DB,
      {
        severity: 'error',
        category: 'route',
        message: (err as Error).message,
        details: { vehicleId },
        traceId: c.get('traceId'),
        source: '/api/vehicle-enrichment',
        statusCode: 500,
      },
      safeCtx(c),
    );
    return c.json({ ok: false, code: 'enrichment_failed', error: (err as Error).message }, 500);
  }
});

export default app;
