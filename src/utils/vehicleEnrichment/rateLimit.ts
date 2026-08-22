// src/utils/vehicleEnrichment/rateLimit.ts

export interface EnrichKvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export const ENRICH_RATE_LIMITS = {
  plateToVin:   { daily: 80 },
  vinDecoder:   { monthly: 80 },
  plateDecoder: { daily: 80 },
} as const;

type AllowResult = { allowed: true } | { allowed: false; reason: string };

async function checkDaily(
  kv: EnrichKvLike,
  prefix: string,
  budget: number,
  nowMs: number,
): Promise<AllowResult> {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const key = `vehicle_enrich:${prefix}:day:${day}`;
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= budget) return { allowed: false, reason: 'daily_limit' };
  await kv.put(key, String(count + 1), { expirationTtl: 25 * 60 * 60 });
  return { allowed: true };
}

async function checkMonthly(
  kv: EnrichKvLike,
  prefix: string,
  budget: number,
  nowMs: number,
): Promise<AllowResult> {
  const month = new Date(nowMs).toISOString().slice(0, 7);
  const key = `vehicle_enrich:${prefix}:month:${month}`;
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= budget) return { allowed: false, reason: 'monthly_limit' };
  await kv.put(key, String(count + 1), { expirationTtl: 32 * 24 * 60 * 60 });
  return { allowed: true };
}

export function checkAndReservePlateToVin(kv: EnrichKvLike, nowMs: number): Promise<AllowResult> {
  return checkDaily(kv, 'plate_to_vin', ENRICH_RATE_LIMITS.plateToVin.daily, nowMs);
}

export function checkAndReserveVinDecoder(kv: EnrichKvLike, nowMs: number): Promise<AllowResult> {
  return checkMonthly(kv, 'vin_decoder', ENRICH_RATE_LIMITS.vinDecoder.monthly, nowMs);
}

export function checkAndReservePlateDecoder(kv: EnrichKvLike, nowMs: number): Promise<AllowResult> {
  return checkDaily(kv, 'plate_decoder', ENRICH_RATE_LIMITS.plateDecoder.daily, nowMs);
}
