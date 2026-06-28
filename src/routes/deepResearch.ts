// src/routes/deepResearch.ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { query, queryFirst, execute } from '../utils/db';
import { recordAudit } from '../utils/auditLog';
import { notConfigured } from '../utils/notConfigured';

const deepResearch = new Hono<Env>();

function actorId(c: { get: (k: 'user') => any }): number | null {
  const u = c.get('user');
  return u?.user_id ?? u?.userId ?? u?.id ?? null;
}
function orgId(c: { get: (k: 'user') => any }): number | null {
  const u = c.get('user');
  return u?.org_id ?? u?.orgId ?? null;
}

deepResearch.get('/health', (c) => c.json({ configured: !!(c.env.FIRECRAWL_API_KEY || '').trim() }));

deepResearch.post('/', async (c): Promise<Response> => {
  if (!(c.env.FIRECRAWL_API_KEY || '').trim()) {
    // 200 + skipped:true — config gap, not an outage. See notConfigured docstring.
    return notConfigured(c, 'firecrawl_api_key_unset', { error: 'Firecrawl not configured' });
  }
  const body = await c.req.json().catch(() => ({} as any));
  const subject = String(body.subject || '').trim();
  if (!subject) return c.json({ error: 'subject required' }, 400);
  const subjectType = String(body.subject_type || 'topic');
  const context = String(body.context || '');
  const seedAngles: string[] = Array.isArray(body.seed_angles) ? body.seed_angles.map(String) : [];
  const monitorIntervalDays = Number.isFinite(body.monitor_interval_days) && body.monitor_interval_days > 0
    ? Math.floor(body.monitor_interval_days) : null;
  const link = body.link && body.link.entity_type ? body.link : null;
  const id = crypto.randomUUID();
  const org = orgId(c);
  const uid = actorId(c);

  await execute(c.env.DB,
    `INSERT INTO deep_research_jobs (id, org_id, created_by, subject, subject_type, context, status, progress, monitor_interval_days, linked_entity_type, linked_entity_id, run_count) VALUES (?,?,?,?,?,?, 'queued', 0, ?,?,?, 1)`,
    id, org, uid, subject, subjectType, context, monitorIntervalDays,
    link?.entity_type ?? null, link?.entity_id ?? null);

  await recordAudit(c, { action: 'deep_research.create', entityType: 'deep_research_job', entityId: null, details: JSON.stringify({ id, subject, subjectType }), actorId: uid });

  const stub = c.env.DEEP_RESEARCH.get(c.env.DEEP_RESEARCH.idFromName(id));
  await stub.fetch('https://do/start', {
    method: 'POST',
    body: JSON.stringify({ jobId: id, orgId: org, subject, subjectType, context, seedAngles, monitorIntervalDays, runNo: 1 }),
  });
  return c.json({ id }, 201);
});

deepResearch.get('/jobs', async (c): Promise<Response> => {
  const org = orgId(c);
  const monitor = c.req.query('monitor');
  const subjectType = c.req.query('subject_type');
  let sql = `SELECT id, subject, subject_type, status, progress, stage_detail, source_count, finding_count, monitor_interval_days, run_count, linked_entity_type, linked_entity_id, created_at, updated_at FROM deep_research_jobs WHERE (org_id = ? OR org_id IS NULL)`;
  const binds: unknown[] = [org];
  if (monitor === '1') sql += ` AND monitor_interval_days IS NOT NULL`;
  if (subjectType) { sql += ` AND subject_type = ?`; binds.push(subjectType); }
  sql += ` ORDER BY created_at DESC LIMIT 100`;
  return c.json(await query(c.env.DB, sql, ...binds));
});

deepResearch.get('/jobs/:id', async (c): Promise<Response> => {
  const id = c.req.param('id');
  const job = await queryFirst(c.env.DB, `SELECT * FROM deep_research_jobs WHERE id = ? AND (org_id = ? OR org_id IS NULL)`, id, orgId(c));
  if (!job) return c.json({ error: 'not found' }, 404);
  const sources = await query(c.env.DB, `SELECT id, run_no, url, title, description, angle, scraped FROM research_sources WHERE job_id = ? ORDER BY run_no DESC, id ASC`, id);
  const findings = await query(c.env.DB, `SELECT id, run_no, finding_type, title, detail, confidence, trust, verdict, source_urls_json, status, entity_ref_type, entity_ref_id, is_delta FROM research_findings WHERE job_id = ? ORDER BY run_no DESC, trust DESC`, id);
  return c.json({ job, sources, findings });
});

deepResearch.post('/jobs/:id/rerun', async (c): Promise<Response> => {
  const id = c.req.param('id');
  const job = await queryFirst<any>(c.env.DB, `SELECT * FROM deep_research_jobs WHERE id = ? AND (org_id = ? OR org_id IS NULL)`, id, orgId(c));
  if (!job) return c.json({ error: 'not found' }, 404);
  const runNo = (job.run_count || 1) + 1;
  await execute(c.env.DB, `UPDATE deep_research_jobs SET status='queued', progress=0, run_count=?, updated_at=datetime('now') WHERE id=?`, runNo, id);
  const stub = c.env.DEEP_RESEARCH.get(c.env.DEEP_RESEARCH.idFromName(id));
  await stub.fetch('https://do/start', {
    method: 'POST',
    body: JSON.stringify({ jobId: id, orgId: job.org_id, subject: job.subject, subjectType: job.subject_type, context: job.context || '', seedAngles: [], monitorIntervalDays: job.monitor_interval_days, runNo }),
  });
  return c.json({ ok: true, run_no: runNo });
});

deepResearch.put('/jobs/:id/monitor', async (c): Promise<Response> => {
  const id = c.req.param('id');
  const owned = await queryFirst(c.env.DB, `SELECT id FROM deep_research_jobs WHERE id = ? AND (org_id = ? OR org_id IS NULL)`, id, orgId(c));
  if (!owned) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json().catch(() => ({} as any));
  const days = Number.isFinite(body.monitor_interval_days) && body.monitor_interval_days > 0 ? Math.floor(body.monitor_interval_days) : null;
  const next = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
  await execute(c.env.DB, `UPDATE deep_research_jobs SET monitor_interval_days=?, next_run_at=?, updated_at=datetime('now') WHERE id=?`, days, next, id);
  return c.json({ ok: true, monitor_interval_days: days });
});

deepResearch.delete('/jobs/:id', async (c): Promise<Response> => {
  const id = c.req.param('id');
  const owned = await queryFirst(c.env.DB, `SELECT id FROM deep_research_jobs WHERE id = ? AND (org_id = ? OR org_id IS NULL)`, id, orgId(c));
  if (!owned) return c.json({ error: 'not found' }, 404);
  await execute(c.env.DB, `DELETE FROM research_findings WHERE job_id = ?`, id);
  await execute(c.env.DB, `DELETE FROM research_sources WHERE job_id = ?`, id);
  await execute(c.env.DB, `DELETE FROM research_runs WHERE job_id = ?`, id);
  await execute(c.env.DB, `DELETE FROM deep_research_jobs WHERE id = ?`, id);
  return c.json({ ok: true });
});

deepResearch.post('/findings/:id/confirm', async (c): Promise<Response> => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const refType = body.entity_ref_type ? String(body.entity_ref_type) : null;
  const refId = Number.isFinite(body.entity_ref_id) ? Math.floor(body.entity_ref_id) : null;
  const r = await execute(c.env.DB, `UPDATE research_findings SET status='confirmed', entity_ref_type=?, entity_ref_id=? WHERE id=? AND (org_id=? OR org_id IS NULL)`, refType, refId, id, orgId(c));
  if (!r.meta.changes) return c.json({ error: 'not found' }, 404);
  await recordAudit(c, { action: 'deep_research.confirm_finding', entityType: 'research_finding', entityId: id, details: JSON.stringify({ refType, refId }), actorId: actorId(c) });
  return c.json({ ok: true });
});

deepResearch.post('/findings/:id/dismiss', async (c): Promise<Response> => {
  const id = c.req.param('id');
  const r = await execute(c.env.DB, `UPDATE research_findings SET status='dismissed' WHERE id=? AND (org_id=? OR org_id IS NULL)`, id, orgId(c));
  if (!r.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

export default deepResearch;
