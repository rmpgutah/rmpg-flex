// src/routes/personIntel.ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { execute } from '../utils/db';
import type { IntelSeed } from '../utils/personIntel/types';

const app = new Hono<Env>();

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
  const rows = await c.env.DB.prepare(
    `SELECT id, subject_name, subject_dob, status, phase, risk_score, risk_flags, linked_person_id, data_points_found, created_at, completed_at
     FROM person_intelligence WHERE created_by = ? OR org_id = ?
     ORDER BY created_at DESC LIMIT 50`
  ).bind(user.id, orgId ?? '').all();
  return c.json(rows.results);
});

// GET /api/person-intel/:id — get dossier with data points
app.get('/:id', async (c) => {
  const dossierId = Number(c.req.param('id'));
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
  const dpId = Number(c.req.param('dpId'));
  const body = await c.req.json<{ officer_note?: string; officer_flagged?: boolean; promoted?: boolean }>();
  await execute(c.env.DB, `UPDATE person_intel_data_points SET officer_note=COALESCE(?,officer_note), officer_flagged=COALESCE(?,officer_flagged), promoted=COALESCE(?,promoted) WHERE id=?`,
    [body.officer_note ?? null, body.officer_flagged != null ? (body.officer_flagged ? 1 : 0) : null, body.promoted != null ? (body.promoted ? 1 : 0) : null, dpId]);
  return c.json({ ok: true });
});

// DELETE /api/person-intel/:id — delete dossier
app.delete('/:id', async (c) => {
  const dossierId = Number(c.req.param('id'));
  await execute(c.env.DB, `DELETE FROM person_intel_data_points WHERE dossier_id=?`, [dossierId]);
  await execute(c.env.DB, `DELETE FROM person_intel_connections WHERE dossier_id=?`, [dossierId]);
  await execute(c.env.DB, `DELETE FROM person_intel_sources WHERE dossier_id=?`, [dossierId]);
  await execute(c.env.DB, `DELETE FROM person_intelligence WHERE id=?`, [dossierId]);
  return c.json({ ok: true });
});

export default app;
