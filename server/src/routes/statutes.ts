// ============================================================
// RMPG Flex — Utah Statute Routes
// ============================================================
// API endpoints for searching, browsing, and linking Utah
// Criminal Code (Title 76) and Vehicle Code (Title 41) statutes.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';

const router = Router();

router.use(authenticateToken);

// ─── SEARCH / LIST STATUTES ────────────────────────────────

// GET /api/statutes — Search or list statutes
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q, category, title, offense_level, subcategory, limit = '50', offset = '0' } = req.query;
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 200);
    const offsetNum = parseInt(offset as string, 10) || 0;

    let where = 'WHERE is_active = 1';
    const params: any[] = [];

    if (q) {
      where += ' AND (citation LIKE ? OR short_title LIKE ? OR description LIKE ?)';
      const searchTerm = `%${q}%`;
      params.push(searchTerm, searchTerm, searchTerm);
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
      ORDER BY title, chapter, section
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offsetNum);

    // Get distinct subcategories for filtering
    const subcategories = db.prepare(`
      SELECT DISTINCT subcategory FROM utah_statutes WHERE is_active = 1 ORDER BY subcategory
    
      LIMIT 1000
    `).all() as { subcategory: string }[];

    res.json({
      data: statutes,
      total: total.count,
      subcategories: subcategories.map(s => s.subcategory),
    });
  } catch (error: any) {
    console.error('List statutes error:', error);
    res.status(500).json({ error: 'Failed to list statutes', code: 'LIST_STATUTES_ERROR' });
  }
});

// GET /api/statutes/search — Quick search (for autocomplete / lookup)
router.get('/search', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q, category, limit = '20' } = req.query;
    const limitNum = Math.min(parseInt(limit as string, 10) || 20, 50);

    if (!q || (q as string).length < 2) {
      res.json({ data: [] });
      return;
    }

    let where = 'WHERE is_active = 1 AND (citation LIKE ? OR short_title LIKE ?)';
    const searchTerm = `%${q}%`;
    const params: any[] = [searchTerm, searchTerm];

    if (category) {
      where += ' AND category = ?';
      params.push(category);
    }

    const statutes = db.prepare(`
      SELECT id, citation, short_title, description, offense_level, category, subcategory, citation_fine
      FROM utah_statutes
      ${where}
      ORDER BY
        CASE WHEN citation LIKE ? THEN 0 ELSE 1 END,
        title, chapter, section
      LIMIT ?
    `).all(...params, `${q}%`, limitNum);

    res.set('Cache-Control', 'private, max-age=300');
    res.json({ data: statutes });
  } catch (error: any) {
    console.error('Search statutes error:', error);
    res.status(500).json({ error: 'Failed to search statutes', code: 'SEARCH_STATUTES_ERROR' });
  }
});

// GET /api/statutes/:id — Get single statute
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const statute = db.prepare('SELECT * FROM utah_statutes WHERE id = ?').get(req.params.id);
    if (!statute) {
      res.status(404).json({ error: 'Statute not found', code: 'STATUTE_NOT_FOUND' });
      return;
    }
    res.json(statute);
  } catch (error: any) {
    console.error('Get statute error:', error);
    res.status(500).json({ error: 'Failed to get statute', code: 'GET_STATUTE_ERROR' });
  }
});

// POST /api/statutes — Add custom statute (admin only)
router.post('/', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { title, chapter, section, subsection, citation, short_title, description, offense_level, category, subcategory } = req.body;

    if (!citation || !short_title || !category) {
      res.status(400).json({ error: 'citation, short_title, and category are required', code: 'CITATION_SHORTTITLE_AND_CATEGORY' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO utah_statutes (title, chapter, section, subsection, citation, short_title, description, offense_level, category, subcategory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title || 0, chapter || null, section || '', subsection || null, citation, short_title, description || null, offense_level || null, category, subcategory || null);

    const statute = db.prepare('SELECT * FROM utah_statutes WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(statute);
  } catch (error: any) {
    console.error('Create statute error:', error);
    res.status(500).json({ error: 'Failed to create statute', code: 'CREATE_STATUTE_ERROR' });
  }
});

// PUT /api/statutes/:id — Update statute (admin only)
router.put('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { citation, short_title, description, offense_level, category, subcategory, is_active } = req.body;

    const fields: string[] = [];
    const params: any[] = [];

    if (citation !== undefined) { fields.push('citation = ?'); params.push(citation); }
    if (short_title !== undefined) { fields.push('short_title = ?'); params.push(short_title); }
    if (description !== undefined) { fields.push('description = ?'); params.push(description); }
    if (offense_level !== undefined) { fields.push('offense_level = ?'); params.push(offense_level); }
    if (category !== undefined) { fields.push('category = ?'); params.push(category); }
    if (subcategory !== undefined) { fields.push('subcategory = ?'); params.push(subcategory); }
    if (is_active !== undefined) { fields.push('is_active = ?'); params.push(is_active); }

    if (fields.length === 0) {
      res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' });
      return;
    }

    params.push(req.params.id);
    db.prepare(`UPDATE utah_statutes SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    const statute = db.prepare('SELECT * FROM utah_statutes WHERE id = ?').get(req.params.id);
    res.json(statute);
  } catch (error: any) {
    console.error('Update statute error:', error);
    res.status(500).json({ error: 'Failed to update statute', code: 'UPDATE_STATUTE_ERROR' });
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
    res.status(500).json({ error: 'Failed to delete statute', code: 'DELETE_STATUTE_ERROR' });
  }
});

// ─── ENTITY-STATUTE LINKS ──────────────────────────────────

// GET /api/statutes/entity/:type/:id — Get statutes linked to an entity
router.get('/entity/:type/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { type, id } = req.params;

    const links = db.prepare(`
      SELECT es.*, s.citation, s.short_title, s.offense_level, s.category, s.subcategory, s.description
      FROM entity_statutes es
      JOIN utah_statutes s ON es.statute_id = s.id
      WHERE es.entity_type = ? AND es.entity_id = ?
      ORDER BY s.citation
    
      LIMIT 1000
    `).all(type, id);

    res.json({ data: links });
  } catch (error: any) {
    console.error('Get entity statutes error:', error);
    res.status(500).json({ error: 'Failed to get entity statutes', code: 'GET_ENTITY_STATUTES_ERROR' });
  }
});

// POST /api/statutes/entity — Link a statute to an entity
router.post('/entity', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { entity_type, entity_id, statute_id, notes } = req.body;

    if (!entity_type || !entity_id || !statute_id) {
      res.status(400).json({ error: 'entity_type, entity_id, and statute_id are required', code: 'ENTITYTYPE_ENTITYID_AND_STATUTEID' });
      return;
    }

    const result = db.prepare(`
      INSERT OR IGNORE INTO entity_statutes (entity_type, entity_id, statute_id, notes)
      VALUES (?, ?, ?, ?)
    `).run(entity_type, entity_id, statute_id, notes || null);

    if (result.changes === 0) {
      res.status(409).json({ error: 'Statute already linked to this entity', code: 'STATUTE_ALREADY_LINKED_TO' });
      return;
    }

    const link = db.prepare(`
      SELECT es.*, s.citation, s.short_title, s.offense_level, s.category, s.subcategory
      FROM entity_statutes es
      JOIN utah_statutes s ON es.statute_id = s.id
      WHERE es.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(link);
  } catch (error: any) {
    console.error('Link statute error:', error);
    res.status(500).json({ error: 'Failed to link statute', code: 'LINK_STATUTE_ERROR' });
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
    res.status(500).json({ error: 'Failed to unlink statute', code: 'UNLINK_STATUTE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 36: Statute Penalty Lookup
// ════════════════════════════════════════════════════════════

router.get('/penalty/:citation', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const citation = decodeURIComponent(req.params.citation);

    const statute = db.prepare(`
      SELECT id, citation, short_title, description, offense_level, category,
             citation_fine, min_penalty, max_penalty, penalty_notes
      FROM utah_statutes
      WHERE citation = ? AND is_active = 1
    `).get(citation) as any;

    if (!statute) return res.status(404).json({ error: 'Statute not found', code: 'STATUTE_NOT_FOUND' });

    // Penalty info based on offense level
    const penaltyRanges: Record<string, { jail_max: string; fine_max: string }> = {
      'first_degree_felony': { jail_max: '5 years to life', fine_max: '$10,000' },
      'second_degree_felony': { jail_max: '1-15 years', fine_max: '$10,000' },
      'third_degree_felony': { jail_max: '0-5 years', fine_max: '$5,000' },
      'class_a_misdemeanor': { jail_max: 'Up to 364 days', fine_max: '$2,500' },
      'class_b_misdemeanor': { jail_max: 'Up to 6 months', fine_max: '$1,000' },
      'class_c_misdemeanor': { jail_max: 'Up to 90 days', fine_max: '$750' },
      'infraction': { jail_max: 'None', fine_max: '$750' },
      'felony': { jail_max: 'Varies', fine_max: '$10,000' },
      'misdemeanor_a': { jail_max: 'Up to 364 days', fine_max: '$2,500' },
      'misdemeanor_b': { jail_max: 'Up to 6 months', fine_max: '$1,000' },
      'misdemeanor_c': { jail_max: 'Up to 90 days', fine_max: '$750' },
    };

    const penalty = penaltyRanges[statute.offense_level] || { jail_max: 'Unknown', fine_max: 'Unknown' };

    res.json({
      data: {
        ...statute,
        penalty_range: penalty,
        citation_fine: statute.citation_fine || null,
        min_penalty: statute.min_penalty || null,
        max_penalty: statute.max_penalty || null,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 37: Commonly Charged Statutes
// ════════════════════════════════════════════════════════════

router.get('/analytics/top-charged', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '365', limit = '20' } = req.query;
    const cutoff = new Date(Date.now() - parseInt(days as string, 10) * 24 * 60 * 60 * 1000).toISOString();
    const limitNum = Math.min(50, parseInt(limit as string, 10) || 20);

    // From citations
    const topFromCitations = db.prepare(`
      SELECT us.citation, us.short_title, us.offense_level, us.category,
             COUNT(*) as citation_count
      FROM entity_statutes es
      JOIN utah_statutes us ON es.statute_id = us.id
      WHERE es.entity_type = 'citation' AND es.created_at >= ?
      GROUP BY us.id
      ORDER BY citation_count DESC
      LIMIT ?
    `).all(cutoff, limitNum) as any[];

    // From incidents
    const topFromIncidents = db.prepare(`
      SELECT us.citation, us.short_title, us.offense_level, us.category,
             COUNT(*) as incident_count
      FROM entity_statutes es
      JOIN utah_statutes us ON es.statute_id = us.id
      WHERE es.entity_type = 'incident' AND es.created_at >= ?
      GROUP BY us.id
      ORDER BY incident_count DESC
      LIMIT ?
    `).all(cutoff, limitNum) as any[];

    // Combined top
    const combined = new Map<string, any>();
    for (const s of topFromCitations) {
      combined.set(s.citation, { ...s, total_count: s.citation_count, incident_count: 0 });
    }
    for (const s of topFromIncidents) {
      if (combined.has(s.citation)) {
        const existing = combined.get(s.citation);
        existing.incident_count = s.incident_count;
        existing.total_count = (existing.citation_count || 0) + s.incident_count;
      } else {
        combined.set(s.citation, { ...s, citation_count: 0, total_count: s.incident_count });
      }
    }

    const sorted = Array.from(combined.values()).sort((a, b) => b.total_count - a.total_count).slice(0, limitNum);

    res.json({ data: sorted, period_days: parseInt(days as string, 10) });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 38: Statute Amendment Tracking
// ════════════════════════════════════════════════════════════

router.post('/:id/amendment', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const statute = db.prepare('SELECT * FROM utah_statutes WHERE id = ?').get(req.params.id) as any;
    if (!statute) return res.status(404).json({ error: 'Statute not found', code: 'STATUTE_NOT_FOUND' });

    const { amendment_date, amendment_type, description, effective_date, previous_text, new_text } = req.body;
    if (!amendment_type || !description) return res.status(400).json({ error: 'amendment_type and description required', code: 'AMENDMENTTYPE_AND_DESCRIPTION_REQUIRED' });

    const now = localNow();

    // Store amendment in activity_log with structured data
    const amendmentData = {
      statute_id: parseInt(req.params.id),
      citation: statute.citation,
      amendment_type: amendment_type, // 'amended', 'repealed', 'enacted', 'renumbered'
      description,
      amendment_date: amendment_date || now.split('T')[0],
      effective_date: effective_date || null,
      previous_text: previous_text || null,
      new_text: new_text || null,
      recorded_by: req.user!.userId,
    };

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'statute_amendment', 'utah_statute', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, JSON.stringify(amendmentData), now);

    // If repealed, deactivate
    if (amendment_type === 'repealed') {
      db.prepare('UPDATE utah_statutes SET is_active = 0 WHERE id = ?').run(req.params.id);
    }

    res.status(201).json({ data: amendmentData });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

router.get('/:id/amendments', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const amendments = db.prepare(`
      SELECT al.*, u.full_name as recorded_by_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = 'utah_statute' AND al.entity_id = ? AND al.action = 'statute_amendment'
      ORDER BY al.created_at DESC
    
      LIMIT 1000
    `).all(req.params.id) as any[];

    const parsed = amendments.map((a: any) => {
      try { return { ...JSON.parse(a.details), id: a.id, recorded_by_name: a.recorded_by_name, created_at: a.created_at }; }
      catch { return a; }
    });

    res.json({ data: parsed });
  } catch (error: any) { res.status(500).json({ error: 'Server error in statutes', code: 'STATUTES_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// FEATURE 39: Charge Enhancement Calculator
// ════════════════════════════════════════════════════════════

router.post('/calculate-enhancement', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { statute_id, citation, factors } = req.body;

    let statute: any = null;
    if (statute_id) {
      statute = db.prepare('SELECT * FROM utah_statutes WHERE id = ?').get(statute_id);
    } else if (citation) {
      statute = db.prepare('SELECT * FROM utah_statutes WHERE citation = ? AND is_active = 1').get(citation);
    }
    if (!statute) return res.status(404).json({ error: 'Statute not found', code: 'STATUTE_NOT_FOUND' });

    const enhancementFactors = factors || {};
    let baseLevel = statute.offense_level || 'class_b_misdemeanor';
    const enhancements: { factor: string; description: string; effect: string }[] = [];

    // Enhancement hierarchy
    const levels = [
      'infraction', 'class_c_misdemeanor', 'class_b_misdemeanor', 'class_a_misdemeanor',
      'third_degree_felony', 'second_degree_felony', 'first_degree_felony',
    ];
    let currentIdx = levels.indexOf(baseLevel);
    if (currentIdx === -1) currentIdx = 2; // default to class_b_misdemeanor

    // Repeat offender
    if (enhancementFactors.repeat_offender) {
      currentIdx = Math.min(currentIdx + 1, levels.length - 1);
      enhancements.push({ factor: 'Repeat Offender', description: 'Prior conviction for same or similar offense', effect: 'Elevated one level' });
    }

    // Weapon used
    if (enhancementFactors.weapon_used) {
      currentIdx = Math.min(currentIdx + 2, levels.length - 1);
      enhancements.push({ factor: 'Weapon Used', description: 'Use of a dangerous weapon during offense', effect: 'Elevated two levels' });
    }

    // Vulnerable victim
    if (enhancementFactors.vulnerable_victim) {
      currentIdx = Math.min(currentIdx + 1, levels.length - 1);
      enhancements.push({ factor: 'Vulnerable Victim', description: 'Victim is elderly, disabled, or minor', effect: 'Elevated one level' });
    }

    // Gang enhancement
    if (enhancementFactors.gang_related) {
      currentIdx = Math.min(currentIdx + 1, levels.length - 1);
      enhancements.push({ factor: 'Gang Enhancement', description: 'Offense committed in furtherance of gang activity', effect: 'Elevated one level' });
    }

    // DV enhancement
    if (enhancementFactors.domestic_violence) {
      enhancements.push({ factor: 'Domestic Violence', description: 'DV enhancement applies — mandatory arrest, no-contact order', effect: 'DV designation added' });
    }

    const enhancedLevel = levels[currentIdx];

    res.json({
      data: {
        base_offense: statute.citation,
        base_title: statute.short_title,
        base_level: baseLevel,
        enhanced_level: enhancedLevel,
        was_enhanced: enhancedLevel !== baseLevel,
        enhancements,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 40: Statute Comparison Tool
// ════════════════════════════════════════════════════════════

router.post('/compare', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { statute_ids } = req.body;
    if (!Array.isArray(statute_ids) || statute_ids.length < 2) {
      return res.status(400).json({ error: 'Provide at least 2 statute_ids to compare', code: 'PROVIDE_AT_LEAST_2' });
    }
    if (statute_ids.length > 5) {
      return res.status(400).json({ error: 'Maximum 5 statutes for comparison', code: 'MAXIMUM_5_STATUTES_FOR' });
    }

    const placeholders = statute_ids.map(() => '?').join(',');
    const statutes = db.prepare(`
      SELECT * FROM utah_statutes WHERE id IN (${placeholders})
    
      LIMIT 1000
    `).all(...statute_ids) as any[];

    if (statutes.length < 2) return res.status(404).json({ error: 'One or more statutes not found', code: 'ONE_OR_MORE_STATUTES' });

    // Build comparison
    const comparison = {
      statutes: statutes.map((s: any) => ({
        id: s.id,
        citation: s.citation,
        short_title: s.short_title,
        description: s.description,
        offense_level: s.offense_level,
        category: s.category,
        subcategory: s.subcategory,
        is_active: s.is_active,
      })),
      differences: {
        offense_levels: [...new Set(statutes.map((s: any) => s.offense_level))],
        categories: [...new Set(statutes.map((s: any) => s.category))],
        same_level: statutes.every((s: any) => s.offense_level === statutes[0].offense_level),
        same_category: statutes.every((s: any) => s.category === statutes[0].category),
      },
    };

    res.json({ data: comparison });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

export default router;
