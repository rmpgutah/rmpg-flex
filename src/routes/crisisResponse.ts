import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const crisis = new Hono<Env>();

crisis.get('/incidents', async (c) => {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM crisis_response_incidents ORDER BY created_at DESC LIMIT 200');
  return c.json(rows || []);
});

crisis.post('/incidents', async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json();
  const result = await execute(db,
    'INSERT INTO crisis_response_incidents (incident_number, incident_type, location, subject_name, disposition, cit_team_used, resolved_on_scene, diverted, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    body.incident_number, body.incident_type || 'other', body.location || null, body.subject_name || null, body.disposition || null, body.cit_team_used || 0, body.resolved_on_scene || 0, body.diverted || 0, body.notes || null
  );
  return c.json({ success: true, id: result.meta.last_row_id });
});

crisis.put('/incidents/:id', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const body = await c.req.json();
  await execute(db,
    'UPDATE crisis_response_incidents SET incident_number=?, incident_type=?, location=?, subject_name=?, disposition=?, cit_team_used=?, resolved_on_scene=?, diverted=?, notes=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?',
    body.incident_number, body.incident_type || 'other', body.location || null, body.subject_name || null, body.disposition || null, body.cit_team_used || 0, body.resolved_on_scene || 0, body.diverted || 0, body.notes || null, id
  );
  return c.json({ success: true });
});

crisis.delete('/incidents/:id', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  await execute(db, 'DELETE FROM crisis_response_incidents WHERE id=?', id);
  return c.json({ success: true });
});

crisis.get('/stats', async (c) => {
  const db = getDb(c.env);
  const total = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM crisis_response_incidents');
  const cit = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM crisis_response_incidents WHERE cit_team_used=1');
  const resolved = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM crisis_response_incidents WHERE resolved_on_scene=1');
  const diverted = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM crisis_response_incidents WHERE diverted=1');
  const totalCnt = total?.cnt || 0;
  return c.json({
    citCalls: totalCnt,
    resolvedOnScene: resolved?.cnt || 0,
    diversionRate: totalCnt > 0 ? Math.round((diverted?.cnt || 0) / totalCnt * 100) : 0,
    teamsAvailable: 3,
  });
});

export default crisis;
