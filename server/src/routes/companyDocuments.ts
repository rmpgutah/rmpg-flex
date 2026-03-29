import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';

const router = Router();
router.use(authenticateToken);

// ── List Documents ────────────────────────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { category, published } = req.query;
    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (category) { where += ' AND d.category = ?'; params.push(category); }
    if (published !== undefined) { where += ' AND d.published = ?'; params.push(published === 'true' ? 1 : 0); }
    const docs = db.prepare(`
      SELECT d.*, u.full_name as created_by_name, ub.full_name as updated_by_name
      FROM company_documents d
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN users ub ON d.updated_by = ub.id
      ${where}
      ORDER BY d.sort_order ASC, d.created_at DESC
    `).all(...params);
    res.json({ data: docs });
  } catch (error: any) {
    console.error('List company documents error:', error);
    res.status(500).json({ error: 'Failed to list documents', code: 'DOCS_LIST_ERROR' });
  }
});

// ── CSV Export (must be before /:id to avoid conflict) ───────────────────────
router.get('/export/csv', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
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
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="training_docs_export_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (error: any) {
    console.error('Company documents CSV export error:', error);
    res.status(500).json({ error: 'Failed to export documents', code: 'DOCS_EXPORT_ERROR' });
  }
});

// ── Get Single Document ───────────────────────────────────────────────────────
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const doc = db.prepare(`
      SELECT d.*, u.full_name as created_by_name
      FROM company_documents d
      LEFT JOIN users u ON d.created_by = u.id
      WHERE d.id = ?
    `).get(req.params.id) as any;
    if (!doc) { res.status(404).json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }); return; }
    res.json({ data: doc });
  } catch (error: any) {
    console.error('Get company document error:', error);
    res.status(500).json({ error: 'Failed to get document', code: 'DOC_GET_ERROR' });
  }
});

// ── Create Document ───────────────────────────────────────────────────────────
router.post('/', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { title, description, category = 'general', file_id, content_type = 'file', external_url, is_required_reading = 0, published = 1, sort_order = 0 } = req.body;
    if (!title) { res.status(400).json({ error: 'Title is required', code: 'DOC_TITLE_REQUIRED' }); return; }
    const userId = (req as any).user?.id;
    const result = db.prepare(`
      INSERT INTO company_documents (title, description, category, file_id, content_type, external_url, is_required_reading, published, sort_order, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, description || null, category, file_id || null, content_type, external_url || null, is_required_reading ? 1 : 0, published ? 1 : 0, sort_order, userId, userId);
    const doc = db.prepare('SELECT * FROM company_documents WHERE id = ?').get(result.lastInsertRowid) as any;
    auditLog(req, 'CREATE', 'company_documents', result.lastInsertRowid as number, null, doc);
    res.json({ success: true, data: doc });
  } catch (error: any) {
    console.error('Create company document error:', error);
    res.status(500).json({ error: 'Failed to create document', code: 'DOC_CREATE_ERROR' });
  }
});

// ── Update Document ───────────────────────────────────────────────────────────
router.put('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM company_documents WHERE id = ?').get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }); return; }
    const allowed = ['title', 'description', 'category', 'file_id', 'content_type', 'external_url', 'is_required_reading', 'published', 'sort_order'];
    const setClauses: string[] = [];
    const values: any[] = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) { setClauses.push(`${key} = ?`); values.push(req.body[key]); }
    }
    if (setClauses.length === 0) { res.status(400).json({ error: 'No fields to update', code: 'DOC_NO_FIELDS' }); return; }
    setClauses.push('updated_by = ?', "updated_at = datetime('now','localtime')");
    values.push((req as any).user?.id, req.params.id);
    db.prepare(`UPDATE company_documents SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    const updated = db.prepare('SELECT * FROM company_documents WHERE id = ?').get(req.params.id) as any;
    auditLog(req, 'UPDATE', 'company_documents', parseInt(req.params.id), existing, updated);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('Update company document error:', error);
    res.status(500).json({ error: 'Failed to update document', code: 'DOC_UPDATE_ERROR' });
  }
});

// ── Delete Document ───────────────────────────────────────────────────────────
router.delete('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM company_documents WHERE id = ?').get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }); return; }
    db.prepare('DELETE FROM company_documents WHERE id = ?').run(req.params.id);
    auditLog(req, 'DELETE', 'company_documents', parseInt(req.params.id), existing, null);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete company document error:', error);
    res.status(500).json({ error: 'Failed to delete document', code: 'DOC_DELETE_ERROR' });
  }
});

export default router;
