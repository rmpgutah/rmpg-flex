import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const companyDocuments = new Hono<Env>();

companyDocuments.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const category = c.req.query('category');
    const published = c.req.query('published');

    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (category) { where += ' AND d.category = ?'; params.push(category); }
    if (published !== undefined) { where += ' AND d.published = ?'; params.push(published === 'true' ? 1 : 0); }

    const docs = await query<any>(
      db,
      `SELECT d.*, u.full_name as created_by_name, ub.full_name as updated_by_name
       FROM company_documents d
       LEFT JOIN users u ON d.created_by = u.id
       LEFT JOIN users ub ON d.updated_by = ub.id
       ${where}
       ORDER BY d.sort_order ASC, d.created_at DESC`,
      ...params,
    );
    return c.json(docs);
  } catch (err) {
    console.error('List company documents error:', err);
    return c.json({ error: 'Failed to list documents', code: 'DOCS_LIST_ERROR' }, 500);
  }
});

companyDocuments.get('/export/csv', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<any>(
      db,
      `SELECT d.title, d.description, d.category, d.content_type,
              d.external_url, d.is_required_reading, d.published,
              u.full_name as created_by_name, d.created_at, d.updated_at
       FROM company_documents d
       LEFT JOIN users u ON d.created_by = u.id
       ORDER BY d.sort_order ASC, d.created_at DESC
       LIMIT 10000`,
    );
    const headers = ['Title', 'Description', 'Category', 'Content Type', 'URL', 'Required Reading', 'Published', 'Created By', 'Created', 'Updated'];
    const csv = [
      headers.join(','),
      ...rows.map((r) => [
        (r.title || '').replace(/"/g, '""'),
        (r.description || '').replace(/"/g, '""'),
        r.category, r.content_type,
        (r.external_url || '').replace(/"/g, '""'),
        r.is_required_reading ? 'Yes' : 'No',
        r.published ? 'Yes' : 'No',
        (r.created_by_name || '').replace(/"/g, '""'),
        r.created_at, r.updated_at,
      ].map((v) => `"${v || ''}"`).join(',')),
    ].join('\n');
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', `attachment; filename="training_docs_export_${new Date().toISOString().slice(0, 10)}.csv"`);
    return c.body(csv);
  } catch (err) {
    console.error('Company documents CSV export error:', err);
    return c.json({ error: 'Failed to export documents', code: 'DOCS_EXPORT_ERROR' }, 500);
  }
});

companyDocuments.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const doc = await queryFirst<any>(
      db,
      `SELECT d.*, u.full_name as created_by_name
       FROM company_documents d
       LEFT JOIN users u ON d.created_by = u.id
       WHERE d.id = ?`,
      id,
    );
    if (!doc) return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404);
    return c.json({ data: doc });
  } catch (err) {
    console.error('Get company document error:', err);
    return c.json({ error: 'Failed to get document', code: 'DOC_GET_ERROR' }, 500);
  }
});

companyDocuments.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    const body = await c.req.json();
    const {
      title, description, category = 'general', file_id, content_type = 'file',
      external_url, is_required_reading = 0, published = 1, sort_order = 0,
    } = body;

    if (!title) return c.json({ error: 'Title is required', code: 'DOC_TITLE_REQUIRED' }, 400);

    const result = await execute(
      db,
      `INSERT INTO company_documents (title, description, category, file_id, content_type, external_url, is_required_reading, published, sort_order, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      title, description || null, category, file_id || null, content_type,
      external_url || null, is_required_reading ? 1 : 0, published ? 1 : 0,
      sort_order, userId ?? null, userId ?? null,
    );

    const doc = await queryFirst<any>(db, 'SELECT * FROM company_documents WHERE id = ?', Number(result.meta.last_row_id));

    await execute(
      db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES (?, 'CREATE', 'company_documents', ?, ?, ?)`,
      userId ?? null, result.meta.last_row_id, JSON.stringify(doc),
      c.req.header('CF-Connecting-IP') || 'unknown',
    );

    return c.json({ success: true, data: doc });
  } catch (err) {
    console.error('Create company document error:', err);
    return c.json({ error: 'Failed to create document', code: 'DOC_CREATE_ERROR' }, 500);
  }
});

companyDocuments.put('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    const id = parseInt(c.req.param('id'), 10);
    const existing = await queryFirst<any>(db, 'SELECT * FROM company_documents WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404);

    const body = await c.req.json();
    const allowed = ['title', 'description', 'category', 'file_id', 'content_type', 'external_url', 'is_required_reading', 'published', 'sort_order'];
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const key of allowed) {
      if (body[key] !== undefined) {
        setClauses.push(`${key} = ?`);
        values.push(key === 'is_required_reading' || key === 'published' ? (body[key] ? 1 : 0) : body[key]);
      }
    }

    if (setClauses.length === 0) {
      return c.json({ error: 'No fields to update', code: 'DOC_NO_FIELDS' }, 400);
    }

    setClauses.push('updated_by = ?', "updated_at = datetime('now','localtime')");
    values.push(userId ?? null, id);

    await execute(db, `UPDATE company_documents SET ${setClauses.join(', ')} WHERE id = ?`, ...values);
    const updated = await queryFirst<any>(db, 'SELECT * FROM company_documents WHERE id = ?', id);

    await execute(
      db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES (?, 'UPDATE', 'company_documents', ?, ?, ?)`,
      userId ?? null, id, JSON.stringify(updated),
      c.req.header('CF-Connecting-IP') || 'unknown',
    );

    return c.json({ success: true, data: updated });
  } catch (err) {
    console.error('Update company document error:', err);
    return c.json({ error: 'Failed to update document', code: 'DOC_UPDATE_ERROR' }, 500);
  }
});

companyDocuments.delete('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const existing = await queryFirst<any>(db, 'SELECT * FROM company_documents WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404);

    await execute(db, 'DELETE FROM company_documents WHERE id = ?', id);

    await execute(
      db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES (?, 'DELETE', 'company_documents', ?, '', ?)`,
      (c.get('userId') as number) ?? null, id,
      c.req.header('CF-Connecting-IP') || 'unknown',
    );

    return c.json({ success: true });
  } catch (err) {
    console.error('Delete company document error:', err);
    return c.json({ error: 'Failed to delete document', code: 'DOC_DELETE_ERROR' }, 500);
  }
});

export default companyDocuments;
