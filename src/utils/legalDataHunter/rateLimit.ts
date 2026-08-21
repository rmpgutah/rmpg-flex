// ============================================================
// RMPG Flex — Legal Data Hunter integration: rate-limit budget
// ============================================================
// LDH's own limits are 10 req/min, 20 req/day, 600/period. This
// enforces a self-imposed buffer (8/min, 18/day) using KV counters
// so a burst of "Validate Charge" clicks can never trip LDH's own
// limiter. Soft/best-effort: KV reads+writes below aren't atomic,
// but the buffer margin absorbs the rare race under this feature's
// low, human-click-driven call volume.
// ============================================================

export const LDH_DAILY_BUDGET = 18;
export const LDH_MINUTE_BUDGET = 8;

export interface LdhKvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function dayKey(nowMs: number): string {
  const iso = new Date(nowMs).toISOString();
  return `legal_data_hunter:usage:day:${iso.slice(0, 10)}`; // YYYY-MM-DD
}

function minuteKey(nowMs: number): string {
  const flooredMinute = Math.floor(nowMs / 60_000) * 60_000;
  return `legal_data_hunter:usage:minute:${flooredMinute}`;
}

export async function checkAndReserveLdhCall(
  kv: LdhKvLike,
  nowMs: number,
): Promise<{ allowed: true } | { allowed: false; reason: 'daily_limit' | 'minute_limit' }> {
  const dKey = dayKey(nowMs);
  const mKey = minuteKey(nowMs);

  const dayCountRaw = await kv.get(dKey);
  const dayCount = dayCountRaw ? parseInt(dayCountRaw, 10) || 0 : 0;
  if (dayCount >= LDH_DAILY_BUDGET) {
    return { allowed: false, reason: 'daily_limit' };
  }

  const minuteCountRaw = await kv.get(mKey);
  const minuteCount = minuteCountRaw ? parseInt(minuteCountRaw, 10) || 0 : 0;
  if (minuteCount >= LDH_MINUTE_BUDGET) {
    return { allowed: false, reason: 'minute_limit' };
  }

  // TTLs: a day key outlives the day (25h buffer for clock skew), a minute
  // key outlives the minute (2m buffer).
  await kv.put(dKey, String(dayCount + 1), { expirationTtl: 25 * 60 * 60 });
  await kv.put(mKey, String(minuteCount + 1), { expirationTtl: 120 });

  return { allowed: true };
}

/** Read-only view of today's usage against the same KV counters
 *  checkAndReserveLdhCall writes. Backs GET /usage. */
export async function getLdhUsageToday(
  kv: LdhKvLike,
  nowMs: number,
): Promise<{ day: string; calls_today: number; daily_budget: number; minute_budget: number }> {
  const dKey = dayKey(nowMs);
  const raw = await kv.get(dKey);
  return {
    day: new Date(nowMs).toISOString().slice(0, 10),
    calls_today: raw ? parseInt(raw, 10) || 0 : 0,
    daily_budget: LDH_DAILY_BUDGET,
    minute_budget: LDH_MINUTE_BUDGET,
  };
}
