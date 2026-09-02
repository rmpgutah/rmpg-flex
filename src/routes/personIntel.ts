// src/routes/personIntel.ts
import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../types';
import { execute, query } from '../utils/db';
import { ensurePersonIntelSchema } from '../utils/personIntel/schema';
import type { IntelSeed, VerificationMethod } from '../utils/personIntel/types';
import { fetchCrossRefs, persistCrossRefs } from '../utils/personIntel/crossReference';
import { computeVerdict, persistVerification, fetchVerifications, effectiveConfidence } from '../utils/personIntel/verification';
import { applyVerifiedPointsToPerson, loadDossierPoints } from '../utils/personIntel/applyVerifiedToPerson';
import { runLegalPhase } from '../utils/personIntel/phaseLegal';
import { pendingCentraliaResult, normalizeCentraliaResult, centraliaToDataPoints } from '../utils/personIntel/centraliaModel';
import { extractOpinionWithAi } from '../utils/personIntel/centraliaExtractAi';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { log } from '../utils/logger';

const app = new Hono<Env>();

app.use('*', async (c, next) => {
  await ensurePersonIntelSchema(c.env.DB);
  return next();
});

// A dossier is scoped to its creator (or org). The list endpoint enforces
// `WHERE created_by = ? OR org_id = ?`, but the detail / annotate / delete
// paths fetched purely by :id and applied no scope — so any authenticated
// non-client_viewer role could read, alter, or permanently DELETE another
// user's OSINT subject dossier (and its data points / connections / sources)
// by enumerating sequential ids. Supervisory roles legitimately see all
// dossiers; everyone else is confined to their own.
const INTEL_OVERSIGHT_ROLES = new Set(['admin', 'manager', 'supervisor']);

// Returns null if the caller may act on this dossier, or a 403/404 Response.
async function authorizeDossier(c: any, dossierId: number): Promise<Response | null> {
  const user = c.get('user');
  const row = await c.env.DB.prepare(
    'SELECT created_by, org_id FROM person_intelligence WHERE id = ?'
  ).bind(dossierId).first() as { created_by: number | null; org_id: string | null } | null;
  if (!row) return c.json({ error: 'not found' }, 404);
  if (INTEL_OVERSIGHT_ROLES.has(user.role)) return null;
  const orgId: string | null = (user as any).org_id ?? null;
  const ownsByUser = row.created_by != null && row.created_by === user.id;
  const ownsByOrg = orgId != null && row.org_id != null && row.org_id === orgId;
  if (ownsByUser || ownsByOrg) return null;
  return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
}

// POST /api/person-intel — create dossier + kick off PersonIntelDO
app.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ seed: IntelSeed; notes?: string }>();
  if (!body.seed || Object.keys(body.seed).filter(k => (body.seed as any)[k]).length === 0) {
    return c.json({ error: 'seed required' }, 400);
  }

  const now = new Date().toISOString();
  const subjectName = body.seed.name ?? body.seed.email ?? body.seed.phone ?? body.seed.plate ?? 'Unknown';
  const orgId: string | null = (user as any).org_id ?? null;
  const result = await c.env.DB.prepare(
    `INSERT INTO person_intelligence (subject_seed, subject_name, subject_dob, status, phase, created_by, org_id, notes, created_at)
     VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?)`
  ).bind(JSON.stringify(body.seed), subjectName, body.seed.dob ?? null, user.id, orgId, body.notes ?? null, now).run();

  const dossierId = result.meta.last_row_id as number;

  // Launch PersonIntelDO
  const id = c.env.PERSON_INTEL_DO.idFromName(`pi-${dossierId}`);
  const stub = c.env.PERSON_INTEL_DO.get(id);
  await stub.fetch('https://do/', { method: 'POST', body: JSON.stringify({ dossierId, seed: body.seed }), headers: { 'Content-Type': 'application/json' } });

  return c.json({ ok: true, dossierId });
});

// GET /api/person-intel — list dossiers
app.get('/', async (c) => {
  const user = c.get('user');
  const orgId: string | null = (user as any).org_id ?? null;
  try {
    const rows = await c.env.DB.prepare(
      `SELECT id, subject_name, subject_dob, status, phase, risk_score, risk_flags, linked_person_id, data_points_found, cross_refs_found, created_at, completed_at
       FROM person_intelligence WHERE created_by = ? OR org_id = ?
       ORDER BY created_at DESC LIMIT 50`
    ).bind(user.id, orgId ?? '').all();
    return c.json(rows.results);
  } catch (err) {
    log.warn('person-intel list falling back without cross_refs_found', {
      message: err instanceof Error ? err.message : String(err),
    });
    const rows = await c.env.DB.prepare(
      `SELECT id, subject_name, subject_dob, status, phase, risk_score, risk_flags, linked_person_id, data_points_found, created_at, completed_at
       FROM person_intelligence WHERE created_by = ? OR org_id = ?
       ORDER BY created_at DESC LIMIT 50`
    ).bind(user.id, orgId ?? '').all();
    return c.json((rows.results ?? []).map((r) => ({ ...r, cross_refs_found: 0 })));
  }
});

// GET /api/person-intel/:id — get dossier with data points
app.get('/:id', async (c) => {
  const dossierId = Number(c.req.param('id'));
  const denied = await authorizeDossier(c, dossierId);
  if (denied) return denied;
  const dossier = await c.env.DB.prepare(`SELECT * FROM person_intelligence WHERE id = ?`).bind(dossierId).first();
  if (!dossier) return c.json({ error: 'not found' }, 404);

  const dataPoints = await c.env.DB.prepare(
    `SELECT * FROM person_intel_data_points WHERE dossier_id = ? ORDER BY confidence DESC`
  ).bind(dossierId).all();

  const connections = await c.env.DB.prepare(
    `SELECT * FROM person_intel_connections WHERE dossier_id = ?`
  ).bind(dossierId).all();

  const sources = await c.env.DB.prepare(
    `SELECT * FROM person_intel_sources WHERE dossier_id = ? ORDER BY queried_at`
  ).bind(dossierId).all();

  return c.json({
    ...dossier,
    dataPoints: dataPoints.results,
    connections: connections.results,
    sources: sources.results,
  });
});

// PATCH /api/person-intel/:id/data-point/:dpId — officer annotate a data point
app.patch('/:id/data-point/:dpId', async (c) => {
  const dossierId = Number(c.req.param('id'));
  const denied = await authorizeDossier(c, dossierId);
  if (denied) return denied;
  const dpId = Number(c.req.param('dpId'));
  const body = await c.req.json<{ officer_note?: string; officer_flagged?: boolean; promoted?: boolean }>();
  // Bind dpId AND dossier_id so a caller authorized for THIS dossier can't
  // annotate a data point that belongs to a different (unauthorized) one.
  await execute(c.env.DB, `UPDATE person_intel_data_points SET officer_note=COALESCE(?,officer_note), officer_flagged=COALESCE(?,officer_flagged), promoted=COALESCE(?,promoted) WHERE id=? AND dossier_id=?`,
    [body.officer_note ?? null, body.officer_flagged != null ? (body.officer_flagged ? 1 : 0) : null, body.promoted != null ? (body.promoted ? 1 : 0) : null, dpId, dossierId]);
  return c.json({ ok: true });
});

// POST /api/person-intel/:id/apply-to-person — fill blank person fields from
// aggregator-verified data points (confidence ≥ 0.60, 2+ sources). Never clobbers.
app.post('/:id/apply-to-person', async (c) => {
  const dossierId = Number(c.req.param('id'));
  const denied = await authorizeDossier(c, dossierId);
  if (denied) return denied;
  const dossier = await c.env.DB.prepare(
    'SELECT linked_person_id FROM person_intelligence WHERE id = ?',
  ).bind(dossierId).first<{ linked_person_id: number | null }>();
  if (!dossier) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ person_id?: number }>().catch(() => ({} as { person_id?: number }));
  const personId = Number(body.person_id ?? dossier.linked_person_id);
  if (!Number.isFinite(personId) || personId <= 0) {
    return c.json({ error: 'no identity-confirmed person to fill' }, 400);
  }
  const points = await loadDossierPoints(c.env.DB, dossierId);
  const result = await applyVerifiedPointsToPerson(c.env.DB, personId, points);
  if (!dossier.linked_person_id) {
    await execute(c.env.DB, 'UPDATE person_intelligence SET linked_person_id=? WHERE id=?', personId, dossierId);
  }
  return c.json({ ok: true, ...result });
});

// DELETE /api/person-intel/:id — delete dossier
app.delete('/:id', async (c) => {
  const dossierId = Number(c.req.param('id'));
  const denied = await authorizeDossier(c, dossierId);
  if (denied) return denied;
  await execute(c.env.DB, `DELETE FROM person_intel_data_points WHERE dossier_id=?`, [dossierId]);
  await execute(c.env.DB, `DELETE FROM person_intel_connections WHERE dossier_id=?`, [dossierId]);
  await execute(c.env.DB, `DELETE FROM person_intel_sources WHERE dossier_id=?`, [dossierId]);
  await execute(c.env.DB, `DELETE FROM person_intel_cross_refs WHERE dossier_id=?`, [dossierId]);
  await execute(c.env.DB, `DELETE FROM person_intelligence WHERE id=?`, [dossierId]);
  return c.json({ ok: true });
});

// ============================================================
// Cross-reference capture & verification
// ============================================================

// POST /api/person-intel/:id/cross-refs/refresh — run the legal phase inline
// (CourtListener/juriscraper + FBI Wanted + criminal-DB + skip-trace) and
// capture the resulting cross-refs. Returns the captured cross-refs.
app.post('/:id/cross-refs/refresh', async (c) => {
  const dossierId = Number(c.req.param('id'));
  const denied = await authorizeDossier(c, dossierId);
  if (denied) return denied;
  const dossier = await c.env.DB.prepare(`SELECT subject_seed FROM person_intelligence WHERE id=?`).bind(dossierId).first<{ subject_seed: string }>();
  if (!dossier) return c.json({ error: 'not found' }, 404);
  let seed: IntelSeed;
  try { seed = JSON.parse(dossier.subject_seed); } catch { return c.json({ error: 'invalid seed' }, 400); }

  const result = await runLegalPhase(c.env.DB, seed);
  // Persist source rows + cross-refs inline (mirror the DO's legal phase).
  for (const r of result.sourceResults) {
    await execute(c.env.DB,
      `INSERT INTO person_intel_sources (dossier_id,source_name,phase,status,response_time_ms,data_points_found,error_message) VALUES (?,?,?,?,?,?,?)`,
      dossierId, r.sourceName, r.phase, r.status, r.responseTimeMs, r.dataPoints?.length ?? 0, r.errorMessage ?? null);
  }
  const captured = await persistCrossRefs(c.env.DB, dossierId, result.crossRefs, c.get('user').id);
  const crossRefs = await fetchCrossRefs(c.env.DB, dossierId);
  return c.json({ ok: true, captured, crossRefs, sources: result.sourceResults, riskFlags: result.riskFlags });
});

// GET /api/person-intel/:id/cross-refs — list captured cross-refs with their
// verifications and effective (post-verification) confidence.
app.get('/:id/cross-refs', async (c) => {
  const dossierId = Number(c.req.param('id'));
  const denied = await authorizeDossier(c, dossierId);
  if (denied) return denied;
  const crossRefs = await fetchCrossRefs(c.env.DB, dossierId);
  const enriched = await Promise.all(crossRefs.map(async (xr) => {
    const verifs = await fetchVerifications(c.env.DB, xr.id!);
    return { ...xr, verifications: verifs, effectiveConfidence: effectiveConfidence(xr, verifs) };
  }));
  return c.json(enriched);
});

// POST /api/person-intel/:id/cross-refs/:xrefId/verify — verify a cross-ref.
// Body: { method: 'dob'|'address'|'phone'|'email'|'identifier'|'officer_review', evidence: string }
app.post('/:id/cross-refs/:xrefId/verify', async (c) => {
  const dossierId = Number(c.req.param('id'));
  const denied = await authorizeDossier(c, dossierId);
  if (denied) return denied;
  const xrefId = Number(c.req.param('xrefId'));
  const body = await c.req.json<{ method: VerificationMethod; evidence: string }>();
  if (!body.method || typeof body.evidence !== 'string') {
    return c.json({ error: 'method and evidence required' }, 400);
  }
  // Load the cross-ref (scoped to this dossier).
  const xrRow = await c.env.DB.prepare(
    `SELECT id, dossier_id, source, external_ref, external_url, label, matched_fields,
            confidence, is_criminal, risk_flags
       FROM person_intel_cross_refs WHERE id=? AND dossier_id=?`,
  ).bind(xrefId, dossierId).first<any>();
  if (!xrRow) return c.json({ error: 'not found' }, 404);

  let matchedFields: { field: string; value: string }[] = [];
  let riskFlags: string[] = [];
  try {
    matchedFields = JSON.parse(xrRow.matched_fields || '[]');
    riskFlags = JSON.parse(xrRow.risk_flags || '[]');
  } catch { /* defaults */ }
  const crossRef = {
    id: xrRow.id, dossierId: xrRow.dossier_id, source: xrRow.source,
    externalRef: xrRow.external_ref, externalUrl: xrRow.external_url ?? undefined,
    label: xrRow.label, matchedFields, confidence: xrRow.confidence,
    isCriminal: !!xrRow.is_criminal, riskFlags: riskFlags as any,
  };
  // Known values = the dossier's corroborated data points.
  const knownRows = await c.env.DB.prepare(
    `SELECT value FROM person_intel_data_points WHERE dossier_id=?`,
  ).bind(dossierId).all<{ value: string }>();
  const knownValues = (knownRows.results ?? []).map(r => r.value);
  const user = c.get('user');

  const outcome = computeVerdict(crossRef, body.method, body.evidence, knownValues);
  await persistVerification(c.env.DB, crossRef,
    { crossRefId: xrefId, method: body.method, evidence: body.evidence, verifiedBy: user.id },
    outcome);
  return c.json({ ok: true, result: outcome.result, adjustedConfidence: outcome.adjustedConfidence, reason: outcome.reason });
});

// ============================================================
// Reporting (GautaVaid/Skip_Tracing professional reporting pattern)
// ============================================================

// GET /api/person-intel/:id/report?format=pdf|csv
app.get('/:id/report', async (c) => {
  const dossierId = Number(c.req.param('id'));
  const denied = await authorizeDossier(c, dossierId);
  if (denied) return denied;
  const format = (c.req.query('format') || 'pdf').toLowerCase();
  const dossier = await c.env.DB.prepare(`SELECT * FROM person_intelligence WHERE id=?`).bind(dossierId).first<any>();
  if (!dossier) return c.json({ error: 'not found' }, 404);
  const crossRefs = await fetchCrossRefs(c.env.DB, dossierId);
  const enriched = await Promise.all(crossRefs.map(async (xr) => {
    const v = await fetchVerifications(c.env.DB, xr.id!);
    return { ...xr, verifications: v, effectiveConfidence: effectiveConfidence(xr, v) };
  }));
  const dataPoints = await query<any>(c.env.DB,
    `SELECT category, field, value, sources, confidence FROM person_intel_data_points WHERE dossier_id=? ORDER BY confidence DESC`, dossierId);

  if (format === 'csv') {
    const rows = [['type', 'source', 'label', 'external_ref', 'is_criminal', 'confidence', 'effective', 'verified_result']];
    for (const xr of enriched) {
      rows.push(['cross_ref', xr.source, xr.label, xr.externalRef, String(xr.isCriminal), String(xr.confidence), String(xr.effectiveConfidence), xr.riskFlags.join('|')]);
    }
    for (const dp of dataPoints) {
      rows.push(['data_point', dp.sources, dp.field, dp.value, '', String(dp.confidence), '', '']);
    }
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="intel-${dossierId}.csv"` } });
  }

  // PDF via pdf-lib (already a dependency).
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]); // A4
  let y = 800;
  const navy = rgb(0.13, 0.25, 0.37);
  page.drawText('RMPG Flex — Person Intelligence Report', { x: 40, y, size: 16, font: bold, color: navy });
  y -= 28;
  page.drawText(`Dossier #${dossierId} — ${dossier.subject_name ?? 'Unknown'}`, { x: 40, y, size: 12, font, color: rgb(0.1, 0.1, 0.1) });
  y -= 18;
  page.drawText(`Risk score: ${dossier.risk_score ?? 0}   Flags: ${dossier.risk_flags ?? '[]'}   Status: ${dossier.status}`, { x: 40, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
  y -= 24;
  page.drawText('Cross-References', { x: 40, y, size: 12, font: bold, color: navy });
  y -= 16;
  for (const xr of enriched) {
    if (y < 80) { y = 800; doc.addPage([595, 842]); }
    const line = `[${xr.source}] ${xr.label} — ${xr.isCriminal ? 'CRIMINAL' : 'civil'} — conf ${xr.confidence.toFixed(2)} → ${xr.effectiveConfidence.toFixed(2)}`;
    page.drawText(line.slice(0, 95), { x: 40, y, size: 9, font, color: rgb(0.15, 0.15, 0.15) });
    y -= 13;
    if (xr.externalUrl) { page.drawText(`  ${xr.externalUrl.slice(0, 90)}`, { x: 40, y, size: 8, font, color: rgb(0.35, 0.35, 0.35) }); y -= 11; }
  }
  const bytes = await doc.save();
  return new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="intel-${dossierId}.pdf"` } });
});

// ============================================================
// centralia opinion extraction (freelawproject/centralia)
// ============================================================

// POST /api/person-intel/opinions/extract — accept a court PDF + court_id,
// stash it in R2 (UPLOADS/intel-opinions/), create a pending opinion row,
// return the centralia skeleton the client/sidecar will fill.
app.post('/opinions/extract', async (c) => {
  const user = c.get('user');
  const form = await c.req.formData();
  const file = form.get('pdf') as File | null;
  const courtId = String(form.get('court_id') || '').trim();
  const docketNumber = String(form.get('docket_number') || '').trim() || undefined;
  const dossierId = Number(form.get('dossier_id') || 0) || null;
  if (!file || !courtId) return c.json({ error: 'pdf and court_id required' }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const r2Key = `intel-opinions/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  try { await c.env.UPLOADS.put(r2Key, bytes, { customMetadata: { court_id: courtId, uploaded_by: String(user.id) } }); }
  catch (e) { log.error('opinion R2 put failed', { r2Key }, e instanceof Error ? e : new Error(String(e))); return c.json({ error: 'storage failed' }, 502); }

  const skeleton = pendingCentraliaResult(courtId, docketNumber);
  const ins = await c.env.DB.prepare(
    `INSERT INTO person_intel_opinions (dossier_id, court_id, docket_number, r2_key, status, extracted_by)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  ).bind(dossierId, courtId, docketNumber ?? null, r2Key, user.id).run();
  const opinionId = ins.meta.last_row_id as number;
  return c.json({ ok: true, opinionId, r2Key, status: skeleton.status, warnings: skeleton.warnings });
});

/**
 * Persist a centralia result on its opinion row and fold the recovered
 * `legal` data points + docket cross-ref into the linked dossier. Shared by
 * /complete (client/sidecar-supplied) and /extract-ai (server-side run).
 */
async function applyCentraliaResult(
  db: D1Database,
  opinionId: number,
  dossierId: number | null,
  result: ReturnType<typeof normalizeCentraliaResult>,
  userId: number,
): Promise<void> {
  await execute(db,
    `UPDATE person_intel_opinions SET extracted=?, status=?, completed_at=datetime('now') WHERE id=?`,
    JSON.stringify(result), result.status, opinionId);
  if (!dossierId) return;
  const pts = centraliaToDataPoints(result);
  for (const p of pts) {
    await execute(db,
      `INSERT INTO person_intel_data_points (dossier_id,category,field,value,sources,confidence) VALUES (?,?,?,?,?,?)`,
      dossierId, p.category, p.field, p.value, JSON.stringify([p.source]), 0.6);
  }
  if (result.cluster.docket_number || result.cluster.case_name) {
    await execute(db,
      `INSERT INTO person_intel_cross_refs
         (dossier_id, source, external_ref, external_url, label, matched_fields, confidence, is_criminal, risk_flags, captured_by)
       VALUES (?, 'COURTLISTENER', ?, ?, ?, ?, ?, ?, '[]', ?)
       ON CONFLICT(dossier_id, source, external_ref) DO UPDATE SET label=excluded.label`,
      dossierId, result.cluster.docket_number || result.cluster.case_name || `opinion:${opinionId}`,
      undefined, result.cluster.case_name || result.cluster.docket_number || 'Court opinion',
      JSON.stringify([{ field: 'docket_number', value: result.cluster.docket_number || '' }]),
      0.5, 0, userId);
  }
}

// POST /api/person-intel/opinions/:id/complete — accept a centralia-shaped
// JSON result (from a client-side Pyodide centralia run or a sidecar),
// normalize + persist it, and fold its `legal` data points into the dossier.
app.post('/opinions/:id/complete', async (c) => {
  const user = c.get('user');
  const opinionId = Number(c.req.param('id'));
  const body = await c.req.json<{ result: unknown; dossier_id?: number }>();
  if (!body.result) return c.json({ error: 'result required' }, 400);
  const row = await c.env.DB.prepare(`SELECT dossier_id FROM person_intel_opinions WHERE id=?`)
    .bind(opinionId).first<{ dossier_id: number | null }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const result = normalizeCentraliaResult(body.result);
  await applyCentraliaResult(c.env.DB, opinionId, body.dossier_id ?? row.dossier_id ?? null, result, user.id);
  return c.json({ ok: true, status: result.status, cluster: result.cluster, opinionCount: result.opinions.length });
});

// POST /api/person-intel/opinions/:id/extract-ai — run the extraction
// server-side: pull the stored PDF from R2, read its text layer (unpdf), then
// structure it into the centralia contract via the callAi provider chain.
// Fills the same row a client-side Pyodide run would have filled via /complete.
app.post('/opinions/:id/extract-ai', async (c) => {
  const user = c.get('user');
  const opinionId = Number(c.req.param('id'));
  const row = await c.env.DB.prepare(
    `SELECT id, dossier_id, court_id, r2_key FROM person_intel_opinions WHERE id=?`,
  ).bind(opinionId).first<{ id: number; dossier_id: number | null; court_id: string; r2_key: string | null }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (!c.env.AI) return c.json({ error: 'AI binding unavailable', code: 'not_configured' }, 503);
  if (!row.r2_key) return c.json({ error: 'opinion has no stored PDF' }, 400);

  const obj = await c.env.UPLOADS.get(row.r2_key).catch(() => null);
  if (!obj) return c.json({ error: 'stored PDF missing from object storage' }, 502);
  const bytes = await obj.arrayBuffer();

  const result = await extractOpinionWithAi(c.env as never, bytes);
  // Echo the court id the row was created with (the extractor can't know it).
  result.court_id = row.court_id;
  await applyCentraliaResult(c.env.DB, opinionId, row.dossier_id, result, user.id);
  return c.json({
    ok: true,
    status: result.status,
    cluster: result.cluster,
    opinionCount: result.opinions.length,
    warnings: result.warnings ?? [],
  });
});

// GET /api/person-intel/opinions/:id — fetch a stored opinion's centralia result.
app.get('/opinions/:id', async (c) => {
  const opinionId = Number(c.req.param('id'));
  const row = await c.env.DB.prepare(
    `SELECT id, dossier_id, court_id, docket_number, r2_key, status, extracted, created_at, completed_at
       FROM person_intel_opinions WHERE id=?`,
  ).bind(opinionId).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  let extracted = null;
  try { extracted = row.extracted ? JSON.parse(row.extracted) : null; } catch { /* leave null */ }
  return c.json({ ...row, extracted });
});

export default app;
