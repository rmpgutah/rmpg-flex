// src/utils/geocodeBackfill.ts
// One-time cron-driven backfill: forward-geocode calls that have a
// location_address but null lat/lng so they appear on all map surfaces.
//
// Called from the * * * * * cron in src/index.ts (via waitUntil).
// Processes BATCH_SIZE calls per invocation to stay within:
//   - Nominatim's 1 req/sec policy (PACE_MS gap between calls)
//   - Workers' 30 s CPU budget (20 calls × 1.1 s << 30 s)
//
// Self-terminating: returns { done: true } once no unmapped calls remain.
// The cron arm becomes a no-op without any code changes once backfill is done.
//
// Un-geocodable addresses ("UNKNOWN", unparseable intersections) are tracked
// in a KV cooldown ledger and skipped for RETRY_COOLDOWN_MS. Without it the
// `ORDER BY id DESC LIMIT 20` re-selected the same 20 permanently-bad rows
// every minute forever — livelocking the sweep behind them (older backlog
// never reached) and hammering Nominatim with ~28k identical requests/day.

import { geocodeAddress } from '../routes/geocode';
import type { Bindings } from '../types';

const BATCH_SIZE = 20;
const CANDIDATE_FETCH = 100; // over-fetch so cooldown-skipped rows still leave a full batch
const PACE_MS = 1_100; // 1.1 s — comfortably under Nominatim's 1 req/s cap
const FAIL_LEDGER_KEY = 'geocode_backfill_failed_ids';
const RETRY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // retry a failed address weekly
const FAIL_LEDGER_MAX = 1000; // hard cap so the KV value can't grow unbounded

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function backfillCallCoordinates(
  db: D1Database,
  env: Bindings,
): Promise<{ updated: number; done: boolean }> {
  // Load the failure-cooldown ledger (call id → last failed-at ms).
  let failed: Record<string, number> = {};
  try {
    failed = (await env.KV.get<Record<string, number>>(FAIL_LEDGER_KEY, 'json')) ?? {};
  } catch { /* ledger unreadable → behave as before (retry everything) */ }
  const now = Date.now();
  let ledgerDirty = false;
  for (const [id, ts] of Object.entries(failed)) {
    if (now - ts >= RETRY_COOLDOWN_MS) { delete failed[id]; ledgerDirty = true; }
  }

  // Find calls with a meaningful address but no coordinates. Over-fetch so
  // rows sitting in the cooldown ledger don't starve the batch.
  const rows = await db
    .prepare(
      `SELECT id, location_address FROM calls_for_service
       WHERE (latitude IS NULL OR longitude IS NULL)
         AND location_address IS NOT NULL
         AND TRIM(location_address) != ''
         AND LENGTH(TRIM(location_address)) >= 5
       ORDER BY id DESC
       LIMIT ?`,
    )
    .bind(CANDIDATE_FETCH)
    .all<{ id: number; location_address: string }>();

  const candidates = (rows.results ?? []).filter((r) => !(String(r.id) in failed));
  if (candidates.length === 0) {
    if (ledgerDirty) {
      try { await env.KV.put(FAIL_LEDGER_KEY, JSON.stringify(failed)); } catch { /* best-effort */ }
    }
    // done only when there's truly nothing left — rows merely on cooldown
    // aren't "done", they retry after the window.
    return { updated: 0, done: (rows.results ?? []).length === 0 };
  }

  const batch = candidates.slice(0, BATCH_SIZE);
  let updated = 0;
  for (const row of batch) {
    let ok = false;
    try {
      const coords = await geocodeAddress(env, row.location_address.trim());
      if (coords) {
        await db
          .prepare(
            `UPDATE calls_for_service SET latitude = ?, longitude = ?, updated_at = datetime('now') WHERE id = ?`,
          )
          .bind(coords.lat, coords.lng, row.id)
          .run();
        updated++;
        ok = true;
      }
    } catch {
      // fall through to the failure ledger below
    }
    if (!ok) {
      failed[String(row.id)] = now;
      ledgerDirty = true;
    }
    await sleep(PACE_MS);
  }

  if (ledgerDirty) {
    // Trim oldest entries if the ledger somehow exceeds the cap.
    const entries = Object.entries(failed);
    if (entries.length > FAIL_LEDGER_MAX) {
      entries.sort((a, b) => b[1] - a[1]);
      failed = Object.fromEntries(entries.slice(0, FAIL_LEDGER_MAX));
    }
    try { await env.KV.put(FAIL_LEDGER_KEY, JSON.stringify(failed)); } catch { /* best-effort */ }
  }

  // If we filled the whole batch there may be more rows remaining.
  const done = batch.length < BATCH_SIZE;
  return { updated, done };
}
