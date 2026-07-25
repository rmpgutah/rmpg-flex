import type { D1Database } from '@cloudflare/workers-types';
import type { IntelSeed, RawDataPoint, SourceResult } from './types';

function personRow(row: any): RawDataPoint[] {
  const pts: RawDataPoint[] = [];
  const src = 'InternalRecords';
  if (row.address) pts.push({ category: 'address', field: 'street', value: row.address, source: src });
  if (row.city) pts.push({ category: 'address', field: 'city', value: row.city, source: src });
  if (row.state) pts.push({ category: 'address', field: 'state', value: row.state, source: src });
  if (row.zip) pts.push({ category: 'address', field: 'zip', value: row.zip, source: src });
  if (row.phone) pts.push({ category: 'phone', field: 'number', value: row.phone, source: src });
  if (row.email) pts.push({ category: 'email', field: 'address', value: row.email, source: src });
  if (row.date_of_birth) pts.push({ category: 'legal', field: 'dob', value: row.date_of_birth, source: src });
  if (row.full_name) pts.push({ category: 'legal', field: 'name', value: row.full_name, source: src });
  return pts;
}

function vehicleRow(row: any): RawDataPoint[] {
  const src = 'InternalRecords';
  const pts: RawDataPoint[] = [];
  if (row.plate_number) pts.push({ category: 'vehicle', field: 'plate', value: row.plate_number, source: src });
  if (row.make) pts.push({ category: 'vehicle', field: 'make', value: row.make, source: src });
  if (row.model) pts.push({ category: 'vehicle', field: 'model', value: row.model, source: src });
  if (row.color) pts.push({ category: 'vehicle', field: 'color', value: row.color, source: src });
  return pts;
}

// `persons` has first_name/last_name/dob — there is no full_name or
// date_of_birth column, so every query here threw "no such column: full_name"
// and Phase 1 silently returned no internal records. personRow() above reads
// row.full_name / row.date_of_birth, so alias in SQL rather than reshaping the
// consumer. Same concat idiom already used in records.ts:891.
const PERSON_NAME_SQL = "(first_name || ' ' || last_name)";
const PERSON_COLS =
  `${PERSON_NAME_SQL} AS full_name, dob AS date_of_birth, address, city, state, zip, phone, email`;

export async function queryPhase1(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  const pts: RawDataPoint[] = [];
  const src = 'InternalRecords';

  try {
    if (seed.name) {
      const like = `%${seed.name.split(' ')[0]}%`;
      const { results } = await db.prepare(
        `SELECT ${PERSON_COLS} FROM persons WHERE ${PERSON_NAME_SQL} LIKE ? LIMIT 10`
      ).bind(like).all<any>();
      for (const r of results) pts.push(...personRow(r));
    }
    if (seed.phone) {
      const { results } = await db.prepare(
        `SELECT ${PERSON_COLS} FROM persons WHERE phone = ? LIMIT 5`
      ).bind(seed.phone).all<any>();
      for (const r of results) {
        if (!pts.some(p => p.field === 'phone' && p.value === r.phone)) pts.push({ category: 'phone', field: 'number', value: seed.phone, source: src });
        pts.push(...personRow(r));
      }
    }
    if (seed.email) {
      const { results } = await db.prepare(
        `SELECT ${PERSON_COLS} FROM persons WHERE email = ? LIMIT 5`
      ).bind(seed.email).all<any>();
      for (const r of results) pts.push(...personRow(r));
    }
    if (seed.plate) {
      const { results } = await db.prepare(
        'SELECT plate_number,make,model,color,year FROM vehicles_records WHERE plate_number = ? LIMIT 5'
      ).bind(seed.plate.toUpperCase()).all<any>();
      for (const r of results) pts.push(...vehicleRow(r));
    }

    return { sourceName: src, phase: 1, status: 'success', dataPoints: pts, connections: [], responseTimeMs: Date.now() - t0 };
  } catch (e: any) {
    return { sourceName: src, phase: 1, status: 'error', dataPoints: [], connections: [], responseTimeMs: Date.now() - t0, errorMessage: String(e?.message ?? e) };
  }
}
