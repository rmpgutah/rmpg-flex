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

import { geocodeAddress } from '../routes/geocode';
import type { Bindings } from '../types';

const BATCH_SIZE = 20;
const PACE_MS = 1_100; // 1.1 s — comfortably under Nominatim's 1 req/s cap

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function backfillCallCoordinates(
  db: D1Database,
  env: Bindings,
): Promise<{ updated: number; done: boolean }> {
  // Find calls with a meaningful address but no coordinates.
  // Limit to BATCH_SIZE to stay within CPU budget.
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
    .bind(BATCH_SIZE)
    .all<{ id: number; location_address: string }>();

  if (!rows.results || rows.results.length === 0) {
    return { updated: 0, done: true };
  }

  let updated = 0;
  for (const row of rows.results) {
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
      }
    } catch {
      // skip individual failures — next cron tick will retry
    }
    await sleep(PACE_MS);
  }

  // If we filled the whole batch there may be more rows remaining.
  const done = rows.results.length < BATCH_SIZE;
  return { updated, done };
}
