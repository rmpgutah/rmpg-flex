import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const accreditation = new Hono<Env>();

accreditation.get('/standards', async (c) => {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM accreditation_standards ORDER BY standard_number');
  return c.json(rows || []);
});

accreditation.post('/standards', async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json();
  const result = await execute(db,
    'INSERT INTO accreditation_standards (standard_number, standard_name, category, description, compliance_status, last_reviewed, next_review, proof_url, assigned_to, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    body.standard_number, body.standard_name, body.category || null, body.description || null, body.compliance_status || 'pending', body.last_reviewed || null, body.next_review || null, body.proof_url || null, body.assigned_to || null, body.notes || null
  );
  return c.json({ success: true, id: result.meta.last_row_id });
});

accreditation.put('/standards/:id', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const body = await c.req.json();
  await execute(db,
    'UPDATE accreditation_standards SET standard_number=?, standard_name=?, category=?, description=?, compliance_status=?, last_reviewed=?, next_review=?, proof_url=?, assigned_to=?, notes=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?',
    body.standard_number, body.standard_name, body.category || null, body.description || null, body.compliance_status || 'pending', body.last_reviewed || null, body.next_review || null, body.proof_url || null, body.assigned_to || null, body.notes || null, id
  );
  return c.json({ success: true });
});

accreditation.delete('/standards/:id', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  await execute(db, 'DELETE FROM accreditation_standards WHERE id=?', id);
  return c.json({ success: true });
});

accreditation.get('/stats', async (c) => {
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
});

export default accreditation;
