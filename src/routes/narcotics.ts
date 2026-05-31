import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const narcotics = new Hono<Env>();

narcotics.get('/cases', async (c) => {
  try { const db = getDb(c.env); const rows = await query(db, 'SELECT * FROM narcotics_cases ORDER BY created_at DESC LIMIT 200'); return c.json(rows || []); }
  catch (err) { return c.json({ error: 'Failed to fetch narcotics cases', detail: (err as Error)?.message }, 500); }
});

narcotics.post('/cases', async (c) => {
  try { const db = getDb(c.env); const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400); const result = await execute(db, 'INSERT INTO narcotics_cases (case_number, case_type, subject_name, location, substance, quantity, street_value, status, priority, officer_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', (body.case_number || (() => { throw new Error("case_number required"); })()), body.case_type || 'investigation', body.subject_name || null, body.location || null, body.substance || null, body.quantity || null, body.street_value || 0, body.status || 'open', body.priority || 'normal', body.officer_id || null, body.notes || null); return c.json({ success: true, id: result.meta.last_row_id }); }
  catch (err) { return c.json({ error: 'Failed to create narcotics case', detail: (err as Error)?.message }, 500); }
});

narcotics.put('/cases/:id', async (c) => {
  try { const db = getDb(c.env); const id = c.req.param('id'); const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400); await execute(db, 'UPDATE narcotics_cases SET case_number=?, case_type=?, subject_name=?, location=?, substance=?, quantity=?, street_value=?, status=?, priority=?, officer_id=?, notes=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?', (body.case_number || (() => { throw new Error("case_number required"); })()), body.case_type || 'investigation', body.subject_name || null, body.location || null, body.substance || null, body.quantity || null, body.street_value || 0, body.status || 'open', body.priority || 'normal', body.officer_id || null, body.notes || null, id); return c.json({ success: true }); }
  catch (err) { return c.json({ error: 'Failed to update narcotics case', detail: (err as Error)?.message }, 500); }
});

narcotics.delete('/cases/:id', async (c) => {
  try { const db = getDb(c.env); const id = c.req.param('id'); await execute(db, 'DELETE FROM narcotics_cases WHERE id=?', id); return c.json({ success: true }); }
  catch (err) { return c.json({ error: 'Failed to delete narcotics case', detail: (err as Error)?.message }, 500); }
});

narcotics.get('/stats', async (c) => {
  try { const db = getDb(c.env); const total = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM narcotics_cases'); const active = await queryFirst<{cnt:number}>(db, "SELECT COUNT(*) as cnt FROM narcotics_cases WHERE status IN ('open','active')"); const seized = await queryFirst<{cnt:number}>(db, 'SELECT COALESCE(SUM(street_value),0) as cnt FROM narcotics_cases'); return c.json({ totalInvestigations: total?.cnt || 0, activeCIs: active?.cnt || 0, totalSeizures: total?.cnt || 0, totalStreetValue: seized?.cnt || 0 }); }
  catch (err) { return c.json({ error: 'Failed to fetch narcotics stats', detail: (err as Error)?.message }, 500); }
});

export default narcotics;
