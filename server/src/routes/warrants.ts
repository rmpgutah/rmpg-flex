import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { broadcast } from '../utils/websocket';
import { localNow } from '../utils/timeUtils';
import { searchUtahWarrants, searchUtahWarrantsCache, getUtahWarrantSyncStatus, runWarrantWatchScan } from '../utils/utahWarrantScraper';
import {
  searchScrapedWarrants, getActiveScrapedWarrants, getWarrantScraperStatus,
  getWarrantScraperStats, manualScrapeSource, resetWarrantSourceErrors,
  setWarrantSourceEnabled, checkPersonWarrants,
} from '../utils/multiStateWarrantScraper';
import {
  searchCourtRecords, getCachedCourtRecords, getCourtRecordsByPersonId,
  getCourtRecordStats,
} from '../utils/courtRecordsScraper';
import { createNotificationForRoles } from './notifications';

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
      subject_name,
      archived,
      page = '1',
      per_page = '50',
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
    if (subject_name) {
      whereClause += " AND (p.first_name || ' ' || p.last_name) LIKE ?";
      params.push(`%${subject_name}%`);
    }

    // Archive filter
    if (archived === 'true') {
      whereClause += ' AND w.archived_at IS NOT NULL';
    } else if (archived !== 'all') {
      whereClause += ' AND w.archived_at IS NULL';
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPageNum = Math.min(200, Math.max(1, parseInt(per_page as string, 10) || 25));
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
        u.full_name as entered_by_name
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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/warrants/check/:personId - Check if person has active warrants
router.get('/check/:personId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { personId } = req.params;

    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(personId) as any;
    if (!person) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }

    const warrants = db.prepare(`
      SELECT w.*,
        u.full_name as entered_by_name
      FROM warrants w
      LEFT JOIN users u ON w.entered_by = u.id
      WHERE w.subject_person_id = ? AND w.status = 'active'
      ORDER BY w.created_at DESC
    `).all(personId);

    res.json({
      has_warrants: warrants.length > 0,
      count: warrants.length,
      warrants,
    });
  } catch (error: any) {
    console.error('Check warrants error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Utah State Warrants (real-time search from warrants.utah.gov) ───────────
// NOTE: These must be declared BEFORE /:id to avoid being caught by the param route

// GET /api/warrants/utah — Search Utah state warrants (live from warrants.utah.gov)
router.get('/utah', async (req: Request, res: Response) => {
  try {
    const { search } = req.query;

    // Require a search term (API needs both first + last name)
    if (!search || typeof search !== 'string' || search.trim().length < 2) {
      // Return cached results if no search
      const cached = searchUtahWarrantsCache('', { limit: 50 });
      return res.json({
        data: cached,
        pagination: { page: 1, per_page: 50, total: cached.length, totalPages: 1 },
        source: 'cache',
      });
    }

    // Live search warrants.utah.gov
    const results = await searchUtahWarrants(search.trim());

    res.json({
      data: results,
      pagination: { page: 1, per_page: results.length, total: results.length, totalPages: 1 },
      source: results.length > 0 && results[0].source === 'UTAH_STATE' ? 'live' : 'cache',
    });
  } catch (error: any) {
    console.error('Utah warrants search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/warrants/utah/cache — Client-side direct search results imported to server cache
// When CloudFront blocks the server IP, the client fetches warrants.utah.gov directly
// from the user's browser and posts results here for caching.
router.post('/utah/cache', (req: Request, res: Response) => {
  try {
    const { results } = req.body;
    if (!Array.isArray(results) || results.length === 0) {
      res.json({ cached: 0 });
      return;
    }

    const db = getDb();
    const now = localNow();

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO utah_warrants
        (utah_person_id, first_name, middle_name, last_name, age, city,
         utah_warrant_id, issue_date, court_name, case_id, charges, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      for (const r of results) {
        if (!r.utah_person_id || !r.utah_warrant_id) continue;
        insertStmt.run(
          r.utah_person_id, r.first_name || '', r.middle_name || null,
          r.last_name || '', r.age || null, r.city || null,
          r.utah_warrant_id, r.issue_date || null,
          r.court_name || null, r.case_id || null,
          typeof r.charges === 'string' ? r.charges : JSON.stringify(r.charges || []),
          now
        );
      }
    });
    tx();

    res.json({ cached: results.length });
  } catch (error: any) {
    console.error('Cache Utah warrants error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/warrants/utah/count — Cached warrant count for tab badge
router.get('/utah/count', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM utah_warrants').get() as any;
    res.json({ count: row.count });
  } catch {
    res.json({ count: 0 });
  }
});

// GET /api/warrants/utah/sync-status — Status info for UI
router.get('/utah/sync-status', (req: Request, res: Response) => {
  try {
    const status = getUtahWarrantSyncStatus();
    res.json({
      lastSync: status.lastSync,
      status: status.status,
      personsFound: 0,
      warrantsFound: status.warrantCount,
      durationMs: 0,
      lastError: status.lastError,
      currentCount: status.warrantCount,
    });
  } catch {
    res.json({ lastSync: null, status: 'ready', currentCount: 0 });
  }
});

// ─── WARRANT WATCH — Automated scan log & controls ──────────────

// GET /api/warrants/watch/log — View warrant watch event log
router.get('/watch/log', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { event, person_id, page = '1', limit = '50' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (event === 'warrant_found' || event === 'warrant_cleared') {
      where += ' AND wl.event = ?';
      params.push(event);
    }
    if (person_id) {
      where += ' AND wl.person_id = ?';
      params.push(person_id);
    }

    const total = (db.prepare(`
      SELECT COUNT(*) as count FROM warrant_watch_log wl ${where}
    `).get(...params) as any)?.count || 0;

    const rows = db.prepare(`
      SELECT wl.*,
        p.photo_url, p.dob, p.caution_flags
      FROM warrant_watch_log wl
      LEFT JOIN persons p ON wl.person_id = p.id
      ${where}
      ORDER BY wl.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.json({
      data: rows,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    console.error('Get warrant watch log error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/warrants/watch/active — List persons with currently active warrants
router.get('/watch/active', (req: Request, res: Response) => {
  try {
    const db = getDb();

    // For each person, find their most recent "warrant_found" that doesn't have
    // a subsequent "warrant_cleared" for the same utah_warrant_id
    const rows = db.prepare(`
      SELECT DISTINCT
        wl.person_id,
        wl.person_name,
        wl.utah_warrant_id,
        wl.utah_person_id,
        wl.court_name,
        wl.case_id,
        wl.charges,
        wl.issue_date,
        wl.created_at as first_detected,
        p.photo_url, p.dob, p.caution_flags, p.address, p.city, p.state
      FROM warrant_watch_log wl
      LEFT JOIN persons p ON wl.person_id = p.id
      WHERE wl.event = 'warrant_found'
        AND NOT EXISTS (
          SELECT 1 FROM warrant_watch_log wl2
          WHERE wl2.person_id = wl.person_id
            AND wl2.utah_warrant_id = wl.utah_warrant_id
            AND wl2.event = 'warrant_cleared'
            AND wl2.created_at > wl.created_at
        )
      ORDER BY wl.created_at DESC
    `).all();

    res.json({ data: rows, total: rows.length });
  } catch (error: any) {
    console.error('Get active warrant watch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/warrants/watch/runs — View scan run history
router.get('/watch/runs', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { limit = '20' } = req.query;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));

    const runs = db.prepare(`
      SELECT * FROM warrant_watch_runs
      ORDER BY started_at DESC
      LIMIT ?
    `).all(limitNum);

    res.json({ data: runs });
  } catch (error: any) {
    console.error('Get warrant watch runs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/warrants/watch/scan — Trigger an immediate manual scan
router.post('/watch/scan', requireRole('admin', 'manager', 'supervisor'), async (req: Request, res: Response) => {
  try {
    // Start scan in background and return immediately
    res.json({ message: 'Warrant watch scan started', status: 'running' });

    // Run scan asynchronously (don't await in the response)
    runWarrantWatchScan().catch(err => {
      console.error('[Warrant Watch] Manual scan failed:', err.message);
    });
  } catch (error: any) {
    console.error('Trigger warrant watch scan error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(404).json({ error: 'Warrant not found' });
      return;
    }

    // Get activity log for this warrant
    const activity = db.prepare(`
      SELECT al.*, u.full_name as user_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = 'warrant' AND al.entity_id = ?
      ORDER BY al.created_at DESC
    `).all(warrant.id);

    res.json({
      ...warrant,
      activity,
    });
  } catch (error: any) {
    console.error('Get warrant error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(400).json({ error: 'type is required' });
      return;
    }
    if (!charge_description) {
      res.status(400).json({ error: 'charge_description is required' });
      return;
    }

    // Normalize type to lowercase to match CHECK constraint
    const normalizedType = String(type).toLowerCase();

    // Validate subject person exists if provided
    if (subject_person_id) {
      const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(subject_person_id) as any;
      if (!person) {
        res.status(404).json({ error: 'Subject person not found' });
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

    // Broadcast warrant event (minimal payload — no subject PII over WebSocket)
    broadcast('alerts', 'warrant', {
      action: 'created',
      id: warrant.id,
      warrant_number: warrant.warrant_number,
      type: warrant.type,
      status: warrant.status,
    });

    // Notify all sworn personnel of new warrant
    createNotificationForRoles(
      ['admin', 'manager', 'supervisor', 'officer'],
      'warrant', `New Warrant: ${warrant.warrant_number}`,
      `${warrant.type} warrant — ${warrant.charge_description || 'No description'}`,
      'warrant', warrant.id, 'high', 'warrant.created', req.user!.userId,
    );

    res.status(201).json(warrant);
  } catch (error: any) {
    console.error('Create warrant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/warrants/:id - Update warrant
router.put('/:id', requireRole('dispatcher', 'supervisor', 'admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    const warrant = db.prepare('SELECT * FROM warrants WHERE id = ?').get(req.params.id) as any;
    if (!warrant) {
      res.status(404).json({ error: 'Warrant not found' });
      return;
    }

    // Only allow updating non-served warrants
    if (warrant.status === 'served') {
      res.status(403).json({ error: 'Cannot update a served warrant' });
      return;
    }

    // Validate subject person exists if provided
    if (req.body.subject_person_id) {
      const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.body.subject_person_id) as any;
      if (!person) {
        res.status(404).json({ error: 'Subject person not found' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/warrants/:id/serve - Serve a warrant
router.put('/:id/serve', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    const warrant = db.prepare('SELECT * FROM warrants WHERE id = ?').get(req.params.id) as any;
    if (!warrant) {
      res.status(404).json({ error: 'Warrant not found' });
      return;
    }

    if (warrant.status !== 'active') {
      res.status(400).json({ error: 'Only active warrants can be served' });
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

    // Broadcast warrant served event (minimal payload — no subject PII over WebSocket)
    broadcast('alerts', 'warrant', {
      action: 'served',
      id: updated.id,
      warrant_number: updated.warrant_number,
      type: updated.type,
      status: updated.status,
    });

    // Notify supervisors warrant was served
    createNotificationForRoles(
      ['admin', 'manager', 'supervisor'],
      'warrant', `Warrant Served: ${updated.warrant_number}`,
      `${updated.type} warrant served${served_location ? ` at ${served_location}` : ''}`,
      'warrant', updated.id, 'normal', 'warrant.served', req.user!.userId,
    );

    res.json(updated);
  } catch (error: any) {
    console.error('Serve warrant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/warrants/:id - Delete warrant (non-active only)
router.delete('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const warrant = db.prepare('SELECT * FROM warrants WHERE id = ?').get(req.params.id) as any;
    if (!warrant) { res.status(404).json({ error: 'Warrant not found' }); return; }
    if (warrant.status === 'active') {
      res.status(400).json({ error: 'Cannot delete an active warrant. Change status first.' });
      return;
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/warrants/:id/archive
router.post('/:id/archive', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const warrant = db.prepare('SELECT * FROM warrants WHERE id = ?').get(req.params.id) as any;
    if (!warrant) { res.status(404).json({ error: 'Warrant not found' }); return; }
    if (warrant.archived_at) { res.status(400).json({ error: 'Warrant is already archived' }); return; }

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/warrants/:id/unarchive
router.post('/:id/unarchive', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const warrant = db.prepare('SELECT * FROM warrants WHERE id = ?').get(req.params.id) as any;
    if (!warrant) { res.status(404).json({ error: 'Warrant not found' }); return; }
    if (!warrant.archived_at) { res.status(400).json({ error: 'Warrant is not archived' }); return; }

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// MULTI-STATE WARRANT SCRAPER — Scraped warrants from all states
// ═══════════════════════════════════════════════════════════════

// GET /api/warrants/scraped/search — Search scraped warrants by name
router.get('/scraped/search', (req: Request, res: Response) => {
  try {
    const { q, state, status, page = '1', limit = '50' } = req.query;
    if (!q || String(q).trim().length < 2) {
      res.json({ data: [], total: 0, pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } });
      return;
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const result = searchScrapedWarrants(String(q), {
      state: state ? String(state) : undefined,
      status: status ? String(status) : undefined,
      limit: limitNum,
      offset,
    });

    res.json({
      data: result.data,
      total: result.total,
      pagination: { page: pageNum, limit: limitNum, total: result.total, totalPages: Math.ceil(result.total / limitNum) },
    });
  } catch (error: any) {
    console.error('Search scraped warrants error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/warrants/scraped/active — All active scraped warrants
router.get('/scraped/active', (req: Request, res: Response) => {
  try {
    const { state, limit = '200' } = req.query;
    const data = getActiveScrapedWarrants({
      state: state ? String(state) : undefined,
      limit: Math.min(500, parseInt(limit as string, 10) || 200),
    });
    res.json({ data, total: data.length });
  } catch (error: any) {
    console.error('Get active scraped warrants error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/warrants/scraped/stats — Warrant scraper statistics
router.get('/scraped/stats', (req: Request, res: Response) => {
  try {
    const stats = getWarrantScraperStats();
    res.json(stats);
  } catch (error: any) {
    console.error('Get warrant scraper stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/warrants/scraped/status — Scraper config status for all sources
router.get('/scraped/status', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const status = getWarrantScraperStatus();
    res.json({ data: status });
  } catch (error: any) {
    console.error('Get warrant scraper status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/warrants/scraped/person/:personId — Check person for active warrants
router.get('/scraped/person/:personId', (req: Request, res: Response) => {
  try {
    const personId = parseInt(String(req.params.personId), 10);
    if (isNaN(personId)) {
      res.status(400).json({ error: 'Invalid person ID' });
      return;
    }
    const warrants = checkPersonWarrants(personId);
    res.json({ data: warrants, total: warrants.length, has_active_warrants: warrants.length > 0 });
  } catch (error: any) {
    console.error('Check person warrants error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/warrants/scraped/scrape/:sourceKey — Trigger manual scrape
router.post('/scraped/scrape/:sourceKey', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const sourceKey = String(req.params.sourceKey);
    res.json({ message: `Scrape started for ${sourceKey}`, status: 'running' });

    // Run scrape in background
    manualScrapeSource(sourceKey).catch(err => {
      console.error(`[Warrant Scraper] Manual scrape failed for ${sourceKey}:`, err.message);
    });
  } catch (error: any) {
    console.error('Manual warrant scrape error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/warrants/scraped/reset/:sourceKey — Reset source errors
router.post('/scraped/reset/:sourceKey', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const sourceKey = String(req.params.sourceKey);
    resetWarrantSourceErrors(sourceKey);
    res.json({ message: `Errors reset for ${sourceKey}`, success: true });
  } catch (error: any) {
    console.error('Reset warrant source errors:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/warrants/scraped/enable/:sourceKey — Enable/disable a source
router.put('/scraped/enable/:sourceKey', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const sourceKey = String(req.params.sourceKey);
    const { enabled } = req.body;
    setWarrantSourceEnabled(sourceKey, Boolean(enabled));
    res.json({ message: `Source ${sourceKey} ${enabled ? 'enabled' : 'disabled'}`, success: true });
  } catch (error: any) {
    console.error('Toggle warrant source error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════
//  COURT RECORDS — Public Court Record Search
// ════════════════════════════════════════════════════════════

// GET /api/warrants/court-records/search?firstName=&lastName=
router.get('/court-records/search', async (req: Request, res: Response) => {
  try {
    const firstName = String(req.query.firstName || '').trim();
    const lastName = String(req.query.lastName || '').trim();
    if (!firstName || !lastName) {
      res.status(400).json({ error: 'firstName and lastName are required' });
      return;
    }

    const states = req.query.states ? String(req.query.states).split(',') : undefined;
    const result = await searchCourtRecords(firstName, lastName, { states });
    res.json(result);
  } catch (error: any) {
    console.error('Court records search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/warrants/court-records/person/:personId
router.get('/court-records/person/:personId', (req: Request, res: Response) => {
  try {
    const personId = parseInt(String(req.params.personId), 10);
    if (isNaN(personId)) {
      res.status(400).json({ error: 'Invalid person ID' });
      return;
    }

    const records = getCourtRecordsByPersonId(personId);
    res.json({ records, total: records.length });
  } catch (error: any) {
    console.error('Court records by person error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/warrants/court-records/stats
router.get('/court-records/stats', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const stats = getCourtRecordStats();
    res.json(stats);
  } catch (error: any) {
    console.error('Court records stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
