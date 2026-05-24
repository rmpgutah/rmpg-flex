import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';
import { localNow } from '../worker-middleware/timeUtils';

const PENALTY_RANGES: Record<string, { jail_max: string; fine_max: string }> = {
  first_degree_felony: { jail_max: '5 years to life', fine_max: '$10,000' },
  second_degree_felony: { jail_max: '1-15 years', fine_max: '$10,000' },
  third_degree_felony: { jail_max: '0-5 years', fine_max: '$5,000' },
  class_a_misdemeanor: { jail_max: 'Up to 364 days', fine_max: '$2,500' },
  class_b_misdemeanor: { jail_max: 'Up to 6 months', fine_max: '$1,000' },
  class_c_misdemeanor: { jail_max: 'Up to 90 days', fine_max: '$750' },
  infraction: { jail_max: 'None', fine_max: '$750' },
  felony: { jail_max: 'Varies', fine_max: '$10,000' },
  misdemeanor_a: { jail_max: 'Up to 364 days', fine_max: '$2,500' },
  misdemeanor_b: { jail_max: 'Up to 6 months', fine_max: '$1,000' },
  misdemeanor_c: { jail_max: 'Up to 90 days', fine_max: '$750' },
};

const ENHANCEMENT_LEVELS = [
  'infraction', 'class_c_misdemeanor', 'class_b_misdemeanor', 'class_a_misdemeanor',
  'third_degree_felony', 'second_degree_felony', 'first_degree_felony',
];

export function mountStatuteRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // ─── SEARCH / LIST STATUTES ────────────────────────────────

  api.get('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query('q');
      const category = c.req.query('category');
      const title = c.req.query('title');
      const offense_level = c.req.query('offense_level');
      const subcategory = c.req.query('subcategory');
      const limitRaw = parseInt(c.req.query('limit') || '100000', 10);
      const offsetRaw = parseInt(c.req.query('offset') || '0', 10);
      const limitNum = Math.min(100000, Math.max(1, isNaN(limitRaw) ? 100000 : limitRaw));
      const offsetNum = Math.min(50000, Math.max(0, isNaN(offsetRaw) ? 0 : offsetRaw));

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
        params.push(parseInt(title, 10));
      }

      if (offense_level) {
        where += ' AND offense_level = ?';
        params.push(offense_level);
      }

      if (subcategory) {
        where += ' AND subcategory = ?';
        params.push(subcategory);
      }

      const total = await db.prepare(`SELECT COUNT(*) as count FROM utah_statutes ${where}`).get(...params) as any;

      const statutes = await db.prepare(`
        SELECT * FROM utah_statutes
        ${where}
        ORDER BY title, chapter, section
        LIMIT ? OFFSET ?
      `).all(...params, limitNum, offsetNum);

      const subcatRows = await db.prepare(
        'SELECT DISTINCT subcategory FROM utah_statutes WHERE is_active = 1 ORDER BY subcategory LIMIT 1000'
      ).all() as any[];

      return c.json({
        data: statutes,
        total: (total as any)?.count ?? 0,
        subcategories: subcatRows.map((s: any) => s.subcategory),
      });
    } catch (error: any) {
      console.error('List statutes error:', error);
      return c.json({ error: 'Failed to list statutes', code: 'LIST_STATUTES_ERROR' }, 500);
    }
  });

  // GET /api/statutes/search — Quick search (for autocomplete / lookup)
  api.get('/search', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query('q');
      const category = c.req.query('category');
      const limitRaw = parseInt(c.req.query('limit') || '100000', 10);
      const limitNum = Math.min(100000, Math.max(1, isNaN(limitRaw) ? 100000 : limitRaw));

      if (!q || q.length < 2) {
        return c.json({ data: [] });
      }

      let where = 'WHERE is_active = 1 AND (citation LIKE ? OR short_title LIKE ?)';
      const searchTerm = `%${q}%`;
      const params: any[] = [searchTerm, searchTerm];

      if (category) {
        where += ' AND category = ?';
        params.push(category);
      }

      const statutes = await db.prepare(`
        SELECT id, citation, short_title, description, offense_level, category, subcategory, citation_fine
        FROM utah_statutes
        ${where}
        ORDER BY
          CASE WHEN citation LIKE ? THEN 0 ELSE 1 END,
          title, chapter, section
        LIMIT ?
      `).all(...params, `${q}%`, limitNum);

      c.header('Cache-Control', 'private, max-age=300');
      return c.json({ data: statutes });
    } catch (error: any) {
      console.error('Search statutes error:', error);
      return c.json({ error: 'Failed to search statutes', code: 'SEARCH_STATUTES_ERROR' }, 500);
    }
  });

  // GET /api/statutes/analytics/top-charged — Commonly charged statutes
  api.get('/analytics/top-charged', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const days = c.req.query('days') || '365';
      const limitRaw = parseInt(c.req.query('limit') || '100000', 10);
      const cutoff = new Date(Date.now() - parseInt(days, 10) * 24 * 60 * 60 * 1000).toISOString();
      const limitNum = Math.min(100000, Math.max(1, isNaN(limitRaw) ? 100000 : limitRaw));

      const topFromCitations = await db.prepare(`
        SELECT us.citation, us.short_title, us.offense_level, us.category,
               COUNT(*) as citation_count
        FROM entity_statutes es
        JOIN utah_statutes us ON es.statute_id = us.id
        WHERE es.entity_type = 'citation' AND es.created_at >= ?
        GROUP BY us.id
        ORDER BY citation_count DESC
        LIMIT ?
      `).all(cutoff, limitNum) as any[];

      const topFromIncidents = await db.prepare(`
        SELECT us.citation, us.short_title, us.offense_level, us.category,
               COUNT(*) as incident_count
        FROM entity_statutes es
        JOIN utah_statutes us ON es.statute_id = us.id
        WHERE es.entity_type = 'incident' AND es.created_at >= ?
        GROUP BY us.id
        ORDER BY incident_count DESC
        LIMIT ?
      `).all(cutoff, limitNum) as any[];

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

      const sorted = Array.from(combined.values())
        .sort((a, b) => b.total_count - a.total_count)
        .slice(0, limitNum);

      return c.json({ data: sorted, period_days: parseInt(days, 10) });
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // GET /api/statutes/entity/:type/:id — Get statutes linked to an entity
  api.get('/entity/:type/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const type = c.req.param('type');
      const id = c.req.param('id');

      const links = await db.prepare(`
        SELECT es.*, s.citation, s.short_title, s.offense_level, s.category, s.subcategory, s.description
        FROM entity_statutes es
        JOIN utah_statutes s ON es.statute_id = s.id
        WHERE es.entity_type = ? AND es.entity_id = ?
        ORDER BY s.citation
        LIMIT 1000
      `).all(type, id);

      return c.json({ data: links });
    } catch (error: any) {
      return c.json({ error: 'Failed to get entity statutes', code: 'GET_ENTITY_STATUTES_ERROR' }, 500);
    }
  });

  // POST /api/statutes/entity — Link a statute to an entity
  api.post('/entity', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { entity_type, entity_id, statute_id, notes } = await c.req.json();

      if (!entity_type || !entity_id || !statute_id) {
        return c.json({ error: 'entity_type, entity_id, and statute_id are required', code: 'ENTITYTYPE_ENTITYID_AND_STATUTEID' }, 400);
      }

      const result = await db.prepare(`
        INSERT OR IGNORE INTO entity_statutes (entity_type, entity_id, statute_id, notes)
        VALUES (?, ?, ?, ?)
      `).run(entity_type, entity_id, statute_id, notes || null);

      if (result.meta.changes === 0) {
        return c.json({ error: 'Statute already linked to this entity', code: 'STATUTE_ALREADY_LINKED_TO' }, 409);
      }

      const link = await db.prepare(`
        SELECT es.*, s.citation, s.short_title, s.offense_level, s.category, s.subcategory
        FROM entity_statutes es
        JOIN utah_statutes s ON es.statute_id = s.id
        WHERE es.id = ?
      `).get(result.meta.last_row_id);

      return c.json(link, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to link statute', code: 'LINK_STATUTE_ERROR' }, 500);
    }
  });

  // DELETE /api/statutes/entity/:id — Remove a statute link
  api.delete('/entity/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = c.req.param('id');
      await db.prepare('DELETE FROM entity_statutes WHERE id = ?').run(id);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to unlink statute', code: 'UNLINK_STATUTE_ERROR' }, 500);
    }
  });

  // GET /api/statutes/penalty/:citation — Penalty lookup
  api.get('/penalty/:citation', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const citation = c.req.param('citation');

      const statute = await db.prepare(`
        SELECT id, citation, short_title, description, offense_level, category,
               citation_fine, min_penalty, max_penalty, penalty_notes
        FROM utah_statutes
        WHERE citation = ? AND is_active = 1
      `).get(citation) as any;

      if (!statute) return c.json({ error: 'Statute not found', code: 'STATUTE_NOT_FOUND' }, 404);

      const penalty = PENALTY_RANGES[statute.offense_level] || { jail_max: 'Unknown', fine_max: 'Unknown' };

      return c.json({
        data: {
          ...statute,
          penalty_range: penalty,
          citation_fine: statute.citation_fine || null,
          min_penalty: statute.min_penalty || null,
          max_penalty: statute.max_penalty || null,
        },
      });
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // POST /api/statutes/calculate-enhancement — Charge enhancement calculator
  api.post('/calculate-enhancement', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { statute_id, citation, factors } = await c.req.json();

      let statute: any = null;
      if (statute_id) {
        statute = await db.prepare('SELECT * FROM utah_statutes WHERE id = ?').get(statute_id);
      } else if (citation) {
        statute = await db.prepare('SELECT * FROM utah_statutes WHERE citation = ? AND is_active = 1').get(citation);
      }
      if (!statute) return c.json({ error: 'Statute not found', code: 'STATUTE_NOT_FOUND' }, 404);

      const enhancementFactors = factors || {};
      let baseLevel = statute.offense_level || 'class_b_misdemeanor';
      const enhancements: { factor: string; description: string; effect: string }[] = [];

      let currentIdx = ENHANCEMENT_LEVELS.indexOf(baseLevel);
      if (currentIdx === -1) currentIdx = 2;

      if (enhancementFactors.repeat_offender) {
        currentIdx = Math.min(currentIdx + 1, ENHANCEMENT_LEVELS.length - 1);
        enhancements.push({ factor: 'Repeat Offender', description: 'Prior conviction for same or similar offense', effect: 'Elevated one level' });
      }

      if (enhancementFactors.weapon_used) {
        currentIdx = Math.min(currentIdx + 2, ENHANCEMENT_LEVELS.length - 1);
        enhancements.push({ factor: 'Weapon Used', description: 'Use of a dangerous weapon during offense', effect: 'Elevated two levels' });
      }

      if (enhancementFactors.vulnerable_victim) {
        currentIdx = Math.min(currentIdx + 1, ENHANCEMENT_LEVELS.length - 1);
        enhancements.push({ factor: 'Vulnerable Victim', description: 'Victim is elderly, disabled, or minor', effect: 'Elevated one level' });
      }

      if (enhancementFactors.gang_related) {
        currentIdx = Math.min(currentIdx + 1, ENHANCEMENT_LEVELS.length - 1);
        enhancements.push({ factor: 'Gang Enhancement', description: 'Offense committed in furtherance of gang activity', effect: 'Elevated one level' });
      }

      if (enhancementFactors.domestic_violence) {
        enhancements.push({ factor: 'Domestic Violence', description: 'DV enhancement applies — mandatory arrest, no-contact order', effect: 'DV designation added' });
      }

      const enhancedLevel = ENHANCEMENT_LEVELS[currentIdx];

      return c.json({
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
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // POST /api/statutes/compare — Statute comparison tool
  api.post('/compare', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { statute_ids } = await c.req.json();

      if (!Array.isArray(statute_ids) || statute_ids.length < 2) {
        return c.json({ error: 'Provide at least 2 statute_ids to compare', code: 'PROVIDE_AT_LEAST_2' }, 400);
      }
      if (statute_ids.length > 5) {
        return c.json({ error: 'Maximum 5 statutes for comparison', code: 'MAXIMUM_5_STATUTES_FOR' }, 400);
      }

      const placeholders = statute_ids.map(() => '?').join(',');
      const statutes = await db.prepare(`
        SELECT * FROM utah_statutes WHERE id IN (${placeholders})
        LIMIT 1000
      `).all(...statute_ids) as any[];

      if (statutes.length < 2) return c.json({ error: 'One or more statutes not found', code: 'ONE_OR_MORE_STATUTES' }, 404);

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

      return c.json({ data: comparison });
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // GET /api/statutes/:id — Get single statute
  api.get('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const statute = await db.prepare('SELECT * FROM utah_statutes WHERE id = ?').get(id);
      if (!statute) {
        return c.json({ error: 'Statute not found', code: 'STATUTE_NOT_FOUND' }, 404);
      }
      return c.json(statute);
    } catch (error: any) {
      return c.json({ error: 'Failed to get statute', code: 'GET_STATUTE_ERROR' }, 500);
    }
  });

  // POST /api/statutes — Add custom statute (admin/manager only)
  api.post('/', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { title, chapter, section, subsection, citation, short_title, description, offense_level, category, subcategory } = await c.req.json();

      if (!citation || !short_title || !category) {
        return c.json({ error: 'citation, short_title, and category are required', code: 'CITATION_SHORTTITLE_AND_CATEGORY' }, 400);
      }

      const result = await db.prepare(`
        INSERT INTO utah_statutes (title, chapter, section, subsection, citation, short_title, description, offense_level, category, subcategory)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(title || 0, chapter || null, section || '', subsection || null, citation, short_title, description || null, offense_level || null, category, subcategory || null);

      const statute = await db.prepare('SELECT * FROM utah_statutes WHERE id = ?').get(result.meta.last_row_id);
      return c.json(statute, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to create statute', code: 'CREATE_STATUTE_ERROR' }, 500);
    }
  });

  // PUT /api/statutes/:id — Update statute (admin/manager only)
  api.put('/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const { citation, short_title, description, offense_level, category, subcategory, is_active } = await c.req.json();

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
        return c.json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' }, 400);
      }

      params.push(id);
      await db.prepare(`UPDATE utah_statutes SET ${fields.join(', ')} WHERE id = ?`).run(...params);

      const statute = await db.prepare('SELECT * FROM utah_statutes WHERE id = ?').get(id);
      return c.json(statute);
    } catch (error: any) {
      return c.json({ error: 'Failed to update statute', code: 'UPDATE_STATUTE_ERROR' }, 500);
    }
  });

  // DELETE /api/statutes/:id — Deactivate statute (admin/manager only)
  api.delete('/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      await db.prepare('UPDATE utah_statutes SET is_active = 0 WHERE id = ?').run(id);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to delete statute', code: 'DELETE_STATUTE_ERROR' }, 500);
    }
  });

  // POST /api/statutes/:id/amendment — Add amendment (admin/manager only)
  api.post('/:id/amendment', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));

      const statute = await db.prepare('SELECT * FROM utah_statutes WHERE id = ?').get(id) as any;
      if (!statute) return c.json({ error: 'Statute not found', code: 'STATUTE_NOT_FOUND' }, 404);

      const { amendment_date, amendment_type, description, effective_date, previous_text, new_text } = await c.req.json();
      if (!amendment_type || !description) return c.json({ error: 'amendment_type and description required', code: 'AMENDMENTTYPE_AND_DESCRIPTION_REQUIRED' }, 400);

      const now = localNow();
      const user = c.get('user');

      const amendmentData = {
        statute_id: id,
        citation: statute.citation,
        amendment_type,
        description,
        amendment_date: amendment_date || now.split('T')[0],
        effective_date: effective_date || null,
        previous_text: previous_text || null,
        new_text: new_text || null,
        recorded_by: user.userId,
      };

      await db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
        VALUES (?, 'statute_amendment', 'utah_statute', ?, ?, ?)
      `).run(user.userId, String(id), JSON.stringify(amendmentData), now);

      if (amendment_type === 'repealed') {
        await db.prepare('UPDATE utah_statutes SET is_active = 0 WHERE id = ?').run(id);
      }

      return c.json({ data: amendmentData }, 201);
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // GET /api/statutes/:id/amendments — Get amendment history
  api.get('/:id/amendments', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = c.req.param('id');

      const amendments = await db.prepare(`
        SELECT al.*, u.full_name as recorded_by_name
        FROM activity_log al
        LEFT JOIN users u ON al.user_id = u.id
        WHERE al.entity_type = 'utah_statute' AND al.entity_id = ? AND al.action = 'statute_amendment'
        ORDER BY al.created_at DESC
        LIMIT 1000
      `).all(id) as any[];

      const parsed = amendments.map((a: any) => {
        try { return { ...JSON.parse(a.details), id: a.id, recorded_by_name: a.recorded_by_name, created_at: a.created_at }; }
        catch { return a; }
      });

      return c.json({ data: parsed });
    } catch (error: any) {
      return c.json({ error: 'Server error in statutes', code: 'STATUTES_ERROR' }, 500);
    }
  });

  app.route('/api/statutes', api);
}
