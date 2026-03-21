import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateParamId } from '../middleware/sanitize';
import { localNow } from '../utils/timeUtils';
import { auditLog } from '../utils/auditLogger';

const router = Router();
router.use(authenticateToken);

// ─── GET /api/company-documents ─── List documents ───
// All users see published docs; admins/managers also see unpublished
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const category = req.query.category as string | undefined;
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'manager';

    let sql = `
      SELECT d.*, u.full_name as creator_name,
             a.original_name as file_name, a.file_size, a.mime_type
      FROM company_documents d
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN attachments a ON d.file_id = a.file_id
    `;
    const conditions: string[] = [];
    const params: any[] = [];

    if (!isAdmin) {
      conditions.push('d.published = 1');
    }
    if (category && category !== 'all') {
      conditions.push('d.category = ?');
      params.push(category);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY d.sort_order ASC, d.created_at DESC';

    const docs = db.prepare(sql).all(...params);
    res.json(docs);
  } catch (error: any) {
    console.error('List company documents error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/company-documents/:id ─── Get single document ───
router.get('/:id', validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const docId = parseInt(String(req.params.id), 10);
    if (isNaN(docId)) { res.status(400).json({ error: 'Invalid document ID' }); return; }
    const doc = db.prepare(`
      SELECT d.*, u.full_name as creator_name,
             a.original_name as file_name, a.file_size, a.mime_type
      FROM company_documents d
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN attachments a ON d.file_id = a.file_id
      WHERE d.id = ?
    `).get(docId);

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json(doc);
  } catch (error: any) {
    console.error('Get company document error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/company-documents ─── Create document (admin/manager) ───
router.post('/', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      title, description, category, file_id, content_type,
      external_url, is_required_reading, published, sort_order,
    } = req.body;

    if (!title) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO company_documents (
        title, description, category, file_id, content_type,
        external_url, is_required_reading, published, sort_order,
        created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title,
      description || null,
      category || 'general',
      file_id || null,
      content_type || 'file',
      external_url || null,
      is_required_reading ? 1 : 0,
      published != null ? (published ? 1 : 0) : 1,
      sort_order ?? 0,
      req.user!.userId,
      req.user!.userId,
    );

    const doc = db.prepare(`
      SELECT d.*, u.full_name as creator_name,
             a.original_name as file_name, a.file_size, a.mime_type
      FROM company_documents d
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN attachments a ON d.file_id = a.file_id
      WHERE d.id = ?
    `).get(result.lastInsertRowid);
    if (!doc) { res.status(500).json({ error: 'Failed to retrieve created document' }); return; }

    auditLog(req, 'CREATE', 'company_documents', Number(result.lastInsertRowid), `Created company document: ${title}`);
    res.status(201).json(doc || { id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('Create company document error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/company-documents/:id ─── Update document (admin/manager) ───
router.put('/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid document ID' }); return; }
    const existing = db.prepare('SELECT id FROM company_documents WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const {
      title, description, category, file_id, content_type,
      external_url, is_required_reading, published, sort_order,
    } = req.body;

    const fields: string[] = [];
    const values: any[] = [];

    const addField = (col: string, val: any) => {
      if (val !== undefined) {
        fields.push(`${col} = ?`);
        values.push(val);
      }
    };

    addField('title', title);
    addField('description', description);
    addField('category', category);
    addField('file_id', file_id);
    addField('content_type', content_type);
    addField('external_url', external_url);
    if (is_required_reading !== undefined) addField('is_required_reading', is_required_reading ? 1 : 0);
    if (published !== undefined) addField('published', published ? 1 : 0);
    addField('sort_order', sort_order);

    fields.push("updated_by = ?");
    values.push(req.user!.userId);
    fields.push("updated_at = ?");
    values.push(localNow());

    values.push(id);
    db.prepare(`UPDATE company_documents SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    const doc = db.prepare(`
      SELECT d.*, u.full_name as creator_name,
             a.original_name as file_name, a.file_size, a.mime_type
      FROM company_documents d
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN attachments a ON d.file_id = a.file_id
      WHERE d.id = ?
    `).get(id);

    auditLog(req, 'UPDATE' as any, 'company_documents', id, `Updated company document ${id}`);
    res.json(doc);
  } catch (error: any) {
    console.error('Update company document error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/company-documents/:id ─── Delete document (admin/manager) ───
router.delete('/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid document ID' }); return; }
    const doc = db.prepare('SELECT * FROM company_documents WHERE id = ?').get(id) as any;

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Delete the linked attachment file if present
    if (doc.file_id) {
      const att = db.prepare('SELECT file_path FROM attachments WHERE file_id = ?').get(doc.file_id) as any;
      if (att) {
        // Remove the actual file from disk to prevent orphaned files
        if (att.file_path) {
          const uploadsDir = path.resolve(process.cwd(), 'uploads');
          const filePath = path.resolve(uploadsDir, att.file_path);
          if (!filePath.startsWith(uploadsDir)) {
            // Path traversal guard
          } else {
            try { fs.unlinkSync(filePath); } catch { /* file may already be deleted */ }
          }
        }
        db.prepare('DELETE FROM attachments WHERE file_id = ?').run(doc.file_id);
      }
    }

    db.prepare('DELETE FROM company_documents WHERE id = ?').run(id);
    auditLog(req, 'DELETE' as any, 'company_documents', id, `Deleted company document: ${doc.title}`);
    res.json({ message: 'Document deleted' });
  } catch (error: any) {
    console.error('Delete company document error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
