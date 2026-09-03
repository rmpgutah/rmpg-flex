import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

import { dbErrorResponse } from '../utils/dbErrors';
const accreditation = new Hono<Env>();

accreditation.get('/standards', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query(db, 'SELECT * FROM accreditation_standards ORDER BY standard_number');
    return c.json(rows || []);
  } catch (err) { return dbErrorResponse(c, err, 'Failed to fetch standards'); }
});

accreditation.post('/standards', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
    const result = await execute(db,
      'INSERT INTO accreditation_standards (standard_number, standard_name, category, description, compliance_status, last_reviewed, next_review, proof_url, assigned_to, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      (body.standard_number || (() => { throw new Error("standard_number required"); })()), (body.standard_name || (() => { throw new Error("standard_name required"); })()), body.category || null, body.description || null, body.compliance_status || 'pending', body.last_reviewed || null, body.next_review || null, body.proof_url || null, body.assigned_to || null, body.notes || null
    );
    return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) { return dbErrorResponse(c, err, 'Failed to create standard'); }
});

accreditation.put('/standards/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
    await execute(db,
      'UPDATE accreditation_standards SET standard_number=?, standard_name=?, category=?, description=?, compliance_status=?, last_reviewed=?, next_review=?, proof_url=?, assigned_to=?, notes=?, updated_at=datetime(\'now\') WHERE id=?',
      (body.standard_number || (() => { throw new Error('standard_number required'); })()), (body.standard_name || (() => { throw new Error('standard_name required'); })()), body.category || null, body.description || null, body.compliance_status || 'pending', body.last_reviewed || null, body.next_review || null, body.proof_url || null, body.assigned_to || null, body.notes || null, id
    );
    return c.json({ success: true });
  } catch (err) { return dbErrorResponse(c, err, 'Failed to update standard'); }
});

accreditation.delete('/standards/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const r = await execute(db, 'DELETE FROM accreditation_standards WHERE id=?', id);
    if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) { return dbErrorResponse(c, err, 'Failed to delete standard'); }
});

accreditation.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const total = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM accreditation_standards');
    const compliant = await queryFirst<{cnt:number}>(db, "SELECT COUNT(*) as cnt FROM accreditation_standards WHERE compliance_status='compliant'");
    const totalCnt = total?.cnt || 0;
    const compliantCnt = compliant?.cnt || 0;
    return c.json({
      standardsTotal: totalCnt,
      standardsCompliant: compliantCnt,
      compliancePct: totalCnt > 0 ? Math.round((compliantCnt / totalCnt) * 100) : 0,
      nextAssessment: '',
    });
  } catch (err) { return dbErrorResponse(c, err, 'Failed to fetch accreditation stats'); }
});

export default accreditation;
