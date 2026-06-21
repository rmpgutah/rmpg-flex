// ============================================================
// RMPG Flex — Salt Lake County Assessor lookup + apply
// ============================================================
// /api/assessor surface:
//   GET  /parcels?address=<addr>      — search; KV-cached 30d
//   GET  /parcel/:parcel_no           — detail; KV-cached 30d
//   POST /apply  { record_type, record_id, parcel_number }
//                                     — never-clobber autofill onto
//                                       businesses|properties + upsert
//                                       parcel_records + replace parcel_sales
//
// All upstream IO funnels through src/utils/sl-assessor/client.ts (Firecrawl
// scrape → parser). Without FIRECRAWL_API_KEY any cache-miss path returns
// 503 not_configured — by design.
//
// ensureAssessorColumns(db) runs at the top of every handler that touches
// the new parcel_records / parcel_sales tables or the business/property
// columns. It is self-caching, so subsequent calls in the same isolate
// are cheap — but skipping it would 500 with "no such table" on a cold
// isolate hitting live D1 if migration 0142 didn't land (deploy applies
// migrations with continue-on-error: true; see CLAUDE.md rule #5).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, columnExists, ensureAssessorColumns } from '../utils/db';
import { recordAudit } from '../utils/auditLog';
import {
  cacheKeyParcels, cacheKeyParcel, getCached, putCached,
} from '../utils/sl-assessor/cache';
import { searchByAddress, getParcel } from '../utils/sl-assessor/client';
import { applyParcelToRecord } from '../utils/sl-assessor/autofill';
import {
  AssessorConfigError, AssessorHttpError, AssessorParseError, AssessorTimeoutError,
} from '../utils/sl-assessor/types';
import type { Parcel, ParcelSummary } from '../utils/sl-assessor/types';

const app = new Hono<Env>();

function handleError(c: any, e: unknown) {
  if (e instanceof AssessorConfigError)
    return c.json({ code: 'not_configured', message: e.message }, 503);
  if (e instanceof AssessorTimeoutError)
    return c.json({ code: 'timeout', message: e.message }, 503);
  if (e instanceof AssessorHttpError)
    return c.json({ code: 'upstream', status: e.status, message: e.message }, 503);
  if (e instanceof AssessorParseError)
    return c.json({ code: 'parse_error', message: e.message }, 500);
  return c.json({ code: 'unknown', message: (e as Error)?.message ?? 'unknown' }, 500);
}

app.get('/parcels', async (c) => {
  const address = c.req.query('address')?.trim();
  if (!address) return c.json({ code: 'missing_address' }, 400);
  const key = cacheKeyParcels(address);
  try {
    const cached = await getCached<ParcelSummary[]>(c.env, key);
    if (cached) return c.json({ parcels: cached, cached: true, source_url: null });
    const parcels = await searchByAddress(c.env, address);
    await putCached(c.env, key, parcels);
    return c.json({ parcels, cached: false, source_url: null });
  } catch (e) { return handleError(c, e); }
});

app.get('/parcel/:parcel_no', async (c) => {
  const parcelNo = c.req.param('parcel_no');
  if (!parcelNo) return c.json({ code: 'missing_parcel_no' }, 400);
  const key = cacheKeyParcel(parcelNo);
  try {
    const cached = await getCached<Parcel>(c.env, key);
    if (cached) return c.json({ parcel: cached, sales: cached.sales, cached: true });
    const parcel = await getParcel(c.env, parcelNo);
    await putCached(c.env, key, parcel);
    return c.json({ parcel, sales: parcel.sales, cached: false });
  } catch (e) { return handleError(c, e); }
});

/**
 * POST /apply  { record_type: 'business'|'property', record_id, parcel_number }
 * Looks up the parcel (cached or fetched), applies never-clobber autofill onto
 * the target record, upserts parcel_records, and replaces parcel_sales. Audits
 * the write AFTER it lands so a failed write doesn't audit success.
 */
app.post('/apply', async (c) => {
  const body = await c.req.json().catch(() => null) as
    { record_type?: string; record_id?: number; parcel_number?: string } | null;
  if (!body?.record_type || !body.record_id || !body.parcel_number)
    return c.json({ code: 'missing_fields' }, 400);
  const table = body.record_type === 'business' ? 'businesses'
              : body.record_type === 'property' ? 'properties' : null;
  if (!table) return c.json({ code: 'bad_record_type' }, 400);

  const db = getDb(c.env);
  // Self-heal: ensure the new columns + parcel_records/parcel_sales tables
  // exist before any read or write touches them.
  await ensureAssessorColumns(db);

  const record = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`)
    .bind(body.record_id).first<Record<string, unknown>>();
  if (!record) return c.json({ code: 'not_found' }, 404);

  let parcel: Parcel;
  try {
    const cached = await getCached<Parcel>(c.env, cacheKeyParcel(body.parcel_number));
    parcel = cached ?? await getParcel(c.env, body.parcel_number);
    if (!cached) await putCached(c.env, cacheKeyParcel(body.parcel_number), parcel);
  } catch (e) { return handleError(c, e); }

  const { patch, skipped } = applyParcelToRecord(record, parcel);
  // Build dynamic UPDATE — only known columns. columnExists() guards against
  // a partial reconciliation where one ALTER landed but another didn't.
  const setSql: string[] = [];
  const setBind: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(await columnExists(db, table, k))) continue;
    setSql.push(`${k} = ?`);
    setBind.push(v);
  }
  if (setSql.length) {
    await db.prepare(`UPDATE ${table} SET ${setSql.join(', ')} WHERE id = ?`)
      .bind(...setBind, body.record_id).run();
  }

  // Upsert the full parcel record. parcel_number is UNIQUE (mig 0142), so
  // ON CONFLICT(parcel_number) DO UPDATE is the canonical upsert here.
  await db.prepare(`
    INSERT INTO parcel_records (
      parcel_number, source, source_url, account_number, serial_number, tax_district,
      owner_of_record, owner_type, owner_mailing_address,
      situs_address, situs_city, situs_zip, subdivision,
      land_acres, land_sqft, land_value, zoning,
      year_built, effective_year_built, total_bldg_sqft, finished_sqft, basement_sqft, garage_sqft,
      stories, bedrooms, bathrooms, construction_type, improvement_class, improvement_value,
      market_value_total, market_value_land, market_value_improvement,
      taxable_value, assessed_value, tax_year,
      legal_description, plat, lot, block, raw_data_json,
      fetched_at, refreshed_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      datetime('now'), datetime('now')
    )
    ON CONFLICT(parcel_number) DO UPDATE SET
      owner_of_record = excluded.owner_of_record,
      owner_type = excluded.owner_type,
      owner_mailing_address = excluded.owner_mailing_address,
      situs_address = excluded.situs_address,
      market_value_total = excluded.market_value_total,
      year_built = excluded.year_built,
      legal_description = excluded.legal_description,
      raw_data_json = excluded.raw_data_json,
      refreshed_at = datetime('now')
  `).bind(
    parcel.parcel_number, parcel.source, parcel.source_url, parcel.account_number, parcel.serial_number, parcel.tax_district,
    parcel.owner_of_record, parcel.owner_type, parcel.owner_mailing_address,
    parcel.situs_address, parcel.situs_city, parcel.situs_zip, parcel.subdivision,
    parcel.land_acres, parcel.land_sqft, parcel.land_value, parcel.zoning,
    parcel.year_built, parcel.effective_year_built, parcel.total_bldg_sqft, parcel.finished_sqft, parcel.basement_sqft, parcel.garage_sqft,
    parcel.stories, parcel.bedrooms, parcel.bathrooms, parcel.construction_type, parcel.improvement_class, parcel.improvement_value,
    parcel.market_value_total, parcel.market_value_land, parcel.market_value_improvement,
    parcel.taxable_value, parcel.assessed_value, parcel.tax_year,
    parcel.legal_description, parcel.plat, parcel.lot, parcel.block,
    JSON.stringify(parcel.raw_data_json),
  ).run();

  // Replace sales history. DELETE before INSERT so a partial failure leaves
  // the table in a coherent state (worst case: no sales rather than stale rows).
  const pr = await db.prepare('SELECT id FROM parcel_records WHERE parcel_number = ?')
    .bind(parcel.parcel_number).first<{ id: number }>();
  if (pr) {
    await db.prepare('DELETE FROM parcel_sales WHERE parcel_record_id = ?').bind(pr.id).run();
    for (const s of parcel.sales) {
      await db.prepare(`
        INSERT INTO parcel_sales (parcel_record_id, sale_date, sale_price, doc_number, buyer, seller, sale_type)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(pr.id, s.sale_date, s.sale_price, s.doc_number, s.buyer, s.seller, s.sale_type).run();
    }
  }

  // Audit AFTER the writes — a failed write must not log a success.
  await recordAudit(c, {
    action: 'ASSESSOR_APPLIED',
    entityType: body.record_type,
    entityId: body.record_id,
    details: {
      parcel_number: parcel.parcel_number,
      fields_set: Object.keys(patch).filter((k) => k !== 'assessor_source_url' && k !== 'assessor_last_synced_at'),
      skipped,
    },
  });

  return c.json({ ok: true, patch, skipped, parcel_record_id: pr?.id ?? null });
});

export default app;
