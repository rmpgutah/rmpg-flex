// ============================================================
// RMPG Flex — NIBRS Code Lookups + Export
// Read-only endpoints for the FBI NIBRS code tables (seeded by
// nibrsCodes.ts) plus the export route added in NB-3. NB-2's
// validator is exposed via /api/incidents/:id/nibrs-validate
// in the existing incidents router.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { buildNibrsExport } from '../utils/nibrsFlatFile';
import { auditLog } from '../utils/auditLogger';
import { logger } from '../utils/logger';

const router = Router();
router.use(authenticateToken);

// GET /api/nibrs/codes/offenses?group=A|B&active=1
router.get('/codes/offenses', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const group = typeof req.query.group === 'string' ? req.query.group.toUpperCase() : null;
    const activeOnly = req.query.active !== '0';
    const params: any[] = [];
    const wheres: string[] = [];
    if (group === 'A' || group === 'B') {
      wheres.push('ucr_group = ?');
      params.push(group);
    }
    if (activeOnly) wheres.push('active = 1');
    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM nibrs_offense_codes ${where} ORDER BY ucr_group, code`).all(...params);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, '[nibrs] offenses list error');
    res.status(500).json({ error: 'Failed to list NIBRS offenses', code: 'NIBRS_LIST_ERR' });
  }
});

// GET /api/nibrs/codes/locations
router.get('/codes/locations', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    res.json(db.prepare('SELECT * FROM nibrs_location_codes ORDER BY code').all());
  } catch (err) {
    res.status(500).json({ error: 'Failed to list location codes', code: 'NIBRS_LOC_ERR' });
  }
});

// GET /api/nibrs/codes/weapons
router.get('/codes/weapons', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    res.json(db.prepare('SELECT * FROM nibrs_weapon_codes ORDER BY code').all());
  } catch (err) {
    res.status(500).json({ error: 'Failed to list weapon codes', code: 'NIBRS_WEAPON_ERR' });
  }
});

// GET /api/nibrs/codes/biases
router.get('/codes/biases', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    res.json(db.prepare('SELECT * FROM nibrs_bias_codes ORDER BY code').all());
  } catch (err) {
    res.status(500).json({ error: 'Failed to list bias codes', code: 'NIBRS_BIAS_ERR' });
  }
});

// GET /api/nibrs/codes/properties
router.get('/codes/properties', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    res.json(db.prepare('SELECT * FROM nibrs_property_descriptions ORDER BY code').all());
  } catch (err) {
    res.status(500).json({ error: 'Failed to list property codes', code: 'NIBRS_PROP_ERR' });
  }
});

// GET /api/nibrs/codes/loss-types
router.get('/codes/loss-types', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    res.json(db.prepare('SELECT * FROM nibrs_property_loss_types ORDER BY code').all());
  } catch (err) {
    res.status(500).json({ error: 'Failed to list loss types', code: 'NIBRS_LOSS_ERR' });
  }
});

// GET /api/nibrs/codes — all-in-one for client dropdowns
router.get('/codes', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    res.json({
      offenses:   db.prepare('SELECT * FROM nibrs_offense_codes WHERE active = 1 ORDER BY ucr_group, code').all(),
      locations:  db.prepare('SELECT * FROM nibrs_location_codes ORDER BY code').all(),
      weapons:    db.prepare('SELECT * FROM nibrs_weapon_codes ORDER BY code').all(),
      biases:     db.prepare('SELECT * FROM nibrs_bias_codes ORDER BY code').all(),
      properties: db.prepare('SELECT * FROM nibrs_property_descriptions ORDER BY code').all(),
      lossTypes:  db.prepare('SELECT * FROM nibrs_property_loss_types ORDER BY code').all(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load NIBRS codes', code: 'NIBRS_ALL_ERR' });
  }
});

// ─────────────────────────────────────────────────────────────
// NB-3: Export endpoint
// POST /api/nibrs/export?from=YYYY-MM-DD&to=YYYY-MM-DD[&dryRun=1][&force=1]
//   dryRun=1  → JSON envelope { included, excluded, totalSegments } only
//   force=1   → emit invalid incidents too (admin only); logged as override
//   default   → application/octet-stream NIBRS .dat with sidecar header
//               X-NIBRS-Excluded-Count and X-NIBRS-Included-Count
// ─────────────────────────────────────────────────────────────
router.post('/export', requireRole('admin', 'manager', 'supervisor'), async (req: Request, res: Response) => {
  try {
    const fromStr = String(req.query.from || '');
    const toStr   = String(req.query.to || '');
    const fromDate = new Date(fromStr || '1970-01-01');
    const toDate   = new Date(toStr || new Date().toISOString());
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      res.status(400).json({ error: 'Invalid from/to date (use YYYY-MM-DD)', code: 'NIBRS_BAD_DATES' });
      return;
    }
    if (toDate < fromDate) {
      res.status(400).json({ error: 'to must be >= from', code: 'NIBRS_DATE_ORDER' });
      return;
    }

    const dryRun = req.query.dryRun === '1';
    const force = req.query.force === '1' && req.user?.role === 'admin';

    const result = await buildNibrsExport({
      fromDate,
      toDate,
      enforceValidation: !force,
    });

    auditLog(req, force ? 'NIBRS_EXPORT_FORCED' : 'NIBRS_EXPORT', 'nibrs', 0,
      `NIBRS export ${fromStr}..${toStr}: ${result.included.length} included, ${result.excluded.length} excluded, ${result.totalSegments} segments`);

    if (dryRun) {
      res.json({
        from: fromStr,
        to: toStr,
        included: result.included,
        excluded: result.excluded,
        totalSegments: result.totalSegments,
        force,
      });
      return;
    }

    const filename = `nibrs-${fromStr || 'start'}-to-${toStr || 'now'}.dat`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-NIBRS-Included-Count', String(result.included.length));
    res.setHeader('X-NIBRS-Excluded-Count', String(result.excluded.length));
    res.setHeader('X-NIBRS-Segment-Count', String(result.totalSegments));
    res.send(result.content);
  } catch (err) {
    logger.error({ err }, '[nibrs] export error');
    res.status(500).json({ error: 'NIBRS export failed', code: 'NIBRS_EXPORT_ERR' });
  }
});

export default router;
