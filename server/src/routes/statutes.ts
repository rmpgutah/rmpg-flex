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
    console.error('List states error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/statutes — Search or list statutes (with state filter)
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q, category, title, offense_level, subcategory, state, limit = '50', offset = '0' } = req.query;
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 200);
    const offsetNum = parseInt(offset as string, 10) || 0;

    let where = 'WHERE is_active = 1';
    const params: any[] = [];

    if (state) {
      where += ' AND state = ?';
      params.push((state as string).toUpperCase());
    }

    if (q) {
      where += ' AND (citation LIKE ? OR short_title LIKE ? OR description LIKE ? OR definition LIKE ?)';
      const searchTerm = `%${q}%`;
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
    console.error('List statutes error:', error);
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

    let where = 'WHERE is_active = 1 AND (citation LIKE ? OR short_title LIKE ?)';
    const searchTerm = `%${q}%`;
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
        CASE WHEN citation LIKE ? THEN 0 ELSE 1 END,
        state, title, chapter, section
      LIMIT ?
    `).all(...params, `${q}%`, limitNum);

    res.json({ data: statutes });
  } catch (error: any) {
    console.error('Search statutes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/statutes/:id — Get single statute
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const statute = db.prepare('SELECT * FROM utah_statutes WHERE id = ?').get(req.params.id);
    if (!statute) {
      res.status(404).json({ error: 'Statute not found' });
      return;
    }
    res.json(statute);
  } catch (error: any) {
    console.error('Get statute error:', error);
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

    const statute = db.prepare('SELECT * FROM utah_statutes WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(statute);
  } catch (error: any) {
    console.error('Create statute error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/statutes/:id — Update statute (admin only)
router.put('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
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

    params.push(req.params.id);
    db.prepare(`UPDATE utah_statutes SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    const statute = db.prepare('SELECT * FROM utah_statutes WHERE id = ?').get(req.params.id);
    res.json(statute);
  } catch (error: any) {
    console.error('Update statute error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/statutes/:id — Deactivate statute (admin only)
router.delete('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('UPDATE utah_statutes SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete statute error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── ENTITY-STATUTE LINKS ──────────────────────────────────

// GET /api/statutes/entity/:type/:id — Get statutes linked to an entity
router.get('/entity/:type/:id', (req: Request, res: Response) => {
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
    console.error('Get entity statutes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/statutes/entity — Link a statute to an entity
router.post('/entity', (req: Request, res: Response) => {
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
    `).get(result.lastInsertRowid);

    res.status(201).json(link);
  } catch (error: any) {
    console.error('Link statute error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/statutes/entity/:id — Remove a statute link
router.delete('/entity/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM entity_statutes WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Unlink statute error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
