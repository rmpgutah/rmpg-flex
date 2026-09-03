import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { dbErrorResponse } from '../utils/dbErrors';

const CRISIS_WRITE_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;
const CRISIS_DELETE_ROLES = ['admin', 'manager', 'supervisor'] as const;
// Mirror CHECK constraint on crisis_response_incidents.incident_type from
// migrations/0048_specialized_modules.sql:92. Update both if the migration moves.
const CRISIS_INCIDENT_TYPES = ['mental_health','suicide_ideation','substance_abuse','domestic','welfare_check','other'] as const;
type CrisisIncidentType = typeof CRISIS_INCIDENT_TYPES[number];
const normalizeIncidentType = (v: unknown): CrisisIncidentType | null => {
  if (v == null || v === '') return 'other';
  return (CRISIS_INCIDENT_TYPES as readonly string[]).includes(v as string) ? (v as CrisisIncidentType) : null;
};

const crisis = new Hono<Env>();

crisis.get('/incidents', async (c) => {
  try { const db = getDb(c.env); const rows = await query(db, 'SELECT * FROM crisis_response_incidents ORDER BY created_at DESC LIMIT 200'); return c.json(rows || []); }
  catch (err) { return dbErrorResponse(c, err, 'Failed to fetch crisis incidents'); }
});

crisis.post('/incidents', requireRole(...CRISIS_WRITE_ROLES), async (c) => {
  try { const db = getDb(c.env); const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
    const incidentType = normalizeIncidentType(body.incident_type);
    if (incidentType === null) {
      return c.json({ error: 'Invalid incident_type', allowed: CRISIS_INCIDENT_TYPES }, 400);
    }
    const result = await execute(db, 'INSERT INTO crisis_response_incidents (incident_number, incident_type, location, subject_name, disposition, cit_team_used, resolved_on_scene, diverted, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', (body.incident_number || (() => { throw new Error("incident_number required"); })()), incidentType, body.location || null, body.subject_name || null, body.disposition || null, body.cit_team_used || 0, body.resolved_on_scene || 0, body.diverted || 0, body.notes || null); return c.json({ success: true, id: result.meta.last_row_id }); }
  catch (err) { return dbErrorResponse(c, err, 'Failed to create crisis incident'); }
});

crisis.put('/incidents/:id', requireRole(...CRISIS_WRITE_ROLES), async (c) => {
  try { const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
    const incidentType = normalizeIncidentType(body.incident_type);
    if (incidentType === null) {
      return c.json({ error: 'Invalid incident_type', allowed: CRISIS_INCIDENT_TYPES }, 400);
    }
    await execute(db, 'UPDATE crisis_response_incidents SET incident_number=?, incident_type=?, location=?, subject_name=?, disposition=?, cit_team_used=?, resolved_on_scene=?, diverted=?, notes=?, updated_at=datetime(\'now\') WHERE id=?', (body.incident_number || (() => { throw new Error("incident_number required"); })()), incidentType, body.location || null, body.subject_name || null, body.disposition || null, body.cit_team_used || 0, body.resolved_on_scene || 0, body.diverted || 0, body.notes || null, id); return c.json({ success: true }); }
  catch (err) { return dbErrorResponse(c, err, 'Failed to update crisis incident'); }
});

crisis.delete('/incidents/:id', requireRole(...CRISIS_DELETE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const result = await execute(db, 'DELETE FROM crisis_response_incidents WHERE id=?', id);
    if (!result.meta.changes) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) { return dbErrorResponse(c, err, 'Failed to delete crisis incident'); }
});

crisis.get('/stats', async (c) => {
  try { const db = getDb(c.env); const total = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM crisis_response_incidents'); const cit = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM crisis_response_incidents WHERE cit_team_used=1'); const resolved = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM crisis_response_incidents WHERE resolved_on_scene=1'); const diverted = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM crisis_response_incidents WHERE diverted=1'); const totalCnt = total?.cnt || 0; return c.json({ citCalls: totalCnt, resolvedOnScene: resolved?.cnt || 0, diversionRate: totalCnt > 0 ? Math.round((diverted?.cnt || 0) / totalCnt * 100) : 0, teamsAvailable: 3 }); }
  catch (err) { return dbErrorResponse(c, err, 'Failed to fetch crisis stats'); }
});

export default crisis;
