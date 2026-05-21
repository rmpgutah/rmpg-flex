// Forensics Lab routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db } from '../worker-middleware/d1Helpers';
import { localNow } from '../worker-middleware/timeUtils';

async function generateLabNumber(db: D1Db): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `LAB-${yy}-`;
  const last = await db.prepare(
    `SELECT lab_number FROM forensic_cases WHERE lab_number LIKE ? ORDER BY id DESC LIMIT 1`,
  ).get(`${prefix}%`) as { lab_number: string } | undefined;

  let nextNum = 1;
  if (last) {
    const match = last.lab_number.match(/LAB-\d{2}-(\d{5})/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  return `${prefix}${String(nextNum).padStart(5, '0')}`;
}

// Activity logging (skipped in Workers — no shared db handle)
// logActivity calls are omitted; the Express version wrote to forensic_activity_log

export function mountForensicsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // ════════════════════════════════════════════════════════════
  // CASES
  // ════════════════════════════════════════════════════════════

  // GET /stats
  api.get('/stats', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const statusCounts = await db.prepare('SELECT status, COUNT(*) as count FROM forensic_cases GROUP BY status').all() as any[];
      const typeCounts = await db.prepare('SELECT case_type, COUNT(*) as count FROM forensic_cases GROUP BY case_type').all() as any[];
      const priorityCounts = await db.prepare("SELECT priority, COUNT(*) as count FROM forensic_cases WHERE status NOT IN ('released','cancelled') GROUP BY priority").all() as any[];
      const totalExhibits = (await db.prepare('SELECT COUNT(*) as cnt FROM forensic_exhibits').get() as any)?.cnt || 0;
      const totalAnalyses = (await db.prepare('SELECT COUNT(*) as cnt FROM forensic_analyses').get() as any)?.cnt || 0;
      const pendingAnalyses = (await db.prepare("SELECT COUNT(*) as cnt FROM forensic_analyses WHERE status IN ('pending','in_progress')").get() as any)?.cnt || 0;

      c.header('Cache-Control', 'private, max-age=60');
      return c.json({
        data: {
          by_status: Object.fromEntries(statusCounts.map((r: any) => [r.status, r.count])),
          by_type: Object.fromEntries(typeCounts.map((r: any) => [r.case_type, r.count])),
          by_priority: Object.fromEntries(priorityCounts.map((r: any) => [r.priority, r.count])),
          total: statusCounts.reduce((a: number, b: any) => a + b.count, 0),
          total_exhibits: totalExhibits,
          total_analyses: totalAnalyses,
          pending_analyses: pendingAnalyses,
        },
      });
    } catch (error: any) {
      console.error('Forensics stats error:', error);
      return c.json({ error: 'Failed to get forensics stats', code: 'FORENSICS_STATS_ERROR' }, 500);
    }
  });

  // GET / — List
  api.get('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { status, case_type, priority, search, page = '1', limit = '100000' } = q;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100000, Math.max(1, parseInt(limit, 10) || 100000));
      const offset = (pageNum - 1) * limitNum;

      let where = 'WHERE 1=1';
      const params: any[] = [];

      if (status) { where += ' AND fc.status = ?'; params.push(status); }
      if (case_type) { where += ' AND fc.case_type = ?'; params.push(case_type); }
      if (priority) { where += ' AND fc.priority = ?'; params.push(priority); }
      if (search) {
        where += ' AND (fc.lab_number LIKE ? OR fc.title LIKE ? OR fc.description LIKE ? OR fc.requesting_officer LIKE ?)';
        const s = `%${search}%`;
        params.push(s, s, s, s);
      }

      const total = (await db.prepare(`SELECT COUNT(*) as count FROM forensic_cases fc ${where}`).get(...params) as any).count;

      const rows = await db.prepare(`
        SELECT fc.*,
          u.full_name as lead_examiner_name,
          cb.full_name as created_by_name,
          (SELECT COUNT(*) FROM forensic_exhibits WHERE forensic_case_id = fc.id) as exhibit_count,
          (SELECT COUNT(*) FROM forensic_analyses WHERE forensic_case_id = fc.id) as analysis_count,
          (SELECT COUNT(*) FROM forensic_analyses WHERE forensic_case_id = fc.id AND status = 'completed') as completed_analysis_count
        FROM forensic_cases fc
        LEFT JOIN users u ON fc.lead_examiner_id = u.id
        LEFT JOIN users cb ON fc.created_by = cb.id
        ${where}
        ORDER BY
          CASE fc.priority WHEN 'urgent' THEN 0 WHEN 'rush' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
          CASE fc.status WHEN 'received' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'analysis_complete' THEN 2
            WHEN 'report_drafted' THEN 3 WHEN 'reviewed' THEN 4 WHEN 'released' THEN 5 ELSE 6 END,
          fc.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, limitNum, offset);

      return c.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
    } catch (error: any) {
      console.error('Get forensic cases error:', error);
      return c.json({ error: 'Failed to get forensic cases', code: 'GET_FORENSIC_CASES_ERROR' }, 500);
    }
  });

  // GET /:id
  api.get('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = parseInt(c.req.param('id'), 10);
      if (isNaN(id)) return c.json({ error: 'Invalid forensic case ID', code: 'INVALID_FORENSIC_CASE_ID' }, 400);
      const row = await db.prepare(`
        SELECT fc.*,
          u.full_name as lead_examiner_name,
          cb.full_name as created_by_name
        FROM forensic_cases fc
        LEFT JOIN users u ON fc.lead_examiner_id = u.id
        LEFT JOIN users cb ON fc.created_by = cb.id
        WHERE fc.id = ?
      `).get(id);
      if (!row) return c.json({ error: 'Forensic case not found', code: 'FORENSIC_CASE_NOT_FOUND' }, 404);
      return c.json({ data: row });
    } catch (error: any) {
      console.error('Get forensic case error:', error);
      return c.json({ error: 'Failed to get forensic case', code: 'GET_FORENSIC_CASE_ERROR' }, 500);
    }
  });

  // POST / — Create
  api.post('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const body = await c.req.json();
      const {
        case_type = 'general', priority = 'normal', title, description,
        requesting_agency = 'RMPG', requesting_officer, lead_examiner_id,
        linked_incident_id, linked_case_id, linked_incident_number,
        linked_case_number, due_date, notes,
      } = body;

      if (!title?.trim()) return c.json({ error: 'Title is required', code: 'MISSING_TITLE' }, 400);

      const validPriorities = ['normal', 'rush', 'urgent'];
      if (!validPriorities.includes(priority)) return c.json({ error: 'Invalid priority', code: 'INVALID_PRIORITY' }, 400);

      const lab_number = await generateLabNumber(db);
      const now = localNow();

      const userId = user.userId;
      const result = await db.prepare(`
        INSERT INTO forensic_cases (
          lab_number, case_type, status, priority, title, description,
          requesting_agency, requesting_officer, lead_examiner_id,
          linked_incident_id, linked_case_id, linked_incident_number,
          linked_case_number, received_date, due_date, notes,
          created_by, created_at, updated_at
        ) VALUES (?, ?, 'received', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        lab_number, case_type, priority, title.trim(), description || null,
        requesting_agency, requesting_officer || null, lead_examiner_id || null,
        linked_incident_id || null, linked_case_id || null,
        linked_incident_number || null, linked_case_number || null,
        now, due_date || null, notes || null,
        userId, now, now,
      );

      // activity log, auditLog, broadcast skipped

      const newCase = await db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(result.meta.last_row_id);
      return c.json({ data: newCase }, 201);
    } catch (error: any) {
      console.error('Create forensic case error:', error);
      return c.json({ error: 'Internal server error', code: 'CREATE_FORENSIC_ERROR' }, 500);
    }
  });

  // PUT /:id — Update
  api.put('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const existing = await db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(c.req.param('id')) as any;
      if (!existing) return c.json({ error: 'Forensic case not found', code: 'FORENSIC_CASE_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const {
        case_type, priority, title, description, status,
        requesting_agency, requesting_officer, lead_examiner_id,
        linked_incident_id, linked_case_id, linked_incident_number,
        linked_case_number, due_date, notes,
      } = body;

      const now = localNow();
      const newStatus = status || existing.status;
      let completed_date = existing.completed_date;
      let released_date = existing.released_date;

      if (newStatus === 'analysis_complete' && !completed_date) completed_date = now;
      if (newStatus === 'released' && !released_date) released_date = now;

      await db.prepare(`
        UPDATE forensic_cases SET
          case_type = ?, priority = ?, title = ?, description = ?, status = ?,
          requesting_agency = ?, requesting_officer = ?, lead_examiner_id = ?,
          linked_incident_id = ?, linked_case_id = ?, linked_incident_number = ?,
          linked_case_number = ?, due_date = ?, completed_date = ?, released_date = ?,
          notes = ?, updated_at = ?
        WHERE id = ?
      `).run(
        case_type || existing.case_type, priority || existing.priority,
        title || existing.title, description ?? existing.description,
        newStatus,
        requesting_agency ?? existing.requesting_agency,
        requesting_officer ?? existing.requesting_officer,
        lead_examiner_id ?? existing.lead_examiner_id,
        linked_incident_id ?? existing.linked_incident_id,
        linked_case_id ?? existing.linked_case_id,
        linked_incident_number ?? existing.linked_incident_number,
        linked_case_number ?? existing.linked_case_number,
        due_date ?? existing.due_date,
        completed_date, released_date,
        notes ?? existing.notes, now, c.req.param('id'),
      );

      const updated = await db.prepare(`
        SELECT fc.*, u.full_name as lead_examiner_name, cb.full_name as created_by_name
        FROM forensic_cases fc
        LEFT JOIN users u ON fc.lead_examiner_id = u.id
        LEFT JOIN users cb ON fc.created_by = cb.id
        WHERE fc.id = ?
      `).get(c.req.param('id'));
      return c.json({ data: updated });
    } catch (error: any) {
      console.error('Update forensic case error:', error);
      return c.json({ error: 'Failed to update forensic case', code: 'FORENSICS_ERROR' }, 500);
    }
  });

  // DELETE /:id
  api.delete('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existing = await db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(c.req.param('id')) as any;
      if (!existing) return c.json({ error: 'Forensic case not found', code: 'FORENSIC_CASE_NOT_FOUND' }, 404);
      await db.prepare('DELETE FROM forensic_cases WHERE id = ?').run(c.req.param('id'));
      return c.json({ message: 'Forensic case deleted' });
    } catch (error: any) {
      console.error('Delete forensic case error:', error);
      return c.json({ error: 'Failed to delete forensic case', code: 'DELETE_FORENSIC_CASE_ERROR' }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════
  // EXHIBITS
  // ════════════════════════════════════════════════════════════

  // GET /:caseId/exhibits
  api.get('/:caseId/exhibits', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT * FROM forensic_exhibits WHERE forensic_case_id = ? ORDER BY exhibit_number
        LIMIT 1000
      `).all(c.req.param('caseId'));
      return c.json({ data: rows });
    } catch (error: any) {
      console.error('Get exhibits error:', error);
      return c.json({ error: 'Failed to get exhibits', code: 'GET_EXHIBITS_ERROR' }, 500);
    }
  });

  // POST /:caseId/exhibits
  api.post('/:caseId/exhibits', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const fc = await db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(c.req.param('caseId')) as any;
      if (!fc) return c.json({ error: 'Forensic case not found', code: 'FORENSIC_CASE_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const {
        exhibit_type = 'other', description, quantity = 1, condition_received,
        storage_location, storage_temp, collected_by, collected_date,
        collection_method, hash_md5, hash_sha256, notes,
        examination_requested,
      } = body;

      if (!description?.trim()) return c.json({ error: 'Description is required', code: 'DESCRIPTION_IS_REQUIRED' }, 400);

      const lastExhibit = await db.prepare(
        'SELECT exhibit_number FROM forensic_exhibits WHERE forensic_case_id = ? ORDER BY id DESC LIMIT 1'
      ).get(c.req.param('caseId')) as any;
      let nextNum = 1;
      if (lastExhibit) {
        const match = lastExhibit.exhibit_number.match(/(\d+)$/);
        if (match) nextNum = parseInt(match[1], 10) + 1;
      }
      const exhibit_number = `EX-${String(nextNum).padStart(3, '0')}`;

      const now = localNow();
      const initialCustody = JSON.stringify([{
        action: 'received',
        by: user.username,
        at: now,
        notes: 'Initial intake',
      }]);

      const result = await db.prepare(`
        INSERT INTO forensic_exhibits (
          forensic_case_id, exhibit_number, exhibit_type, description, quantity,
          condition_received, storage_location, storage_temp, collected_by,
          collected_date, collection_method, hash_md5, hash_sha256,
          chain_of_custody, notes, examination_requested, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        c.req.param('caseId'), exhibit_number, exhibit_type, description.trim(), quantity,
        condition_received || null, storage_location || null, storage_temp || null,
        collected_by || null, collected_date || null, collection_method || null,
        hash_md5 || null, hash_sha256 || null, initialCustody,
        notes || null, examination_requested || null, now, now,
      );

      const newExhibit = await db.prepare('SELECT * FROM forensic_exhibits WHERE id = ?').get(result.meta.last_row_id);
      return c.json({ data: newExhibit }, 201);
    } catch (error: any) {
      console.error('Create exhibit error:', error);
      return c.json({ error: 'Failed to create exhibit', code: 'FORENSICS_ERROR' }, 500);
    }
  });

  // PUT /:caseId/exhibits/:exhibitId
  api.put('/:caseId/exhibits/:exhibitId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existing = await db.prepare('SELECT * FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?').get(c.req.param('exhibitId'), c.req.param('caseId')) as any;
      if (!existing) return c.json({ error: 'Exhibit not found', code: 'EXHIBIT_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const {
        exhibit_type, description, quantity, condition_received,
        storage_location, storage_temp, collected_by, collected_date,
        collection_method, hash_md5, hash_sha256, disposition,
        disposition_date, disposition_notes, notes,
      } = body;

      const now = localNow();
      await db.prepare(`
        UPDATE forensic_exhibits SET
          exhibit_type = ?, description = ?, quantity = ?, condition_received = ?,
          storage_location = ?, storage_temp = ?, collected_by = ?, collected_date = ?,
          collection_method = ?, hash_md5 = ?, hash_sha256 = ?, disposition = ?,
          disposition_date = ?, disposition_notes = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(
        exhibit_type || existing.exhibit_type, description || existing.description,
        quantity ?? existing.quantity, condition_received ?? existing.condition_received,
        storage_location ?? existing.storage_location, storage_temp ?? existing.storage_temp,
        collected_by ?? existing.collected_by, collected_date ?? existing.collected_date,
        collection_method ?? existing.collection_method, hash_md5 ?? existing.hash_md5,
        hash_sha256 ?? existing.hash_sha256, disposition ?? existing.disposition,
        disposition_date ?? existing.disposition_date, disposition_notes ?? existing.disposition_notes,
        notes ?? existing.notes, now, c.req.param('exhibitId'),
      );

      const updated = await db.prepare('SELECT * FROM forensic_exhibits WHERE id = ?').get(c.req.param('exhibitId'));
      return c.json({ data: updated });
    } catch (error: any) {
      console.error('Update exhibit error:', error);
      return c.json({ error: 'Failed to update exhibit', code: 'FORENSICS_ERROR' }, 500);
    }
  });

  // DELETE /:caseId/exhibits/:exhibitId
  api.delete('/:caseId/exhibits/:exhibitId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existing = await db.prepare('SELECT * FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?').get(c.req.param('exhibitId'), c.req.param('caseId')) as any;
      if (!existing) return c.json({ error: 'Exhibit not found', code: 'EXHIBIT_NOT_FOUND' }, 404);

      await db.prepare('DELETE FROM forensic_exhibits WHERE id = ?').run(c.req.param('exhibitId'));
      return c.json({ message: 'Exhibit deleted' });
    } catch (error: any) {
      console.error('Delete exhibit error:', error);
      return c.json({ error: 'Failed to delete exhibit', code: 'DELETE_EXHIBIT_ERROR' }, 500);
    }
  });

  // POST /:caseId/exhibits/:exhibitId/custody
  api.post('/:caseId/exhibits/:exhibitId/custody', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const existing = await db.prepare('SELECT * FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?').get(c.req.param('exhibitId'), c.req.param('caseId')) as any;
      if (!existing) return c.json({ error: 'Exhibit not found', code: 'EXHIBIT_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { action, notes: custodyNotes } = body;
      if (!action) return c.json({ error: 'Action is required', code: 'ACTION_IS_REQUIRED' }, 400);

      const chain = JSON.parse(existing.chain_of_custody || '[]');
      chain.push({ action, by: user.username, at: localNow(), notes: custodyNotes || '', admin_override: user.role === 'admin' });

      await db.prepare('UPDATE forensic_exhibits SET chain_of_custody = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(chain), localNow(), existing.id);

      const updated = await db.prepare('SELECT * FROM forensic_exhibits WHERE id = ?').get(existing.id);
      return c.json({ data: updated });
    } catch (error: any) {
      console.error('Custody update error:', error);
      return c.json({ error: 'Failed to update custody', code: 'CUSTODY_UPDATE_ERROR' }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════
  // ANALYSES
  // ════════════════════════════════════════════════════════════

  // GET /:caseId/analyses
  api.get('/:caseId/analyses', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT a.*, u.full_name as examiner_name, e.exhibit_number
        FROM forensic_analyses a
        LEFT JOIN users u ON a.examiner_id = u.id
        LEFT JOIN forensic_exhibits e ON a.exhibit_id = e.id
        WHERE a.forensic_case_id = ?
        ORDER BY a.created_at DESC
        LIMIT 1000
      `).all(c.req.param('caseId'));
      return c.json({ data: rows });
    } catch (error: any) {
      console.error('Get analyses error:', error);
      return c.json({ error: 'Failed to get analyses', code: 'GET_ANALYSES_ERROR' }, 500);
    }
  });

  // POST /:caseId/analyses
  api.post('/:caseId/analyses', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const fc = await db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(c.req.param('caseId')) as any;
      if (!fc) return c.json({ error: 'Forensic case not found', code: 'FORENSIC_CASE_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { exhibit_id, analysis_type, methodology, equipment_used, examiner_id, notes } = body;

      if (!analysis_type) return c.json({ error: 'Analysis type is required', code: 'ANALYSIS_TYPE_IS_REQUIRED' }, 400);

      const now = localNow();
      const result = await db.prepare(`
        INSERT INTO forensic_analyses (
          forensic_case_id, exhibit_id, analysis_type, methodology,
          equipment_used, examiner_id, status, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `).run(
        c.req.param('caseId'), exhibit_id || null, analysis_type,
        methodology || null, equipment_used || null,
        examiner_id || user.userId, notes || null, now, now,
      );

      const newAnalysis = await db.prepare(`
        SELECT a.*, u.full_name as examiner_name, e.exhibit_number
        FROM forensic_analyses a
        LEFT JOIN users u ON a.examiner_id = u.id
        LEFT JOIN forensic_exhibits e ON a.exhibit_id = e.id
        WHERE a.id = ?
      `).get(result.meta.last_row_id);
      return c.json({ data: newAnalysis }, 201);
    } catch (error: any) {
      console.error('Create analysis error:', error);
      return c.json({ error: 'Failed to create analysis', code: 'FORENSICS_ERROR' }, 500);
    }
  });

  // PUT /:caseId/analyses/:analysisId
  api.put('/:caseId/analyses/:analysisId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existing = await db.prepare('SELECT * FROM forensic_analyses WHERE id = ? AND forensic_case_id = ?').get(c.req.param('analysisId'), c.req.param('caseId')) as any;
      if (!existing) return c.json({ error: 'Analysis not found', code: 'ANALYSIS_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const {
        analysis_type, methodology, equipment_used, examiner_id,
        status, started_at, completed_at, results, conclusion,
        limitations, notes,
      } = body;

      const now = localNow();
      const newStatus = status || existing.status;
      let newStarted = started_at ?? existing.started_at;
      let newCompleted = completed_at ?? existing.completed_at;

      if (newStatus === 'in_progress' && !newStarted) newStarted = now;
      if ((newStatus === 'completed' || newStatus === 'inconclusive') && !newCompleted) newCompleted = now;

      await db.prepare(`
        UPDATE forensic_analyses SET
          analysis_type = ?, methodology = ?, equipment_used = ?, examiner_id = ?,
          status = ?, started_at = ?, completed_at = ?, results = ?,
          conclusion = ?, limitations = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(
        analysis_type || existing.analysis_type, methodology ?? existing.methodology,
        equipment_used ?? existing.equipment_used, examiner_id ?? existing.examiner_id,
        newStatus, newStarted, newCompleted,
        results ?? existing.results, conclusion ?? existing.conclusion,
        limitations ?? existing.limitations, notes ?? existing.notes,
        now, c.req.param('analysisId'),
      );

      const updated = await db.prepare(`
        SELECT a.*, u.full_name as examiner_name, e.exhibit_number
        FROM forensic_analyses a
        LEFT JOIN users u ON a.examiner_id = u.id
        LEFT JOIN forensic_exhibits e ON a.exhibit_id = e.id
        WHERE a.id = ?
      `).get(c.req.param('analysisId'));
      return c.json({ data: updated });
    } catch (error: any) {
      console.error('Update analysis error:', error);
      return c.json({ error: 'Failed to update analysis', code: 'FORENSICS_ERROR' }, 500);
    }
  });

  // DELETE /:caseId/analyses/:analysisId
  api.delete('/:caseId/analyses/:analysisId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existing = await db.prepare('SELECT * FROM forensic_analyses WHERE id = ? AND forensic_case_id = ?').get(c.req.param('analysisId'), c.req.param('caseId')) as any;
      if (!existing) return c.json({ error: 'Analysis not found', code: 'ANALYSIS_NOT_FOUND' }, 404);
      await db.prepare('DELETE FROM forensic_analyses WHERE id = ?').run(c.req.param('analysisId'));
      return c.json({ message: 'Analysis deleted' });
    } catch (error: any) {
      console.error('Delete analysis error:', error);
      return c.json({ error: 'Failed to delete analysis', code: 'DELETE_ANALYSIS_ERROR' }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════
  // ACTIVITY LOG
  // ════════════════════════════════════════════════════════════

  api.get('/:caseId/activity', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT * FROM forensic_activity_log WHERE forensic_case_id = ? ORDER BY performed_at DESC
        LIMIT 1000
      `).all(c.req.param('caseId'));
      return c.json({ data: rows });
    } catch (error: any) {
      console.error('Get activity log error:', error);
      return c.json({ error: 'Failed to get activity log', code: 'GET_ACTIVITY_LOG_ERROR' }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════
  // HASH SETS
  // ════════════════════════════════════════════════════════════

  // GET /hash-sets
  api.get('/hash-sets', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const sets = await db.prepare('SELECT * FROM forensic_hash_sets ORDER BY created_at DESC LIMIT 1000').all();
      return c.json({ data: sets });
    } catch (error: any) {
      console.error('Get hash sets error:', error);
      return c.json({ error: 'Failed to get hash sets', code: 'GET_HASH_SETS_ERROR' }, 500);
    }
  });

  // POST /hash-sets
  api.post('/hash-sets', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { name, set_type, description, version, entries } = body;

      if (!name || !set_type) return c.json({ error: 'Name and set_type are required', code: 'NAME_AND_SETTYPE_ARE' }, 400);

      const now = localNow();
      const user = c.get('user');
      const userName = user.username || 'unknown';

      const result = await db.prepare(`
        INSERT INTO forensic_hash_sets (name, set_type, description, version, imported_by, imported_by_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, set_type, description || null, version || null, user.userId, userName, now, now);
      const setId = result.meta.last_row_id;

      let hashCount = 0;
      if (Array.isArray(entries) && entries.length > 0) {
        for (const entry of entries) {
          if (entry.md5) { await db.prepare('INSERT OR IGNORE INTO forensic_hash_entries (hash_set_id, hash_value, hash_type, file_name, file_size, category) VALUES (?, ?, ?, ?, ?, ?)').run(setId, (entry.md5 as string).toLowerCase(), 'md5', entry.file_name || null, entry.file_size || null, entry.category || null); hashCount++; }
          if (entry.sha1) { await db.prepare('INSERT OR IGNORE INTO forensic_hash_entries (hash_set_id, hash_value, hash_type, file_name, file_size, category) VALUES (?, ?, ?, ?, ?, ?)').run(setId, (entry.sha1 as string).toLowerCase(), 'sha1', entry.file_name || null, entry.file_size || null, entry.category || null); hashCount++; }
          if (entry.sha256) { await db.prepare('INSERT OR IGNORE INTO forensic_hash_entries (hash_set_id, hash_value, hash_type, file_name, file_size, category) VALUES (?, ?, ?, ?, ?, ?)').run(setId, (entry.sha256 as string).toLowerCase(), 'sha256', entry.file_name || null, entry.file_size || null, entry.category || null); hashCount++; }
          if (!entry.md5 && !entry.sha1 && !entry.sha256 && entry.hash_value && entry.hash_type) {
            await db.prepare('INSERT OR IGNORE INTO forensic_hash_entries (hash_set_id, hash_value, hash_type, file_name, file_size, category) VALUES (?, ?, ?, ?, ?, ?)').run(setId, (entry.hash_value as string).toLowerCase(), entry.hash_type, entry.file_name || null, entry.file_size || null, entry.category || null);
            hashCount++;
          }
        }

        await db.prepare('UPDATE forensic_hash_sets SET hash_count = ?, updated_at = ? WHERE id = ?').run(hashCount, now, setId);
      }

      const created = await db.prepare('SELECT * FROM forensic_hash_sets WHERE id = ?').get(setId);
      return c.json({ data: created, hash_count: hashCount }, 201);
    } catch (error: any) {
      console.error('Create hash set error:', error);
      return c.json({ error: 'Failed to create hash set', code: 'CREATE_HASH_SET_ERROR' }, 500);
    }
  });

  // DELETE /hash-sets/:id
  api.delete('/hash-sets/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = parseInt(c.req.param('id'), 10);
      if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

      const existing = await db.prepare('SELECT id, name FROM forensic_hash_sets WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Hash set not found', code: 'HASH_SET_NOT_FOUND' }, 404);

      await db.prepare('DELETE FROM forensic_hash_sets WHERE id = ?').run(id);
      return c.json({ message: `Hash set "${existing.name}" deleted` });
    } catch (error: any) {
      console.error('Delete hash set error:', error);
      return c.json({ error: 'Failed to delete hash set', code: 'DELETE_HASH_SET_ERROR' }, 500);
    }
  });

  // POST /hash-sets/check
  api.post('/hash-sets/check', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { hashes } = body;

      if (!Array.isArray(hashes) || hashes.length === 0) {
        return c.json({ error: 'Provide an array of hashes', code: 'PROVIDE_AN_ARRAY_OF' }, 400);
      }

      const placeholders = hashes.map(() => '?').join(',');
      const lowerHashes = hashes.map((h: string) => (h as string).toLowerCase());

      const matches = await db.prepare(`
        SELECT e.hash_value, e.hash_type, e.file_name, e.category,
               s.id as set_id, s.name as set_name, s.set_type
        FROM forensic_hash_entries e
        JOIN forensic_hash_sets s ON s.id = e.hash_set_id
        WHERE LOWER(e.hash_value) IN (${placeholders})
        LIMIT 1000
      `).all(...lowerHashes) as any[];

      const results: Record<string, any[]> = {};
      for (const m of matches) {
        if (!results[m.hash_value]) results[m.hash_value] = [];
        results[m.hash_value].push({
          set_id: m.set_id,
          set_name: m.set_name,
          set_type: m.set_type,
          hash_type: m.hash_type,
          file_name: m.file_name,
          category: m.category,
        });
      }

      return c.json({ data: results, total_matches: matches.length });
    } catch (error: any) {
      console.error('Hash check error:', error);
      return c.json({ error: 'Failed to check hashes', code: 'HASH_CHECK_ERROR' }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════
  // EVIDENCE INTAKE
  // ════════════════════════════════════════════════════════════

  api.post('/:caseId/evidence-intake', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const fc = await db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(c.req.param('caseId')) as any;
      if (!fc) return c.json({ error: 'Forensic case not found', code: 'FORENSIC_CASE_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const {
        item_description, item_type, item_make, item_model, item_serial,
        condition_on_receipt, packaging_type, packaging_sealed,
        collected_by, collected_date, collected_location,
        chain_of_custody_from, storage_location, storage_requirements,
        hazardous, biohazard, notes,
      } = body;

      if (!item_description) return c.json({ error: 'item_description is required', code: 'ITEMDESCRIPTION_IS_REQUIRED' }, 400);

      const now = localNow();
      const exhibitCount = (await db.prepare('SELECT COUNT(*) as cnt FROM forensic_exhibits WHERE forensic_case_id = ?').get(c.req.param('caseId')) as any).cnt;
      const exhibit_number = `${fc.lab_number}-E${String(exhibitCount + 1).padStart(3, '0')}`;

      const info = await db.prepare(`
        INSERT INTO forensic_exhibits (
          forensic_case_id, exhibit_number, description, evidence_type,
          device_make, device_model, device_serial,
          condition_on_receipt, packaging_type, packaging_sealed,
          collected_by, collected_date, collected_location,
          received_from, storage_location, storage_requirements,
          is_hazardous, is_biohazard, notes,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)
      `).run(
        c.req.param('caseId'), exhibit_number, item_description, item_type || 'other',
        item_make || null, item_model || null, item_serial || null,
        condition_on_receipt || 'good', packaging_type || 'sealed_bag',
        packaging_sealed ? 1 : 0,
        collected_by || user.username, collected_date || now, collected_location || '',
        chain_of_custody_from || '', storage_location || 'Evidence Locker',
        storage_requirements || 'standard',
        hazardous ? 1 : 0, biohazard ? 1 : 0, notes || '',
        now, now
      );

      const exhibit = await db.prepare('SELECT * FROM forensic_exhibits WHERE id = ?').get(info.meta.last_row_id);
      return c.json({ data: exhibit }, 201);
    } catch (error: any) {
      console.error('Evidence intake error:', error);
      return c.json({ error: 'Failed to create evidence intake', code: 'FORENSICS_ERROR' }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════
  // LAB QUEUE
  // ════════════════════════════════════════════════════════════

  api.get('/queue/priority', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const queue = await db.prepare(`
        SELECT fc.id, fc.lab_number, fc.title, fc.case_type, fc.priority, fc.status,
               fc.received_date, fc.due_date, fc.lead_examiner_id,
               u.full_name as lead_examiner_name,
               (SELECT COUNT(*) FROM forensic_exhibits WHERE forensic_case_id = fc.id) as exhibit_count,
               (SELECT COUNT(*) FROM forensic_analyses WHERE forensic_case_id = fc.id AND status IN ('pending','in_progress')) as pending_analyses,
               CASE fc.priority
                 WHEN 'rush' THEN 1 WHEN 'urgent' THEN 2 WHEN 'expedited' THEN 3 ELSE 4
               END as priority_order,
               JULIANDAY(COALESCE(fc.due_date, '9999-12-31')) - JULIANDAY('now') as days_until_due
        FROM forensic_cases fc
        LEFT JOIN users u ON fc.lead_examiner_id = u.id
        WHERE fc.status NOT IN ('closed', 'cancelled', 'released')
        ORDER BY priority_order ASC, days_until_due ASC, fc.received_date ASC
      `).all();

      return c.json({ data: queue });
    } catch (error: any) {
      console.error('Lab queue error:', error);
      return c.json({ error: 'Failed to get lab queue', code: 'LAB_QUEUE_ERROR' }, 500);
    }
  });

  api.put('/queue/reorder', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { case_id, new_priority } = body;
      if (!case_id || !new_priority) return c.json({ error: 'case_id and new_priority required', code: 'CASEID_AND_NEWPRIORITY_REQUIRED' }, 400);

      const valid = ['routine', 'expedited', 'urgent', 'rush'];
      if (!valid.includes(new_priority)) return c.json({ error: 'Invalid priority', code: 'INVALID_PRIORITY' }, 400);

      await db.prepare('UPDATE forensic_cases SET priority = ?, updated_at = ? WHERE id = ?')
        .run(new_priority, localNow(), case_id);

      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════
  // CUSTODY TRANSFER (digital signature)
  // ════════════════════════════════════════════════════════════

  api.post('/:caseId/exhibits/:exhibitId/custody-transfer', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const exhibit = await db.prepare('SELECT * FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?')
        .get(c.req.param('exhibitId'), c.req.param('caseId')) as any;
      if (!exhibit) return c.json({ error: 'Exhibit not found', code: 'EXHIBIT_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { transferred_to_id, transferred_to_name, reason, signature_data, location } = body;
      if (!transferred_to_name && !transferred_to_id) return c.json({ error: 'transferred_to is required', code: 'TRANSFERREDTO_IS_REQUIRED' }, 400);

      const now = localNow();
      const transferData = {
        exhibit_id: exhibit.id,
        exhibit_number: exhibit.exhibit_number,
        transferred_from_id: user.userId,
        transferred_from_name: user.username,
        transferred_to_id: transferred_to_id || null,
        transferred_to_name: transferred_to_name || '',
        reason: reason || 'examination',
        signature_data: signature_data || null,
        location: location || '',
        transferred_at: now,
      };

      await db.prepare('UPDATE forensic_exhibits SET current_custodian = ?, current_custodian_id = ?, updated_at = ? WHERE id = ?')
        .run(transferred_to_name || '', transferred_to_id || null, now, exhibit.id);

      return c.json({ data: transferData }, 201);
    } catch (error: any) {
      console.error('Custody transfer error:', error);
      return c.json({ error: 'Failed to transfer custody', code: 'FORENSICS_ERROR' }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════
  // REPORT TEMPLATES
  // ════════════════════════════════════════════════════════════

  api.get('/templates/report', async (c) => {
    const templates: Record<string, any> = {
      digital: {
        title: 'Digital Forensics Examination Report',
        sections: [
          { name: 'Case Information', fields: ['lab_number', 'case_type', 'requesting_agency', 'requesting_officer', 'received_date'] },
          { name: 'Evidence Description', fields: ['device_type', 'make', 'model', 'serial', 'condition'] },
          { name: 'Examination Methodology', fields: ['tools_used', 'imaging_method', 'hash_algorithm', 'source_hash', 'image_hash'] },
          { name: 'Findings', fields: ['files_recovered', 'artifacts_found', 'timeline_events', 'notable_items'] },
          { name: 'Conclusions', fields: ['summary', 'opinion'] },
          { name: 'Examiner Certification', fields: ['examiner_name', 'examiner_credentials', 'signature', 'date'] },
        ],
      },
      biological: {
        title: 'Biological Evidence Examination Report',
        sections: [
          { name: 'Case Information', fields: ['lab_number', 'requesting_agency', 'received_date'] },
          { name: 'Evidence Description', fields: ['sample_type', 'quantity', 'collection_method', 'storage_conditions'] },
          { name: 'Testing Methodology', fields: ['test_type', 'reagents_used', 'controls'] },
          { name: 'Results', fields: ['positive_findings', 'negative_findings', 'quantitative_results'] },
          { name: 'Conclusions', fields: ['interpretation', 'statistical_analysis'] },
          { name: 'Examiner Certification', fields: ['examiner_name', 'credentials', 'signature', 'date'] },
        ],
      },
      latent_prints: {
        title: 'Latent Print Examination Report',
        sections: [
          { name: 'Case Information', fields: ['lab_number', 'requesting_agency', 'received_date'] },
          { name: 'Evidence Processed', fields: ['surface_type', 'processing_method', 'prints_developed'] },
          { name: 'Comparison Results', fields: ['identified_prints', 'inconclusive_prints', 'eliminated_prints'] },
          { name: 'Conclusions', fields: ['identification_summary'] },
          { name: 'Examiner Certification', fields: ['examiner_name', 'signature', 'date'] },
        ],
      },
      drug_analysis: {
        title: 'Controlled Substance Analysis Report',
        sections: [
          { name: 'Case Information', fields: ['lab_number', 'requesting_agency', 'received_date'] },
          { name: 'Evidence Description', fields: ['appearance', 'packaging', 'gross_weight', 'net_weight'] },
          { name: 'Analysis', fields: ['presumptive_test', 'confirmatory_test', 'instrument_used'] },
          { name: 'Results', fields: ['substance_identified', 'schedule', 'purity'] },
          { name: 'Examiner Certification', fields: ['examiner_name', 'signature', 'date'] },
        ],
      },
    };

    return c.json({ data: templates });
  });

  api.post('/:caseId/generate-report', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const fc = await db.prepare(`
        SELECT fc.*, u.full_name as lead_examiner_name
        FROM forensic_cases fc LEFT JOIN users u ON fc.lead_examiner_id = u.id
        WHERE fc.id = ?
      `).get(c.req.param('caseId')) as any;
      if (!fc) return c.json({ error: 'Case not found', code: 'CASE_NOT_FOUND' }, 404);

      const exhibits = await db.prepare('SELECT * FROM forensic_exhibits WHERE forensic_case_id = ?').all(c.req.param('caseId'));
      const analyses = await db.prepare('SELECT * FROM forensic_analyses WHERE forensic_case_id = ?').all(c.req.param('caseId'));
      const activity = await db.prepare('SELECT * FROM forensic_activity_log WHERE forensic_case_id = ? ORDER BY performed_at ASC').all(c.req.param('caseId'));

      const body = await c.req.json();
      const { findings, conclusions, additional_notes } = body;

      const report = {
        lab_number: fc.lab_number,
        title: fc.title,
        case_type: fc.case_type,
        requesting_agency: fc.requesting_agency,
        requesting_officer: fc.requesting_officer,
        received_date: fc.received_date,
        completed_date: fc.completed_date || localNow(),
        examiner: fc.lead_examiner_name || user.username,
        exhibits,
        analyses,
        chain_of_custody: (activity as any[]).filter((a: any) => a.action === 'custody_transfer'),
        findings: findings || '',
        conclusions: conclusions || '',
        additional_notes: additional_notes || '',
        generated_at: localNow(),
        generated_by: user.username,
      };

      const now = localNow();
      await db.prepare('UPDATE forensic_cases SET status = ?, completed_date = COALESCE(completed_date, ?), updated_at = ? WHERE id = ?')
        .run('report_draft', now, now, c.req.param('caseId'));

      return c.json({ data: report });
    } catch (error: any) {
      console.error('Generate report error:', error);
      return c.json({ error: 'Failed to generate report', code: 'FORENSICS_ERROR' }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════
  // CAPACITY PLANNING
  // ════════════════════════════════════════════════════════════

  api.get('/capacity/planning', async (c) => {
    try {
      const db = new D1Db(c.env.DB);

      const examiners = await db.prepare(`
        SELECT u.id, u.full_name,
          COUNT(CASE WHEN fc.status NOT IN ('closed', 'cancelled', 'released') THEN 1 END) as active_cases,
          COUNT(CASE WHEN fc.priority = 'rush' AND fc.status NOT IN ('closed', 'cancelled', 'released') THEN 1 END) as rush_cases,
          COUNT(CASE WHEN fc.priority = 'urgent' AND fc.status NOT IN ('closed', 'cancelled', 'released') THEN 1 END) as urgent_cases
        FROM users u
        LEFT JOIN forensic_cases fc ON fc.lead_examiner_id = u.id
        WHERE u.status = 'active' AND (u.role IN ('admin', 'officer') OR fc.lead_examiner_id IS NOT NULL)
        GROUP BY u.id
        HAVING active_cases > 0
        ORDER BY active_cases DESC
      `).all() as any[];

      const weeklyLoad: any[] = [];
      for (let w = 0; w < 4; w++) {
        const weekStart = new Date(Date.now() + w * 7 * 24 * 60 * 60 * 1000);
        const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        const dueThisWeek = await db.prepare(`
          SELECT COUNT(*) as cnt FROM forensic_cases
          WHERE due_date BETWEEN ? AND ? AND status NOT IN ('closed', 'cancelled', 'released')
        `).get(weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]) as any;

        weeklyLoad.push({
          week: w + 1,
          start: weekStart.toISOString().split('T')[0],
          end: weekEnd.toISOString().split('T')[0],
          cases_due: dueThisWeek?.cnt || 0,
        });
      }

      const pendingAnalyses = (await db.prepare("SELECT COUNT(*) as cnt FROM forensic_analyses WHERE status IN ('pending', 'in_progress')").get() as any)?.cnt || 0;

      const avgTurnaround = await db.prepare(`
        SELECT AVG(JULIANDAY(completed_date) - JULIANDAY(received_date)) as avg_days
        FROM forensic_cases
        WHERE completed_date IS NOT NULL AND received_date IS NOT NULL
      `).get() as any;

      return c.json({
        data: {
          examiners,
          weekly_load: weeklyLoad,
          pending_analyses: pendingAnalyses,
          avg_turnaround_days: Math.round((avgTurnaround?.avg_days || 0) * 10) / 10,
          total_active_cases: examiners.reduce((s: number, e: any) => s + e.active_cases, 0),
        },
      });
    } catch (error: any) {
      console.error('Capacity planning error:', error);
      return c.json({ error: 'Failed to get capacity planning', code: 'CAPACITY_PLANNING_ERROR' }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════
  // CASE LINKS
  // ════════════════════════════════════════════════════════════

  api.get('/:caseId/links', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const links = await db.prepare('SELECT * FROM forensic_case_links WHERE forensic_case_id = ? ORDER BY linked_at DESC LIMIT 1000').all(c.req.param('caseId'));
      return c.json(links);
    } catch (error: any) {
      console.error('Forensic case links error:', error);
      return c.json({ error: 'Failed to get forensic case links', code: 'FORENSIC_CASE_LINKS_ERROR' }, 500);
    }
  });

  api.post('/:caseId/links', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { linked_type, linked_id, linked_label } = body;
      if (!linked_type || !linked_id) return c.json({ error: 'linked_type and linked_id required', code: 'LINKEDTYPE_AND_LINKEDID_REQUIRED' }, 400);
      const result = await db.prepare('INSERT INTO forensic_case_links (forensic_case_id, linked_type, linked_id, relationship) VALUES (?, ?, ?, ?)').run(c.req.param('caseId'), linked_type, linked_id, linked_label || null);
      return c.json({ id: result.meta.last_row_id }, 201);
    } catch (error: any) {
      console.error('Forensic case add link error:', error);
      return c.json({ error: 'Failed to add forensic case link', code: 'FORENSIC_CASE_ADD_LINK' }, 500);
    }
  });

  // GET /:caseId/hashes
  api.get('/:caseId/hashes', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const hashes = await db.prepare('SELECT * FROM forensic_hash_results WHERE case_id = ? ORDER BY created_at DESC LIMIT 1000').all(c.req.param('caseId'));

      const stats = {
        total: hashes.length,
        matches: (hashes as any[]).filter((h: any) => h.match_found).length,
        clean: (hashes as any[]).filter((h: any) => !h.match_found).length,
      };

      return c.json({ hashes, stats });
    } catch (error: any) {
      console.error('Forensic case hashes error:', error);
      return c.json({ error: 'Failed to get forensic case hashes', code: 'FORENSIC_CASE_HASHES_ERROR' }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════
  // TURNAROUND TIMES
  // ════════════════════════════════════════════════════════════

  api.get('/turnaround-times', async (c) => {
    try {
      const db = new D1Db(c.env.DB);

      const byType = await db.prepare(`
        SELECT case_type, COUNT(*) as cases_completed,
          ROUND(AVG(JULIANDAY(completed_date) - JULIANDAY(received_date)), 1) as avg_days,
          ROUND(MIN(JULIANDAY(completed_date) - JULIANDAY(received_date)), 1) as min_days,
          ROUND(MAX(JULIANDAY(completed_date) - JULIANDAY(received_date)), 1) as max_days
        FROM forensic_cases
        WHERE completed_date IS NOT NULL AND received_date IS NOT NULL
        GROUP BY case_type ORDER BY avg_days DESC
      `).all();

      const byPriority = await db.prepare(`
        SELECT priority, COUNT(*) as cases_completed,
          ROUND(AVG(JULIANDAY(completed_date) - JULIANDAY(received_date)), 1) as avg_days
        FROM forensic_cases
        WHERE completed_date IS NOT NULL AND received_date IS NOT NULL
        GROUP BY priority
      `).all();

      const monthlyTrend = await db.prepare(`
        SELECT strftime('%Y-%m', completed_date) as month, COUNT(*) as cases_completed,
          ROUND(AVG(JULIANDAY(completed_date) - JULIANDAY(received_date)), 1) as avg_days
        FROM forensic_cases
        WHERE completed_date IS NOT NULL AND received_date IS NOT NULL
          AND completed_date >= datetime('now', '-12 months')
        GROUP BY month ORDER BY month
      `).all();

      const overdue = await db.prepare(`
        SELECT id, lab_number, title, case_type, priority, due_date, received_date,
          CAST(JULIANDAY('now') - JULIANDAY(due_date) AS INTEGER) as days_overdue
        FROM forensic_cases
        WHERE due_date IS NOT NULL AND due_date < DATE('now')
          AND status NOT IN ('released', 'cancelled', 'closed')
        ORDER BY days_overdue DESC
        LIMIT 50
      `).all();

      const analysisTurnaround = await db.prepare(`
        SELECT analysis_type, COUNT(*) as completed,
          ROUND(AVG(JULIANDAY(completed_at) - JULIANDAY(created_at)), 1) as avg_days
        FROM forensic_analyses
        WHERE completed_at IS NOT NULL
        GROUP BY analysis_type ORDER BY avg_days DESC
      `).all();

      return c.json({
        data: {
          by_type: byType,
          by_priority: byPriority,
          monthly_trend: monthlyTrend,
          overdue_cases: overdue,
          analysis_turnaround: analysisTurnaround,
        },
      });
    } catch (error: any) {
      console.error('Turnaround times error:', error);
      return c.json({ error: 'Failed to get turnaround times', code: 'TURNAROUND_TIMES_ERROR' }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════
  // CUSTODY AUDIT
  // ════════════════════════════════════════════════════════════

  api.get('/:caseId/exhibits/:exhibitId/custody-audit', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const exhibit = await db.prepare('SELECT * FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?')
        .get(c.req.param('exhibitId'), c.req.param('caseId')) as any;
      if (!exhibit) return c.json({ error: 'Exhibit not found', code: 'EXHIBIT_NOT_FOUND' }, 404);

      let chain: any[] = [];
      try { chain = JSON.parse(exhibit.chain_of_custody || '[]'); } catch { /* ignore */ }

      const transfers = await db.prepare(`
        SELECT * FROM forensic_activity_log
        WHERE forensic_case_id = ? AND exhibit_id = ? AND action IN ('custody_transfer', 'received', 'check_in', 'check_out')
        ORDER BY performed_at ASC
      `).all(c.req.param('caseId'), c.req.param('exhibitId')) as any[];

      const gaps: any[] = [];
      const issues: string[] = [];

      for (let i = 1; i < chain.length; i++) {
        const prev = chain[i - 1];
        const curr = chain[i];
        const prevTime = prev.at || prev.timestamp;
        const currTime = curr.at || curr.timestamp;
        if (prevTime && currTime) {
          const gapHours = (new Date(currTime).getTime() - new Date(prevTime).getTime()) / (1000 * 60 * 60);
          if (gapHours > 24) {
            gaps.push({ from_index: i - 1, to_index: i, gap_hours: Math.round(gapHours * 10) / 10 });
          }
        }
      }

      for (let i = 0; i < chain.length; i++) {
        if (!chain[i].by && !chain[i].user_name && !chain[i].user_id) {
          issues.push(`Entry ${i + 1}: Missing responsible party`);
        }
      }

      if (!exhibit.current_custodian && !exhibit.storage_location) {
        issues.push('No current custodian or storage location recorded');
      }

      return c.json({
        data: {
          exhibit_id: exhibit.id,
          exhibit_number: exhibit.exhibit_number,
          chain_entries: chain.length,
          transfer_records: transfers.length,
          gaps,
          issues,
          is_valid: gaps.length === 0 && issues.length === 0,
          current_custodian: exhibit.current_custodian || null,
          current_location: exhibit.storage_location || null,
        },
      });
    } catch (error: any) {
      console.error('Custody audit error:', error);
      return c.json({ error: 'Failed to audit custody', code: 'CUSTODY_AUDIT_ERROR' }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════
  // ANALYSIS TEMPLATES
  // ════════════════════════════════════════════════════════════

  api.get('/analysis-templates', async (c) => {
    const templates: Record<string, any> = {
      dna: {
        name: 'DNA Analysis',
        result_fields: ['profile_type', 'loci_tested', 'allele_calls', 'match_probability', 'codis_eligible', 'mixture_detected'],
        conclusion_options: ['match', 'exclusion', 'inconclusive', 'mixture_detected', 'insufficient_sample'],
      },
      fingerprint: {
        name: 'Fingerprint Comparison',
        result_fields: ['print_quality', 'ridge_detail', 'comparison_points', 'afis_searched', 'candidate_matches'],
        conclusion_options: ['identification', 'exclusion', 'inconclusive', 'unsuitable_for_comparison'],
      },
      toxicology: {
        name: 'Toxicology Screen',
        result_fields: ['specimen_type', 'tests_performed', 'substances_detected', 'concentrations', 'detection_limits'],
        conclusion_options: ['positive', 'negative', 'inconclusive', 'below_threshold'],
      },
      firearms: {
        name: 'Firearms/Toolmarks',
        result_fields: ['firearm_type', 'caliber', 'rifling_characteristics', 'nibin_entered', 'comparison_results'],
        conclusion_options: ['identification', 'elimination', 'inconclusive', 'unsuitable'],
      },
      digital: {
        name: 'Digital Forensics',
        result_fields: ['device_type', 'os_version', 'encryption_status', 'data_recovered', 'artifacts_found', 'timeline_events'],
        conclusion_options: ['evidence_found', 'no_relevant_evidence', 'partial_recovery', 'device_inaccessible'],
      },
      drug_analysis: {
        name: 'Drug Analysis',
        result_fields: ['presumptive_result', 'confirmatory_result', 'substance_identified', 'schedule', 'net_weight', 'purity'],
        conclusion_options: ['controlled_substance_identified', 'no_controlled_substance', 'inconclusive'],
      },
      trace_evidence: {
        name: 'Trace Evidence',
        result_fields: ['material_type', 'microscopy_results', 'spectroscopy_results', 'comparison_results'],
        conclusion_options: ['consistent', 'inconsistent', 'inconclusive', 'insufficient_sample'],
      },
    };
    return c.json({ data: templates });
  });

  api.post('/:caseId/analyses/:analysisId/apply-template', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const existing = await db.prepare('SELECT * FROM forensic_analyses WHERE id = ? AND forensic_case_id = ?')
        .get(c.req.param('analysisId'), c.req.param('caseId')) as any;
      if (!existing) return c.json({ error: 'Analysis not found', code: 'ANALYSIS_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { template_name, result_data, conclusion } = body;
      if (!template_name) return c.json({ error: 'template_name required', code: 'TEMPLATE_NAME_REQUIRED' }, 400);

      const now = localNow();
      await db.prepare(`UPDATE forensic_analyses SET template_name = ?, results = ?, conclusion = ?, updated_at = ? WHERE id = ?`)
        .run(template_name, JSON.stringify(result_data || {}), conclusion || existing.conclusion, now, c.req.param('analysisId'));

      const updated = await db.prepare('SELECT * FROM forensic_analyses WHERE id = ?').get(c.req.param('analysisId'));
      return c.json({ data: updated });
    } catch (error: any) {
      console.error('Apply template error:', error);
      return c.json({ error: 'Failed to apply template', code: 'APPLY_TEMPLATE_ERROR' }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════
  // QC CHECKS
  // ════════════════════════════════════════════════════════════

  api.post('/:caseId/qc-check', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const fc = await db.prepare('SELECT * FROM forensic_cases WHERE id = ?').get(c.req.param('caseId')) as any;
      if (!fc) return c.json({ error: 'Forensic case not found', code: 'FORENSIC_CASE_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { check_type, reviewer_notes, items_checked, pass } = body;
      if (!check_type) return c.json({ error: 'check_type required', code: 'CHECK_TYPE_REQUIRED' }, 400);

      const validTypes = ['peer_review', 'admin_review', 'technical_review', 'calibration_check', 'blank_check', 'positive_control', 'negative_control'];
      if (!validTypes.includes(check_type)) return c.json({ error: 'Invalid check type', code: 'INVALID_CHECK_TYPE' }, 400);

      const now = localNow();
      const qcData = {
        check_type,
        reviewer_id: user.userId,
        reviewer_name: user.username,
        items_checked: items_checked || [],
        pass: pass !== false,
        reviewer_notes: reviewer_notes || '',
        performed_at: now,
      };

      if (check_type === 'peer_review' && pass !== false && fc.status === 'report_drafted') {
        await db.prepare('UPDATE forensic_cases SET status = ?, updated_at = ? WHERE id = ?')
          .run('reviewed', now, c.req.param('caseId'));
      }

      return c.json({ data: qcData });
    } catch (error: any) {
      console.error('QC check error:', error);
      return c.json({ error: 'Failed to record QC check', code: 'QC_CHECK_ERROR' }, 500);
    }
  });

  api.get('/:caseId/qc-history', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const checks = await db.prepare(`
        SELECT * FROM forensic_activity_log
        WHERE forensic_case_id = ? AND action = 'qc_check'
        ORDER BY performed_at DESC
        LIMIT 100
      `).all(c.req.param('caseId'));
      return c.json({ data: checks });
    } catch (error: any) {
      return c.json({ error: 'Failed to get QC history', code: 'QC_HISTORY_ERROR' }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════
  // BACKLOG METRICS
  // ════════════════════════════════════════════════════════════

  api.get('/metrics/backlog', async (c) => {
    try {
      const db = new D1Db(c.env.DB);

      const backlogByType = await db.prepare(`
        SELECT case_type, COUNT(*) as count,
          ROUND(AVG(JULIANDAY('now') - JULIANDAY(received_date)), 1) as avg_age_days
        FROM forensic_cases
        WHERE status NOT IN ('released', 'cancelled', 'closed')
        GROUP BY case_type ORDER BY count DESC
      `).all();

      const backlogByExaminer = await db.prepare(`
        SELECT u.full_name as examiner, COUNT(*) as active_cases,
          ROUND(AVG(JULIANDAY('now') - JULIANDAY(fc.received_date)), 1) as avg_age_days
        FROM forensic_cases fc
        LEFT JOIN users u ON fc.lead_examiner_id = u.id
        WHERE fc.status NOT IN ('released', 'cancelled', 'closed')
        GROUP BY fc.lead_examiner_id ORDER BY active_cases DESC
      `).all();

      const unassigned = (await db.prepare(`
        SELECT COUNT(*) as count FROM forensic_cases
        WHERE lead_examiner_id IS NULL AND status NOT IN ('released', 'cancelled', 'closed')
      `).get() as any)?.count || 0;

      const pendingAnalyses = (await db.prepare("SELECT COUNT(*) as count FROM forensic_analyses WHERE status = 'pending'").get() as any)?.count || 0;

      const inProgressAnalyses = (await db.prepare("SELECT COUNT(*) as count FROM forensic_analyses WHERE status = 'in_progress'").get() as any)?.count || 0;

      return c.json({
        data: {
          backlog_by_type: backlogByType,
          backlog_by_examiner: backlogByExaminer,
          unassigned_cases: unassigned,
          pending_analyses: pendingAnalyses,
          in_progress_analyses: inProgressAnalyses,
          total_backlog: (backlogByType as any[]).reduce((s: number, t: any) => s + t.count, 0),
        },
      });
    } catch (error: any) {
      console.error('Forensic backlog error:', error);
      return c.json({ error: 'Failed to get backlog metrics', code: 'BACKLOG_METRICS_ERROR' }, 500);
    }
  });

  // CSV Export
  api.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT fc.lab_number, fc.case_number, fc.case_type, fc.status, fc.priority,
               fc.submitted_by_name, fc.lead_examiner_name, fc.description,
               fc.received_date, fc.due_date, fc.completed_date, fc.created_at,
               (SELECT COUNT(*) FROM forensic_exhibits WHERE forensic_case_id = fc.id) as exhibit_count
        FROM forensic_cases fc
        ORDER BY fc.created_at DESC
        LIMIT 10000
      `).all() as any[];
      const headers = ['Lab #', 'Case #', 'Case Type', 'Status', 'Priority', 'Submitted By', 'Lead Examiner', 'Description', 'Received Date', 'Due Date', 'Completed Date', 'Exhibits', 'Created'];
      const csv = [
        headers.join(','),
        ...rows.map((r: any) => [
          r.lab_number, r.case_number, r.case_type, r.status, r.priority,
          (r.submitted_by_name || '').replace(/"/g, '""'),
          (r.lead_examiner_name || '').replace(/"/g, '""'),
          (r.description || '').replace(/"/g, '""'),
          r.received_date, r.due_date, r.completed_date, r.exhibit_count, r.created_at
        ].map(v => `"${v || ''}"`).join(','))
      ].join('\n');
      c.header('Content-Type', 'text/csv');
      c.header('Content-Disposition', `attachment; filename="forensic_cases_export_${new Date().toISOString().slice(0, 10)}.csv"`);
      return c.body(csv);
    } catch (error: any) {
      console.error('Forensics CSV export error:', error);
      return c.json({ error: 'Failed to export forensic cases', code: 'FORENSICS_EXPORT_ERROR' }, 500);
    }
  });

  app.route('/api/forensics', api);
  app.route('/api/forensic-lab', api);
}
