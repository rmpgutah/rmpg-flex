// Fill-only promotion of verified aggregator data points onto a persons row.
// Never clobbers officer-entered values (COALESCE NULLIF blank). A point is
// eligible only when confidence ≥ 0.60 AND at least two independent sources
// (or InternalRecords plus one aggregator) corroborate it.

import type { D1Database } from '@cloudflare/workers-types';
import { execute, query, queryFirst } from '../db';
import { normalizeDob } from '../normalizeDob';
import { log } from '../logger';

export const PRIMARY_CONFIDENCE = 0.60;
export const NOISE_FLOOR = 0.40;

const AGGREGATORS = new Set([
  'InternalRecords',
  'MicroBilt',
  'Pipl',
  'Spokeo',
  'SkipTracerFlex',
  'Clearbit',
  'HunterIO',
  'NumVerify',
]);

export interface IntelDataPointRow {
  category: string;
  field: string;
  value: string;
  sources: string[] | string;
  confidence: number;
  verified_by?: number;
  promoted?: number;
}

export function parseSources(raw: string[] | string | null | undefined): string[] {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [String(raw)];
  } catch {
    return [String(raw)];
  }
}

export function isVerifiedAggregatorPoint(dp: IntelDataPointRow): boolean {
  if (dp.confidence < PRIMARY_CONFIDENCE) return false;
  const sources = parseSources(dp.sources);
  const unique = [...new Set(sources)];
  if (unique.length >= 2) return true;
  if (unique.length === 1 && unique[0] === 'InternalRecords' && dp.confidence >= 0.80) return true;
  const aggregatorHits = unique.filter((s) => AGGREGATORS.has(s));
  return aggregatorHits.length >= 2;
}

const FIELD_TO_COLUMN: Record<string, string> = {
  'address:street': 'address',
  'address:city': 'city',
  'address:state': 'state',
  'address:zip': 'zip',
  'phone:number': 'phone',
  'email:address': 'email',
  'legal:dob': 'dob',
  'legal:born': 'dob',
};

export interface ApplyVerifiedResult {
  personId: number;
  filled: string[];
  skipped: string[];
}

export async function applyVerifiedPointsToPerson(
  db: D1Database,
  personId: number,
  points: IntelDataPointRow[],
): Promise<ApplyVerifiedResult> {
  const filled: string[] = [];
  const skipped: string[] = [];
  const patch: Record<string, string> = {};

  for (const dp of points) {
    if (!isVerifiedAggregatorPoint(dp)) {
      skipped.push(`${dp.category}.${dp.field}`);
      continue;
    }
    const col = FIELD_TO_COLUMN[`${dp.category}:${dp.field}`];
    if (!col) {
      skipped.push(`${dp.category}.${dp.field}`);
      continue;
    }
    let value = String(dp.value).trim();
    if (col === 'dob') {
      const iso = normalizeDob(value);
      if (!iso) { skipped.push(`${dp.category}.${dp.field}`); continue; }
      value = iso;
    }
    if (!value) { skipped.push(`${dp.category}.${dp.field}`); continue; }
    if (!patch[col]) patch[col] = value;
  }

  if (!Object.keys(patch).length) return { personId, filled, skipped };

  const person = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM persons WHERE id = ?', personId);
  if (!person) return { personId, filled, skipped };

  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [col, value] of Object.entries(patch)) {
    const current = person[col];
    const blank = current == null || String(current).trim() === '';
    if (!blank) {
      skipped.push(col);
      continue;
    }
    sets.push(`${col} = COALESCE(NULLIF(${col},''), ?)`);
    binds.push(value);
    filled.push(col);
  }
  if (!sets.length) return { personId, filled, skipped };

  try {
    await execute(db, `UPDATE persons SET ${sets.join(', ')} WHERE id = ?`, ...binds, personId);
  } catch (err) {
    log.error('applyVerifiedPointsToPerson failed', { personId }, err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
  return { personId, filled, skipped };
}

export async function loadDossierPoints(db: D1Database, dossierId: number): Promise<IntelDataPointRow[]> {
  const rows = await query<any>(
    db,
    `SELECT category, field, value, sources, confidence, verified_by, promoted
       FROM person_intel_data_points WHERE dossier_id = ?`,
    dossierId,
  );
  return rows.map((r: any) => ({
    category: r.category,
    field: r.field,
    value: r.value,
    sources: parseSources(r.sources),
    confidence: r.confidence,
    verified_by: r.verified_by,
    promoted: r.promoted,
  }));
}

export function shouldPersistPoint(confidence: number): boolean {
  return confidence >= NOISE_FLOOR;
}

export function autoPromote(confidence: number, sourceCount: number): boolean {
  return confidence >= PRIMARY_CONFIDENCE && sourceCount >= 2;
}
