// Use of Force routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db } from '../worker-middleware/d1Helpers';
import { localNow } from '../worker-middleware/timeUtils';

export function mountUseOfForceRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /stats — Dashboard stats
  api.get('/stats', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const total = (await db.prepare('SELECT COUNT(*) as cnt FROM use_of_force').get() as any)?.cnt || 0;
      const pending = (await db.prepare("SELECT COUNT(*) as cnt FROM use_of_force WHERE status IN ('draft','submitted')").get() as any)?.cnt || 0;
      const reviewed = (await db.prepare("SELECT COUNT(*) as cnt FROM use_of_force WHERE status = 'reviewed'").get() as any)?.cnt || 0;
      const thisMonth = (await db.prepare("SELECT COUNT(*) as cnt FROM use_of_force WHERE created_at >= strftime('%Y-%m-01', 'now', 'localtime')").get() as any)?.cnt || 0;
      const byType = await db.prepare('SELECT force_type, COUNT(*) as count FROM use_of_force WHERE force_type IS NOT NULL GROUP BY force_type ORDER BY count DESC').all();
      const byLevel = await db.prepare('SELECT force_level, COUNT(*) as count FROM use_of_force WHERE force_level IS NOT NULL GROUP BY force_level ORDER BY count DESC').all();
      return c.json({ total, pending_review: pending, reviewed, this_month: thisMonth, by_type: byType, by_level: byLevel });
    } catch (error: any) {
      console.error('UoF stats error:', error);
      return c.json({ error: 'Failed to get UoF stats', code: 'UOF_STATS_ERROR' }, 500);
    }
  });

  // GET / — List all UoF reports with filters
  api.get('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { status, officer_id, force_type, force_level, page = '1', per_page = '100000', search } = q;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const perPage = Math.min(100000, Math.max(1, parseInt(per_page, 10) || 100000));
      const offset = (pageNum - 1) * perPage;

      let where = 'WHERE 1=1';
      const params: any[] = [];

      if (status) { where += ' AND uof.status = ?'; params.push(status); }
      if (officer_id) { where += ' AND uof.officer_id = ?'; params.push(officer_id); }
      if (force_type) { where += ' AND uof.force_type = ?'; params.push(force_type); }
      if (force_level) { where += ' AND uof.force_level = ?'; params.push(force_level); }
      if (search) {
        where += ' AND (uof.narrative LIKE ? OR uof.justification LIKE ? OR u.full_name LIKE ? OR p.first_name || " " || p.last_name LIKE ?)';
        const s = `%${search}%`;
        params.push(s, s, s, s);
      }

      const total = (await db.prepare(`SELECT COUNT(*) as cnt FROM use_of_force uof LEFT JOIN users u ON uof.officer_id = u.id LEFT JOIN persons p ON uof.subject_person_id = p.id ${where}`).get(...params) as any).cnt;

      const rows = await db.prepare(`
        SELECT uof.*,
          u.full_name as officer_name, u.badge_number as officer_badge,
          p.first_name as subject_first_name, p.last_name as subject_last_name, p.dob as subject_dob,
          i.incident_number, i.incident_type,
          r.full_name as reviewer_name
        FROM use_of_force uof
        LEFT JOIN users u ON uof.officer_id = u.id
        LEFT JOIN persons p ON uof.subject_person_id = p.id
        LEFT JOIN incidents i ON uof.incident_id = i.id
        LEFT JOIN users r ON uof.reviewed_by = r.id
        ${where}
        ORDER BY uof.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, perPage, offset);

      return c.json({ data: rows, pagination: { page: pageNum, per_page: perPage, total, totalPages: Math.ceil(total / perPage) } });
    } catch (error: any) {
      console.error('List UoF error:', error);
      return c.json({ error: 'Failed to list UoF reports', code: 'LIST_UOF_ERROR' }, 500);
    }
  });

  // GET /:id — Detail
  api.get('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const row = await db.prepare(`
        SELECT uof.*,
          u.full_name as officer_name, u.badge_number as officer_badge,
          p.first_name as subject_first_name, p.last_name as subject_last_name, p.dob as subject_dob,
          i.incident_number, i.incident_type,
          r.full_name as reviewer_name
        FROM use_of_force uof
        LEFT JOIN users u ON uof.officer_id = u.id
        LEFT JOIN persons p ON uof.subject_person_id = p.id
        LEFT JOIN incidents i ON uof.incident_id = i.id
        LEFT JOIN users r ON uof.reviewed_by = r.id
        WHERE uof.id = ?
      `).get(c.req.param('id'));
      if (!row) return c.json({ error: 'UoF report not found', code: 'UOF_NOT_FOUND' }, 404);
      return c.json({ data: row });
    } catch (error: any) {
      console.error('Get UoF error:', error);
      return c.json({ error: 'Failed to get UoF report', code: 'GET_UOF_ERROR' }, 500);
    }
  });

  // POST / — Create new UoF report
  api.post('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const body = await c.req.json();
      const {
        incident_id, subject_person_id, force_type, force_level,
        justification, subject_injuries, officer_injuries,
        de_escalation_attempted, de_escalation_details,
        weapons_used, body_camera_active, witness_officers, narrative,
      } = body;

      if (!force_type) return c.json({ error: 'force_type is required', code: 'FORCE_TYPE_REQUIRED' }, 400);

      const now = localNow();
      const result = await db.prepare(`
        INSERT INTO use_of_force (
          incident_id, officer_id, subject_person_id, force_type, force_level,
          justification, subject_injuries, officer_injuries,
          de_escalation_attempted, de_escalation_details,
          weapons_used, body_camera_active, witness_officers,
          narrative, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)
      `).run(
        incident_id || null, user.userId, subject_person_id || null,
        force_type, force_level || null,
        justification || null, subject_injuries || null, officer_injuries || null,
        de_escalation_attempted ? 1 : 0, de_escalation_details || null,
        weapons_used || null, body_camera_active ? 1 : 0,
        JSON.stringify(witness_officers || []),
        narrative || null, now, now,
      );

      // auditLog skipped; broadcast skipped

      const created = await db.prepare(`
        SELECT uof.*, u.full_name as officer_name FROM use_of_force uof LEFT JOIN users u ON uof.officer_id = u.id WHERE uof.id = ?
      `).get(result.meta.last_row_id);
      return c.json({ data: created }, 201);
    } catch (error: any) {
      console.error('Create UoF error:', error);
      return c.json({ error: 'Failed to create UoF report', code: 'CREATE_UOF_ERROR' }, 500);
    }
  });

  // PUT /:id — Update UoF report
  api.put('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existing = await db.prepare('SELECT * FROM use_of_force WHERE id = ?').get(c.req.param('id')) as any;
      if (!existing) return c.json({ error: 'UoF report not found', code: 'UOF_NOT_FOUND' }, 404);

      const body = await c.req.json();

      const fieldMap: Record<string, (v: any) => any> = {
        incident_id: v => v ?? null, subject_person_id: v => v ?? null,
        force_type: v => v ?? null, force_level: v => v ?? null,
        justification: v => v ?? null, subject_injuries: v => v ?? null,
        officer_injuries: v => v ?? null,
        de_escalation_attempted: v => v ? 1 : 0, de_escalation_details: v => v ?? null,
        weapons_used: v => v ?? null, body_camera_active: v => v ? 1 : 0,
        witness_officers: v => JSON.stringify(v || []),
        narrative: v => v ?? null, status: v => v ?? null,
      };

      const setClauses: string[] = [];
      const values: any[] = [];
      const bodyKeys = Object.keys(body);

      for (const [key, transform] of Object.entries(fieldMap)) {
        if (bodyKeys.includes(key)) {
          setClauses.push(`${key} = ?`);
          values.push(transform(body[key]));
        }
      }

      if (setClauses.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS' }, 400);

      setClauses.push('updated_at = ?');
      values.push(localNow());
      values.push(c.req.param('id'));
      await db.prepare(`UPDATE use_of_force SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

      // auditLog skipped

      const updated = await db.prepare(`
        SELECT uof.*, u.full_name as officer_name FROM use_of_force uof LEFT JOIN users u ON uof.officer_id = u.id WHERE uof.id = ?
      `).get(c.req.param('id'));
      return c.json({ data: updated });
    } catch (error: any) {
      console.error('Update UoF error:', error);
      return c.json({ error: 'Failed to update UoF report', code: 'UPDATE_UOF_ERROR' }, 500);
    }
  });

  // PUT /:id/review — Supervisor review
  api.put('/:id/review', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existing = await db.prepare('SELECT * FROM use_of_force WHERE id = ?').get(c.req.param('id')) as any;
      if (!existing) return c.json({ error: 'UoF report not found', code: 'UOF_NOT_FOUND' }, 404);

      const now = localNow();
      const body = await c.req.json();
      const { decision, review_notes } = body;
      const newStatus = decision === 'approved' ? 'reviewed' : decision === 'returned' ? 'draft' : 'reviewed';

      await db.prepare(`
        UPDATE use_of_force SET status = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?
      `).run(newStatus, c.get('user').userId, now, now, c.req.param('id'));

      // auditLog skipped; broadcast skipped

      const updated = await db.prepare(`
        SELECT uof.*, u.full_name as officer_name, r.full_name as reviewer_name
        FROM use_of_force uof
        LEFT JOIN users u ON uof.officer_id = u.id
        LEFT JOIN users r ON uof.reviewed_by = r.id
        WHERE uof.id = ?
      `).get(c.req.param('id'));
      return c.json({ data: updated });
    } catch (error: any) {
      console.error('Review UoF error:', error);
      return c.json({ error: 'Failed to review UoF report', code: 'REVIEW_UOF_ERROR' }, 500);
    }
  });

  // DELETE /:id — Delete (admin only)
  api.delete('/:id', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existing = await db.prepare('SELECT * FROM use_of_force WHERE id = ?').get(c.req.param('id')) as any;
      if (!existing) return c.json({ error: 'UoF report not found', code: 'UOF_NOT_FOUND' }, 404);

      await db.prepare('DELETE FROM use_of_force WHERE id = ?').run(c.req.param('id'));
      // auditLog skipped
      return c.json({ success: true });
    } catch (error: any) {
      console.error('Delete UoF error:', error);
      return c.json({ error: 'Failed to delete UoF report', code: 'DELETE_UOF_ERROR' }, 500);
    }
  });

  // GET /by-officer/:officerId — UoF history for officer
  api.get('/by-officer/:officerId', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT uof.*, i.incident_number, p.first_name as subject_first_name, p.last_name as subject_last_name
        FROM use_of_force uof
        LEFT JOIN incidents i ON uof.incident_id = i.id
        LEFT JOIN persons p ON uof.subject_person_id = p.id
        WHERE uof.officer_id = ?
        ORDER BY uof.created_at DESC
      `).all(c.req.param('officerId'));
      return c.json({ data: rows });
    } catch (error: any) {
      console.error('UoF by officer error:', error);
      return c.json({ error: 'Failed to get officer UoF history', code: 'UOF_BY_OFFICER_ERROR' }, 500);
    }
  });

  app.route('/api/use-of-force', api);
}
