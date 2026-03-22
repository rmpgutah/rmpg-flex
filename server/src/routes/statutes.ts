// ============================================================
// RMPG Flex — Multi-State Statute Routes
// ============================================================
// API endpoints for searching, browsing, and linking statutes
// across all supported states (UT, CO, WY, ID, NV, AZ, NM).
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import { validateParamId, escapeLike } from '../middleware/sanitize';
import { auditLog } from '../utils/auditLogger';
import { broadcast } from '../utils/websocket';
import { sendCsv } from '../utils/csvExport';

const router = Router();

router.use(authenticateToken);

// ─── SEARCH / LIST STATUTES ────────────────────────────────

// GET /api/statutes/states — Get list of states with statute counts
router.get('/states', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const states = db.prepare(`
      SELECT state, state_name, COUNT(*) as count
      FROM utah_statutes
      WHERE is_active = 1
      GROUP BY state, state_name
      ORDER BY state_name
    `).all();

    res.json({ data: states });
  } catch (error: any) {
    console.error('List states error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/statutes — Search or list statutes (with state filter)
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q, category, title, offense_level, subcategory, state, limit = '50', offset = '0' } = req.query;
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 200);
    const offsetNum = Math.max(0, Math.min(parseInt(offset as string, 10) || 0, 10000));

    let where = 'WHERE is_active = 1';
    const params: any[] = [];

    if (state) {
      where += ' AND state = ?';
      params.push((state as string).toUpperCase());
    }

    if (q) {
      const searchStr = String(q).slice(0, 200); // Prevent excessively long search terms
      where += " AND (citation LIKE ? ESCAPE '\\' OR short_title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR definition LIKE ? ESCAPE '\\')";
      const searchTerm = `%${escapeLike(searchStr)}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (category) {
      where += ' AND category = ?';
      params.push(category);
    }

    if (title) {
      where += ' AND title = ?';
      params.push(parseInt(title as string, 10));
    }

    if (offense_level) {
      where += ' AND offense_level = ?';
      params.push(offense_level);
    }

    if (subcategory) {
      where += ' AND subcategory = ?';
      params.push(subcategory);
    }

    const total = db.prepare(`SELECT COUNT(*) as count FROM utah_statutes ${where}`).get(...params) as { count: number };

    const statutes = db.prepare(`
      SELECT * FROM utah_statutes
      ${where}
      ORDER BY state, title, chapter, section
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offsetNum);

    // Get distinct subcategories for filtering (within selected state or all)
    let subWhere = 'WHERE is_active = 1';
    const subParams: any[] = [];
    if (state) {
      subWhere += ' AND state = ?';
      subParams.push((state as string).toUpperCase());
    }
    const subcategories = db.prepare(`
      SELECT DISTINCT subcategory FROM utah_statutes ${subWhere} ORDER BY subcategory
    `).all(...subParams) as { subcategory: string }[];

    res.json({
      data: statutes,
      total: total.count,
      subcategories: subcategories.map(s => s.subcategory),
    });
  } catch (error: any) {
    console.error('List statutes error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/statutes/search — Quick search (for autocomplete / lookup)
router.get('/search', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q, category, state, limit = '20' } = req.query;
    const limitNum = Math.min(parseInt(limit as string, 10) || 20, 50);

    if (!q || (q as string).length < 2) {
      res.json({ data: [] });
      return;
    }

    let where = "WHERE is_active = 1 AND (citation LIKE ? ESCAPE '\\' OR short_title LIKE ? ESCAPE '\\')";
    const searchTerm = `%${escapeLike(String(q))}%`;
    const params: any[] = [searchTerm, searchTerm];

    if (state) {
      where += ' AND state = ?';
      params.push((state as string).toUpperCase());
    }

    if (category) {
      where += ' AND category = ?';
      params.push(category);
    }

    const statutes = db.prepare(`
      SELECT id, state, state_name, citation, short_title, description, definition, offense_level, category, subcategory, citation_fine
      FROM utah_statutes
      ${where}
      ORDER BY
        CASE WHEN citation LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,
        state, title, chapter, section
      LIMIT ?
    `).all(...params, `${escapeLike(String(q))}%`, limitNum);

    res.json({ data: statutes });
  } catch (error: any) {
    console.error('Search statutes error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/statutes/:id — Get single statute
router.get('/:id', validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const statute = db.prepare('SELECT * FROM utah_statutes WHERE id = ?').get(req.params.id);
    if (!statute) {
      res.status(404).json({ error: 'Statute not found' });
      return;
    }
    res.json(statute);
  } catch (error: any) {
    console.error('Get statute error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/statutes — Add custom statute (admin only)
router.post('/', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { state: stateCode, state_name: stateName, title, chapter, section, subsection, citation, short_title, description, definition, offense_level, category, subcategory } = req.body;

    if (!citation || !short_title || !category) {
      res.status(400).json({ error: 'citation, short_title, and category are required' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO utah_statutes (state, state_name, title, chapter, section, subsection, citation, short_title, description, definition, offense_level, category, subcategory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(stateCode || 'UT', stateName || 'Utah', title || 0, chapter || null, section || '', subsection || null, citation, short_title, description || null, definition || null, offense_level || null, category, subcategory || null);

    const statute = db.prepare('SELECT * FROM utah_statutes WHERE id = ?').get(Number(result.lastInsertRowid));
    if (!statute) { res.status(500).json({ error: 'Failed to retrieve created statute' }); return; }
    auditLog(req, 'CREATE' as any, 'statute' as any, Number(result.lastInsertRowid), `Created statute ${citation}: ${short_title}`);
    broadcast('records', 'statute:created', statute);
    res.status(201).json(statute);
  } catch (error: any) {
    console.error('Create statute error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/statutes/:id — Update statute (admin only)
router.put('/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { citation, short_title, description, definition, offense_level, category, subcategory, is_active } = req.body;

    const fields: string[] = [];
    const params: any[] = [];

    if (citation !== undefined) { fields.push('citation = ?'); params.push(citation); }
    if (short_title !== undefined) { fields.push('short_title = ?'); params.push(short_title); }
    if (description !== undefined) { fields.push('description = ?'); params.push(description); }
    if (definition !== undefined) { fields.push('definition = ?'); params.push(definition); }
    if (offense_level !== undefined) { fields.push('offense_level = ?'); params.push(offense_level); }
    if (category !== undefined) { fields.push('category = ?'); params.push(category); }
    if (subcategory !== undefined) { fields.push('subcategory = ?'); params.push(subcategory); }
    if (is_active !== undefined) { fields.push('is_active = ?'); params.push(is_active); }

    if (fields.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    // Check existence first
    const existing = db.prepare('SELECT id FROM utah_statutes WHERE id = ?').get(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Statute not found' }); return; }

    params.push(req.params.id);
    db.prepare(`UPDATE utah_statutes SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    const statute = db.prepare('SELECT * FROM utah_statutes WHERE id = ?').get(req.params.id);
    auditLog(req, 'UPDATE' as any, 'statute' as any, req.params.id, `Updated statute ${req.params.id}`);
    broadcast('records', 'statute:updated', statute);
    res.json(statute);
  } catch (error: any) {
    console.error('Update statute error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/statutes/:id — Deactivate statute (admin only)
router.delete('/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('UPDATE utah_statutes SET is_active = 0 WHERE id = ?').run(req.params.id);
    auditLog(req, 'DELETE' as any, 'statute' as any, req.params.id, `Deactivated statute ${req.params.id}`);
    broadcast('records', 'statute:deleted', { id: Number(req.params.id) });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete statute error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── ENTITY-STATUTE LINKS ──────────────────────────────────

// GET /api/statutes/entity/:type/:id — Get statutes linked to an entity
router.get('/entity/:type/:id', validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { type, id } = req.params;

    const links = db.prepare(`
      SELECT es.*, s.state, s.state_name, s.citation, s.short_title, s.offense_level, s.category, s.subcategory, s.description, s.definition
      FROM entity_statutes es
      JOIN utah_statutes s ON es.statute_id = s.id
      WHERE es.entity_type = ? AND es.entity_id = ?
      ORDER BY s.state, s.citation
    `).all(type, id);

    res.json({ data: links });
  } catch (error: any) {
    console.error('Get entity statutes error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/statutes/entity — Link a statute to an entity
router.post('/entity', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { entity_type, entity_id, statute_id, notes } = req.body;

    if (!entity_type || !entity_id || !statute_id) {
      res.status(400).json({ error: 'entity_type, entity_id, and statute_id are required' });
      return;
    }

    const result = db.prepare(`
      INSERT OR IGNORE INTO entity_statutes (entity_type, entity_id, statute_id, notes)
      VALUES (?, ?, ?, ?)
    `).run(entity_type, entity_id, statute_id, notes || null);

    if (result.changes === 0) {
      res.status(409).json({ error: 'Statute already linked to this entity' });
      return;
    }

    const link = db.prepare(`
      SELECT es.*, s.state, s.state_name, s.citation, s.short_title, s.offense_level, s.category, s.subcategory
      FROM entity_statutes es
      JOIN utah_statutes s ON es.statute_id = s.id
      WHERE es.id = ?
    `).get(Number(result.lastInsertRowid));
    if (!link) { res.status(500).json({ error: 'Failed to retrieve linked statute' }); return; }

    auditLog(req, 'CREATE' as any, 'entity_statute' as any, Number(result.lastInsertRowid), `Linked statute ${statute_id} to ${entity_type} ${entity_id}`);
    res.status(201).json(link);
  } catch (error: any) {
    console.error('Link statute error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/statutes/entity/:id — Remove a statute link
router.delete('/entity/:id', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM entity_statutes WHERE id = ?').run(req.params.id);
    auditLog(req, 'DELETE' as any, 'entity_statute' as any, req.params.id, `Removed statute link ${req.params.id}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Unlink statute error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/statutes/export/csv — Export statute database as CSV ───
router.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const state = req.query.state as string | undefined;

    let where = 'WHERE is_active = 1';
    const params: any[] = [];
    if (state) {
      where += ' AND state = ?';
      params.push(state.toUpperCase());
    }

    const rows = db.prepare(`
      SELECT * FROM utah_statutes ${where}
      ORDER BY state, title, chapter, section
    `).all(...params);

    sendCsv(res, `statutes_export_${localNow().slice(0, 10)}.csv`, [
      { key: 'id', header: 'ID' },
      { key: 'state', header: 'State' },
      { key: 'state_name', header: 'State Name' },
      { key: 'citation', header: 'Citation' },
      { key: 'short_title', header: 'Short Title' },
      { key: 'description', header: 'Description' },
      { key: 'definition', header: 'Definition' },
      { key: 'offense_level', header: 'Offense Level' },
      { key: 'category', header: 'Category' },
      { key: 'subcategory', header: 'Subcategory' },
      { key: 'title', header: 'Title Number' },
      { key: 'chapter', header: 'Chapter' },
      { key: 'section', header: 'Section' },
      { key: 'subsection', header: 'Subsection' },
    ], rows);
  } catch (error: any) {
    console.error('Export statutes error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
