// Warrant routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';

export function mountWarrantRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/warrants - List warrants
  api.get('/', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const { status, type, archived, page = '1', per_page = '100000' } = q;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { whereClause += ' AND w.status = ?'; params.push(status); }
    if (type) { whereClause += ' AND w.type = ?'; params.push(type); }
    if (archived === 'true') {
      whereClause += ' AND w.archived_at IS NOT NULL';
    } else if (archived !== 'all') {
      whereClause += ' AND w.archived_at IS NULL';
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const perPageNum = Math.min(100000, Math.max(1, parseInt(per_page, 10) || 100000));
    const offset = (pageNum - 1) * perPageNum;

    const countRow = await db.prepare(`SELECT COUNT(*) as total FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id ${whereClause}`).get(...params) as any;

    const warrants = await db.prepare(`
      SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name,
        u.full_name as entered_by_name
      FROM warrants w
      LEFT JOIN persons p ON w.subject_person_id = p.id
      LEFT JOIN users u ON w.entered_by = u.id
      ${whereClause}
      ORDER BY w.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, perPageNum, offset);

    return c.json({
      data: warrants,
      pagination: { page: pageNum, per_page: perPageNum, total: (countRow as any)?.total ?? 0, totalPages: Math.ceil(((countRow as any)?.total ?? 0) / perPageNum) },
    });
  });

  // GET /api/warrants/:id
  api.get('/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const warrant = await db.prepare('SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name, u.full_name as entered_by_name FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id LEFT JOIN users u ON w.entered_by = u.id WHERE w.id = ?').get(id);
    if (!warrant) return c.json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }, 404);
    return c.json(warrant);
  });

  app.route('/api/warrants', api);
}
