// ============================================================
// RMPG Flex — CarsXE integration: self-imposed rate-limit budget
// ============================================================
// CarsXE's actual per-account limit isn't confirmed yet (open question in
// the design spec) — this enforces a conservative default (30/min) via a
// KV counter so a burst of "Run Lookup" clicks can never trip whatever
// CarsXE's real limiter turns out to be. Same shape as
// src/utils/legalDataHunter/rateLimit.ts. Soft/best-effort: KV reads+writes
// below aren't atomic, but the margin absorbs the rare race under this
// feature's low, human-click-driven call volume.
// ============================================================

export const CARXE_MINUTE_BUDGET = 30;

export interface CarxeKvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function minuteKey(nowMs: number): string {
  const flooredMinute = Math.floor(nowMs / 60_000) * 60_000;
  return `carxe:usage:minute:${flooredMinute}`;
}

export async function checkAndReserveCarxeCall(
  kv: CarxeKvLike,
  nowMs: number,
): Promise<{ allowed: true } | { allowed: false; reason: 'minute_limit' }> {
  const mKey = minuteKey(nowMs);
  const countRaw = await kv.get(mKey);
  const count = countRaw ? parseInt(countRaw, 10) || 0 : 0;
  if (count >= CARXE_MINUTE_BUDGET) {
    return { allowed: false, reason: 'minute_limit' };
  }
  await kv.put(mKey, String(count + 1), { expirationTtl: 120 });
  return { allowed: true };
}
