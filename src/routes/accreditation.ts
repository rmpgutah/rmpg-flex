import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const accreditation = new Hono<Env>();

accreditation.get('/standards', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query(db, 'SELECT * FROM accreditation_standards ORDER BY standard_number');
    return c.json(rows || []);
  } catch (err) { return c.json({ error: 'Failed to fetch standards', detail: (err as Error)?.message }, 500); }
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
  } catch (err) { return c.json({ error: 'Failed to create standard', detail: (err as Error)?.message }, 500); }
});

accreditation.put('/standards/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
    await execute(db,
      'UPDATE accreditation_standards SET standard_number=?, standard_name=?, category=?, description=?, compliance_status=?, last_reviewed=?, next_review=?, proof_url=?, assigned_to=?, notes=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?',
      (body.standard_number || (() => { throw new Error("standard_number required"); })()), (body.standard_name || (() => { throw new Error("standard_name required"); })()), body.category || null, body.description || null, body.compliance_status || 'pending', body.last_reviewed || null, body.next_review || null, body.proof_url || null, body.assigned_to || null, body.notes || null, id
    );
    return c.json({ success: true });
  } catch (err) { return c.json({ error: 'Failed to update standard', detail: (err as Error)?.message }, 500); }
});

accreditation.delete('/standards/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    await execute(db, 'DELETE FROM accreditation_standards WHERE id=?', id);
    return c.json({ success: true });
  } catch (err) { return c.json({ error: 'Failed to delete standard', detail: (err as Error)?.message }, 500); }
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
  } catch (err) { return c.json({ error: 'Failed to fetch accreditation stats', detail: (err as Error)?.message }, 500); }
});

export default accreditation;
