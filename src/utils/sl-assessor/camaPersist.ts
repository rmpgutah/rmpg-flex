// src/utils/sl-assessor/camaPersist.ts
//
// Writes a CamaParcel into D1: the widened parcel_records columns, the
// parcel_residence 1:1 row, and the two JSON blocks (land records, value
// history).
//
// Kept as its own seam rather than folded into the existing 42-column
// parcel_records upsert in routes/assessor.ts — that statement is already at
// the edge of readable, and a separate UPDATE means a CAMA write can fail
// without taking the core parcel record down with it.
//
// ── D1 bound-parameter budget (CLAUDE.md rule #20) ──────────────────────
// D1 rejects any statement carrying more than 100 bound parameters, at bind
// time. Both statements here are FIXED-WIDTH — their parameter count comes
// from the field registry, not from caller data — so neither can grow with
// row count the way an IN-list does:
//
//   parcel_records UPDATE   42 fields + 6 structural + 1 WHERE  = 49
//   parcel_residence INSERT 54 fields + 1 FK                    = 55
//
// The registry test asserts these stay under the cap, so adding a field to
// camaFields.ts fails loudly rather than at runtime on live data.

import {
  PARCEL_RECORD_EXTRA_FIELDS, PARCEL_RECORD_STRUCTURAL_COLUMNS,
  RESIDENCE_FIELDS,
} from './camaFields';
import type { CamaParcel } from './camaParser';
import { log } from '../logger';

export interface CamaPersistResult {
  parcel_record_id: number | null;
  parcel_columns_written: number;
  residence_written: boolean;
  land_records_written: number;
  value_history_written: number;
}

/**
 * Persist the CAMA build for an already-upserted parcel_records row.
 *
 * Returns a per-block count rather than a bare boolean so a caller (and the
 * audit log) can tell "wrote nothing because the county had nothing" apart
 * from "wrote nothing because the table is missing" — the distinction that
 * makes a silently-degraded backfill detectable.
 *
 * Never throws. A CAMA write failing must not fail the officer's lookup or
 * the backfill job that triggered it; the flat parcel record is already
 * committed by the time this runs.
 */
export async function persistCama(
  db: D1Database,
  parcelNumber: string,
  cama: CamaParcel,
): Promise<CamaPersistResult> {
  const result: CamaPersistResult = {
    parcel_record_id: null,
    parcel_columns_written: 0,
    residence_written: false,
    land_records_written: 0,
    value_history_written: 0,
  };

  try {
    const row = await db.prepare('SELECT id FROM parcel_records WHERE parcel_number = ?')
      .bind(parcelNumber).first<{ id: number }>();
    if (!row) {
      log.warn('[cama-persist] no parcel_records row to attach to', { parcel: parcelNumber });
      return result;
    }
    result.parcel_record_id = row.id;

    // ── parcel_records: parcel + valuation + structural ──────────────────
    const setCols: string[] = [];
    const setVals: unknown[] = [];
    for (const f of PARCEL_RECORD_EXTRA_FIELDS) {
      const v = cama.parcel[f.col];
      if (v === undefined) continue;
      setCols.push(`${f.col} = ?`);
      setVals.push(v);
    }
    const structural: Record<string, unknown> = {
      latitude: cama.latitude,
      longitude: cama.longitude,
      land_records_json: cama.land_records.length ? JSON.stringify(cama.land_records) : null,
      value_history_json: cama.value_history.length ? JSON.stringify(cama.value_history) : null,
      cama_as_of: cama.cama_as_of,
      cama_source_variant: cama.cama_source_variant,
    };
    for (const [col] of PARCEL_RECORD_STRUCTURAL_COLUMNS) {
      setCols.push(`${col} = ?`);
      setVals.push(structural[col] ?? null);
    }
    if (setCols.length) {
      await db.prepare(`UPDATE parcel_records SET ${setCols.join(', ')} WHERE id = ?`)
        .bind(...setVals, row.id).run();
      result.parcel_columns_written = setCols.length;
    }
    result.land_records_written = cama.land_records.length;
    result.value_history_written = cama.value_history.length;

    // ── parcel_residence (1:1) ───────────────────────────────────────────
    // Only written when the county actually published a residence block. A
    // vacant lot or a commercial parcel legitimately has none, and an
    // all-null row would be indistinguishable from a parse failure.
    const hasResidence = RESIDENCE_FIELDS.some((f) => cama.residence[f.col] != null);
    if (hasResidence) {
      const cols = RESIDENCE_FIELDS.map((f) => f.col);
      const vals = RESIDENCE_FIELDS.map((f) => cama.residence[f.col] ?? null);
      const placeholders = cols.map(() => '?').join(', ');
      const updates = cols.map((c) => `${c} = excluded.${c}`).join(', ');
      await db.prepare(`
        INSERT INTO parcel_residence (parcel_record_id, ${cols.join(', ')})
        VALUES (?, ${placeholders})
        ON CONFLICT(parcel_record_id) DO UPDATE SET
          ${updates},
          updated_at = datetime('now')
      `).bind(row.id, ...vals).run();
      result.residence_written = true;
    }
  } catch (err) {
    // Degrade, don't fail. Logged at error so a systematic breakage (a
    // missing column after an unapplied migration) is still visible in
    // Workers Logs rather than being swallowed entirely.
    log.error('[cama-persist] failed', { parcel: parcelNumber }, err instanceof Error ? err : undefined);
  }
  return result;
}

/** Read the CAMA build back for a parcel.
 *
 *  ⚠️ Explicit column list, never SELECT *. parcel_records now carries ~94
 *  columns and D1 caps a SELECT result set at ~100 — a `SELECT p.*, r.*`
 *  join across parcel_records and parcel_residence would be ~148 and fail
 *  on live data while passing every local test with a narrow fixture.
 */
export async function readCama(
  db: D1Database,
  parcelNumber: string,
): Promise<{
  parcel: Record<string, unknown> | null;
  residence: Record<string, unknown> | null;
  land_records: unknown[];
  value_history: unknown[];
} | null> {
  const parcelCols = [
    ...PARCEL_RECORD_EXTRA_FIELDS.map((f) => f.col),
    ...PARCEL_RECORD_STRUCTURAL_COLUMNS.map(([c]) => c),
  ];
  try {
    const rec = await db.prepare(
      `SELECT id, ${parcelCols.join(', ')} FROM parcel_records WHERE parcel_number = ?`,
    ).bind(parcelNumber).first<Record<string, unknown>>();
    if (!rec) return null;

    const residence = await db.prepare(
      `SELECT ${RESIDENCE_FIELDS.map((f) => f.col).join(', ')}
       FROM parcel_residence WHERE parcel_record_id = ?`,
    ).bind(rec.id).first<Record<string, unknown>>();

    return {
      parcel: rec,
      residence: residence ?? null,
      land_records: safeJson(rec.land_records_json),
      value_history: safeJson(rec.value_history_json),
    };
  } catch (err) {
    log.error('[cama-persist] read failed', { parcel: parcelNumber }, err instanceof Error ? err : undefined);
    return null;
  }
}

function safeJson(v: unknown): unknown[] {
  if (typeof v !== 'string' || !v) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
