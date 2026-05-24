/**
 * NIBRS routes — reference-data reads + flat-file export.
 *
 * GET  /api/nibrs/codes                                  — combined manifest
 * GET  /api/nibrs/codes/offenses|locations|weapons|biases|properties|loss-types
 * POST /api/nibrs/export?from=YYYY-MM-DD&to=YYYY-MM-DD&dryRun=1
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { paramStr } from '../utils/reqHelpers';
import { buildNibrsFlatFile } from '../utils/nibrsFlatFile';
import { logger } from '../utils/logger';

const router = Router();
router.use(authenticateToken);

const codeTables = [
  { url: 'offenses',    table: 'nibrs_offense_codes',    extra: 'crime_against, group_class, attempted_completed_required, victim_required, property_required' },
  { url: 'locations',   table: 'nibrs_location_codes',   extra: '' },
  { url: 'weapons',     table: 'nibrs_weapon_codes',     extra: '' },
  { url: 'biases',      table: 'nibrs_bias_codes',       extra: '' },
  { url: 'properties',  table: 'nibrs_property_codes',   extra: '' },
  { url: 'loss-types',  table: 'nibrs_loss_type_codes',  extra: '' },
];

router.get('/codes', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const out: Record<string, unknown[]> = {};
    for (const t of codeTables) {
      const cols = t.extra ? `code, description, ${t.extra}` : `code, description`;
      out[t.url.replace('-', '_')] = db.prepare(`SELECT ${cols} FROM ${t.table} WHERE active = 1 ORDER BY code`).all();
    }
    res.json(out);
  } catch (err: any) {
    logger.error({ err }, 'nibrs codes manifest failed');
    res.status(500).json({ error: 'Failed to load NIBRS codes', code: 'NIBRS_CODES_ERROR' });
  }
});

for (const t of codeTables) {
  router.get(`/codes/${t.url}`, (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const cols = t.extra ? `code, description, ${t.extra}` : `code, description`;
      res.json(db.prepare(`SELECT ${cols} FROM ${t.table} WHERE active = 1 ORDER BY code`).all());
    } catch (err: any) {
      logger.error({ err, table: t.table }, 'nibrs code table failed');
      res.status(500).json({ error: `Failed to load ${t.url}`, code: 'NIBRS_CODES_ERROR' });
    }
  });
}

router.post('/export', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const from = paramStr(req.query.from);
    const to = paramStr(req.query.to);
    const dryRun = paramStr(req.query.dryRun) === '1';
    const forced = paramStr(req.query.force) === '1' && req.user?.role === 'admin';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)', code: 'INVALID_DATE_RANGE' });
      return;
    }

    const result = buildNibrsFlatFile(db, { dateFrom: from, dateTo: to, includeForced: forced });

    if (dryRun) {
      res.json({
        dryRun: true,
        incidentCount: result.incidentCount,
        segmentCount: result.segmentCount,
        byteSize: result.byteSize,
        sha256: result.sha256,
      });
      return;
    }

    // Persist to disk for audit; return as attachment.
    const outDir = path.join(process.cwd(), 'server', 'data', 'nibrs-exports');
    try { fs.mkdirSync(outDir, { recursive: true }); } catch { /* ignore */ }
    const filename = `nibrs-${from}_${to}-${result.sha256.slice(0, 8)}.txt`;
    const fullPath = path.join(outDir, filename);
    fs.writeFileSync(fullPath, result.body, 'utf8');

    const ori = process.env.NIBRS_AGENCY_ORI || 'UTRMPG000';
    const insert = db.prepare(`
      INSERT INTO nibrs_exports (ori, date_from, date_to, incident_count, segment_count, byte_size, generated_by, forced, file_sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ori, from, to, result.incidentCount, result.segmentCount, result.byteSize, req.user!.userId, forced ? 1 : 0, result.sha256);

    auditLog(req, 'NIBRS_EXPORT', 'nibrs_export', Number(insert.lastInsertRowid), null, { from, to, sha256: result.sha256, incidents: result.incidentCount });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-NIBRS-SHA256', result.sha256);
    res.setHeader('X-NIBRS-Incidents', String(result.incidentCount));
    res.setHeader('X-NIBRS-Segments', String(result.segmentCount));
    res.send(result.body);
  } catch (err: any) {
    logger.error({ err }, 'nibrs export failed');
    res.status(500).json({ error: 'Failed to generate NIBRS export', code: 'NIBRS_EXPORT_ERROR' });
  }
});

router.get('/exports', requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    res.json(db.prepare(`
      SELECT e.*, u.full_name as generated_by_name
      FROM nibrs_exports e LEFT JOIN users u ON e.generated_by = u.id
      ORDER BY e.created_at DESC LIMIT 100
    `).all());
  } catch (err: any) {
    logger.error({ err }, 'nibrs exports list failed');
    res.status(500).json({ error: 'Failed to list NIBRS exports', code: 'NIBRS_EXPORTS_LIST_ERROR' });
  }
});

export default router;
