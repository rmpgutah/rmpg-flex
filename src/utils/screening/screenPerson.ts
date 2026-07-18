// ============================================================
// RMPG Flex — On-demand all-sources person screening
// ============================================================
// screenPersonAllSources() runs every registered screening adapter
// against ONE person right now, independent of the watchlist/cadence
// system runScreeningScans() drives (that system only scans persons
// already on screening_watchlist/intel_watchlist, on a per-source
// interval). This is the "screen this person against everything,
// immediately" entry point that didn't exist before.
//
// Callers: POST /warrants (warrant create, fire-and-forget),
// PUT /warrants/:id (subject_person_id change, fire-and-forget),
// POST /api/screening/screen-person/:id (manual "Screen Now" button,
// awaited so the caller sees the result).
//
// Shares scanPersonAgainstAdapter() with the batch cron path (see
// src/utils/screening/runScreeningScans.ts) so both call sites
// score/upsert screening_hits identically — no duplicated logic.
// ============================================================

import type { Bindings } from '../../types';
import type { PersonRow } from './types';
import { getDb, queryFirst } from '../db';
import { getAdapters } from './registry';
import { scanPersonAgainstAdapter, shouldRunSource, type SourceRunState } from './runScreeningScans';

async function configThreshold(env: Bindings, sourceKey: string): Promise<number> {
  const row = await queryFirst<{ config_value: string }>(getDb(env),
    'SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1',
    `screening_${sourceKey.replace(/-/g, '_')}_min_score`).catch(() => null);
  const n = row ? parseInt(row.config_value, 10) : NaN;
  return (Number.isFinite(n) ? n : 80) / 100;
}

export interface ScreenPersonOpts { triggeredBy?: string }
export interface ScreenPersonResult { sourcesRun: number; newHits: number; errors: number }

export async function screenPersonAllSources(
  env: Bindings,
  personId: number,
  opts: ScreenPersonOpts = {},
): Promise<ScreenPersonResult> {
  const db = getDb(env);
  const person = await queryFirst<PersonRow>(
    db, 'SELECT id, first_name, middle_name, last_name, dob, citizenship FROM persons WHERE id = ?', personId,
  );
  if (!person) return { sourcesRun: 0, newHits: 0, errors: 0 };

  let sourcesRun = 0, newHits = 0, errors = 0;
  for (const adapter of getAdapters()) {
    if (!adapter.supportsWatch) continue;
    const state = await queryFirst<SourceRunState>(db,
      `SELECT enabled, circuit_broken,
              (julianday('now') - julianday(last_run_at)) * 24 AS hours_since_run
         FROM screening_source_state WHERE source_key = ?`, adapter.sourceKey).catch(() => null);
    if (!shouldRunSource(state)) continue; // disabled or cooling down — same gate runOne uses
    const threshold = await configThreshold(env, adapter.sourceKey);
    try {
      const result = await scanPersonAgainstAdapter(env, adapter, person, { threshold });
      sourcesRun++;
      newHits += result.newHits;
      errors += result.errors;
    } catch (err) {
      errors++;
      console.warn(`[screening] on-demand ${adapter.sourceKey} for person ${personId} (${opts.triggeredBy ?? 'unknown'}) failed:`, err);
    }
  }
  return { sourcesRun, newHits, errors };
}
