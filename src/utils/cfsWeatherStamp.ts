// Persist a CFS weather snapshot onto calls_for_service_ext.
// Best-effort: never throws to the caller.

import type { D1Database } from '@cloudflare/workers-types';
import { execute, columnExists } from './db';
import { log } from './logger';
import {
  fetchCfsWeather,
  isHazardousSnapshot,
  parseWeatherSnapshot,
  type CfsWeatherSnapshot,
} from './cfsWeather';

let weatherColsEnsured = false;

export async function ensureCfsWeatherColumns(db: D1Database): Promise<void> {
  if (weatherColsEnsured) return;
  for (const [col, ddl] of [
    ['weather_snapshot', 'TEXT'],
    ['weather_manual', 'INTEGER DEFAULT 0'],
  ] as const) {
    try {
      if (!(await columnExists(db, 'calls_for_service_ext', col))) {
        await execute(db, `ALTER TABLE calls_for_service_ext ADD COLUMN ${col} ${ddl}`);
      }
    } catch (err) {
      log.warn('ensureCfsWeatherColumns alter failed', { col, err: String(err) });
    }
  }
  weatherColsEnsured = true;
}

export async function stampCallWeather(
  db: D1Database,
  opts: {
    callId: number;
    lat: number | null | undefined;
    lng: number | null | undefined;
    at?: string | null;
    existingConditions?: string | null;
    existingLighting?: string | null;
    weatherManual?: boolean;
    /** When true (created_at edited), scene category is overwritten. */
    overwriteConditions?: boolean;
  },
): Promise<CfsWeatherSnapshot | null> {
  const lat = opts.lat == null ? null : Number(opts.lat);
  const lng = opts.lng == null ? null : Number(opts.lng);
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const snap = await fetchCfsWeather({ lat, lng, at: opts.at ?? null });
  if (!snap) return null;

  try {
    await ensureCfsWeatherColumns(db);
    await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', opts.callId);
    await execute(
      db,
      `UPDATE calls_for_service_ext SET weather_snapshot = ?, weather_manual = CASE
         WHEN ? = 1 THEN 0 ELSE COALESCE(weather_manual, 0) END
       WHERE id = ?`,
      JSON.stringify(snap),
      opts.overwriteConditions ? 1 : 0,
      opts.callId,
    );

    const fillConditions = opts.overwriteConditions || !opts.weatherManual;
    const sets: string[] = [];
    const params: unknown[] = [];
    if (fillConditions || !opts.existingConditions) {
      sets.push('weather_conditions = ?');
      params.push(snap.scene_category);
    }
    if (opts.overwriteConditions && snap.lighting) {
      sets.push('lighting_conditions = ?');
      params.push(snap.lighting);
    } else if (!opts.existingLighting && snap.lighting) {
      sets.push("lighting_conditions = COALESCE(NULLIF(lighting_conditions, ''), ?)");
      params.push(snap.lighting);
    }
    if (isHazardousSnapshot(snap)) {
      sets.push('officer_safety_caution = 1');
    }
    if (sets.length) {
      params.push(opts.callId);
      await execute(
        db,
        `UPDATE calls_for_service SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
        ...params,
      );
    }
  } catch (err) {
    log.warn('stampCallWeather persist failed (non-fatal)', { callId: opts.callId, err: String(err) });
  }

  return snap;
}

export { parseWeatherSnapshot };
