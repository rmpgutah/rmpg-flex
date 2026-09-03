// src/utils/vehicleEnrichment/rateLimit.ts

import { VehicleEnrichRateLimitError } from './types';

export interface EnrichKvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export const ENRICH_RATE_LIMITS = {
  plateToVin:   { daily: 80 },
  vinDecoder:   { monthly: 80 },
  plateDecoder: { daily: 80 },
} as const;

async function checkDaily(
  kv: EnrichKvLike,
  prefix: string,
  budget: number,
  api: string,
  nowMs: number,
): Promise<void> {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const key = `vehicle_enrich:${prefix}:day:${day}`;
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= budget) throw new VehicleEnrichRateLimitError(api);
  await kv.put(key, String(count + 1), { expirationTtl: 25 * 60 * 60 });
}

async function checkMonthly(
  kv: EnrichKvLike,
  prefix: string,
  budget: number,
  api: string,
  nowMs: number,
): Promise<void> {
  const month = new Date(nowMs).toISOString().slice(0, 7);
  const key = `vehicle_enrich:${prefix}:month:${month}`;
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= budget) throw new VehicleEnrichRateLimitError(api);
  await kv.put(key, String(count + 1), { expirationTtl: 35 * 24 * 60 * 60 });
}

export function checkAndReservePlateToVin(kv: EnrichKvLike, nowMs: number): Promise<void> {
  return checkDaily(kv, 'plate_to_vin', ENRICH_RATE_LIMITS.plateToVin.daily, 'plateToVin', nowMs);
}

export function checkAndReserveVinDecoder(kv: EnrichKvLike, nowMs: number): Promise<void> {
  return checkMonthly(kv, 'vin_decoder', ENRICH_RATE_LIMITS.vinDecoder.monthly, 'vinDecoder', nowMs);
}

export function checkAndReservePlateDecoder(kv: EnrichKvLike, nowMs: number): Promise<void> {
  return checkDaily(kv, 'plate_decoder', ENRICH_RATE_LIMITS.plateDecoder.daily, 'plateDecoder', nowMs);
}
