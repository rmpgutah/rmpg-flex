// Warrant routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow } from '../worker-middleware/d1Helpers';
import { auditLog } from '../worker-middleware/auditLogger';

export function mountWarrantRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/warrants/scrapers/health — cheap summary for header badge
  // MUST be defined BEFORE /:id to avoid "health" matching :id
  api.get('/scrapers/health', async (c) => {
    const db = new D1Db(c.env.DB);
    let total = 0; let healthy = 0; let degraded = 0; let failed = 0; let circuit_broken = 0;
    let last_hour_runs = 0; let last_hour_inserted = 0;

    try {
      const circuitRow = await db.prepare('SELECT COUNT(*) as n FROM warrant_scraper_config WHERE circuit_broken = 1 AND enabled = 1').get() as any;
      circuit_broken = circuitRow?.n || 0;

      const sources = await db.prepare('SELECT source_key FROM warrant_scraper_config WHERE enabled = 1').all() as any[];
      total = sources.length;

      for (const s of sources) {
        const m = await db.prepare(`
          SELECT COUNT(*) as total_runs,
            SUM(CASE WHEN error_message IS NULL THEN 1 ELSE 0 END) as successful_runs,
            SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END) as failed_runs
          FROM warrant_scraper_runs WHERE source_key = ? AND started_at >= datetime('now', '-24 hours')
        `).get(s.source_key) as any;

        if (!m || !m.total_runs) { failed++; continue; }
        const rate = m.total_runs > 0 ? m.successful_runs / m.total_runs : 0;
        if (rate >= 0.8) healthy++;
        else if (rate >= 0.5) degraded++;
        else failed++;
      }

      const lh = await db.prepare('SELECT COUNT(*) as n, COALESCE(SUM(inserted_count), 0) as inserted FROM warrant_scraper_runs WHERE started_at >= datetime(\'now\', \'-1 hour\')').get() as any;
      last_hour_runs = lh?.n || 0;
      last_hour_inserted = lh?.inserted || 0;
    } catch { /* scraper tables may not exist */ }

    return c.json({ healthy, degraded, failed, circuit_broken, total, last_hour_runs, last_hour_inserted });
  });

  // GET /api/warrants/scrapers — list all sources with basic info
  api.get('/scrapers', async (c) => {
    const db = new D1Db(c.env.DB);
    let sources: any[] = [];
    try {
      sources = await db.prepare(`
        SELECT source_key, display_name, state, county, source_url, source_type,
          enabled, circuit_broken, priority, consecutive_errors,
          last_scrape_at, last_success_at, last_error,
          avg_parse_count, p95_latency_ms,
          (SELECT COUNT(*) FROM scraped_warrants WHERE source_key = warrant_scraper_config.source_key) AS warrant_count
        FROM warrant_scraper_config
        ORDER BY priority, state, county
      `).all() as any[];
    } catch { /* scraper tables may not exist */ }
    return c.json({ sources });
  });

  // POST /api/warrants/scrapers/:source_key/trigger — stub
  api.post('/scrapers/:source_key/trigger', async (c) => {
    return c.json({ message: 'Trigger not available in Workers runtime', stub: true });
  });

  // POST /api/warrants/scrapers/:source_key/reset-circuit — stub
  api.post('/scrapers/:source_key/reset-circuit', async (c) => {
    const db = new D1Db(c.env.DB);
    const sourceKey = c.req.param('source_key');
    try {
      await db.prepare("UPDATE warrant_scraper_config SET circuit_broken = 0, consecutive_errors = 0 WHERE source_key = ?").run(sourceKey);
      return c.json({ message: 'Circuit reset' });
    } catch {
      return c.json({ error: 'Source not found' }, 404);
    }
  });

  // GET /api/warrants - List warrants
  api.get('/', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const {
      status, type, severity, source, subject_name, archived,
      court, charge, date_from, date_to, expiring_days, person_id,
      page = '1', per_page = '100000',
    } = q;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { whereClause += ' AND w.status = ?'; params.push(status); }
    if (type) { whereClause += ' AND w.type = ?'; params.push(type); }
    if (severity) { whereClause += ' AND w.offense_level = ?'; params.push(severity); }
    if (source) { whereClause += " AND COALESCE(w.source, 'manual') = ?"; params.push(source); }
    if (subject_name) {
      const s = `%${subject_name}%`;
      whereClause += " AND ((p.first_name || ' ' || p.last_name) LIKE ? OR w.warrant_number LIKE ? OR w.charge_description LIKE ?)";
      params.push(s, s, s);
    }
    if (court) { whereClause += ' AND w.issuing_court LIKE ?'; params.push(`%${court}%`); }
    if (charge) { whereClause += ' AND w.charge_description LIKE ?'; params.push(`%${charge}%`); }
    if (date_from) { whereClause += ' AND w.created_at >= ?'; params.push(date_from); }
    if (date_to) { whereClause += ' AND w.created_at <= ?'; params.push(date_to); }
    if (expiring_days) {
      const eDays = parseInt(expiring_days, 10);
      if (!isNaN(eDays) && eDays > 0) {
        whereClause += " AND w.expires_at IS NOT NULL AND w.expires_at <= date('now', '+' || ? || ' days') AND w.expires_at >= date('now')";
        params.push(eDays);
      }
    }
    if (person_id) { whereClause += ' AND w.subject_person_id = ?'; params.push(person_id); }
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
        (p.first_name || ' ' || p.last_name) as subject_name,
        u.full_name as entered_by_name,
        (SELECT COUNT(*) FROM warrant_service_attempts WHERE warrant_id = w.id) as service_attempt_count
      FROM warrants w
      LEFT JOIN persons p ON w.subject_person_id = p.id
      LEFT JOIN users u ON w.entered_by = u.id
      ${whereClause}
      ORDER BY w.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, perPageNum, offset);

    return c.json({
      data: warrants,
      pagination: { page: pageNum, per_page: perPageNum, total: countRow?.total ?? 0, totalPages: Math.ceil((countRow?.total ?? 0) / perPageNum) },
    });
  });

  // GET /api/warrants/dashboard/stats
  api.get('/dashboard/stats', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const totalActive = (await db.prepare("SELECT COUNT(*) as cnt FROM warrants WHERE status = 'active' AND archived_at IS NULL").get() as any)?.cnt || 0;
      const totalServed30d = (await db.prepare("SELECT COUNT(*) as cnt FROM warrants WHERE status = 'served' AND served_at >= datetime('now', '-30 days', 'localtime')").get() as any)?.cnt || 0;
      const typeRows = await db.prepare("SELECT type, COUNT(*) as cnt FROM warrants WHERE status = 'active' AND archived_at IS NULL GROUP BY type").all() as any[];
      const total_by_type: Record<string, number> = { arrest: 0, bench: 0, search: 0, civil: 0 };
      for (const r of typeRows) total_by_type[r.type] = r.cnt;
      const avgAge = (await db.prepare("SELECT AVG(julianday('now','localtime') - julianday(created_at)) as avg_days FROM warrants WHERE status = 'active' AND archived_at IS NULL").get() as any)?.avg_days || 0;
      const hitsToday = (await db.prepare("SELECT COUNT(*) as cnt FROM warrant_watch_log WHERE event = 'warrant_found' AND created_at >= date('now','localtime')").get() as any)?.cnt || 0;
      const personsFlagged = (await db.prepare("SELECT COUNT(DISTINCT subject_person_id) as cnt FROM warrants WHERE status = 'active' AND subject_person_id IS NOT NULL AND archived_at IS NULL").get() as any)?.cnt || 0;
      const servedMonth = (await db.prepare("SELECT COUNT(*) as cnt FROM warrants WHERE status = 'served' AND served_at >= date('now','start of month','localtime')").get() as any)?.cnt || 0;
      const totalAll30d = totalActive + totalServed30d;
      const clearanceRate = totalAll30d > 0 ? Math.round((totalServed30d / totalAll30d) * 100) : 0;
      return c.json({
        activeWarrants: totalActive, hitsToday, personsFlagged, sourcesOnline: 0, sourcesTotal: 0,
        total_active: totalActive, total_served_30d: totalServed30d, total_by_type,
        avg_age_days: Math.round(avgAge), served_this_month: servedMonth, clearance_rate_30d: clearanceRate,
      });
    } catch {
      return c.json({ error: 'Failed to get dashboard stats', code: 'DASHBOARD_STATS_ERROR' }, 500);
    }
  });

  // GET /api/warrants/dashboard/feed
  api.get('/dashboard/feed', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const range = c.req.query('range') || '24h';
      let rangeClause = "datetime('now', '-1 day', 'localtime')";
      if (range === '1h') rangeClause = "datetime('now', '-1 hour', 'localtime')";
      else if (range === '8h') rangeClause = "datetime('now', '-8 hours', 'localtime')";
      else if (range === '7d') rangeClause = "datetime('now', '-7 days', 'localtime')";
      const feed = await db.prepare(`
        SELECT 'watch' as feed_source, wl.id, wl.person_name, wl.event, wl.charges, wl.court_name as court, wl.utah_warrant_id as source_id, wl.created_at as timestamp
        FROM warrant_watch_log wl WHERE wl.created_at >= ${rangeClause}
        UNION ALL
        SELECT 'activity' as feed_source, al.id, COALESCE(u.full_name, 'System') as person_name, al.action as event, al.details as charges, NULL as court, CAST(al.entity_id AS TEXT) as source_id, al.created_at as timestamp
        FROM activity_log al LEFT JOIN users u ON al.user_id = u.id
        WHERE al.entity_type = 'warrant' AND al.created_at >= ${rangeClause}
        ORDER BY timestamp DESC LIMIT 100
      `).all();
      return c.json({ data: feed });
    } catch {
      return c.json({ error: 'Failed to get dashboard feed', code: 'DASHBOARD_FEED_ERROR' }, 500);
    }
  });

  // GET /api/warrants/dashboard/priority
  api.get('/dashboard/priority', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const warrants = await db.prepare(`
        SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name,
          (p.first_name || ' ' || p.last_name) as subject_name, p.photo_url as subject_photo_url
        FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id
        WHERE w.status = 'active' AND w.archived_at IS NULL
        ORDER BY w.priority_score DESC, w.created_at ASC LIMIT 50
      `).all();
      return c.json({ data: warrants });
    } catch {
      return c.json({ error: 'Failed to get priority warrants', code: 'PRIORITY_WARRANTS_ERROR' }, 500);
    }
  });

  // GET /api/warrants/expiring — Active warrants expiring within N days
  api.get('/expiring', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const days = parseInt(c.req.query('days') || '30', 10);
      const warrants = await db.prepare(`
        SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name,
          (p.first_name || ' ' || p.last_name) as subject_name
        FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id
        WHERE w.status = 'active' AND w.expires_at IS NOT NULL
          AND w.expires_at <= date('now', '+' || ? || ' days')
          AND w.expires_at >= date('now')
        ORDER BY w.expires_at ASC
      `).all(days);
      return c.json({ data: warrants, count: warrants.length });
    } catch {
      return c.json({ error: 'Failed to get expiring warrants', code: 'EXPIRING_ERROR' }, 500);
    }
  });

  // GET /api/warrants/expired — Active warrants that have already expired
  api.get('/expired', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const warrants = await db.prepare(`
        SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name
        FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id
        WHERE w.status = 'active' AND w.expires_at IS NOT NULL AND w.expires_at < date('now')
        ORDER BY w.expires_at ASC
      `).all();
      return c.json({ data: warrants, count: warrants.length });
    } catch {
      return c.json({ error: 'Failed to get expired warrants', code: 'EXPIRED_ERROR' }, 500);
    }
  });

  // GET /api/warrants/national-coverage
  api.get('/national-coverage', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const sources = await db.prepare(`
        SELECT state, source_key, display_name, source_type, enabled, last_scrape_at, consecutive_errors, circuit_broken
        FROM warrant_scraper_config ORDER BY state, source_key
      `).all() as any[];
      const warrantCounts = await db.prepare("SELECT state, COUNT(*) as count FROM scraped_warrants WHERE status = 'active' GROUP BY state").all() as any[];
      const warrantMap: Record<string, number> = {};
      for (const row of warrantCounts) warrantMap[row.state] = row.count;
      const stateStatus: Record<string, string> = {};
      const stateSources: Record<string, number> = {};
      const stateWarrants: Record<string, number> = {};
      for (const src of sources) {
        const st = src.state;
        if (!st) continue;
        stateSources[st] = (stateSources[st] || 0) + 1;
        stateWarrants[st] = warrantMap[st] || 0;
        if (src.enabled && !src.circuit_broken) {
          if (stateWarrants[st] > 0 || src.last_scrape_at) stateStatus[st] = 'active';
          else if (!stateStatus[st] || stateStatus[st] === 'disabled') stateStatus[st] = 'pending';
        } else if (!stateStatus[st]) stateStatus[st] = 'disabled';
      }
      const statesCovered = Object.values(stateStatus).filter(s => s === 'active').length;
      const totalWarrants = Object.values(stateWarrants).reduce((a, b) => a + b, 0);
      return c.json({ sources: sources.length, states_covered: statesCovered, active_warrants: totalWarrants, state_status: stateStatus, state_sources: stateSources, state_warrants: stateWarrants });
    } catch {
      return c.json({ error: 'Failed to get national coverage', code: 'NATIONAL_COVERAGE_ERROR' }, 500);
    }
  });

  // POST /api/warrants/national-search
  api.post('/national-search', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { first_name, last_name, dob, state, offense_level, warrant_type, charge_keyword } = await c.req.json();
      if (!first_name && !last_name && !charge_keyword) {
        return c.json({ error: 'At least a name or charge keyword is required', code: 'SEARCH_PARAMS_REQUIRED' }, 400);
      }
      const conditions: string[] = ["sw.status = 'active'"];
      const params: any[] = [];
      if (first_name) { conditions.push("sw.first_name LIKE ?"); params.push(`%${first_name}%`); }
      if (last_name) { conditions.push("sw.last_name LIKE ?"); params.push(`%${last_name}%`); }
      if (dob) { conditions.push("sw.date_of_birth = ?"); params.push(dob); }
      if (state) { conditions.push("sw.state = ?"); params.push(state); }
      if (offense_level) { conditions.push("sw.offense_level = ?"); params.push(offense_level); }
      if (warrant_type) { conditions.push("sw.warrant_type = ?"); params.push(warrant_type); }
      if (charge_keyword) { conditions.push("sw.charge_description LIKE ?"); params.push(`%${charge_keyword}%`); }
      const localRows = await db.prepare(`
        SELECT sw.*, wsc.display_name as source_display_name, 'local' as search_source
        FROM scraped_warrants sw LEFT JOIN warrant_scraper_config wsc ON sw.source_key = wsc.source_key
        WHERE ${conditions.join(' AND ')}
        ORDER BY sw.state, sw.last_name, sw.first_name LIMIT 500
      `).all(...params);
      return c.json({ results: localRows, live_results: [], errors: [], search_source: 'local' });
    } catch {
      return c.json({ error: 'National search failed', code: 'NATIONAL_SEARCH_ERROR' }, 500);
    }
  });

  // GET /api/warrants/:id — MUST be defined AFTER all static routes
  api.get('/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const warrant = await db.prepare('SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name, u.full_name as entered_by_name FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id LEFT JOIN users u ON w.entered_by = u.id WHERE w.id = ?').get(id);
    if (!warrant) return c.json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }, 404);
    return c.json(warrant);
  });

  // POST /api/warrants - Create warrant
  api.post('/', requireRole('dispatcher', 'supervisor', 'admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const body = await c.req.json();
    const { type, subject_person_id, issuing_court, issuing_judge, charge_description, bail_amount, offense_level, expires_at, notes, statute_id, statute_citation } = body;

    if (!type) return c.json({ error: 'type is required', code: 'TYPE_IS_REQUIRED' }, 400);
    if (!charge_description) return c.json({ error: 'charge_description is required', code: 'CHARGEDESCRIPTION_IS_REQUIRED' }, 400);

    const normalizedType = String(type).toLowerCase();

    if (subject_person_id) {
      const person = await db.prepare('SELECT * FROM persons WHERE id = ?').get(subject_person_id);
      if (!person) return c.json({ error: 'Subject person not found', code: 'SUBJECT_PERSON_NOT_FOUND' }, 404);
    }

    const result = await db.prepare(`
      INSERT INTO warrants (type, status, subject_person_id, issuing_court, issuing_judge,
        charge_description, bail_amount, offense_level, entered_by,
        expires_at, notes, statute_id, statute_citation)
      VALUES (?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalizedType, subject_person_id || null, issuing_court || null, issuing_judge || null,
      charge_description, bail_amount || null, offense_level || null, user.userId,
      expires_at || null, notes || null, statute_id || null, statute_citation || null,
    );

    const warrantId = Number(result.meta.last_row_id);
    const currentYear = new Date().getFullYear();
    const warrantNumber = `WRN-${currentYear}-${String(warrantId).padStart(5, '0')}`;
    await db.prepare('UPDATE warrants SET warrant_number = ? WHERE id = ?').run(warrantNumber, warrantId);

    const warrant = await db.prepare(`
      SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name,
        (p.first_name || ' ' || p.last_name) as subject_name, u.full_name as entered_by_name
      FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id
      LEFT JOIN users u ON w.entered_by = u.id WHERE w.id = ?
    `).get(warrantId);

    await auditLog(db, c, 'warrant_created', 'warrant', warrantId, `Created warrant ${warrantNumber}: ${type} - ${charge_description}`);
    return c.json(warrant, 201);
  });

  // POST /api/warrants/:id/archive
  api.post('/:id/archive', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const warrant = await db.prepare('SELECT * FROM warrants WHERE id = ?').get(id) as any;
    if (!warrant) return c.json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }, 404);
    if (warrant.archived_at) return c.json({ error: 'Warrant is already archived', code: 'WARRANT_IS_ALREADY_ARCHIVED' }, 400);

    const now = localNow();
    await db.prepare('UPDATE warrants SET archived_at = ? WHERE id = ?').run(now, id);
    await auditLog(db, c, 'warrant_archived', 'warrant', id, `Archived warrant ${warrant.warrant_number}`);

    const updated = await db.prepare(`
      SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name,
        (p.first_name || ' ' || p.last_name) as subject_name, u.full_name as entered_by_name
      FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id
      LEFT JOIN users u ON w.entered_by = u.id WHERE w.id = ?
    `).get(id);
    return c.json(updated);
  });

  // POST /api/warrants/:id/unarchive
  api.post('/:id/unarchive', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const warrant = await db.prepare('SELECT * FROM warrants WHERE id = ?').get(id) as any;
    if (!warrant) return c.json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }, 404);
    if (!warrant.archived_at) return c.json({ error: 'Warrant is not archived', code: 'WARRANT_IS_NOT_ARCHIVED' }, 400);

    await db.prepare('UPDATE warrants SET archived_at = NULL WHERE id = ?').run(id);
    await auditLog(db, c, 'warrant_unarchived', 'warrant', id, `Unarchived warrant ${warrant.warrant_number}`);

    const updated = await db.prepare(`
      SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name,
        (p.first_name || ' ' || p.last_name) as subject_name, u.full_name as entered_by_name
      FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id
      LEFT JOIN users u ON w.entered_by = u.id WHERE w.id = ?
    `).get(id);
    return c.json(updated);
  });

  app.route('/api/warrants', api);
}
