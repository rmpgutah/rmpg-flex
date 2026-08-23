// src/utils/vehicleEnrichment/enrichChain.ts
//
// Orchestrates the three-step vehicle enrichment chain:
//   Step 1: Plate → VIN (plateToVin)
//   Step 2: VIN → specs (decodeVin) — only when step 1 produced a VIN
//   Step 3: Plate decoder fallback (decodePlate) — only when step 1 returned no VIN
//
// Cache check first; returns cached data immediately unless opts.force === true.
// All steps are independent try/catch; a step failure logs + continues.
// If ALL steps fail the vehicles_records row is left unchanged and no throw occurs.

import { log, logErrorToDb } from '../logger';
import { queryFirst, execute } from '../db';
import { upsertVehicleFromCarxe } from '../carxe/vehicleRecords';
import { plateToVin, decodeVin, decodePlate } from './client';
import {
  checkAndReservePlateToVin,
  checkAndReserveVinDecoder,
  checkAndReservePlateDecoder,
  type EnrichKvLike,
} from './rateLimit';
import type { EnrichmentResult, VehicleEnrichData } from './types';
import { VehicleEnrichRateLimitError } from './types';

export interface EnrichEnv {
  DB: D1Database;
  KV: KVNamespace;
  PLATE_TO_VIN_API_KEY?: string;
  VIN_DECODER_API_KEY?: string;
  PLATE_DECODER_API_KEY?: string;
  [key: string]: unknown;
}

export interface EnrichOptions {
  force?: boolean;
}

export function buildPlateKey(plate: string, state: string): string {
  return `${plate.trim().toUpperCase()}|${state.trim().toUpperCase()}`;
}

interface CacheRow {
  id: number;
  plate_number: string;
  state: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  trim: string | null;
  color: string | null;
  vehicle_type: string | null;
}

export async function enrichVehicleRecord(
  plate: string,
  state: string,
  db: D1Database,
  env: EnrichEnv,
  _ctx?: ExecutionContext,
  opts: EnrichOptions = {},
): Promise<EnrichmentResult> {
  const plateKey = buildPlateKey(plate, state);
  const kv = env.KV as unknown as EnrichKvLike;

  // ── Cache check ──────────────────────────────────────────────────────────
  if (!opts.force) {
    const cached = await queryFirst<CacheRow>(
      db,
      `SELECT id, plate_number, state, vin, make, model, year, trim, color, vehicle_type
         FROM vehicle_enrichment_cache
        WHERE plate_key = ?`,
      plateKey,
    );
    if (cached) {
      const vRow = await queryFirst<{ id: number }>(
        db,
        `SELECT id FROM vehicles_records
          WHERE UPPER(TRIM(plate_number)) = ?
          LIMIT 1`,
        plate.trim().toUpperCase(),
      );
      return {
        vehicleId: vRow?.id ?? 0,
        fromCache: true,
        data: {
          vin: cached.vin,
          make: cached.make,
          model: cached.model,
          year: cached.year,
          trim: cached.trim,
          color: cached.color,
          vehicle_type: cached.vehicle_type,
        },
        stepsRun: [],
        stepErrors: {},
      };
    }
  }

  // ── Build enrichment data from API chain ─────────────────────────────────
  const stepsRun: EnrichmentResult['stepsRun'] = [];
  const stepErrors: Record<string, string> = {};
  const data: VehicleEnrichData = {};
  const nowMs = Date.now();

  // Step 1: Plate → VIN
  let resolvedVin: string | null = null;
  const p2vKey = env.PLATE_TO_VIN_API_KEY ?? '';
  if (p2vKey) {
    try {
      await checkAndReservePlateToVin(kv, nowMs);
      const r = await plateToVin(plate, state, p2vKey);
      if (r.vin) {
        resolvedVin = r.vin;
        data.vin = r.vin;
      }
      stepsRun.push('plateToVin');
    } catch (err) {
      const msg = err instanceof VehicleEnrichRateLimitError
        ? `rate_limit:${err.api}`
        : (err as Error).message;
      stepErrors['plateToVin'] = msg;
      log.warn('vehicle-enrichment plateToVin failed', { plate, state, msg });
    }
  } else {
    stepErrors['plateToVin'] = 'config:no_key';
  }

  // Step 2: VIN → specs (only if we have a VIN)
  const vinKey = env.VIN_DECODER_API_KEY ?? '';
  if (resolvedVin && vinKey) {
    try {
      await checkAndReserveVinDecoder(kv, nowMs);
      const r = await decodeVin(resolvedVin, vinKey);
      if (r.make) data.make = r.make;
      if (r.model) data.model = r.model;
      if (r.year) data.year = r.year;
      if (r.trim) data.trim = r.trim;
      if (r.color) data.color = r.color;
      if (r.vehicle_type) data.vehicle_type = r.vehicle_type;
      stepsRun.push('decodeVin');
    } catch (err) {
      const msg = err instanceof VehicleEnrichRateLimitError
        ? `rate_limit:${err.api}`
        : (err as Error).message;
      stepErrors['decodeVin'] = msg;
      log.warn('vehicle-enrichment decodeVin failed', { vin: resolvedVin, msg });
    }
  }

  // Step 3: Plate decoder fallback — only when step 1 returned no VIN
  const pdKey = env.PLATE_DECODER_API_KEY ?? '';
  if (!resolvedVin && pdKey) {
    try {
      await checkAndReservePlateDecoder(kv, nowMs);
      const r = await decodePlate(plate, state, pdKey);
      if (!data.make && r.make) data.make = r.make;
      if (!data.model && r.model) data.model = r.model;
      if (!data.year && r.year) data.year = r.year;
      if (!data.vehicle_type && r.vehicle_type) data.vehicle_type = r.vehicle_type;
      stepsRun.push('decodePlate');
    } catch (err) {
      const msg = err instanceof VehicleEnrichRateLimitError
        ? `rate_limit:${err.api}`
        : (err as Error).message;
      stepErrors['decodePlate'] = msg;
      log.warn('vehicle-enrichment decodePlate failed', { plate, msg });
    }
  }

  // ── Write to vehicles_records via the canonical seam ─────────────────────
  let vehicleId = 0;
  const hasAnyData = !!(data.vin || data.make || data.model);

  if (hasAnyData || stepsRun.length > 0) {
    try {
      const result = await upsertVehicleFromCarxe(
        db,
        { plate, state },
        {
          vin: data.vin ?? null,
          make: data.make ?? null,
          model: data.model ?? null,
          year: data.year ?? null,
          trim: data.trim ?? null,
          color: data.color ?? null,
          body_style: null,
          // vehicle_type is not a vehicles_records column; it lives in the enrichment cache only
        },
        'vehicle-enrichment-api',
      );
      vehicleId = result.vehicleId;
    } catch (err) {
      log.warn('vehicle-enrichment upsertVehicleFromCarxe failed', { plate, state, err: (err as Error).message });
      if (_ctx) {
        logErrorToDb(
          db,
          {
            severity: 'warning',
            category: 'integration',
            message: (err as Error).message,
            details: { plate, state },
            source: 'enrichChain',
            statusCode: 500,
          },
          _ctx,
        );
      }
    }
  } else {
    // All steps failed — resolve vehicleId if row exists, otherwise stay 0
    const vRow = await queryFirst<{ id: number }>(
      db,
      `SELECT id FROM vehicles_records WHERE UPPER(TRIM(plate_number)) = ? LIMIT 1`,
      plate.trim().toUpperCase(),
    ).catch(() => null);
    vehicleId = vRow?.id ?? 0;

    if (_ctx) {
      logErrorToDb(
        db,
        {
          severity: 'warning',
          category: 'integration',
          message: 'all vehicle enrichment steps failed — plate enrichment returned no data',
          details: { plate, state, stepErrors },
          source: 'enrichChain',
          statusCode: 0,
        },
        _ctx,
      );
    }
  }

  // ── Upsert cache row only when at least one step succeeded ──────────────
  if (stepsRun.length > 0) {
  try {
    await execute(
      db,
      `INSERT INTO vehicle_enrichment_cache
         (plate_key, plate_number, state, vin, make, model, year, trim, color, vehicle_type,
          raw_plate_to_vin, raw_vin_decoder, raw_plate_decoder, enriched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(plate_key) DO UPDATE SET
         vin = excluded.vin,
         make = excluded.make,
         model = excluded.model,
         year = excluded.year,
         trim = excluded.trim,
         color = excluded.color,
         vehicle_type = excluded.vehicle_type,
         raw_plate_to_vin = excluded.raw_plate_to_vin,
         raw_vin_decoder = excluded.raw_vin_decoder,
         raw_plate_decoder = excluded.raw_plate_decoder,
         enriched_at = excluded.enriched_at`,
      plateKey,
      plate.trim().toUpperCase(),
      state.trim().toUpperCase(),
      data.vin ?? null,
      data.make ?? null,
      data.model ?? null,
      data.year ?? null,
      data.trim ?? null,
      data.color ?? null,
      data.vehicle_type ?? null,
      stepsRun.includes('plateToVin') ? JSON.stringify({ vin: resolvedVin }) : null,
      stepsRun.includes('decodeVin') ? JSON.stringify(data) : null,
      stepsRun.includes('decodePlate') ? JSON.stringify(data) : null,
    );
  } catch (err) {
    log.warn('vehicle-enrichment cache upsert failed', { plateKey, err: (err as Error).message });
  }
  }

  return { vehicleId, fromCache: false, data, stepsRun, stepErrors };
}
