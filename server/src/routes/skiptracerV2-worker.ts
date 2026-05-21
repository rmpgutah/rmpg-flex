// SkipTracer V2 routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramStr, paramNum, localNow } from '../worker-middleware/d1Helpers';
import { auditLog } from '../worker-middleware/auditLogger';

// ============================================================
// Query Type Detection
// ============================================================

const STREET_WORDS = /\b(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|way|pl|place|cir|circle|pkwy|parkway|hwy|highway)\b/i;

function detectQueryType(q: string): 'phone' | 'email' | 'address' | 'name' {
  const stripped = q.replace(/[\s\-().+]/g, '');
  if (/\d{10,}/.test(stripped)) return 'phone';
  if (q.includes('@')) return 'email';
  if (/\d/.test(q) && STREET_WORDS.test(q)) return 'address';
  return 'name';
}

function buildSearchQuery(params: {
  q?: string; name?: string; firstName?: string; lastName?: string;
  phone?: string; email?: string; address?: string; type?: string;
}): { query: Record<string, string>; searchType: string } {
  const { q, name, firstName, lastName, phone, email, address, type } = params;

  if (firstName && lastName) {
    return { query: { name: `${firstName} ${lastName}`, firstName, lastName }, searchType: 'name' };
  }
  if (firstName) return { query: { name: firstName, firstName }, searchType: 'name' };
  if (lastName) return { query: { name: lastName, lastName }, searchType: 'name' };
  if (name) return { query: { name }, searchType: 'name' };
  if (phone) return { query: { phone: phone.replace(/\D/g, '') }, searchType: 'phone' };
  if (email) return { query: { email: email.toLowerCase().trim() }, searchType: 'email' };
  if (address) return { query: { address }, searchType: 'address' };

  if (!q) return { query: {}, searchType: 'unknown' };

  const detected = type || detectQueryType(q);
  switch (detected) {
    case 'phone': return { query: { phone: q.replace(/\D/g, '') }, searchType: 'phone' };
    case 'email': return { query: { email: q.toLowerCase().trim() }, searchType: 'email' };
    case 'address': return { query: { address: q }, searchType: 'address' };
    default: return { query: { name: q }, searchType: 'name' };
  }
}

export function mountSkipTracerV2Routes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/skiptracer-v2/search — Unified multi-source search (stub in Workers)
  api.get('/search', async (c) => {
    const q = c.req.query('q');
    const name = c.req.query('name');
    const firstName = c.req.query('firstName');
    const lastName = c.req.query('lastName');
    const phone = c.req.query('phone');
    const email = c.req.query('email');
    const address = c.req.query('address');
    const type = c.req.query('type');
    const categories = c.req.query('categories');

    if (!q && !name && !firstName && !lastName && !phone && !email && !address) {
      return c.json({ error: 'At least one search parameter is required (q, name, firstName, lastName, phone, email, or address)', code: 'AT_LEAST_ONE_SEARCH' }, 400);
    }

    const { query, searchType } = buildSearchQuery({ q, name, firstName, lastName, phone, email, address, type });

    // External data sources not available in Workers runtime — return stub
    const searchId = crypto.randomUUID();
    const startTime = Date.now();

    // Attempt to search people_index (local cached data)
    const db = new D1Db(c.env.DB);
    let profiles: any[] = [];
    try {
      const searchName = query.name || '';
      if (searchName) {
        const parts = searchName.trim().split(/\s+/);
        const firstNamePart = parts[0] || '';
        const lastNamePart = parts.slice(-1)[0] || '';
        const rows = await db.prepare(`
          SELECT * FROM people_index
          WHERE (first_name LIKE ? OR last_name LIKE ? OR full_name LIKE ?)
          LIMIT 50
        `).all(`%${firstNamePart}%`, `%${lastNamePart}%`, `%${searchName}%`) as any[];
        profiles = rows.map((r: any) => ({
          firstName: r.first_name || '',
          lastName: r.last_name || '',
          middleName: r.middle_name || '',
          fullName: r.full_name || '',
          dob: r.dob || '',
          age: r.age || null,
          gender: r.gender || '',
          addresses: r.addresses ? JSON.parse(r.addresses) : [],
          phones: r.phones ? JSON.parse(r.phones) : [],
          emails: r.emails ? JSON.parse(r.emails) : [],
          associates: r.associates ? JSON.parse(r.associates) : [],
          confidenceScore: 0.5,
          sources: ['people_index'],
        }));
      }
    } catch { /* people_index may not exist */ }

    const durationMs = Date.now() - startTime;

    // Persist search
    try {
      await db.prepare(`
        INSERT INTO skip_tracer_searches_v2
          (search_type, query_params, sources_queried, sources_responded, total_results, searched_by, cost_total, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        searchType,
        JSON.stringify(query),
        JSON.stringify(['people_index']),
        JSON.stringify(['people_index']),
        profiles.length,
        c.get('user')?.userId ?? null,
        0,
        durationMs,
        localNow(),
      );
    } catch { /* table may not exist */ }

    return c.json({
      profiles,
      sourcesQueried: ['people_index'],
      sourcesResponded: ['people_index'],
      totalResults: profiles.length,
      totalCost: 0,
      durationMs,
      query,
      searchId,
      timestamp: localNow(),
    });
  });

  // GET /api/skiptracer-v2/sources — List all sources (stub in Workers)
  api.get('/sources', async (c) => {
    return c.json([
      { name: 'people_index', displayName: 'People Index (Local)', category: 'local', costPerLookup: 0, configured: true, enabled: true, healthy: true },
      { name: 'microbilt', displayName: 'MicroBilt', category: 'paid', costPerLookup: 2.50, configured: false, enabled: false, healthy: false },
      { name: 'rapidapi', displayName: 'RapidAPI', category: 'paid', costPerLookup: 1.00, configured: false, enabled: false, healthy: false },
      { name: 'utah_courts', displayName: 'Utah Courts', category: 'court', costPerLookup: 0, configured: false, enabled: false, healthy: false },
      { name: 'fbi_wanted', displayName: 'FBI Wanted', category: 'registry', costPerLookup: 0, configured: false, enabled: false, healthy: false },
      { name: 'nsopw', displayName: 'NSOPW', category: 'registry', costPerLookup: 0, configured: false, enabled: false, healthy: false },
      { name: 'ofac', displayName: 'OFAC', category: 'registry', costPerLookup: 0, configured: false, enabled: false, healthy: false },
    ]);
  });

  // PUT /api/skiptracer-v2/sources/:name/config — Configure a source (stub in Workers)
  api.put('/sources/:name/config', requireRole('admin'), async (c) => {
    const name = paramStr(c.req.param('name'));
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { enabled, apiKey, config: sourceConfig } = body;

      const upsertConfig = async (configKey: string, configValue: string) => {
        const existing = await db.prepare("SELECT id FROM system_config WHERE config_key = ? LIMIT 1").get(configKey) as any;
        if (existing) {
          await db.prepare("UPDATE system_config SET config_value = ?, updated_at = ? WHERE config_key = ?").run(configValue, localNow(), configKey);
        } else {
          await db.prepare(
            "INSERT INTO system_config (config_key, config_value, category, is_active, updated_at) VALUES (?, ?, 'integrations', 1, ?)"
          ).run(configKey, configValue, localNow());
        }
      };

      if (typeof enabled === 'boolean') {
        await upsertConfig(`skipv2_${name}_enabled`, enabled ? '1' : '0');
      }
      if (typeof apiKey === 'string') {
        // Store API key — in Workers we store as-is (encrypted at rest by platform)
        await upsertConfig(`skipv2_${name}_api_key`, apiKey);
      }
      if (sourceConfig && typeof sourceConfig === 'object') {
        await upsertConfig(`skipv2_${name}_config`, JSON.stringify(sourceConfig));
      }

      await auditLog(new D1Db(c.env.DB), c, 'skiptracer_config_updated', 'integration', 0, `Skip Tracker 3.5 source "${name}" configuration updated`);
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Failed to update source configuration', code: 'FAILED_TO_UPDATE_SOURCE' }, 500);
    }
  });

  // GET /api/skiptracer-v2/dossiers — List saved dossiers
  api.get('/dossiers', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query('q') || '';
      const limit = Math.min(100000, Math.max(1, parseInt(c.req.query('limit') || '100000', 10)));
      const offset = parseInt(c.req.query('offset') || '0', 10);

      let sql = `
        SELECT d.*, u.full_name AS created_by_name
        FROM dossiers d
        LEFT JOIN users u ON u.id = d.created_by
        WHERE d.is_archived = 0
      `;
      const params: any[] = [];

      if (q) {
        sql += ` AND d.subject_name LIKE ?`;
        params.push(`%${q}%`);
      }

      sql += ` ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const rows = await db.prepare(sql).all(...params);

      let countSql = `SELECT COUNT(*) as total FROM dossiers WHERE is_archived = 0`;
      const countParams: any[] = [];
      if (q) {
        countSql += ` AND subject_name LIKE ?`;
        countParams.push(`%${q}%`);
      }
      const totalRow = await db.prepare(countSql).get(...countParams) as any;
      const total = totalRow?.total || 0;

      return c.json({ dossiers: rows, total, limit, offset });
    } catch {
      return c.json({ error: 'Failed to list dossiers', code: 'FAILED_TO_LIST_DOSSIERS' }, 500);
    }
  });

  // POST /api/skiptracer-v2/dossiers — Save a dossier
  api.post('/dossiers', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { subjectName, profileSnapshot, notes, tags, linkedIncidentId, linkedCaseId, linkedCallId } = body;

      if (!subjectName || !profileSnapshot) {
        return c.json({ error: 'subjectName and profileSnapshot are required', code: 'SUBJECTNAME_AND_PROFILESNAPSHOT_ARE' }, 400);
      }

      const now = localNow();
      const result = await db.prepare(`
        INSERT INTO dossiers (subject_name, profile_snapshot, notes, tags, linked_incident_id, linked_case_id, linked_call_id, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        subjectName,
        typeof profileSnapshot === 'string' ? profileSnapshot : JSON.stringify(profileSnapshot),
        notes || null,
        JSON.stringify(tags || []),
        linkedIncidentId || null,
        linkedCaseId || null,
        linkedCallId || null,
        c.get('user')?.userId ?? null,
        now,
        now,
      );

      const id = Number(result.meta.last_row_id);
      await auditLog(db, c, 'CREATE', 'skiptracer', id, `Dossier created for "${subjectName}"`);

      const dossier = await db.prepare(`
        SELECT d.*, u.full_name AS created_by_name
        FROM dossiers d LEFT JOIN users u ON u.id = d.created_by WHERE d.id = ?
      `).get(id);

      return c.json(dossier || { success: true, id });
    } catch {
      return c.json({ error: 'Failed to create dossier', code: 'FAILED_TO_CREATE_DOSSIER' }, 500);
    }
  });

  // GET /api/skiptracer-v2/dossiers/:id — Get a saved dossier
  api.get('/dossiers/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramStr(c.req.param('id'));

      const dossier = await db.prepare(`
        SELECT d.*, u.full_name AS created_by_name
        FROM dossiers d LEFT JOIN users u ON u.id = d.created_by
        WHERE d.id = ? AND d.is_archived = 0
      `).get(id);

      if (!dossier) return c.json({ error: 'Dossier not found', code: 'DOSSIER_NOT_FOUND' }, 404);
      return c.json(dossier);
    } catch {
      return c.json({ error: 'Failed to get dossier', code: 'FAILED_TO_GET_DOSSIER' }, 500);
    }
  });

  // PUT /api/skiptracer-v2/dossiers/:id — Update a dossier
  api.put('/dossiers/:id', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramStr(c.req.param('id'));
      const body = await c.req.json();
      const { notes, tags, linkedIncidentId, linkedCaseId, linkedCallId } = body;

      const existing = await db.prepare('SELECT id FROM dossiers WHERE id = ? AND is_archived = 0').get(id);
      if (!existing) return c.json({ error: 'Dossier not found', code: 'DOSSIER_NOT_FOUND' }, 404);

      const updates: string[] = [];
      const params: any[] = [];

      if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
      if (tags !== undefined) { updates.push('tags = ?'); params.push(JSON.stringify(tags)); }
      if (linkedIncidentId !== undefined) { updates.push('linked_incident_id = ?'); params.push(linkedIncidentId || null); }
      if (linkedCaseId !== undefined) { updates.push('linked_case_id = ?'); params.push(linkedCaseId || null); }
      if (linkedCallId !== undefined) { updates.push('linked_call_id = ?'); params.push(linkedCallId || null); }

      if (updates.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' }, 400);

      updates.push('updated_at = ?');
      params.push(localNow());
      params.push(id);

      await db.prepare(`UPDATE dossiers SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      const updated = await db.prepare('SELECT * FROM dossiers WHERE id = ?').get(id);
      return c.json(updated);
    } catch {
      return c.json({ error: 'Failed to update dossier', code: 'FAILED_TO_UPDATE_DOSSIER' }, 500);
    }
  });

  // DELETE /api/skiptracer-v2/dossiers/:id — Archive a dossier
  api.delete('/dossiers/:id', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramStr(c.req.param('id'));

      const existing = await db.prepare('SELECT id, subject_name FROM dossiers WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Dossier not found', code: 'DOSSIER_NOT_FOUND' }, 404);

      await db.prepare('UPDATE dossiers SET is_archived = 1, updated_at = ? WHERE id = ?').run(localNow(), id);
      await auditLog(db, c, 'DELETE', 'skiptracer', parseInt(id, 10), `Dossier archived for "${existing.subject_name}"`);

      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Failed to archive dossier', code: 'FAILED_TO_ARCHIVE_DOSSIER' }, 500);
    }
  });

  // GET /api/skiptracer-v2/dossiers/:id/pdf — Export dossier as PDF (stub in Workers)
  api.get('/dossiers/:id/pdf', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramStr(c.req.param('id'));

      const dossier = await db.prepare(`
        SELECT d.*, u.full_name AS created_by_name
        FROM dossiers d LEFT JOIN users u ON u.id = d.created_by
        WHERE d.id = ? AND d.is_archived = 0
      `).get(id) as any;

      if (!dossier) return c.json({ error: 'Dossier not found', code: 'DOSSIER_NOT_FOUND' }, 404);

      // PDF generation not available in Workers runtime — return stub
      return c.json({ error: 'PDF export not available in Workers runtime', code: 'PDF_EXPORT_NOT_AVAILABLE', stub: true, dossier }, 501);
    } catch {
      return c.json({ error: 'Failed to export dossier PDF', code: 'FAILED_TO_EXPORT_DOSSIER' }, 500);
    }
  });

  // GET /api/skiptracer-v2/history — Search history with pagination
  api.get('/history', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const limit = Math.min(100000, Math.max(1, parseInt(c.req.query('limit') || '100000', 10)));
      const offset = parseInt(c.req.query('offset') || '0', 10);
      const q = c.req.query('q') || '';

      let whereSql = '';
      const whereParams: any[] = [];
      if (q) {
        whereSql = ' WHERE s.query_params LIKE ?';
        whereParams.push(`%${q}%`);
      }

      const rows = await db.prepare(`
        SELECT s.*, u.full_name AS searcher_name
        FROM skip_tracer_searches_v2 s
        LEFT JOIN users u ON u.id = s.searched_by
        ${whereSql}
        ORDER BY s.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...whereParams, limit, offset);

      const totalRow = await db.prepare(
        `SELECT COUNT(*) as total FROM skip_tracer_searches_v2 s${whereSql}`
      ).get(...whereParams) as any;
      const total = totalRow?.total || 0;

      return c.json({ searches: rows, total, limit, offset });
    } catch {
      return c.json({ error: 'Failed to get search history', code: 'FAILED_TO_GET_SEARCH' }, 500);
    }
  });

  // GET /api/skiptracer-v2/stats — Usage statistics
  api.get('/stats', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const today = now.split(' ')[0] || now.split('T')[0];

      const totalAllRow = await db.prepare('SELECT COUNT(*) as total_all FROM skip_tracer_searches_v2').get() as any;
      const totalAll = totalAllRow?.total_all || 0;

      const totalTodayRow = await db.prepare(
        "SELECT COUNT(*) as total_today FROM skip_tracer_searches_v2 WHERE created_at >= ? || ' 00:00:00'"
      ).get(today) as any;
      const totalToday = totalTodayRow?.total_today || 0;

      const totalWeekRow = await db.prepare(
        "SELECT COUNT(*) as total_week FROM skip_tracer_searches_v2 WHERE created_at >= datetime(?, '-7 days')"
      ).get(now) as any;
      const totalWeek = totalWeekRow?.total_week || 0;

      const totalCostRow = await db.prepare(
        'SELECT COALESCE(SUM(cost_total), 0) as total_cost FROM skip_tracer_searches_v2'
      ).get() as any;
      const totalCost = totalCostRow?.total_cost || 0;

      // Top sources
      const allSearches = await db.prepare(
        'SELECT sources_responded FROM skip_tracer_searches_v2'
      ).all() as Array<{ sources_responded: string }>;

      const sourceCounts: Record<string, number> = {};
      for (const row of allSearches) {
        try {
          const sources = JSON.parse(row.sources_responded);
          if (Array.isArray(sources)) {
            for (const s of sources) {
              sourceCounts[s] = (sourceCounts[s] || 0) + 1;
            }
          }
        } catch { /* skip malformed */ }
      }

      const topSources = Object.entries(sourceCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }));

      // Searches by day for the last 7 days
      const searchesByDay: Array<{ date: string; count: number }> = [];
      for (let i = 6; i >= 0; i--) {
        const dayRow = await db.prepare(
          `SELECT COUNT(*) as cnt FROM skip_tracer_searches_v2 WHERE date(created_at) = date(?, '-${i} days')`
        ).get(today) as any;
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        searchesByDay.push({ date: dateStr, count: dayRow?.cnt || 0 });
      }

      return c.json({
        totalSearches: { today: totalToday, week: totalWeek, allTime: totalAll },
        totalCost: Math.round(totalCost * 100) / 100,
        topSources,
        searchesByDay,
      });
    } catch {
      return c.json({ error: 'Failed to get statistics', code: 'FAILED_TO_GET_STATISTICS' }, 500);
    }
  });

  app.route('/api/skiptracer-v2', api);
}
