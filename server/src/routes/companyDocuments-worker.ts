import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow } from '../worker-middleware/d1Helpers';

export function mountCompanyDocumentsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // ── List Documents ────────────────────────────────────────────────────────────
  api.get('/', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { category, published } = q;
      let where = 'WHERE 1=1';
      const params: any[] = [];
      if (category) { where += ' AND d.category = ?'; params.push(category); }
      if (published !== undefined) { where += ' AND d.published = ?'; params.push(published === 'true' ? 1 : 0); }
      const docs = await db.prepare(`
        SELECT d.*, u.full_name as created_by_name, ub.full_name as updated_by_name
        FROM company_documents d
        LEFT JOIN users u ON d.created_by = u.id
        LEFT JOIN users ub ON d.updated_by = ub.id
        ${where}
        ORDER BY d.sort_order ASC, d.created_at DESC
      `).all(...params);
      return c.json({ data: docs });
    } catch {
      return c.json({ error: 'Failed to list documents', code: 'DOCS_LIST_ERROR' }, 500);
    }
  });

  // ── CSV Export (must be before /:id to avoid conflict) ───────────────────────
  api.get('/export/csv', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT d.title, d.description, d.category, d.content_type,
               d.external_url, d.is_required_reading, d.published,
               u.full_name as created_by_name, d.created_at, d.updated_at
        FROM company_documents d
        LEFT JOIN users u ON d.created_by = u.id
        ORDER BY d.sort_order ASC, d.created_at DESC
        LIMIT 10000
      `).all() as any[];
      const headers = ['Title', 'Description', 'Category', 'Content Type', 'URL', 'Required Reading', 'Published', 'Created By', 'Created', 'Updated'];
      const csv = [
        headers.join(','),
        ...rows.map((r: any) => [
          (r.title || '').replace(/"/g, '""'),
          (r.description || '').replace(/"/g, '""'),
          r.category, r.content_type,
          (r.external_url || '').replace(/"/g, '""'),
          r.is_required_reading ? 'Yes' : 'No',
          r.published ? 'Yes' : 'No',
          (r.created_by_name || '').replace(/"/g, '""'),
          r.created_at, r.updated_at
        ].map(v => `"${v || ''}"`).join(','))
      ].join('\n');
      return c.text(csv, 200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="training_docs_export_${new Date().toISOString().slice(0, 10)}.csv"`,
      });
    } catch {
      return c.json({ error: 'Failed to export documents', code: 'DOCS_EXPORT_ERROR' }, 500);
    }
  });

  // ── Get Single Document ───────────────────────────────────────────────────────
  api.get('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const doc = await db.prepare(`
        SELECT d.*, u.full_name as created_by_name
        FROM company_documents d
        LEFT JOIN users u ON d.created_by = u.id
        WHERE d.id = ?
      `).get(id) as any;
      if (!doc) { return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404); }
      return c.json({ data: doc });
    } catch {
      return c.json({ error: 'Failed to get document', code: 'DOC_GET_ERROR' }, 500);
    }
  });

  // ── Create Document ───────────────────────────────────────────────────────────
  api.post('/', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { title, description, category = 'general', file_id, content_type = 'file', external_url, is_required_reading = 0, published = 1, sort_order = 0 } = body;
      if (!title) { return c.json({ error: 'Title is required', code: 'DOC_TITLE_REQUIRED' }, 400); }
      const user = c.get('user');
      const userId = user?.userId;
      const result = await db.prepare(`
        INSERT INTO company_documents (title, description, category, file_id, content_type, external_url, is_required_reading, published, sort_order, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(title, description || null, category, file_id || null, content_type, external_url || null, is_required_reading ? 1 : 0, published ? 1 : 0, sort_order, userId, userId);
      const doc = await db.prepare('SELECT * FROM company_documents WHERE id = ?').get(Number(result.meta.last_row_id)) as any;
      return c.json({ success: true, data: doc });
    } catch {
      return c.json({ error: 'Failed to create document', code: 'DOC_CREATE_ERROR' }, 500);
    }
  });

  // ── Update Document ───────────────────────────────────────────────────────────
  api.put('/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const existing = await db.prepare('SELECT * FROM company_documents WHERE id = ?').get(id) as any;
      if (!existing) { return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404); }
      const body = await c.req.json();
      const allowed = ['title', 'description', 'category', 'file_id', 'content_type', 'external_url', 'is_required_reading', 'published', 'sort_order'];
      const setClauses: string[] = [];
      const values: any[] = [];
      for (const key of allowed) {
        if (body[key] !== undefined) { setClauses.push(`${key} = ?`); values.push(body[key]); }
      }
      if (setClauses.length === 0) { return c.json({ error: 'No fields to update', code: 'DOC_NO_FIELDS' }, 400); }
      const user = c.get('user');
      setClauses.push('updated_by = ?', "updated_at = datetime('now','localtime')");
      values.push(user?.userId, id);
      await db.prepare(`UPDATE company_documents SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
      const updated = await db.prepare('SELECT * FROM company_documents WHERE id = ?').get(id) as any;
      return c.json({ success: true, data: updated });
    } catch {
      return c.json({ error: 'Failed to update document', code: 'DOC_UPDATE_ERROR' }, 500);
    }
  });

  // ── Delete Document ───────────────────────────────────────────────────────────
  api.delete('/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const existing = await db.prepare('SELECT * FROM company_documents WHERE id = ?').get(id) as any;
      if (!existing) { return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404); }
      await db.prepare('DELETE FROM company_documents WHERE id = ?').run(id);
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Failed to delete document', code: 'DOC_DELETE_ERROR' }, 500);
    }
  });

  app.route('/api/company-documents', api);
}
