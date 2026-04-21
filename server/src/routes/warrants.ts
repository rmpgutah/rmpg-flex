import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcast, broadcastDispatchUpdate } from '../utils/websocket';
import { localNow } from '../utils/timeUtils';
import { universalWarrantCheck, runUniversalWarrantScan } from '../utils/universalWarrantScanner';
import { getUtahWarrantSyncStatus, isUtahApiBlocked, runWarrantWatchScan, searchUtahWarrantsLive, searchUtahWarrantsCache } from '../utils/utahWarrantScraper';
import { getSourceMetrics, getHealthSummary } from '../utils/scraperMetrics';
import { paramStr } from '../utils/reqHelpers';

const router = Router();

// All warrant routes require authentication
router.use(authenticateToken);

// GET /api/warrants - List warrants with filters
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      status,
      type,
      severity,
      source,
      subject_name,
      archived,
      court,
      charge,
      date_from,
      date_to,
      expiring_days,
      person_id,
      page = '1',
      per_page = '100000',
    } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (status) {
      whereClause += ' AND w.status = ?';
      params.push(status);
    }
    if (type) {
      whereClause += ' AND w.type = ?';
      params.push(type);
    }
    if (severity) {
      whereClause += ' AND w.offense_level = ?';
      params.push(severity);
    }
    if (source) {
      whereClause += ' AND COALESCE(w.source, \'manual\') = ?';
      params.push(source);
    }
    if (subject_name) {
      // Search across name, warrant number, AND charge description
      const q = `%${subject_name}%`;
      whereClause += " AND ((p.first_name || ' ' || p.last_name) LIKE ? OR w.warrant_number LIKE ? OR w.charge_description LIKE ?)";
      params.push(q, q, q);
    }
    if (court) {
      whereClause += ' AND w.issuing_court LIKE ?';
      params.push(`%${court}%`);
    }
    if (charge) {
      whereClause += ' AND w.charge_description LIKE ?';
      params.push(`%${charge}%`);
    }
    if (date_from) {
      whereClause += ' AND w.created_at >= ?';
      params.push(date_from);
    }
    if (date_to) {
      whereClause += ' AND w.created_at <= ?';
      params.push(date_to);
    }
    if (expiring_days) {
      const eDays = parseInt(expiring_days as string, 10);
      if (!isNaN(eDays) && eDays > 0) {
        whereClause += " AND w.expires_at IS NOT NULL AND w.expires_at <= date('now', '+' || ? || ' days') AND w.expires_at >= date('now')";
        params.push(eDays);
      }
    }
    if (person_id) {
      whereClause += ' AND w.subject_person_id = ?';
      params.push(person_id);
    }

    // Archive filter
    if (archived === 'true') {
      whereClause += ' AND w.archived_at IS NOT NULL';
    } else if (archived !== 'all') {
      whereClause += ' AND w.archived_at IS NULL';
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPageNum = Math.min(100000, Math.max(1, (parseInt(per_page as string, 10)) || 100000));
    const offset = (pageNum - 1) * perPageNum;

    const countRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM warrants w
      LEFT JOIN persons p ON w.subject_person_id = p.id
      ${whereClause}
    `).get(...params) as any;

    const warrants = db.prepare(`
      SELECT w.*,
        p.first_name as subject_first_name,
        p.last_name as subject_last_name,
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

    res.json({
      data: warrants,
      pagination: {
        page: pageNum,
        per_page: perPageNum,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / perPageNum),
      },
    });
  } catch (error: any) {
    console.error('Get warrants error:', error);
    res.status(500).json({ error: 'Failed to get warrants', code: 'GET_WARRANTS_ERROR' });
  }
});

// GET /api/warrants/export — Export warrants as CSV
router.get('/export', requireRole('dispatcher', 'supervisor', 'admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const warrants = db.prepare(`
      SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name,
             u.full_name as entered_by_name
      FROM warrants w
      LEFT JOIN persons p ON w.subject_person_id = p.id
      LEFT JOIN users u ON w.entered_by = u.id
      WHERE w.archived_at IS NULL
      ORDER BY w.created_at DESC
    
      LIMIT 1000
    `).all() as any[];

    const headers = ['Warrant Number', 'Type', 'Status', 'Charge', 'Subject Name', 'Offense Level', 'Bail Amount', 'Issuing Court', 'Issuing Judge', 'Entered By', 'Created', 'Expires'];
    const rows = warrants.map((w: any) => [
      w.warrant_number || '',
      w.type || '',
      w.status || '',
      (w.charge_description || '').replace(/"/g, '""'),
      `${w.subject_first_name || ''} ${w.subject_last_name || ''}`.trim(),
      w.offense_level || '',
      w.bail_amount || '',
      w.issuing_court || '',
      w.issuing_judge || '',
      w.entered_by_name || '',
      w.created_at || '',
      w.expires_at || '',
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="warrants_export_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch (error: any) {
    console.error('Export warrants error:', error);
    res.status(500).json({ error: 'Failed to export warrants', code: 'EXPORT_WARRANTS_ERROR' });
  }
});

// GET /api/warrants/check/:personId - Check if person has active warrants
router.get('/check/:personId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const personId = parseInt(req.params.personId as string, 10);
    if (isNaN(personId)) {
      res.status(400).json({ error: 'Invalid person ID', code: 'INVALID_PERSON_ID' });
      return;
    }

    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(personId) as any;
    if (!person) {
      res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });
      return;
    }

    const warrants = db.prepare(`
      SELECT w.*,
        u.full_name as entered_by_name
      FROM warrants w
      LEFT JOIN users u ON w.entered_by = u.id
      WHERE w.subject_person_id = ? AND w.status = 'active'
      ORDER BY w.created_at DESC
    
      LIMIT 1000
    `).all(personId);

    res.json({
      has_warrants: warrants.length > 0,
      count: warrants.length,
      warrants,
    });
  } catch (error: any) {
    console.error('Check warrants error:', error);
    res.status(500).json({ error: 'Failed to check warrants', code: 'CHECK_WARRANTS_ERROR' });
  }
});

// PUT /api/warrants/batch-update — Batch update warrant statuses
router.put('/batch-update', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { ids, status } = req.body;
    const validStatuses = ['active', 'served', 'recalled', 'expired', 'quashed'];
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids array is required', code: 'IDS_ARRAY_IS_REQUIRED' });
      return;
    }
    if (ids.length > 100) {
      res.status(400).json({ error: 'Maximum 100 warrants per batch operation', code: 'MAXIMUM_100_WARRANTS_PER' });
      return;
    }
    // Validate all IDs are numbers
    if (!ids.every((id: any) => typeof id === 'number' && Number.isFinite(id))) {
      res.status(400).json({ error: 'All IDs must be valid numbers', code: 'ALL_IDS_MUST_BE' });
      return;
    }
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}`, code: 'INVALID_STATUS' });
      return;
    }
    const now = localNow();
    const placeholders = ids.map(() => '?').join(',');

    const extraFields = status === 'served'
      ? `, served_by = ?, served_at = ?` : '';
    const extraParams = status === 'served'
      ? [req.user!.userId, now] : [];

    db.prepare(`
      UPDATE warrants SET status = ?, updated_at = ?${extraFields}
      WHERE id IN (${placeholders})
    `).run(status, now, ...extraParams, ...ids);

    // Activity log
    for (const id of ids) {
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'warrant_batch_update', 'warrant', ?, ?, ?)
      `).run(req.user!.userId, id, `Batch status change to ${status}`, req.ip || 'unknown');
    }

    broadcast('alerts', 'warrants_updated', { ids, status });
    res.json({ success: true, updated: ids.length });
  } catch (error: any) {
    console.error('Batch update warrants error:', error);
    res.status(500).json({ error: 'Failed to batch update warrants', code: 'BATCH_UPDATE_WARRANTS_ERROR' });
  }
});

// ══════════════════════════════════════════════════════════════
// Dashboard / Scanner Endpoints
// ══════════════════════════════════════════════════════════════

// GET /api/warrants/dashboard/stats — Dashboard statistics
router.get('/dashboard/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const totalActive = (db.prepare(
      `SELECT COUNT(*) as cnt FROM warrants WHERE status = 'active' AND archived_at IS NULL`
    ).get() as any).cnt;

    // Served in last 30 days
    const totalServed30d = (db.prepare(
      `SELECT COUNT(*) as cnt FROM warrants
       WHERE status = 'served' AND served_at >= datetime('now', '-30 days', 'localtime')`
    ).get() as any).cnt;

    // By type
    const typeRows = db.prepare(
      `SELECT type, COUNT(*) as cnt FROM warrants WHERE status = 'active' AND archived_at IS NULL GROUP BY type`
    ).all() as { type: string; cnt: number }[];
    const total_by_type: Record<string, number> = { arrest: 0, bench: 0, search: 0, civil: 0 };
    for (const r of typeRows) total_by_type[r.type] = r.cnt;

    // By source
    const sourceRows = db.prepare(
      `SELECT COALESCE(source, 'manual') as src, COUNT(*) as cnt FROM warrants WHERE status = 'active' AND archived_at IS NULL GROUP BY src`
    ).all() as { src: string; cnt: number }[];
    const total_by_source: Record<string, number> = { manual: 0, utah_api: 0, scraper: 0 };
    for (const r of sourceRows) total_by_source[r.src] = r.cnt;

    // Average age of active warrants (days)
    const avgAge = (db.prepare(
      `SELECT AVG(julianday('now','localtime') - julianday(created_at)) as avg_days
       FROM warrants WHERE status = 'active' AND archived_at IS NULL`
    ).get() as any)?.avg_days || 0;

    // Oldest and newest active
    const oldest = db.prepare(
      `SELECT id, warrant_number, created_at FROM warrants WHERE status = 'active' AND archived_at IS NULL ORDER BY created_at ASC LIMIT 1`
    ).get() as any;
    const newest = db.prepare(
      `SELECT id, warrant_number, created_at FROM warrants WHERE status = 'active' AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1`
    ).get() as any;

    // Served this calendar month
    const servedMonth = (db.prepare(
      `SELECT COUNT(*) as cnt FROM warrants
       WHERE status = 'served' AND served_at >= date('now','start of month','localtime')`
    ).get() as any).cnt;

    // Clearance rate: served / (served + active) over last 30 days
    const totalAll30d = totalActive + totalServed30d;
    const clearanceRate = totalAll30d > 0 ? Math.round((totalServed30d / totalAll30d) * 100) : 0;

    // Hits today (new warrants found by scanner today)
    const hitsToday = (db.prepare(
      `SELECT COUNT(*) as cnt FROM warrant_watch_log
       WHERE event = 'warrant_found' AND created_at >= date('now','localtime')`
    ).get() as any).cnt;

    // Persons flagged with active warrants
    const personsFlagged = (db.prepare(
      `SELECT COUNT(DISTINCT subject_person_id) as cnt FROM warrants
       WHERE status = 'active' AND subject_person_id IS NOT NULL AND archived_at IS NULL`
    ).get() as any).cnt;

    // Source counts
    const scraperSourceCount = (db.prepare(
      `SELECT COUNT(*) as cnt FROM warrant_scraper_config`
    ).get() as any).cnt;
    const scraperOnlineCount = (db.prepare(
      `SELECT COUNT(*) as cnt FROM warrant_scraper_config WHERE enabled = 1 AND last_error IS NULL`
    ).get() as any).cnt;
    // +1 for Utah API (always counts as a source)
    const sourcesTotal = scraperSourceCount + 1;
    const sourcesOnline = scraperOnlineCount + (isUtahApiBlocked() ? 0 : 1);

    res.json({
      // Client-expected fields
      activeWarrants: totalActive,
      hitsToday,
      personsFlagged,
      sourcesOnline,
      sourcesTotal,
      // Extended fields
      total_active: totalActive,
      total_served_30d: totalServed30d,
      total_by_type,
      total_by_source,
      avg_age_days: Math.round(avgAge),
      oldest_active: oldest || null,
      newest_active: newest || null,
      served_this_month: servedMonth,
      clearance_rate_30d: clearanceRate,
    });
  } catch (error: any) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to get dashboard stats', code: 'DASHBOARD_STATS_ERROR' });
  }
});

// GET /api/warrants/dashboard/feed — Recent warrant activity feed
router.get('/dashboard/feed', (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Parse range parameter (1h, 8h, 24h, 7d)
    const range = (req.query.range as string) || '24h';
    let rangeClause = "datetime('now', '-1 day', 'localtime')";
    if (range === '1h') rangeClause = "datetime('now', '-1 hour', 'localtime')";
    else if (range === '8h') rangeClause = "datetime('now', '-8 hours', 'localtime')";
    else if (range === '24h') rangeClause = "datetime('now', '-1 day', 'localtime')";
    else if (range === '7d') rangeClause = "datetime('now', '-7 days', 'localtime')";

    // Combine warrant_watch_log + activity_log warrant entries
    const feed = db.prepare(`
      SELECT
        'watch' as feed_source,
        wl.id,
        wl.person_name,
        wl.event,
        wl.charges,
        wl.court_name as court,
        wl.utah_warrant_id as source_id,
        wl.created_at as timestamp
      FROM warrant_watch_log wl
      WHERE wl.created_at >= ${rangeClause}
      UNION ALL
      SELECT
        'activity' as feed_source,
        al.id,
        COALESCE(u.full_name, 'System') as person_name,
        al.action as event,
        al.details as charges,
        NULL as court,
        CAST(al.entity_id AS TEXT) as source_id,
        al.created_at as timestamp
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = 'warrant' AND al.created_at >= ${rangeClause}
      ORDER BY timestamp DESC
      LIMIT 100
    `).all();

    res.json({ data: feed });
  } catch (error: any) {
    console.error('Dashboard feed error:', error);
    res.status(500).json({ error: 'Failed to get dashboard feed', code: 'DASHBOARD_FEED_ERROR' });
  }
});

// GET /api/warrants/dashboard/priority — High priority warrants
router.get('/dashboard/priority', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const warrants = db.prepare(`
      SELECT w.*,
        p.first_name as subject_first_name,
        p.last_name as subject_last_name,
        (p.first_name || ' ' || p.last_name) as subject_name,
        p.photo_url as subject_photo_url
      FROM warrants w
      LEFT JOIN persons p ON w.subject_person_id = p.id
      WHERE w.status = 'active' AND w.archived_at IS NULL
      ORDER BY
        CASE w.offense_level
          WHEN 'felony' THEN 0
          WHEN 'misdemeanor' THEN 1
          WHEN 'infraction' THEN 2
          WHEN 'civil' THEN 3
          ELSE 4
        END,
        w.created_at ASC
      LIMIT 20
    `).all();

    res.json({ data: warrants });
  } catch (error: any) {
    console.error('Priority warrants error:', error);
    res.status(500).json({ error: 'Failed to get priority warrants', code: 'PRIORITY_WARRANTS_ERROR' });
  }
});

// GET /api/warrants/unified — Merged warrants from all sources
router.get('/unified', (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Local warrants — fetch all (filtering done client-side below)
    const fArchived = req.query.archived;
    let localWhere = 'WHERE 1=1';
    if (fArchived === 'true') {
      localWhere += ' AND w.archived_at IS NOT NULL';
    } else if (fArchived !== 'all') {
      localWhere += ' AND w.archived_at IS NULL';
    }
    const localWarrants = db.prepare(`
      SELECT w.*,
        p.first_name as subject_first_name,
        p.last_name as subject_last_name,
        (p.first_name || ' ' || p.last_name) as subject_name,
        u.full_name as entered_by_name,
        COALESCE(w.source, 'manual') as source
      FROM warrants w
      LEFT JOIN persons p ON w.subject_person_id = p.id
      LEFT JOIN users u ON w.entered_by = u.id
      ${localWhere}
      ORDER BY w.created_at DESC

      LIMIT 2000
    `).all() as any[];

    // Scraped warrants not already linked to a local record
    const scrapedWarrants = db.prepare(`
      SELECT
        sw.id,
        sw.full_name as subject_name,
        sw.first_name as subject_first_name,
        sw.last_name as subject_last_name,
        sw.warrant_type as type,
        'active' as status,
        sw.charge_description,
        sw.court_name as issuing_court,
        sw.bail_amount,
        sw.offense_level,
        sw.issue_date as created_at,
        sw.source_key,
        'scraper' as source,
        ('scraper:' || sw.source_key || ':' || sw.warrant_id) as external_warrant_id
      FROM scraped_warrants sw
      WHERE sw.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM warrants w
          WHERE w.external_warrant_id = ('scraper:' || sw.source_key || ':' || sw.warrant_id)
        )
    
      LIMIT 1000
    `).all() as any[];

    // Utah cached warrants not already linked
    const utahCached = db.prepare(`
      SELECT
        uw.id,
        (uw.first_name || ' ' || uw.last_name) as subject_name,
        uw.first_name as subject_first_name,
        uw.last_name as subject_last_name,
        'arrest' as type,
        'active' as status,
        uw.charges as charge_description,
        uw.court_name as issuing_court,
        NULL as bail_amount,
        NULL as offense_level,
        uw.issue_date as created_at,
        'utah_api' as source_key,
        'utah_api' as source,
        ('utah_api:' || uw.utah_warrant_id) as external_warrant_id
      FROM utah_warrants uw
      WHERE NOT EXISTS (
        SELECT 1 FROM warrants w
        WHERE w.external_warrant_id = ('utah_api:' || uw.utah_warrant_id)
      )
    
      LIMIT 1000
    `).all() as any[];

    // Deduplicate by external_warrant_id
    const seen = new Set<string>();
    const unified: any[] = [];

    for (const w of localWarrants) {
      if (w.external_warrant_id) seen.add(w.external_warrant_id);
      unified.push(w);
    }
    for (const w of [...scrapedWarrants, ...utahCached]) {
      if (w.external_warrant_id && seen.has(w.external_warrant_id)) continue;
      if (w.external_warrant_id) seen.add(w.external_warrant_id);
      unified.push(w);
    }

    // Apply filters from query params
    let filtered = unified;
    const { status: fStatus, type: fType, source: fSource, severity, subject_name: fName } = req.query;
    if (fStatus) filtered = filtered.filter((w: any) => w.status === fStatus);
    if (fType) filtered = filtered.filter((w: any) => w.type === fType);
    if (fSource) filtered = filtered.filter((w: any) => w.source === fSource);
    if (severity) filtered = filtered.filter((w: any) => w.offense_level === severity);
    if (fName) {
      const nameQ = String(fName).toLowerCase();
      filtered = filtered.filter((w: any) =>
        (w.subject_name || '').toLowerCase().includes(nameQ) ||
        (w.subject_first_name || '').toLowerCase().includes(nameQ) ||
        (w.subject_last_name || '').toLowerCase().includes(nameQ) ||
        (w.warrant_number || '').toLowerCase().includes(nameQ) ||
        (w.charge_description || '').toLowerCase().includes(nameQ)
      );
    }
    // Archive filtering already applied in SQL for local warrants;
    // scraped/utah are never archived, so no further filtering needed

    // Pagination
    const pageNum = parseInt(req.query.page as string, 10) || 1;
    const perPage = Math.min(100000, Math.max(1, (parseInt(req.query.per_page as string, 10)) || 100000));
    const total = filtered.length;
    const paged = filtered.slice((pageNum - 1) * perPage, pageNum * perPage);

    res.json({ warrants: paged, total });
  } catch (error: any) {
    console.error('Unified warrants error:', error);
    res.status(500).json({ error: 'Failed to get unified warrants', code: 'UNIFIED_WARRANTS_ERROR' });
  }
});

// GET /api/warrants/person/:personId/profile — Person profile with warrant info
router.get('/person/:personId/profile', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { personId } = req.params;

    const person = db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM warrants w WHERE w.subject_person_id = p.id AND w.status = 'active') as active_warrant_count,
        (SELECT COUNT(*) FROM warrants w WHERE w.subject_person_id = p.id) as total_warrant_count
      FROM persons p WHERE p.id = ?
    `).get(personId) as any;

    if (!person) {
      res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });
      return;
    }

    const warrants = db.prepare(`
      SELECT w.*, u.full_name as entered_by_name
      FROM warrants w
      LEFT JOIN users u ON w.entered_by = u.id
      WHERE w.subject_person_id = ?
      ORDER BY w.status = 'active' DESC, w.created_at DESC
    
      LIMIT 1000
    `).all(personId);

    // Scan history from warrant_watch_log
    const scanHistory = db.prepare(`
      SELECT id, event, charges as details, created_at
      FROM warrant_watch_log
      WHERE person_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(personId);

    // Last checked time
    const lastCheckedRow = db.prepare(`
      SELECT created_at FROM warrant_watch_log
      WHERE person_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(personId) as { created_at: string } | undefined;

    res.json({
      person,
      warrants,
      scanHistory,
      lastChecked: lastCheckedRow?.created_at || null,
    });
  } catch (error: any) {
    console.error('Person warrant profile error:', error);
    res.status(500).json({ error: 'Failed to get person warrant profile', code: 'PERSON_WARRANT_PROFILE_ERROR' });
  }
});

// GET /api/warrants/scraped/status — Scraper source status
router.get('/scraped/status', (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Get scraper configs and their stats
    const sources = db.prepare(`
      SELECT
        wsc.id,
        wsc.source_key,
        wsc.source_name,
        wsc.source_url,
        wsc.enabled,
        wsc.last_run_at,
        wsc.last_error,
        (SELECT COUNT(*) FROM scraped_warrants sw WHERE sw.source_key = wsc.source_key AND sw.status = 'active') as active_count,
        (SELECT COUNT(*) FROM scraped_warrants sw WHERE sw.source_key = wsc.source_key) as total_count
      FROM warrant_scraper_config wsc
      ORDER BY wsc.source_name
    `).all();

    // Add Utah API as a virtual source
    const utahStatus = getUtahWarrantSyncStatus();
    const utahBlocked = isUtahApiBlocked();

    const allSources = [
      {
        id: 0,
        source_key: 'utah_api',
        source_name: 'Utah State Warrants (warrants.utah.gov)',
        source_url: 'https://warrants.utah.gov',
        enabled: true,
        last_run_at: utahStatus.lastSync,
        last_error: utahBlocked ? 'IP temporarily blocked by CloudFront WAF' : null,
        active_count: utahStatus.warrantCount,
        total_count: utahStatus.warrantCount,
        status: utahBlocked ? 'blocked' : utahStatus.status,
      },
      ...sources,
    ];

    res.json({ data: allSources });
  } catch (error: any) {
    console.error('Scraped status error:', error);
    res.status(500).json({ error: 'Failed to get scraped status', code: 'SCRAPED_STATUS_ERROR' });
  }
});

// GET /api/warrants/watch/runs — Warrant watch scan run history
router.get('/watch/runs', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(100000, Math.max(1, (parseInt(req.query.limit as string, 10)) || 100000));

    const runs = db.prepare(`
      SELECT * FROM warrant_watch_runs
      ORDER BY started_at DESC
      LIMIT ?
    `).all(limit);

    res.json({ data: runs });
  } catch (error: any) {
    console.error('Watch runs error:', error);
    res.status(500).json({ error: 'Failed to get watch runs', code: 'WATCH_RUNS_ERROR' });
  }
});

// POST /api/warrants/watch/scan — Trigger a warrant watch scan (admin only)
router.post('/watch/scan', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    // Run in background — don't await
    runWarrantWatchScan().catch((err: any) => {
      console.error('[Warrant Watch] Manual trigger failed:', err.message || err);
    });

    // Log the manual trigger
    const db = getDb();
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'warrant_watch_scan_triggered', 'system', 0, 'Manual warrant watch scan triggered', ?)
    `).run(req.user!.userId, req.ip || 'unknown');

    res.json({ message: 'Warrant watch scan started', started_at: localNow() });
  } catch (error: any) {
    console.error('Trigger watch scan error:', error);
    res.status(500).json({ error: 'Failed to trigger watch scan', code: 'TRIGGER_WATCH_SCAN_ERROR' });
  }
});

// POST /api/warrants/check/:personId — Manual warrant check against all sources
router.post('/check/:personId', (req: Request, res: Response) => {
  (async () => {
    try {
      const personId = parseInt(req.params.personId as string, 10);
      if (isNaN(personId)) {
        res.status(400).json({ error: 'Invalid person ID', code: 'INVALID_PERSON_ID' });
        return;
      }

      const result = await universalWarrantCheck(personId, true);
      res.json({
        hitsFound: result.hitsFound,
        warrantsCreated: result.warrantsCreated,
        warrantsCleared: result.warrantsCleared,
        errors: result.errors,
        personName: result.personName,
      });
    } catch (error: any) {
      console.error('Manual warrant check error:', error);
      res.status(500).json({ error: 'Failed to perform manual warrant check', code: 'MANUAL_WARRANT_CHECK_ERROR' });
    }
  })();
});

// GET /api/warrants/scan/status — Scanner status
router.get('/scan/status', (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Last completed scan run
    const lastRun = db.prepare(
      `SELECT * FROM warrant_watch_runs ORDER BY started_at DESC LIMIT 1`
    ).get() as any;

    const utahStatus = getUtahWarrantSyncStatus();
    const utahBlocked = isUtahApiBlocked();

    // Next scan estimate: last run + 4 hours
    let nextScan: string | null = null;
    if (lastRun?.completed_at) {
      const last = new Date(lastRun.completed_at);
      nextScan = new Date(last.getTime() + 4 * 60 * 60 * 1000).toISOString();
    }

    res.json({
      lastScan: lastRun || null,
      nextScan,
      status: lastRun?.status || 'idle',
      warrantWatchEnabled: true,
      utahApiBlocked: utahBlocked,
      utahCache: utahStatus,
    });
  } catch (error: any) {
    console.error('Scan status error:', error);
    res.status(500).json({ error: 'Failed to get scan status', code: 'SCAN_STATUS_ERROR' });
  }
});

// POST /api/warrants/scan/trigger — Manually trigger a full scan (admin only)
router.post('/scan/trigger', requireRole('admin'), (req: Request, res: Response) => {
  try {
    // Run in background — don't await
    runWarrantWatchScan().catch((err: any) => {
      console.error('[Warrant Scan] Manual trigger failed:', err.message || err);
    });

    // Log the manual trigger
    const db = getDb();
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'warrant_scan_triggered', 'system', 0, 'Manual warrant scan triggered', ?)
    `).run(req.user!.userId, req.ip || 'unknown');

    res.json({ message: 'Scan started', started_at: localNow() });
  } catch (error: any) {
    console.error('Trigger scan error:', error);
    res.status(500).json({ error: 'Failed to trigger scan', code: 'TRIGGER_SCAN_ERROR' });
  }
});

// ── National Warrant Coverage ───────────────────────────
// GET /api/warrants/national-coverage
// Returns per-state coverage stats for the US map
// IMPORTANT: Must be defined BEFORE /:id route to avoid param capture
router.get('/national-coverage', (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Get source config grouped by state
    const sources = db.prepare(`
      SELECT state, source_key, display_name, source_type, enabled,
             last_scrape_at, consecutive_errors, circuit_broken
      FROM warrant_scraper_config
      ORDER BY state, source_key
    `).all() as any[];

    // Get warrant counts per state from scraped_warrants
    const warrantCounts = db.prepare(`
      SELECT state, COUNT(*) as count
      FROM scraped_warrants
      WHERE status = 'active'
      GROUP BY state
    `).all() as { state: string; count: number }[];

    const warrantMap: Record<string, number> = {};
    for (const row of warrantCounts) {
      warrantMap[row.state] = row.count;
    }

    // Build per-state status
    const stateStatus: Record<string, string> = {};
    const stateSources: Record<string, number> = {};
    const stateWarrants: Record<string, number> = {};

    for (const src of sources) {
      const st = src.state;
      if (!st) continue;
      stateSources[st] = (stateSources[st] || 0) + 1;
      stateWarrants[st] = warrantMap[st] || 0;

      // Determine status: active (enabled + has data or recently scraped), pending (enabled, no data yet), disabled
      if (src.enabled && !src.circuit_broken) {
        if (stateWarrants[st] > 0 || src.last_scrape_at) {
          stateStatus[st] = 'active';
        } else if (!stateStatus[st] || stateStatus[st] === 'disabled') {
          stateStatus[st] = 'pending';
        }
      } else if (!stateStatus[st]) {
        stateStatus[st] = 'disabled';
      }
    }

    const statesCovered = Object.values(stateStatus).filter(s => s === 'active').length;
    const totalWarrants = Object.values(stateWarrants).reduce((a, b) => a + b, 0);

    res.json({
      sources: sources.length,
      states_covered: statesCovered,
      active_warrants: totalWarrants,
      state_status: stateStatus,
      state_sources: stateSources,
      state_warrants: stateWarrants,
    });
  } catch (error: any) {
    console.error('National coverage error:', error);
    res.status(500).json({ error: 'Failed to get national coverage', code: 'NATIONAL_COVERAGE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// ⚠️  ROUTE ORDER SENSITIVE — /:id below is parameterized and greedy.
// All /scrapers/* routes MUST appear ABOVE router.get('/:id', ...).
// See CLAUDE.md "Express Route Ordering" rule.
// ═══════════════════════════════════════════════════════════════

// GET /api/warrants/scrapers/health — cheap summary for header badge
// MUST be defined BEFORE /scrapers/:source_key to avoid "health" matching :source_key
router.get('/scrapers/health', (req: Request, res: Response) => {
  try {
    res.json(getHealthSummary());
  } catch (err: any) {
    console.error('GET /scrapers/health error:', err);
    res.status(500).json({ error: 'Failed to fetch health', code: 'FETCH_HEALTH_ERROR' });
  }
});

// GET /api/warrants/scrapers/metrics/summary?window=24
// Also defined BEFORE /scrapers/:source_key for the same reason.
router.get('/scrapers/metrics/summary', (req: Request, res: Response) => {
  try {
    const window = Math.max(1, Math.min(720, parseInt((req.query.window as string) || '24', 10) || 24));
    const db = getDb();
    const sources = db.prepare('SELECT source_key FROM warrant_scraper_config WHERE enabled = 1').all() as { source_key: string }[];
    const all = sources.map(s => getSourceMetrics(s.source_key, window));

    const totalRuns = all.reduce((sum, m) => sum + m.total_runs, 0);
    const totalInserted = all.reduce((sum, m) => sum + m.total_inserted, 0);
    const totalUpdated = all.reduce((sum, m) => sum + m.total_updated, 0);
    const totalSuccess = all.reduce((sum, m) => sum + m.successful_runs + m.unchanged_runs, 0);

    const gradeDist: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    for (const m of all) gradeDist[m.health_grade] = (gradeDist[m.health_grade] ?? 0) + 1;

    res.json({
      window_hours: window,
      total_sources: all.length,
      total_runs: totalRuns,
      total_warrants_inserted: totalInserted,
      total_warrants_updated: totalUpdated,
      avg_success_rate: totalRuns > 0 ? totalSuccess / totalRuns : 0,
      grade_distribution: gradeDist,
    });
  } catch (err: any) {
    console.error('GET /scrapers/metrics/summary error:', err);
    res.status(500).json({ error: 'Failed to fetch summary', code: 'FETCH_SUMMARY_ERROR' });
  }
});

// GET /api/warrants/scrapers — list all sources with 24h metrics
router.get('/scrapers', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const sources = db.prepare(`
      SELECT source_key, display_name, state, county, source_url, source_type,
        enabled, circuit_broken, priority, consecutive_errors,
        last_scrape_at, last_success_at, last_error,
        avg_parse_count, p95_latency_ms,
        (SELECT COUNT(*) FROM scraped_warrants WHERE source_key = warrant_scraper_config.source_key) AS warrant_count
      FROM warrant_scraper_config
      ORDER BY priority, state, county
    `).all() as any[];

    const withMetrics = sources.map(s => ({
      ...s,
      metrics_24h: getSourceMetrics(s.source_key, 24),
    }));
    res.json({ sources: withMetrics });
  } catch (err: any) {
    console.error('GET /scrapers error:', err);
    res.status(500).json({ error: 'Failed to fetch scrapers', code: 'FETCH_SCRAPERS_ERROR' });
  }
});

// GET /api/warrants/scrapers/:source_key — single source with 24h + 7d metrics
router.get('/scrapers/:source_key', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const source = db.prepare('SELECT * FROM warrant_scraper_config WHERE source_key = ?').get(req.params.source_key);
    if (!source) return res.status(404).json({ error: 'Source not found', code: 'SOURCE_NOT_FOUND' });
    res.json({
      ...source,
      metrics_24h: getSourceMetrics(paramStr(req.params.source_key), 24),
      metrics_7d: getSourceMetrics(paramStr(req.params.source_key), 168),
    });
  } catch (err: any) {
    console.error('GET /scrapers/:source_key error:', err);
    res.status(500).json({ error: 'Failed to fetch source', code: 'FETCH_SOURCE_ERROR' });
  }
});

// GET /api/warrants/scrapers/:source_key/runs?limit=50&offset=0
router.get('/scrapers/:source_key/runs', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(100000, Math.max(1, (parseInt((req.query.limit as string) || '50', 10)) || 100000));
    const offset = Math.max(0, parseInt((req.query.offset as string) || '0', 10) || 0);
    const runs = db.prepare(`
      SELECT * FROM warrant_scraper_runs
      WHERE source_key = ?
      ORDER BY started_at DESC
      LIMIT ? OFFSET ?
    `).all(req.params.source_key, limit, offset);
    res.json({ runs });
  } catch (err: any) {
    console.error('GET /scrapers/:source_key/runs error:', err);
    res.status(500).json({ error: 'Failed to fetch runs', code: 'FETCH_RUNS_ERROR' });
  }
});

// ── Scraper action endpoints (admin + manager) ─────────────
// POST /api/warrants/scrapers/bulk — bulk enable/disable/reset/set_priority
// Defined BEFORE /scrapers/:source_key/* routes so "bulk" doesn't match :source_key.
router.post('/scrapers/bulk', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const { action, source_keys, priority } = req.body;
    if (!Array.isArray(source_keys) || source_keys.length === 0) {
      return res.status(400).json({ error: 'source_keys array required', code: 'MISSING_KEYS' });
    }
    if (source_keys.length > 200) {
      return res.status(400).json({ error: 'max 200 sources per bulk op', code: 'TOO_MANY' });
    }

    const db = getDb();
    const placeholders = source_keys.map(() => '?').join(',');
    let result;

    switch (action) {
      case 'enable':
        result = db.prepare(`UPDATE warrant_scraper_config SET enabled = 1 WHERE source_key IN (${placeholders})`).run(...source_keys);
        break;
      case 'disable':
        result = db.prepare(`UPDATE warrant_scraper_config SET enabled = 0 WHERE source_key IN (${placeholders})`).run(...source_keys);
        break;
      case 'reset':
        result = db.prepare(`UPDATE warrant_scraper_config SET consecutive_errors = 0, circuit_broken = 0 WHERE source_key IN (${placeholders})`).run(...source_keys);
        break;
      case 'set_priority': {
        const p = parseInt(priority, 10);
        if (![1, 2, 3, 4].includes(p)) return res.status(400).json({ error: 'priority must be 1-4', code: 'INVALID_PRIORITY' });
        result = db.prepare(`UPDATE warrant_scraper_config SET priority = ? WHERE source_key IN (${placeholders})`).run(p, ...source_keys);
        break;
      }
      default:
        return res.status(400).json({ error: 'action must be enable|disable|reset|set_priority', code: 'INVALID_ACTION' });
    }

    auditLog(req, 'warrant_updated', 'config', 0, `Scraper bulk ${action}: ${source_keys.length} sources`);
    return res.json({ success: true, affected: result.changes });
  } catch (err: any) {
    console.error('POST /scrapers/bulk error:', err);
    return res.status(500).json({ error: 'Bulk op failed', code: 'BULK_ERROR' });
  }
});

// POST /api/warrants/scrapers/:source_key/trigger — force immediate scrape
router.post('/scrapers/:source_key/trigger', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const sourceKey = paramStr(req.params.source_key);
    const db = getDb();
    const exists = db.prepare('SELECT source_key FROM warrant_scraper_config WHERE source_key = ?').get(sourceKey);
    if (!exists) return res.status(404).json({ error: 'Source not found', code: 'SOURCE_NOT_FOUND' });

    // Fire and forget — returns immediately so UI doesn't block on the scrape
    const { syncSource } = await import('../utils/multiStateWarrantScraper');
    syncSource(sourceKey).catch((e: Error) => console.error(`[Manual Trigger] ${String(sourceKey ?? "").replace(/[\r\n]/g, " ").slice(0, 200)}: ${String(e.message ?? "").replace(/[\r\n]/g, " ").slice(0, 200)}`));

    auditLog(req, 'warrant_updated', 'config', 0, `Scraper manually triggered: ${sourceKey}`);
    return res.json({ success: true, source_key: sourceKey, message: 'Scrape initiated' });
  } catch (err: any) {
    console.error('POST /scrapers/:source_key/trigger error:', err);
    return res.status(500).json({ error: 'Trigger failed', code: 'TRIGGER_ERROR' });
  }
});

// POST /api/warrants/scrapers/:source_key/test — dry-run parse (no DB write)
router.post('/scrapers/:source_key/test', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const config = db.prepare('SELECT * FROM warrant_scraper_config WHERE source_key = ?').get(req.params.source_key) as any;
    if (!config) return res.status(404).json({ error: 'Source not found', code: 'SOURCE_NOT_FOUND' });
    if (!config.source_url) return res.status(400).json({ error: 'Source has no URL', code: 'NO_URL' });

    const { parseWithFallback } = await import('../utils/multiStateWarrantScraper');
    const response = await fetch(config.source_url);
    const html = await response.text();
    const result = parseWithFallback(config, html);

    return res.json({
      source_key: req.params.source_key,
      http_status: response.status,
      bytes: html.length,
      parser_used: result.parserUsed,
      drift_signal: result.driftSignal || null,
      entry_count: result.entries.length,
      sample: result.entries.slice(0, 10),
    });
  } catch (err: any) {
    console.error('POST /scrapers/:source_key/test error:', err);
    return res.status(500).json({ error: err.message || 'Test failed', code: 'TEST_ERROR' });
  }
});

// POST /api/warrants/scrapers/:source_key/reset-circuit — clear circuit breaker
router.post('/scrapers/:source_key/reset-circuit', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const result = db.prepare(
      'UPDATE warrant_scraper_config SET consecutive_errors = 0, circuit_broken = 0 WHERE source_key = ?'
    ).run(req.params.source_key);
    if (result.changes === 0) return res.status(404).json({ error: 'Source not found', code: 'SOURCE_NOT_FOUND' });

    auditLog(req, 'warrant_updated', 'config', 0, `Scraper circuit reset: ${req.params.source_key}`);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('POST /scrapers/:source_key/reset-circuit error:', err);
    return res.status(500).json({ error: 'Reset failed', code: 'RESET_ERROR' });
  }
});

// POST /api/warrants/scrapers/:source_key/preview — parse pasted HTML (no DB write, no fetch)
router.post('/scrapers/:source_key/preview', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { html } = req.body;
    if (typeof html !== 'string' || html.length === 0) {
      return res.status(400).json({ error: 'html body required', code: 'MISSING_HTML' });
    }
    if (html.length > 5_000_000) {
      return res.status(413).json({ error: 'html too large (5MB max)', code: 'HTML_TOO_LARGE' });
    }

    const config = getDb().prepare('SELECT * FROM warrant_scraper_config WHERE source_key = ?').get(req.params.source_key) as any;
    if (!config) return res.status(404).json({ error: 'Source not found', code: 'SOURCE_NOT_FOUND' });

    const { parseWithFallback } = await import('../utils/multiStateWarrantScraper');
    const result = parseWithFallback(config, html);

    return res.json({
      parser_used: result.parserUsed,
      drift_signal: result.driftSignal || null,
      entry_count: result.entries.length,
      entries: result.entries,
    });
  } catch (err: any) {
    console.error('POST /scrapers/:source_key/preview error:', err);
    return res.status(500).json({ error: err.message || 'Preview failed', code: 'PREVIEW_ERROR' });
  }
});

// PUT /api/warrants/scrapers/:source_key — update priority/interval/enabled
router.put('/scrapers/:source_key', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const { priority, scrape_interval_minutes, enabled } = req.body;
    const updates: string[] = [];
    const params: any[] = [];

    if (priority !== undefined) {
      const p = parseInt(priority, 10);
      if (![1, 2, 3, 4].includes(p)) return res.status(400).json({ error: 'priority must be 1-4', code: 'INVALID_PRIORITY' });
      updates.push('priority = ?'); params.push(p);
    }
    if (scrape_interval_minutes !== undefined) {
      const m = parseInt(scrape_interval_minutes, 10);
      if (Number.isNaN(m) || m < 5 || m > 1440) return res.status(400).json({ error: 'interval must be 5-1440 min', code: 'INVALID_INTERVAL' });
      updates.push('scrape_interval_minutes = ?'); params.push(m);
    }
    if (enabled !== undefined) {
      updates.push('enabled = ?'); params.push(enabled ? 1 : 0);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update', code: 'NO_UPDATES' });

    params.push(req.params.source_key);
    const result = getDb().prepare(
      `UPDATE warrant_scraper_config SET ${updates.join(', ')} WHERE source_key = ?`
    ).run(...params);
    if (result.changes === 0) return res.status(404).json({ error: 'Source not found', code: 'SOURCE_NOT_FOUND' });

    auditLog(req, 'warrant_updated', 'config', 0, `Scraper config updated: ${req.params.source_key} ${JSON.stringify(req.body)}`);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('PUT /scrapers/:source_key error:', err);
    return res.status(500).json({ error: 'Update failed', code: 'UPDATE_ERROR' });
  }
});

// GET /api/warrants/:id - Get single warrant with details
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const warrant = db.prepare(`
      SELECT w.*,
        p.first_name as subject_first_name,
        p.last_name as subject_last_name,
        p.dob as subject_dob,
        p.gender as subject_gender,
        p.race as subject_race,
        p.height as subject_height,
        p.weight as subject_weight,
        p.hair_color as subject_hair_color,
        p.eye_color as subject_eye_color,
        p.address as subject_address,
        p.photo_url as subject_photo_url,
        (p.first_name || ' ' || p.last_name) as subject_name,
        u_entered.full_name as entered_by_name,
        u_served.full_name as served_by_name
      FROM warrants w
      LEFT JOIN persons p ON w.subject_person_id = p.id
      LEFT JOIN users u_entered ON w.entered_by = u_entered.id
      LEFT JOIN users u_served ON w.served_by = u_served.id
      WHERE w.id = ?
    `).get(req.params.id) as any;

    if (!warrant) {
      res.status(404).json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' });
      return;
    }

    // Get activity log for this warrant
    const activity = db.prepare(`
      SELECT al.*, u.full_name as user_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = 'warrant' AND al.entity_id = ?
      ORDER BY al.created_at DESC
    
      LIMIT 1000
    `).all(warrant.id);

    res.json({
      ...warrant,
      activity,
    });
  } catch (error: any) {
    console.error('Get warrant error:', error);
    res.status(500).json({ error: 'Failed to get warrant', code: 'GET_WARRANT_ERROR' });
  }
});

// POST /api/warrants - Create warrant
router.post('/', requireRole('dispatcher', 'supervisor', 'admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      type,
      subject_person_id,
      issuing_court,
      issuing_judge,
      charge_description,
      bail_amount,
      offense_level,
      expires_at,
      notes,
      statute_id,
      statute_citation,
    } = req.body;

    if (!type) {
      res.status(400).json({ error: 'type is required', code: 'TYPE_IS_REQUIRED' });
      return;
    }
    if (!charge_description) {
      res.status(400).json({ error: 'charge_description is required', code: 'CHARGEDESCRIPTION_IS_REQUIRED' });
      return;
    }

    // Normalize type to lowercase to match CHECK constraint
    const normalizedType = String(type).toLowerCase();

    // Validate subject person exists if provided
    if (subject_person_id) {
      const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(subject_person_id) as any;
      if (!person) {
        res.status(404).json({ error: 'Subject person not found', code: 'SUBJECT_PERSON_NOT_FOUND' });
        return;
      }
    }

    // Insert the warrant
    const result = db.prepare(`
      INSERT INTO warrants (
        type, status, subject_person_id, issuing_court, issuing_judge,
        charge_description, bail_amount, offense_level, entered_by,
        expires_at, notes, statute_id, statute_citation
      ) VALUES (?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalizedType,
      subject_person_id || null,
      issuing_court || null,
      issuing_judge || null,
      charge_description,
      bail_amount || null,
      offense_level || null,
      req.user!.userId,
      expires_at || null,
      notes || null,
      statute_id || null,
      statute_citation || null,
    );

    const warrantId = result.lastInsertRowid;

    // Auto-generate warrant_number: WRN-YYYY-NNNNN
    const currentYear = new Date().getFullYear();
    const warrantNumber = `WRN-${currentYear}-${String(warrantId).padStart(5, '0')}`;

    db.prepare('UPDATE warrants SET warrant_number = ? WHERE id = ?').run(warrantNumber, warrantId);

    const warrant = db.prepare(`
      SELECT w.*,
        p.first_name as subject_first_name,
        p.last_name as subject_last_name,
        (p.first_name || ' ' || p.last_name) as subject_name,
        u.full_name as entered_by_name
      FROM warrants w
      LEFT JOIN persons p ON w.subject_person_id = p.id
      LEFT JOIN users u ON w.entered_by = u.id
      WHERE w.id = ?
    `).get(warrantId) as any;

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'warrant_created', 'warrant', ?, ?, ?)
    `).run(
      req.user!.userId,
      warrantId,
      `Created warrant ${warrantNumber}: ${type} - ${charge_description}`,
      req.ip || 'unknown',
    );

    // Broadcast warrant event
    broadcast('alerts', 'warrant', {
      action: 'created',
      warrant,
    });
    // Dispatcher Brain fan-in (Phase 2): also emit on the dispatch
    // channel with a flat shape the brain's warrant-entered rule
    // consumes. Severity is 'moderate' per design — warrants affect
    // officer safety so they merit a spoken notice.
    broadcastDispatchUpdate({
      action: 'warrant_entered',
      warrant_id: warrantId,
      subject_name: warrant?.subject_name,
      offense_class: warrant?.offense_level ?? warrant?.type,
      bail_amount: warrant?.bail_amount,
    });

    res.status(201).json(warrant);
  } catch (error: any) {
    console.error('Create warrant error:', error);
    res.status(500).json({ error: 'Failed to create warrant', code: 'CREATE_WARRANT_ERROR' });
  }
});

// PUT /api/warrants/:id - Update warrant
router.put('/:id', requireRole('dispatcher', 'supervisor', 'admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    const warrant = db.prepare('SELECT * FROM warrants WHERE id = ?').get(req.params.id) as any;
    if (!warrant) {
      res.status(404).json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' });
      return;
    }

    // God Mode: admin bypass — can update served warrants
    if (req.user?.role !== 'admin') {
      // Only allow updating non-served warrants
      if (warrant.status === 'served') {
        res.status(403).json({ error: 'Cannot update a served warrant', code: 'CANNOT_UPDATE_A_SERVED' });
        return;
      }
    } else if (warrant.status === 'served') {
      auditLog(req, 'ADMIN_OVERRIDE', 'warrant', warrant.id, 'Admin God Mode: bypassed served warrant update restriction');
    }

    // Validate subject person exists if provided
    if (req.body.subject_person_id) {
      const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.body.subject_person_id) as any;
      if (!person) {
        res.status(404).json({ error: 'Subject person not found', code: 'SUBJECT_PERSON_NOT_FOUND' });
        return;
      }
    }

    // Build dynamic SET clause — only update fields explicitly provided
    const bodyKeys = Object.keys(req.body);
    const warrantFields: Record<string, (v: any) => any> = {
      type: v => v || null,
      subject_person_id: v => v || null,
      issuing_court: v => v ?? null,
      issuing_judge: v => v ?? null,
      charge_description: v => v || null,
      bail_amount: v => v ?? null,
      offense_level: v => v ?? null,
      status: v => v || null,
      expires_at: v => v ?? null,
      notes: v => v ?? null,
      statute_id: v => v || null,
      statute_citation: v => v ?? null,
      // God Mode: admin can change warrant number
      ...(req.user?.role === 'admin' ? { warrant_number: (v: any) => v || null } : {}),
    };

    const setClauses: string[] = [];
    const setValues: any[] = [];
    for (const [field, transform] of Object.entries(warrantFields)) {
      if (bodyKeys.includes(field)) {
        setClauses.push(`${field} = ?`);
        setValues.push(transform(req.body[field]));
      }
    }

    if (setClauses.length > 0) {
      setClauses.push("updated_at = ?");
      setValues.push(localNow());
      setValues.push(req.params.id);
      db.prepare(`UPDATE warrants SET ${setClauses.join(', ')} WHERE id = ?`).run(...setValues);
    }

    const updated = db.prepare(`
      SELECT w.*,
        p.first_name as subject_first_name,
        p.last_name as subject_last_name,
        (p.first_name || ' ' || p.last_name) as subject_name,
        u.full_name as entered_by_name
      FROM warrants w
      LEFT JOIN persons p ON w.subject_person_id = p.id
      LEFT JOIN users u ON w.entered_by = u.id
      WHERE w.id = ?
    `).get(req.params.id) as any;

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'warrant_updated', 'warrant', ?, ?, ?)
    `).run(
      req.user!.userId,
      req.params.id,
      `Updated warrant ${warrant.warrant_number}`,
      req.ip || 'unknown',
    );

    res.json(updated);
  } catch (error: any) {
    console.error('Update warrant error:', error);
    res.status(500).json({ error: 'Failed to update warrant', code: 'UPDATE_WARRANT_ERROR' });
  }
});

// PUT /api/warrants/:id/serve - Serve a warrant
router.put('/:id/serve', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const warrant = db.prepare('SELECT * FROM warrants WHERE id = ?').get(req.params.id) as any;
    if (!warrant) {
      res.status(404).json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' });
      return;
    }

    if (warrant.status !== 'active') {
      res.status(400).json({ error: 'Only active warrants can be served', code: 'ONLY_ACTIVE_WARRANTS_CAN' });
      return;
    }

    const { served_location } = req.body;

    const now = localNow();

    db.prepare(`
      UPDATE warrants SET
        status = 'served',
        served_by = ?,
        served_at = ?,
        served_location = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      req.user!.userId,
      now,
      served_location || null,
      localNow(),
      req.params.id,
    );

    const updated = db.prepare(`
      SELECT w.*,
        p.first_name as subject_first_name,
        p.last_name as subject_last_name,
        (p.first_name || ' ' || p.last_name) as subject_name,
        u_entered.full_name as entered_by_name,
        u_served.full_name as served_by_name
      FROM warrants w
      LEFT JOIN persons p ON w.subject_person_id = p.id
      LEFT JOIN users u_entered ON w.entered_by = u_entered.id
      LEFT JOIN users u_served ON w.served_by = u_served.id
      WHERE w.id = ?
    `).get(req.params.id) as any;

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'warrant_served', 'warrant', ?, ?, ?)
    `).run(
      req.user!.userId,
      req.params.id,
      `Served warrant ${warrant.warrant_number}${served_location ? ` at ${served_location}` : ''}`,
      req.ip || 'unknown',
    );

    // Broadcast warrant served event
    broadcast('alerts', 'warrant', {
      action: 'served',
      warrant: updated,
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Serve warrant error:', error);
    res.status(500).json({ error: 'Failed to serve warrant', code: 'SERVE_WARRANT_ERROR' });
  }
});

// DELETE /api/warrants/:id - Delete warrant (non-active only)
router.delete('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const warrant = db.prepare('SELECT * FROM warrants WHERE id = ?').get(req.params.id) as any;
    if (!warrant) { res.status(404).json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }); return; }
    // God Mode: admin bypass — can delete active warrants
    if (req.user?.role !== 'admin') {
      if (warrant.status === 'active') {
        res.status(400).json({ error: 'Cannot delete an active warrant. Change status first.', code: 'CANNOT_DELETE_AN_ACTIVE' });
        return;
      }
    } else if (warrant.status === 'active') {
      auditLog(req, 'ADMIN_OVERRIDE', 'warrant', warrant.id, 'Admin God Mode: bypassed active warrant delete restriction');
    }

    const delTx = db.transaction(() => {
      db.prepare('DELETE FROM warrants WHERE id = ?').run(warrant.id);
      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'warrant_deleted', 'warrant', ?, ?, ?)`).run(
        req.user!.userId, warrant.id, `Deleted warrant ${warrant.warrant_number}: ${warrant.charge_description}`, req.ip || 'unknown');
    });
    delTx();
    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error('Delete warrant error:', error);
    res.status(500).json({ error: 'Failed to delete warrant', code: 'DELETE_WARRANT_ERROR' });
  }
});

// POST /api/warrants/:id/archive
router.post('/:id/archive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const warrant = db.prepare('SELECT * FROM warrants WHERE id = ?').get(req.params.id) as any;
    if (!warrant) { res.status(404).json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }); return; }
    if (warrant.archived_at) { res.status(400).json({ error: 'Warrant is already archived', code: 'WARRANT_IS_ALREADY_ARCHIVED' }); return; }

    const now = localNow();
    db.prepare('UPDATE warrants SET archived_at = ? WHERE id = ?').run(now, warrant.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'warrant_archived', 'warrant', ?, ?, ?)`).run(
      req.user!.userId, warrant.id, `Archived warrant ${warrant.warrant_number}`, req.ip || 'unknown');

    const updated = db.prepare(`
      SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name,
        (p.first_name || ' ' || p.last_name) as subject_name, u.full_name as entered_by_name
      FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id
      LEFT JOIN users u ON w.entered_by = u.id WHERE w.id = ?
    `).get(warrant.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Archive warrant error:', error);
    res.status(500).json({ error: 'Failed to archive warrant', code: 'ARCHIVE_WARRANT_ERROR' });
  }
});

// POST /api/warrants/:id/unarchive
router.post('/:id/unarchive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const warrant = db.prepare('SELECT * FROM warrants WHERE id = ?').get(req.params.id) as any;
    if (!warrant) { res.status(404).json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }); return; }
    if (!warrant.archived_at) { res.status(400).json({ error: 'Warrant is not archived', code: 'WARRANT_IS_NOT_ARCHIVED' }); return; }

    db.prepare('UPDATE warrants SET archived_at = NULL WHERE id = ?').run(warrant.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'warrant_unarchived', 'warrant', ?, ?, ?)`).run(
      req.user!.userId, warrant.id, `Unarchived warrant ${warrant.warrant_number}`, req.ip || 'unknown');

    const updated = db.prepare(`
      SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name,
        (p.first_name || ' ' || p.last_name) as subject_name, u.full_name as entered_by_name
      FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id
      LEFT JOIN users u ON w.entered_by = u.id WHERE w.id = ?
    `).get(warrant.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Unarchive warrant error:', error);
    res.status(500).json({ error: 'Failed to unarchive warrant', code: 'UNARCHIVE_WARRANT_ERROR' });
  }
});

// POST /api/warrants/ingest-utah — Import warrants from Utah API search results
router.post('/ingest-utah', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { warrants: incomingWarrants } = req.body;
    if (!Array.isArray(incomingWarrants) || incomingWarrants.length === 0) {
      res.status(400).json({ error: 'warrants array required', code: 'WARRANTS_ARRAY_REQUIRED' });
      return;
    }

    let imported = 0;
    let skipped = 0;

    for (const w of incomingWarrants) {
      const extId = `utah_api:${w.utah_warrant_id || w.id}`;
      const existing = db.prepare('SELECT id FROM warrants WHERE external_warrant_id = ?').get(extId);
      if (existing) { skipped++; continue; }

      const result = db.prepare(`
        INSERT INTO warrants (warrant_number, type, status, charge_description, issuing_court,
          entered_by, source, external_warrant_id, external_source_key, auto_created, notes, created_at, updated_at)
        VALUES ('__PENDING__', 'arrest', 'active', ?, ?, ?, 'utah_api', ?, 'utah_api', 1, ?, ?, ?)
      `).run(
        w.charges || w.charge_description || 'Utah warrant',
        w.court_name || null,
        req.user!.userId,
        extId,
        `Imported from Utah warrants API`,
        localNow(), localNow()
      );

      const warrantId = result.lastInsertRowid;
      const year = new Date().getFullYear();
      db.prepare('UPDATE warrants SET warrant_number = ? WHERE id = ?')
        .run(`EXT-${year}-${String(warrantId).padStart(5, '0')}`, warrantId);
      imported++;
    }

    res.json({ imported, skipped, total: incomingWarrants.length });
  } catch (error: any) {
    console.error('Ingest Utah warrants error:', error);
    res.status(500).json({ error: 'Failed to ingest utah warrants', code: 'INGEST_UTAH_WARRANTS_ERROR' });
  }
});

// ─── UTAH WARRANT SEARCH ─────────────────────────────────────────
// POST /api/warrants/utah-search — Live search against warrants.utah.gov
router.post('/utah-search', (req: Request, res: Response) => {
  (async () => {
    try {
      const { firstName, lastName } = req.body;
      if (!firstName?.trim() || !lastName?.trim()) {
        res.status(400).json({ error: 'First and last name are required', code: 'NAME_REQUIRED' });
        return;
      }

      const first = String(firstName).trim();
      const last = String(lastName).trim();

      // Try live API first, fall back to cache
      let results: any[] = [];
      let source: 'live' | 'cache' = 'live';
      let blocked = false;

      try {
        if (isUtahApiBlocked()) {
          blocked = true;
          throw new Error('Utah API temporarily blocked');
        }
        results = (await searchUtahWarrantsLive(first, last)) || [];
      } catch {
        // Fallback to cached data
        source = 'cache';
        const db = getDb();
        const cached = db.prepare(`
          SELECT * FROM utah_warrants
          WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)
          ORDER BY fetched_at DESC LIMIT 100
        `).all(first, last) as any[];
        results = cached;
      }

      // Also check local warrants for this person (join through persons table)
      const db = getDb();
      const localWarrants = db.prepare(`
        SELECT w.*, u.full_name as entered_by_name,
          p.first_name as subject_first_name, p.last_name as subject_last_name
        FROM warrants w
        LEFT JOIN users u ON u.id = w.entered_by
        LEFT JOIN persons p ON p.id = w.subject_person_id
        WHERE LOWER(p.first_name) = LOWER(?) AND LOWER(p.last_name) = LOWER(?)
          AND w.status = 'active'
        LIMIT 50
      `).all(first, last) as any[];

      // Check scraped warrants too
      const scrapedWarrants = db.prepare(`
        SELECT * FROM scraped_warrants
        WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)
          AND status = 'active'
        LIMIT 50
      `).all(first, last) as any[];

      // Log the search
      auditLog(req, 'SEARCH' as any, 'warrant' as any, 0, `Utah warrant search: ${first} ${last} — ${results.length} results`);

      res.json({
        utahResults: results,
        localWarrants,
        scrapedWarrants,
        source,
        blocked,
        searchedAt: localNow(),
        totalHits: results.length + localWarrants.length + scrapedWarrants.length,
      });
    } catch (error: any) {
      console.error('Utah warrant search error:', error);
      res.status(500).json({ error: 'Search failed', code: 'UTAH_SEARCH_ERROR' });
    }
  })();
});

// GET /api/warrants/utah-search/auto-poll — Run warrant checks against all persons in system
router.get('/utah-search/auto-poll-status', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const syncStatus = getUtahWarrantSyncStatus();
    const blocked = isUtahApiBlocked();

    // Get recent warrant watch runs
    const runs = db.prepare(`
      SELECT * FROM warrant_watch_runs ORDER BY created_at DESC LIMIT 10
    `).all() as any[];

    // Get persons who have active warrants (local or Utah hits)
    const flaggedPersons = db.prepare(`
      SELECT p.id, p.first_name, p.last_name, p.dob,
        p.gender, p.race, p.height, p.weight, p.hair_color, p.eye_color, p.address, p.photo_url,
        (SELECT COUNT(*) FROM warrants w WHERE w.subject_person_id = p.id AND w.status = 'active') as local_warrant_count,
        (SELECT COUNT(*) FROM utah_warrants uw WHERE LOWER(uw.first_name) = LOWER(p.first_name) AND LOWER(uw.last_name) = LOWER(p.last_name)) as utah_hit_count,
        (SELECT w2.offense_level FROM warrants w2 WHERE w2.subject_person_id = p.id AND w2.status = 'active'
         ORDER BY CASE w2.offense_level WHEN 'felony' THEN 1 WHEN 'misdemeanor' THEN 2 ELSE 3 END LIMIT 1) as warrant_severity
      FROM persons p
      WHERE (SELECT COUNT(*) FROM warrants w WHERE w.subject_person_id = p.id AND w.status = 'active') > 0
         OR (SELECT COUNT(*) FROM utah_warrants uw WHERE LOWER(uw.first_name) = LOWER(p.first_name) AND LOWER(uw.last_name) = LOWER(p.last_name)) > 0
      ORDER BY warrant_severity NULLS LAST, p.last_name
      LIMIT 200
    `).all() as any[];

    // Fetch full warrant details per flagged person
    const flaggedWithWarrants = flaggedPersons.map((p: any) => {
      const warrants = db.prepare(`
        SELECT w.id, w.warrant_number, w.type, w.status, w.charge_description,
          w.offense_level, w.bail_amount, w.issuing_court, w.source, w.created_at
        FROM warrants w WHERE w.subject_person_id = ? AND w.status = 'active'
        ORDER BY w.created_at DESC
      `).all(p.id);
      const utahWarrants = db.prepare(`
        SELECT utah_warrant_id, charges, court_name, issue_date
        FROM utah_warrants
        WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)
        ORDER BY fetched_at DESC LIMIT 20
      `).all(p.first_name, p.last_name);
      return { ...p, warrants, utahWarrants };
    });

    // Get recent warrant watch log entries
    const recentHits = db.prepare(`
      SELECT * FROM warrant_watch_log
      WHERE event IN ('warrant_found', 'warrant_cleared')
      ORDER BY created_at DESC LIMIT 50
    `).all() as any[];

    // Total persons being monitored
    const totalPersons = (db.prepare(`SELECT COUNT(*) as cnt FROM persons WHERE first_name IS NOT NULL AND last_name IS NOT NULL`).get() as any)?.cnt || 0;

    res.json({
      syncStatus,
      blocked,
      runs,
      flaggedPersons: flaggedWithWarrants,
      recentHits,
      totalPersons,
    });
  } catch (error: any) {
    console.error('Auto-poll status error:', error);
    res.status(500).json({ error: 'Failed to get auto-poll status', code: 'AUTO_POLL_STATUS_ERROR' });
  }
});

// GET /api/warrants/person-intel — Person intelligence summary for warrants
router.get('/person-intel', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { person_id, name } = req.query;

    if (person_id) {
      const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(person_id) as any;
      if (!person) { res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }); return; }

      const warrants = db.prepare(`
        SELECT * FROM warrants WHERE subject_person_id = ? AND status = 'active'
      
        LIMIT 1000
      `).all(person_id);

      const utahHits = db.prepare(`
        SELECT * FROM utah_warrants WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)
      
        LIMIT 1000
      `).all(person.first_name || '', person.last_name || '');

      res.json({ person, warrants, utahHits, hasActiveWarrants: warrants.length > 0 });
    } else if (name) {
      const parts = String(name).trim().split(/\s+/);
      if (parts.length < 2) { res.json({ results: [] }); return; }

      const results = db.prepare(`
        SELECT p.id, p.first_name, p.last_name, p.dob,
          (SELECT COUNT(*) FROM warrants w WHERE w.subject_person_id = p.id AND w.status = 'active') as active_warrant_count
        FROM persons p
        WHERE LOWER(first_name) LIKE LOWER(?) AND LOWER(last_name) LIKE LOWER(?)
        LIMIT 20
      `).all(`%${parts[0]}%`, `%${parts[parts.length - 1]}%`);

      res.json({ results });
    } else {
      res.status(400).json({ error: 'person_id or name query required', code: 'PERSONID_OR_NAME_QUERY' });
    }
  } catch (error: any) {
    console.error('Person intel error:', error);
    res.status(500).json({ error: 'Failed to get person intel', code: 'PERSON_INTEL_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 15: Warrant Expiration Warnings (within 30 days)
// ════════════════════════════════════════════════════════════
router.get('/expiring-soon', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string, 10) || 30;
    const warrants = db.prepare(`
      SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name,
        (p.first_name || ' ' || p.last_name) as subject_name,
        CAST(JULIANDAY(w.expires_at) - JULIANDAY('now', 'localtime') AS INTEGER) as days_until_expiry
      FROM warrants w
      LEFT JOIN persons p ON w.subject_person_id = p.id
      WHERE w.status = 'active' AND w.expires_at IS NOT NULL
        AND w.expires_at <= date('now', '+' || ? || ' days', 'localtime')
        AND w.expires_at >= date('now', 'localtime')
        AND w.archived_at IS NULL
      ORDER BY w.expires_at ASC
      LIMIT 100
    `).all(days);
    const expiredUnprocessed = db.prepare(`
      SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name,
        (p.first_name || ' ' || p.last_name) as subject_name
      FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id
      WHERE w.status = 'active' AND w.expires_at IS NOT NULL
        AND w.expires_at < date('now', 'localtime') AND w.archived_at IS NULL
      ORDER BY w.expires_at ASC LIMIT 50
    `).all();
    res.json({ data: { expiring_soon: warrants, already_expired: expiredUnprocessed, expiring_count: warrants.length, expired_count: expiredUnprocessed.length } });
  } catch (error: any) { console.error('Expiring warrants error:', error); res.status(500).json({ error: 'Failed to get expiring warrants', code: 'EXPIRING_WARRANTS_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 16: Service Attempt Tracking
// ════════════════════════════════════════════════════════════
try { const db = getDb(); db.prepare(`CREATE TABLE IF NOT EXISTS warrant_service_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, warrant_id INTEGER NOT NULL, attempted_by INTEGER NOT NULL, attempted_at TEXT NOT NULL, location TEXT, method TEXT DEFAULT 'in_person', result TEXT DEFAULT 'unsuccessful', notes TEXT, created_at TEXT NOT NULL)`).run(); } catch { /* already exists */ }

router.get('/:id/service-attempts', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const warrant = db.prepare('SELECT id FROM warrants WHERE id = ?').get(req.params.id);
    if (!warrant) { res.status(404).json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }); return; }
    const attempts = db.prepare(`SELECT wsa.*, u.full_name as attempted_by_name FROM warrant_service_attempts wsa LEFT JOIN users u ON wsa.attempted_by = u.id WHERE wsa.warrant_id = ? ORDER BY wsa.attempted_at DESC`).all(req.params.id);
    res.json({ data: attempts });
  } catch (error: any) { console.error('Get service attempts error:', error); res.status(500).json({ error: 'Failed to get service attempts', code: 'GET_SERVICE_ATTEMPTS_ERROR' }); }
});

router.post('/:id/service-attempts', requireRole('dispatcher', 'supervisor', 'admin', 'manager', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const warrant = db.prepare('SELECT id, warrant_number FROM warrants WHERE id = ?').get(req.params.id) as any;
    if (!warrant) { res.status(404).json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }); return; }
    const { location, method, result: attemptResult, notes } = req.body;
    const now = localNow();
    const insertResult = db.prepare('INSERT INTO warrant_service_attempts (warrant_id, attempted_by, attempted_at, location, method, result, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(req.params.id, req.user!.userId, now, location || null, method || 'in_person', attemptResult || 'unsuccessful', notes || null, now);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'warrant_service_attempt', 'warrant', ?, ?, ?)`).run(req.user!.userId, req.params.id, `Service attempt on ${warrant.warrant_number}: ${attemptResult || 'unsuccessful'}`, req.ip || 'unknown');
    if (attemptResult === 'served') {
      db.prepare("UPDATE warrants SET status = 'served', served_by = ?, served_at = ?, served_location = ?, updated_at = ? WHERE id = ?").run(req.user!.userId, now, location || null, now, req.params.id);
      broadcast('alerts', 'warrant_served', { id: parseInt(req.params.id as string), warrant_number: warrant.warrant_number });
    }
    res.status(201).json({ data: { id: insertResult.lastInsertRowid } });
  } catch (error: any) { console.error('Create service attempt error:', error); res.status(500).json({ error: 'Failed to record service attempt', code: 'CREATE_SERVICE_ATTEMPT_ERROR' }); }
});

// PUT /api/warrants/:id/service-attempts/:attemptId — Update service attempt
router.put('/:id/service-attempts/:attemptId', requireRole('dispatcher', 'supervisor', 'admin', 'manager', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const warrant = db.prepare('SELECT id, warrant_number FROM warrants WHERE id = ?').get(req.params.id) as any;
    if (!warrant) { res.status(404).json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }); return; }
    const attempt = db.prepare('SELECT * FROM warrant_service_attempts WHERE id = ? AND warrant_id = ?').get(req.params.attemptId, req.params.id) as any;
    if (!attempt) { res.status(404).json({ error: 'Service attempt not found', code: 'ATTEMPT_NOT_FOUND' }); return; }

    const fieldMap: Record<string, string> = {
      location: 'location', method: 'method', result: 'result', notes: 'notes',
    };
    const setClauses: string[] = [];
    const values: any[] = [];
    for (const [bodyKey, dbCol] of Object.entries(fieldMap)) {
      if (req.body[bodyKey] !== undefined) {
        setClauses.push(`${dbCol} = ?`);
        values.push(req.body[bodyKey] ?? null);
      }
    }
    if (setClauses.length === 0) { res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS' }); return; }
    values.push(req.params.attemptId);
    db.prepare(`UPDATE warrant_service_attempts SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    // Auto-transition warrant to served if result changed to 'served'
    if (req.body.result === 'served' && attempt.result !== 'served') {
      const now = localNow();
      db.prepare("UPDATE warrants SET status = 'served', served_by = ?, served_at = ?, served_location = ?, updated_at = ? WHERE id = ?").run(
        req.user!.userId, now, req.body.location || attempt.location || null, now, req.params.id
      );
      broadcast('alerts', 'warrant_served', { id: parseInt(req.params.id as string), warrant_number: warrant.warrant_number });
    }

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'warrant_service_attempt_updated', 'warrant', ?, ?, ?)`).run(
      req.user!.userId, req.params.id, `Updated service attempt on ${warrant.warrant_number}`, req.ip || 'unknown'
    );
    const updated = db.prepare('SELECT wsa.*, u.full_name as attempted_by_name FROM warrant_service_attempts wsa LEFT JOIN users u ON wsa.attempted_by = u.id WHERE wsa.id = ?').get(req.params.attemptId);
    res.json({ data: updated });
  } catch (error: any) { console.error('Update service attempt error:', error); res.status(500).json({ error: 'Failed to update service attempt', code: 'UPDATE_SERVICE_ATTEMPT_ERROR' }); }
});

// DELETE /api/warrants/:id/service-attempts/:attemptId — Delete service attempt
router.delete('/:id/service-attempts/:attemptId', requireRole('supervisor', 'admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const warrant = db.prepare('SELECT id, warrant_number, status FROM warrants WHERE id = ?').get(req.params.id) as any;
    if (!warrant) { res.status(404).json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }); return; }
    const attempt = db.prepare('SELECT * FROM warrant_service_attempts WHERE id = ? AND warrant_id = ?').get(req.params.attemptId, req.params.id) as any;
    if (!attempt) { res.status(404).json({ error: 'Service attempt not found', code: 'ATTEMPT_NOT_FOUND' }); return; }

    db.prepare('DELETE FROM warrant_service_attempts WHERE id = ?').run(req.params.attemptId);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'warrant_service_attempt_deleted', 'warrant', ?, ?, ?)`).run(
      req.user!.userId, req.params.id, `Deleted service attempt from ${warrant.warrant_number}`, req.ip || 'unknown'
    );

    // If deleted attempt was the 'served' one and warrant is served, revert to active
    if (attempt.result === 'served' && warrant.status === 'served') {
      const otherServed = db.prepare("SELECT id FROM warrant_service_attempts WHERE warrant_id = ? AND result = 'served'").get(req.params.id);
      if (!otherServed) {
        db.prepare("UPDATE warrants SET status = 'active', served_by = NULL, served_at = NULL, served_location = NULL, updated_at = ? WHERE id = ?").run(localNow(), req.params.id);
      }
    }
    res.json({ success: true });
  } catch (error: any) { console.error('Delete service attempt error:', error); res.status(500).json({ error: 'Failed to delete service attempt', code: 'DELETE_SERVICE_ATTEMPT_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 17: Warrant Recall Workflow
// ════════════════════════════════════════════════════════════
router.put('/:id/recall', requireRole('dispatcher', 'supervisor', 'admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const warrant = db.prepare('SELECT * FROM warrants WHERE id = ?').get(req.params.id) as any;
    if (!warrant) { res.status(404).json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }); return; }
    if (warrant.status !== 'active') { res.status(400).json({ error: 'Only active warrants can be recalled', code: 'ONLY_ACTIVE_CAN_RECALL' }); return; }
    const { recall_reason, recall_court_order } = req.body;
    if (!recall_reason?.trim()) { res.status(400).json({ error: 'recall_reason is required', code: 'MISSING_RECALL_REASON' }); return; }
    db.prepare("UPDATE warrants SET status = 'recalled', updated_at = ?, notes = COALESCE(notes, '') || ? WHERE id = ?").run(now, `\n[RECALLED ${now}] ${recall_reason}${recall_court_order ? ` | Court Order: ${recall_court_order}` : ''}`, req.params.id);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'warrant_recalled', 'warrant', ?, ?, ?)`).run(req.user!.userId, req.params.id, `Recalled warrant ${warrant.warrant_number}: ${recall_reason}`, req.ip || 'unknown');
    broadcast('alerts', 'warrant_recalled', { id: warrant.id, warrant_number: warrant.warrant_number });
    const updated = db.prepare('SELECT * FROM warrants WHERE id = ?').get(req.params.id);
    res.json({ data: updated });
  } catch (error: any) { console.error('Recall warrant error:', error); res.status(500).json({ error: 'Failed to recall warrant', code: 'RECALL_WARRANT_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 18: Warrant Stats by Status
// ════════════════════════════════════════════════════════════
router.get('/stats/by-status', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const byStatus = db.prepare(`SELECT w.status, COUNT(*) as count FROM warrants w WHERE w.archived_at IS NULL GROUP BY w.status`).all() as any[];
    const byType = db.prepare(`SELECT w.type, w.status, COUNT(*) as count FROM warrants w WHERE w.archived_at IS NULL GROUP BY w.type, w.status`).all() as any[];
    const byOffenseLevel = db.prepare(`SELECT w.offense_level, COUNT(*) as count FROM warrants w WHERE w.status = 'active' AND w.archived_at IS NULL GROUP BY w.offense_level`).all() as any[];
    const avgServiceTime = db.prepare(`SELECT AVG(JULIANDAY(w.served_at) - JULIANDAY(w.created_at)) as avg_days FROM warrants w WHERE w.status = 'served' AND w.served_at IS NOT NULL`).get() as any;
    res.json({ data: { by_status: Object.fromEntries(byStatus.map((r: any) => [r.status, r.count])), by_type_status: byType, by_offense_level: Object.fromEntries(byOffenseLevel.map((r: any) => [r.offense_level || 'unknown', r.count])), avg_service_days: avgServiceTime?.avg_days ? Math.round(avgServiceTime.avg_days) : null } });
  } catch (error: any) { console.error('Warrant stats error:', error); res.status(500).json({ error: 'Failed to get warrant stats', code: 'WARRANT_STATS_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 19: Warrant Data Completeness
// ════════════════════════════════════════════════════════════
router.get('/:id/completeness', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const warrant = db.prepare('SELECT * FROM warrants WHERE id = ?').get(req.params.id) as any;
    if (!warrant) { res.status(404).json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }); return; }
    const requiredFields = ['type', 'charge_description', 'subject_person_id'];
    const recommendedFields = ['issuing_court', 'issuing_judge', 'offense_level', 'bail_amount', 'expires_at', 'statute_citation', 'notes'];
    const filledRequired = requiredFields.filter(f => warrant[f] != null && String(warrant[f]).trim() !== '').length;
    const filledRecommended = recommendedFields.filter(f => warrant[f] != null && String(warrant[f]).trim() !== '').length;
    const score = Math.round(((filledRequired / requiredFields.length) * 60 + (filledRecommended / recommendedFields.length) * 40));
    res.json({ data: { warrant_id: warrant.id, score, grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D', missing_required: requiredFields.filter(f => !warrant[f] || String(warrant[f]).trim() === ''), missing_recommended: recommendedFields.filter(f => !warrant[f] || String(warrant[f]).trim() === '') } });
  } catch (error: any) { console.error('Warrant completeness error:', error); res.status(500).json({ error: 'Failed to get completeness', code: 'WARRANT_COMPLETENESS_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 20: Auto-expire active warrants past expiry date
// ════════════════════════════════════════════════════════════
router.post('/auto-expire', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const expired = db.prepare(`SELECT id, warrant_number FROM warrants WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < date('now', 'localtime') AND archived_at IS NULL`).all() as any[];
    if (expired.length === 0) { res.json({ data: { expired_count: 0 } }); return; }
    db.prepare(`UPDATE warrants SET status = 'expired', updated_at = ? WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < date('now', 'localtime') AND archived_at IS NULL`).run(now);
    for (const w of expired) {
      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'warrant_auto_expired', 'warrant', ?, ?, ?)`).run(req.user!.userId, w.id, `Auto-expired warrant ${w.warrant_number}`, req.ip || 'unknown');
    }
    broadcast('alerts', 'warrants_auto_expired', { count: expired.length });
    res.json({ data: { expired_count: expired.length, expired_warrants: expired.map((w: any) => w.warrant_number) } });
  } catch (error: any) { console.error('Auto-expire error:', error); res.status(500).json({ error: 'Failed to auto-expire warrants', code: 'AUTO_EXPIRE_ERROR' }); }
});

// POST /api/warrants/search-all — Unified search across local warrants, Utah API/cache, and scraped warrants
router.post('/search-all', (req: Request, res: Response) => {
  (async () => {
    try {
      const startTime = Date.now();
      const db = getDb();
      const {
        firstName, lastName, dob, warrantNumber, court, source,
        offenseLevel, status, type, chargeKeyword, dateFrom, dateTo
      } = req.body;

      // --- Local warrants ---
      let localWhere = 'WHERE 1=1';
      const localParams: any[] = [];

      if (firstName) { localWhere += ' AND LOWER(p.first_name) LIKE LOWER(?)'; localParams.push(`%${firstName}%`); }
      if (lastName) { localWhere += ' AND LOWER(p.last_name) LIKE LOWER(?)'; localParams.push(`%${lastName}%`); }
      if (dob) { localWhere += ' AND p.dob = ?'; localParams.push(dob); }
      if (warrantNumber) { localWhere += ' AND w.warrant_number LIKE ?'; localParams.push(`%${warrantNumber}%`); }
      if (court) { localWhere += ' AND LOWER(w.issuing_court) LIKE LOWER(?)'; localParams.push(`%${court}%`); }
      if (source) { localWhere += ' AND w.source = ?'; localParams.push(source); }
      if (offenseLevel) { localWhere += ' AND w.offense_level = ?'; localParams.push(offenseLevel); }
      if (status) { localWhere += ' AND w.status = ?'; localParams.push(status); }
      if (type) { localWhere += ' AND w.type = ?'; localParams.push(type); }
      if (chargeKeyword) { localWhere += ' AND LOWER(w.charge_description) LIKE LOWER(?)'; localParams.push(`%${chargeKeyword}%`); }
      if (dateFrom) { localWhere += ' AND w.created_at >= ?'; localParams.push(dateFrom); }
      if (dateTo) { localWhere += ' AND w.created_at <= ?'; localParams.push(dateTo); }

      const localWarrants = db.prepare(`
        SELECT w.*, p.first_name, p.last_name, p.dob as person_dob,
          u.full_name as entered_by_name
        FROM warrants w
        LEFT JOIN persons p ON w.subject_person_id = p.id
        LEFT JOIN users u ON w.entered_by = u.id
        ${localWhere}
        ORDER BY w.created_at DESC
        LIMIT 500
      `).all(...localParams) as any[];

      // --- Utah API / cache ---
      let utahResults: any[] = [];
      let utahBlocked = false;
      const sources: string[] = ['local'];

      if (firstName?.trim() && lastName?.trim()) {
        try {
          if (isUtahApiBlocked()) {
            utahBlocked = true;
            throw new Error('Utah API blocked');
          }
          utahResults = (await searchUtahWarrantsLive(String(firstName).trim(), String(lastName).trim())) || [];
          sources.push('utah_live');
        } catch {
          // Fallback to cache
          const cached = db.prepare(`
            SELECT * FROM utah_warrants
            WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)
            ORDER BY fetched_at DESC LIMIT 100
          `).all(String(firstName).trim(), String(lastName).trim()) as any[];
          utahResults = cached;
          sources.push('utah_cache');
        }
      }

      // --- Scraped warrants ---
      let scrapedWhere = 'WHERE 1=1';
      const scrapedParams: any[] = [];

      if (firstName) { scrapedWhere += ' AND LOWER(first_name) LIKE LOWER(?)'; scrapedParams.push(`%${firstName}%`); }
      if (lastName) { scrapedWhere += ' AND LOWER(last_name) LIKE LOWER(?)'; scrapedParams.push(`%${lastName}%`); }
      if (chargeKeyword) { scrapedWhere += ' AND LOWER(charges) LIKE LOWER(?)'; scrapedParams.push(`%${chargeKeyword}%`); }
      if (offenseLevel) { scrapedWhere += ' AND LOWER(offense_level) = LOWER(?)'; scrapedParams.push(offenseLevel); }

      const scrapedWarrants = db.prepare(`
        SELECT * FROM scraped_warrants
        ${scrapedWhere}
        ORDER BY scraped_at DESC
        LIMIT 500
      `).all(...scrapedParams) as any[];
      sources.push('scraped');

      const duration = Date.now() - startTime;
      const totalHits = localWarrants.length + utahResults.length + scrapedWarrants.length;

      auditLog(req, 'SEARCH', 'warrants', 0, JSON.stringify({
        params: { firstName, lastName, dob, warrantNumber, court, source, offenseLevel, status, type, chargeKeyword, dateFrom, dateTo },
        totalHits, duration
      }));

      res.json({
        local: localWarrants,
        utah: utahResults,
        scraped: scrapedWarrants,
        meta: {
          duration,
          sources,
          utahBlocked,
          searchedAt: new Date().toISOString(),
          totalHits,
        },
      });
    } catch (error: any) {
      console.error('Unified search error:', error);
      res.status(500).json({ error: 'Unified search failed', code: 'SEARCH_ALL_ERROR' });
    }
  })();
});

// GET /api/warrants/summary-report — Warrant summary/breakdown report
router.get('/summary-report', requireRole('dispatcher', 'supervisor', 'admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { from, to } = req.query;

    let dateFilter = '';
    const dateParams: any[] = [];
    if (from) { dateFilter += ' AND w.created_at >= ?'; dateParams.push(from); }
    if (to) { dateFilter += ' AND w.created_at <= ?'; dateParams.push(to); }

    // By status
    const byStatusRows = db.prepare(`
      SELECT w.status, COUNT(*) as count FROM warrants w WHERE 1=1 ${dateFilter} GROUP BY w.status
    `).all(...dateParams) as any[];
    const byStatus: Record<string, number> = {};
    for (const r of byStatusRows) byStatus[r.status || 'unknown'] = r.count;

    // By type
    const byTypeRows = db.prepare(`
      SELECT w.type, COUNT(*) as count FROM warrants w WHERE 1=1 ${dateFilter} GROUP BY w.type
    `).all(...dateParams) as any[];
    const byType: Record<string, number> = {};
    for (const r of byTypeRows) byType[r.type || 'unknown'] = r.count;

    // By severity (offense_level)
    const bySeverityRows = db.prepare(`
      SELECT w.offense_level, COUNT(*) as count FROM warrants w WHERE 1=1 ${dateFilter} GROUP BY w.offense_level
    `).all(...dateParams) as any[];
    const bySeverity: Record<string, number> = {};
    for (const r of bySeverityRows) bySeverity[r.offense_level || 'unknown'] = r.count;

    // By source
    const bySourceRows = db.prepare(`
      SELECT w.source, COUNT(*) as count FROM warrants w WHERE 1=1 ${dateFilter} GROUP BY w.source
    `).all(...dateParams) as any[];
    const bySource: Record<string, number> = {};
    for (const r of bySourceRows) bySource[r.source || 'unknown'] = r.count;

    // Top courts
    const topCourts = db.prepare(`
      SELECT w.issuing_court as court, COUNT(*) as count FROM warrants w
      WHERE w.issuing_court IS NOT NULL ${dateFilter}
      GROUP BY w.issuing_court ORDER BY count DESC LIMIT 10
    `).all(...dateParams) as any[];

    // New this period
    const newThisPeriod = (db.prepare(`
      SELECT COUNT(*) as cnt FROM warrants w WHERE 1=1 ${dateFilter}
    `).get(...dateParams) as any)?.cnt || 0;

    // Cleared this period
    const clearedThisPeriod = (db.prepare(`
      SELECT COUNT(*) as cnt FROM warrants w WHERE w.status = 'cleared' ${dateFilter}
    `).get(...dateParams) as any)?.cnt || 0;

    // Scan activity from warrant_watch_runs
    let scanFilter = '';
    const scanParams: any[] = [];
    if (from) { scanFilter += ' AND created_at >= ?'; scanParams.push(from); }
    if (to) { scanFilter += ' AND created_at <= ?'; scanParams.push(to); }

    const scanActivity = db.prepare(`
      SELECT
        COUNT(*) as totalScans,
        COALESCE(SUM(warrants_found), 0) as totalFound,
        COALESCE(SUM(warrants_cleared), 0) as totalCleared
      FROM warrant_watch_runs WHERE 1=1 ${scanFilter}
    `).get(...scanParams) as any;

    res.json({
      byStatus,
      byType,
      bySeverity,
      bySource,
      topCourts,
      newThisPeriod,
      clearedThisPeriod,
      scanActivity: {
        totalScans: scanActivity?.totalScans || 0,
        totalFound: scanActivity?.totalFound || 0,
        totalCleared: scanActivity?.totalCleared || 0,
      },
      period: {
        from: from || null,
        to: to || null,
      },
    });
  } catch (error: any) {
    console.error('Summary report error:', error);
    res.status(500).json({ error: 'Failed to generate summary report', code: 'SUMMARY_REPORT_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// Expiration Tracking & Trends & Batch Archive
// ════════════════════════════════════════════════════════════

// GET /api/warrants/expiring — Active warrants expiring within N days
router.get('/expiring', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string, 10) || 30;
    const warrants = db.prepare(`
      SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name,
        (p.first_name || ' ' || p.last_name) as subject_name
      FROM warrants w
      LEFT JOIN persons p ON w.subject_person_id = p.id
      WHERE w.status = 'active' AND w.expires_at IS NOT NULL
        AND w.expires_at <= date('now', '+' || ? || ' days')
        AND w.expires_at >= date('now')
      ORDER BY w.expires_at ASC
    `).all(days);
    res.json({ data: warrants, count: warrants.length });
  } catch (error: any) {
    console.error('Expiring warrants error:', error);
    res.status(500).json({ error: 'Failed to get expiring warrants', code: 'EXPIRING_ERROR' });
  }
});

// GET /api/warrants/expired — Active warrants that have already expired
router.get('/expired', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const warrants = db.prepare(`
      SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name
      FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id
      WHERE w.status = 'active' AND w.expires_at IS NOT NULL AND w.expires_at < date('now')
      ORDER BY w.expires_at DESC
    `).all();
    res.json({ data: warrants, count: warrants.length });
  } catch (error: any) {
    console.error('Expired warrants error:', error);
    res.status(500).json({ error: 'Failed to get expired warrants', code: 'EXPIRED_ERROR' });
  }
});

// GET /api/warrants/trends — Weekly/monthly warrant creation and service stats
router.get('/trends', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const range = req.query.range as string || '30d';
    const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;

    const created = db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as count
      FROM warrants WHERE created_at >= date('now', '-' || ? || ' days')
      GROUP BY date(created_at) ORDER BY day
    `).all(days);

    const served = db.prepare(`
      SELECT date(served_at) as day, COUNT(*) as count
      FROM warrants WHERE served_at IS NOT NULL AND served_at >= date('now', '-' || ? || ' days')
      GROUP BY date(served_at) ORDER BY day
    `).all(days);

    res.json({ created, served, range });
  } catch (error: any) {
    console.error('Warrant trends error:', error);
    res.status(500).json({ error: 'Failed to get warrant trends', code: 'TRENDS_ERROR' });
  }
});

// PUT /api/warrants/batch-archive — Archive multiple warrants at once
router.put('/batch-archive', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids array is required', code: 'IDS_REQUIRED' });
      return;
    }
    const now = localNow();
    const stmt = db.prepare('UPDATE warrants SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL');
    let count = 0;
    for (const id of ids) {
      const r = stmt.run(now, now, id);
      if (r.changes > 0) count++;
    }
    res.json({ archived: count });
  } catch (error: any) {
    console.error('Batch archive warrants error:', error);
    res.status(500).json({ error: 'Failed to batch archive warrants', code: 'BATCH_ARCHIVE_ERROR' });
  }
});

// ── Reset All Circuit Breakers ──────────────────────────
// POST /api/warrants/scraper/reset-all
router.post('/scraper/reset-all', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const result = db.prepare("UPDATE warrant_scraper_config SET circuit_broken = 0, consecutive_errors = 0 WHERE circuit_broken = 1").run();
    res.json({ reset: result.changes, message: `Reset ${result.changes} circuit-broken sources` });
  } catch (error: any) {
    console.error('Reset scrapers error:', error);
    res.status(500).json({ error: 'Failed to reset scrapers' });
  }
});


// ── National Warrant Search ─────────────────────────────
// POST /api/warrants/national-search
// Hybrid search: local DB + live Utah API + live FBI API
router.post('/national-search', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const startMs = Date.now();
    const { first_name, last_name, dob, state, offense_level, warrant_type, charge_keyword } = req.body;

    if (!first_name && !last_name && !charge_keyword) {
      res.status(400).json({ error: 'At least a name or charge keyword is required', code: 'SEARCH_PARAMS_REQUIRED' });
      return;
    }

    // ── Phase 1: Local DB search (instant) ──
    const conditions: string[] = ["sw.status = 'active'"];
    const params: any[] = [];

    if (first_name) { conditions.push("sw.first_name LIKE ?"); params.push(`%${first_name}%`); }
    if (last_name) { conditions.push("sw.last_name LIKE ?"); params.push(`%${last_name}%`); }
    if (dob) { conditions.push("sw.date_of_birth = ?"); params.push(dob); }
    if (state) { conditions.push("sw.state = ?"); params.push(state); }
    if (offense_level) { conditions.push("sw.offense_level = ?"); params.push(offense_level); }
    if (warrant_type) { conditions.push("sw.warrant_type = ?"); params.push(warrant_type); }
    if (charge_keyword) { conditions.push("sw.charge_description LIKE ?"); params.push(`%${charge_keyword}%`); }

    const localRows = db.prepare(`
      SELECT sw.*, wsc.display_name as source_display_name, 'local' as search_source
      FROM scraped_warrants sw
      LEFT JOIN warrant_scraper_config wsc ON sw.source_key = wsc.source_key
      WHERE ${conditions.join(' AND ')}
      ORDER BY sw.state, sw.last_name, sw.first_name
      LIMIT 500
    `).all(...params) as any[];

    // ── Phase 2: Live API searches (parallel, non-blocking) ──
    const liveResults: any[] = [];
    const liveErrors: string[] = [];

    if (first_name && last_name) {
      const liveSearches: Promise<void>[] = [];

      // Utah live API search (if not state-filtered to a different state)
      if (!state || state === 'UT') {
        liveSearches.push(
          (async () => {
            try {
              const utahResults = await searchUtahWarrantsLive(first_name, last_name);
              if (utahResults && utahResults.length > 0) {
                for (const w of utahResults) {
                  const wu = w as any;
                  liveResults.push({
                    first_name: wu.first_name || first_name,
                    last_name: wu.last_name || last_name,
                    date_of_birth: wu.date_of_birth || dob || null,
                    state: 'UT',
                    warrant_type: wu.warrant_type || 'arrest',
                    charge_description: wu.charges || wu.charge_description || '',
                    court_name: wu.court_name || 'Utah Courts',
                    case_number: wu.case_number || wu.case_id || '',
                    issue_date: wu.issue_date || null,
                    bail_amount: wu.bail_amount || null,
                    offense_level: wu.offense_level || null,
                    status: 'active',
                    source_display_name: 'Utah Warrants API (Live)',
                    search_source: 'live_utah',
                  });
                }
              }
            } catch (e: any) {
              liveErrors.push(`Utah: ${e?.message || 'search failed'}`);
            }
          })()
        );
      }

      // FBI Wanted API (live, if not state-filtered or state=US)
      if (!state || state === 'US') {
        liveSearches.push(
          (async () => {
            try {
              const nameQuery = `${first_name} ${last_name}`;
              const fbiRes = await fetch(`https://api.fbi.gov/wanted/v1/list?title=${encodeURIComponent(nameQuery)}&pageSize=20`, {
                signal: AbortSignal.timeout(10000),
              });
              if (fbiRes.ok) {
                const fbiData = await fbiRes.json();
                if (fbiData.items && fbiData.items.length > 0) {
                  for (const item of fbiData.items) {
                    liveResults.push({
                      first_name: first_name,
                      last_name: last_name,
                      full_name: item.title || `${first_name} ${last_name}`,
                      date_of_birth: item.dates_of_birth_used?.[0] || null,
                      state: 'US',
                      warrant_type: 'fugitive',
                      charge_description: item.description || item.caution || '',
                      court_name: 'Federal — FBI',
                      case_number: item.uid || '',
                      bail_amount: item.reward_text ? parseFloat(item.reward_text.replace(/[^0-9.]/g, '')) || null : null,
                      offense_level: 'felony',
                      status: 'active',
                      photo_url: item.images?.[0]?.large || item.images?.[0]?.thumb || null,
                      detail_url: item.url || null,
                      source_display_name: 'FBI Most Wanted (Live)',
                      search_source: 'live_fbi',
                    });
                  }
                }
              }
            } catch (e: any) {
              liveErrors.push(`FBI: ${e?.message || 'search failed'}`);
            }
          })()
        );
      }

      // Wait for all live searches (max 12s timeout)
      if (liveSearches.length > 0) {
        await Promise.race([
          Promise.allSettled(liveSearches),
          new Promise(resolve => setTimeout(resolve, 12000)),
        ]);
      }
    }

    // ── Phase 3: Also search local warrants table (manual entries) ──
    const manualConditions: string[] = ["w.status = 'active'"];
    const manualParams: any[] = [];
    if (first_name) { manualConditions.push("w.subject_first_name LIKE ?"); manualParams.push(`%${first_name}%`); }
    if (last_name) { manualConditions.push("w.subject_last_name LIKE ?"); manualParams.push(`%${last_name}%`); }

    let manualRows: any[] = [];
    if (first_name || last_name) {
      try {
        manualRows = db.prepare(`
          SELECT w.*, 'manual' as search_source, 'RMPG Manual Entry' as source_display_name
          FROM warrants w
          WHERE ${manualConditions.join(' AND ')}
          LIMIT 100
        `).all(...manualParams) as any[];
      } catch (e) { /* warrants table may not have these columns */ }
    }

    // ── Combine all results ──
    const allResults = [...localRows, ...liveResults, ...manualRows];

    // Deduplicate by name + state + charge (fuzzy)
    const seen = new Set<string>();
    const deduplicated = allResults.filter(r => {
      const key = `${(r.first_name || '').toLowerCase()}_${(r.last_name || '').toLowerCase()}_${r.state || ''}_${(r.charge_description || '').substring(0, 30).toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Group by state
    const byState: Record<string, any[]> = {};
    for (const row of deduplicated) {
      const st = row.state || 'Unknown';
      if (!byState[st]) byState[st] = [];
      byState[st].push(row);
    }

    const local = byState['UT'] || [];

    res.json({
      total: deduplicated.length,
      search_time_ms: Date.now() - startMs,
      by_state: byState,
      local,
      live_sources_queried: (first_name && last_name) ? ['Utah API', 'FBI API'] : [],
      live_errors: liveErrors.length > 0 ? liveErrors : undefined,
    });
  } catch (error: any) {
    console.error('National search error:', error);
    res.status(500).json({ error: 'Failed to search national warrants', code: 'NATIONAL_SEARCH_ERROR' });
  }
});

export default router;
