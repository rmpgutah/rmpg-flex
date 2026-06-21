// src/utils/sl-assessor/backfill.ts
// Process up to PER_TICK_BUDGET pending jobs in one scheduled invocation,
// bounded by TICK_WALL_CLOCK_MS so the handler can't overrun. Called from
// the existing per-minute scheduled() handler.

import { searchByAddress, getParcel } from './client';
import { applyParcelToRecord } from './autofill';
import { cacheKeyParcel, getCached, putCached } from './cache';
import type { ParcelSummary } from './types';
import type { Env } from '../../types';

export const BACKFILL_RATE_PER_MIN = 30;
const PER_TICK_BUDGET = 5;            // ≤5 jobs per scheduled minute = 300/hr; safely under the 30/min spec cap
const TICK_WALL_CLOCK_MS = 22_000;    // leave ~8s headroom under the 30s scheduled-handler limit

interface OutcomeApplied {
  status: 'applied';
  applied_parcel_number: string;
}
interface OutcomeAmbiguous {
  status: 'ambiguous';
  matches_json: string;
}
interface OutcomeOther {
  status: 'no_match' | 'unfetchable' | 'error';
  error_message?: string;
}
export type Outcome = OutcomeApplied | OutcomeAmbiguous | OutcomeOther;

/** Pure: pick the right status from a list of matched parcels. */
export function decideOutcome(matches: ParcelSummary[]): Outcome {
  if (matches.length === 0) return { status: 'no_match' };
  if (matches.length === 1) {
    return { status: 'applied', applied_parcel_number: matches[0].parcel_number };
  }
  return { status: 'ambiguous', matches_json: JSON.stringify(matches) };
}

export async function processBackfillTick(env: Env['Bindings']): Promise<number> {
  const started = Date.now();
  let processed = 0;
  while (processed < PER_TICK_BUDGET && Date.now() - started < TICK_WALL_CLOCK_MS) {
    const ok = await processOneJob(env);
    if (!ok) break;
    processed++;
  }
  return processed;
}

async function processOneJob(env: Env['Bindings']): Promise<boolean> {
  const db = env.DB;
  const row = await db.prepare(`
    SELECT id, record_type, record_id, retry_count
    FROM assessor_backfill_jobs
    WHERE status = 'pending' AND retry_count < 3
    ORDER BY id ASC LIMIT 1
  `).first<{ id: number; record_type: 'business' | 'property'; record_id: number; retry_count: number }>();
  if (!row) return false;

  await db.prepare(`UPDATE assessor_backfill_jobs SET started_at = datetime('now') WHERE id = ?`)
    .bind(row.id).run();

  const table = row.record_type === 'business' ? 'businesses' : 'properties';
  const rec = await db.prepare(`SELECT id, address FROM ${table} WHERE id = ?`).bind(row.record_id).first<{ id: number; address: string }>();
  if (!rec || !rec.address || !/\d/.test(rec.address)) {
    await db.prepare(`UPDATE assessor_backfill_jobs SET status = 'unfetchable', completed_at = datetime('now') WHERE id = ?`).bind(row.id).run();
    return true;
  }

  let matches: ParcelSummary[];
  try {
    matches = await searchByAddress(env, rec.address);
  } catch (e: any) {
    const retry = row.retry_count + 1;
    if (retry >= 3) {
      await db.prepare(`UPDATE assessor_backfill_jobs SET status='error', retry_count=?, error_message=?, completed_at=datetime('now') WHERE id=?`).bind(retry, e?.message ?? 'unknown', row.id).run();
    } else {
      await db.prepare(`UPDATE assessor_backfill_jobs SET retry_count=? WHERE id=?`).bind(retry, row.id).run();
    }
    return true;
  }

  const outcome = decideOutcome(matches);

  if (outcome.status === 'applied') {
    const parcelNo = outcome.applied_parcel_number;
    let parcel = await getCached<any>({ KV: env.KV }, cacheKeyParcel(parcelNo));
    if (!parcel) {
      try { parcel = await getParcel(env, parcelNo); }
      catch { /* detail fetch failed — still mark parcel_number to prevent requeue */ }
    }
    if (parcel) {
      await putCached({ KV: env.KV }, cacheKeyParcel(parcelNo), parcel);
      const fullRec = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(row.record_id).first<Record<string, unknown>>() ?? {};
      const { patch } = applyParcelToRecord(fullRec, parcel);
      const setSql: string[] = [];
      const setBind: unknown[] = [];
      for (const [k, v] of Object.entries(patch)) {
        setSql.push(`${k} = ?`); setBind.push(v);
      }
      if (setSql.length) {
        await db.prepare(`UPDATE ${table} SET ${setSql.join(', ')} WHERE id = ?`).bind(...setBind, row.record_id).run();
      }
    } else {
      await db.prepare(`UPDATE ${table} SET parcel_number = ? WHERE id = ?`).bind(parcelNo, row.record_id).run();
    }
    await db.prepare(`UPDATE assessor_backfill_jobs SET status='applied', applied_parcel_number=?, completed_at=datetime('now') WHERE id=?`).bind(parcelNo, row.id).run();
  } else if (outcome.status === 'ambiguous') {
    await db.prepare(`UPDATE assessor_backfill_jobs SET status='ambiguous', matches_json=?, completed_at=datetime('now') WHERE id=?`).bind(outcome.matches_json, row.id).run();
  } else {
    await db.prepare(`UPDATE assessor_backfill_jobs SET status='no_match', completed_at=datetime('now') WHERE id=?`).bind(row.id).run();
    await db.prepare(`UPDATE ${table} SET assessor_last_synced_at = datetime('now') WHERE id = ?`).bind(row.record_id).run();
  }
  return true;
}
