// ============================================================
// RMPG Flex — Sex Offender Registry API Routes
// ============================================================
// Manages sex offender registry records with search, CRUD,
// compliance verification, and bulk import capabilities.
// Designed to integrate with official data feeds (USORS, NCIC)
// when available; supports manual entry and CSV import initially.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow, dateToLocalYMD } from '../utils/timeUtils';
import { validateParamId, escapeLike } from '../middleware/sanitize';
import { auditLog } from '../utils/auditLogger';

const router = Router();
router.use(authenticateToken);

// ─── GET /stats ──────────────────────────────────────────
// Restricted: SOR data contains sensitive PII (addresses, photos, personal identifiers)
router.get('/stats', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) as count FROM sex_offender_registry').get() as any)?.count || 0;
    const tierCounts = db.prepare(
      'SELECT tier, COUNT(*) as count FROM sex_offender_registry GROUP BY tier ORDER BY tier'
    ).all() as any[];
    const statusCounts = db.prepare(
      'SELECT registration_status, COUNT(*) as count FROM sex_offender_registry GROUP BY registration_status'
    ).all() as any[];
    const nonCompliant = (db.prepare(
      "SELECT COUNT(*) as count FROM sex_offender_registry WHERE registration_status IN ('non_compliant', 'absconded')"
    ).get() as any)?.count || 0;
    const dueForVerification = (db.prepare(
      "SELECT COUNT(*) as count FROM sex_offender_registry WHERE next_verification_due IS NOT NULL AND next_verification_due <= DATE('now', '+30 days')"
    ).get() as any)?.count || 0;

    res.json({
      data: {
        total,
        by_tier: Object.fromEntries(tierCounts.map(r => [r.tier, r.count])),
        by_status: Object.fromEntries(statusCounts.map(r => [r.registration_status, r.count])),
        non_compliant: nonCompliant,
        due_for_verification: dueForVerification,
      },
    });
  } catch (error: any) {
    console.error('SOR stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET / ───────────────────────────────────────────────
router.get('/', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { search, tier, status, risk_level, page = '1', limit = '25' } = req.query;
    const pageNum = Math.min(10000, Math.max(1, parseInt(page as string, 10) || 1));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 25));
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (tier) { where += ' AND s.tier = ?'; params.push(parseInt(tier as string, 10)); }
    if (status) { where += ' AND s.registration_status = ?'; params.push(status); }
    if (risk_level) { where += ' AND s.risk_level = ?'; params.push(risk_level); }
    if (search) {
      where += " AND (s.first_name LIKE ? ESCAPE '\\' OR s.last_name LIKE ? ESCAPE '\\' OR s.registry_id LIKE ? ESCAPE '\\' OR s.aliases LIKE ? ESCAPE '\\')";
      const s2 = `%${escapeLike(String(search).trim())}%`; params.push(s2, s2, s2, s2);
    }

    const total = (db.prepare(`SELECT COUNT(*) as count FROM sex_offender_registry s ${where}`).get(...params) as any)?.count || 0;

    const rows = db.prepare(`
      SELECT s.* FROM sex_offender_registry s
      ${where}
      ORDER BY
        CASE s.registration_status
          WHEN 'absconded' THEN 0
          WHEN 'non_compliant' THEN 1
          WHEN 'compliant' THEN 2
          WHEN 'incarcerated' THEN 3
          ELSE 4
        END,
        s.tier DESC,
        s.last_name, s.first_name
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.json({
      data: rows,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    console.error('SOR list error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /:id ────────────────────────────────────────────
router.get('/:id', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sex_offender_registry WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Record not found' });
    res.json({ data: row });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST / ─────────────────────────────────────────────
router.post('/', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const {
      person_id, registry_id, first_name, last_name, middle_name, aliases,
      dob, gender, race, height, weight, hair_color, eye_color, scars_marks_tattoos,
      photo_url, tier, risk_level, registration_status, registration_date, expiration_date,
      last_verification, next_verification_due, registration_jurisdiction,
      offenses, conviction_state, addresses, vehicles,
      employer, employer_address, school, school_address,
      restrictions, conditions, supervising_officer, source, notes,
    } = req.body;

    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'First and last name required' });
    }

    const result = db.prepare(`
      INSERT INTO sex_offender_registry (
        person_id, registry_id, first_name, last_name, middle_name, aliases,
        dob, gender, race, height, weight, hair_color, eye_color, scars_marks_tattoos,
        photo_url, tier, risk_level, registration_status, registration_date, expiration_date,
        last_verification, next_verification_due, registration_jurisdiction,
        offenses, conviction_state, addresses, vehicles,
        employer, employer_address, school, school_address,
        restrictions, conditions, supervising_officer, source, notes,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      person_id || null, registry_id || null, first_name, last_name, middle_name || null,
      typeof aliases === 'string' ? aliases : JSON.stringify(aliases || []),
      dob || null, gender || null, race || null, height || null, weight || null,
      hair_color || null, eye_color || null, scars_marks_tattoos || null, photo_url || null,
      tier ?? 1, risk_level || null, registration_status || 'compliant',
      registration_date || null, expiration_date || null,
      last_verification || null, next_verification_due || null,
      registration_jurisdiction || null,
      typeof offenses === 'string' ? offenses : JSON.stringify(offenses || []),
      conviction_state || null,
      typeof addresses === 'string' ? addresses : JSON.stringify(addresses || []),
      typeof vehicles === 'string' ? vehicles : JSON.stringify(vehicles || []),
      employer || null, employer_address || null, school || null, school_address || null,
      restrictions || null,
      typeof conditions === 'string' ? conditions : JSON.stringify(conditions || []),
      supervising_officer || null, source || 'manual', notes || null,
      req.user!.userId, now, now,
    );

    // Cross-link to persons table if person_id provided
    if (person_id) {
      try {
        db.prepare('UPDATE persons SET is_sex_offender = 1, updated_at = ? WHERE id = ?').run(now, person_id);
      } catch { /* silent — person may not exist */ }
    }

    auditLog(req, 'CREATE', 'person', Number(result.lastInsertRowid) as number,
      JSON.stringify({ first_name, last_name, tier, registration_status: registration_status || 'compliant' }));

    auditLog(req, 'CREATE' as any, 'colorado_doc_offenders' as any, Number(result.lastInsertRowid), `Created SOR entry: ${first_name} ${last_name}`);

    res.status(201).json({ data: { id: Number(result.lastInsertRowid) } });
  } catch (error: any) {
    console.error('SOR create error:', error?.message || 'Unknown error');
    if (error.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Registry ID already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id ────────────────────────────────────────────
router.put('/:id', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const allowedFields = [
      'person_id', 'registry_id', 'first_name', 'last_name', 'middle_name',
      'dob', 'gender', 'race', 'height', 'weight', 'hair_color', 'eye_color',
      'scars_marks_tattoos', 'photo_url', 'tier', 'risk_level', 'registration_status',
      'registration_date', 'expiration_date', 'last_verification', 'next_verification_due',
      'registration_jurisdiction', 'conviction_state',
      'employer', 'employer_address', 'school', 'school_address',
      'restrictions', 'supervising_officer', 'source', 'notes',
    ];
    const jsonFields = ['aliases', 'offenses', 'addresses', 'vehicles', 'conditions'];

    const updates: string[] = ['updated_at = ?'];
    const params: any[] = [now];

    for (const f of allowedFields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    }
    for (const f of jsonFields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        params.push(typeof req.body[f] === 'string' ? req.body[f] : JSON.stringify(req.body[f]));
      }
    }

    params.push(req.params.id);
    db.prepare(`UPDATE sex_offender_registry SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    auditLog(req, 'UPDATE', 'person', parseInt(String(req.params.id), 10), `Updated SOR record #${req.params.id}`);

    res.json({ data: { id: parseInt(req.params.id as string, 10) } });
  } catch (error: any) {
    console.error('SOR update error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id/verify ─────────────────────────────────────
// Log a compliance verification check
router.put('/:id/verify', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { status, notes } = req.body;

    // Calculate next verification based on tier
    const record = db.prepare('SELECT tier FROM sex_offender_registry WHERE id = ?').get(req.params.id) as any;
    if (!record) return res.status(404).json({ error: 'Record not found' });

    // Tier 3 = every 90 days, Tier 2 = every 180 days, Tier 1 = every 365 days
    const intervalDays = record.tier === 3 ? 90 : record.tier === 2 ? 180 : 365;
    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + intervalDays);
    const nextDueStr = dateToLocalYMD(nextDue);

    const updates: string[] = [
      'last_verification = ?',
      'next_verification_due = ?',
      'updated_at = ?',
    ];
    const params: any[] = [now, nextDueStr, now];

    if (status) { updates.push('registration_status = ?'); params.push(status); }
    if (notes) { updates.push('notes = ?'); params.push(notes); }

    params.push(req.params.id);
    db.prepare(`UPDATE sex_offender_registry SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    auditLog(req, 'UPDATE', 'person', parseInt(String(req.params.id), 10), `Verified SOR record #${req.params.id}, next due: ${nextDueStr}`);

    res.json({ data: { id: parseInt(req.params.id as string, 10), last_verification: now, next_verification_due: nextDueStr } });
  } catch (error: any) {
    console.error('SOR verify error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /import ────────────────────────────────────────
// Bulk import from JSON array
router.post('/import', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'Records array required' });
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO sex_offender_registry (
        registry_id, first_name, last_name, middle_name, aliases,
        dob, gender, race, height, weight, hair_color, eye_color, scars_marks_tattoos,
        photo_url, tier, risk_level, registration_status, registration_date, expiration_date,
        registration_jurisdiction, offenses, conviction_state, addresses, vehicles,
        employer, employer_address, restrictions, supervising_officer,
        source, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let imported = 0;
    let skipped = 0;

    const tx = db.transaction(() => {
      for (const r of records) {
        if (!r.first_name || !r.last_name) { skipped++; continue; }
        try {
          const result = insert.run(
            r.registry_id || null, r.first_name, r.last_name, r.middle_name || null,
            typeof r.aliases === 'string' ? r.aliases : JSON.stringify(r.aliases || []),
            r.dob || null, r.gender || null, r.race || null,
            r.height || null, r.weight || null, r.hair_color || null, r.eye_color || null,
            r.scars_marks_tattoos || null, r.photo_url || null,
            r.tier ?? 1, r.risk_level || null, r.registration_status || 'compliant',
            r.registration_date || null, r.expiration_date || null,
            r.registration_jurisdiction || null,
            typeof r.offenses === 'string' ? r.offenses : JSON.stringify(r.offenses || []),
            r.conviction_state || null,
            typeof r.addresses === 'string' ? r.addresses : JSON.stringify(r.addresses || []),
            typeof r.vehicles === 'string' ? r.vehicles : JSON.stringify(r.vehicles || []),
            r.employer || null, r.employer_address || null,
            r.restrictions || null, r.supervising_officer || null,
            'csv_import', req.user!.userId, now, now,
          );
          if (result.changes > 0) imported++; else skipped++;
        } catch { skipped++; }
      }
    });
    tx();

    auditLog(req, 'CREATE', 'person', 0, `Bulk imported SOR records: ${imported} imported, ${skipped} skipped of ${records.length} total`);

    res.json({ data: { imported, skipped, total: records.length } });
  } catch (error: any) {
    console.error('SOR import error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
