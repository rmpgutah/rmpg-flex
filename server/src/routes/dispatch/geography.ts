// ============================================================
// RMPG Flex — Dispatch Geography Management
// Full CRUD for Areas, Sections, Zones, Beats, Dispatch Codes,
// and Premise Alerts. Powers the dispatch district system.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { escapeLike } from '../../middleware/sanitize';
import { auditLog } from '../../utils/auditLogger';
import { identifyBeat } from '../../utils/geofence';

const router = Router();

// ── Helpers ─────────────────────────────────────────────────

function setCacheHeaders(res: Response, seconds: number) {
  res.set('Cache-Control', `private, max-age=${seconds}`);
}

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ════════════════════════════════════════════════════════════
// AREAS — Top-level geographic groupings
// ════════════════════════════════════════════════════════════

router.get('/geography/areas', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const areas = db.prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM dispatch_sectors WHERE area_id = a.id) as section_count
      FROM dispatch_areas a
      ORDER BY a.sort_order, a.area_name
    `).all();
    setCacheHeaders(res, 30);
    res.json(areas);
  } catch (err: any) {
    if (err?.message?.includes('no such table')) { res.json([]); return; }
    res.status(500).json({ error: 'Failed to load areas' });
  }
});

router.post('/geography/areas', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { area_code, area_name, color, description, commander, notes, sort_order } = req.body;
    if (!area_code || !area_name) { res.status(400).json({ error: 'area_code and area_name required' }); return; }
    const result = db.prepare(`
      INSERT INTO dispatch_areas (area_code, area_name, color, description, commander, notes, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(area_code, area_name, color || '#6366f1', description, commander, notes, sort_order || 0);
    auditLog(req, 'CREATE', 'dispatch_areas', result.lastInsertRowid as number, JSON.stringify(req.body));
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) { res.status(409).json({ error: 'Area code already exists' }); return; }
    res.status(500).json({ error: 'Failed to create area' });
  }
});

router.put('/geography/areas/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    const old = db.prepare('SELECT * FROM dispatch_areas WHERE id = ?').get(id);
    if (!old) { res.status(404).json({ error: 'Area not found' }); return; }
    const fields = ['area_code', 'area_name', 'color', 'description', 'commander', 'notes', 'sort_order', 'active'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    updates.push('updated_at = ?'); values.push(now());
    values.push(id);
    db.prepare(`UPDATE dispatch_areas SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    auditLog(req, 'UPDATE', 'dispatch_areas', id, JSON.stringify(req.body));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update area' });
  }
});

router.delete('/geography/areas/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    db.prepare('UPDATE dispatch_sectors SET area_id = NULL WHERE area_id = ?').run(id);
    db.prepare('DELETE FROM dispatch_areas WHERE id = ?').run(id);
    auditLog(req, 'DELETE', 'dispatch_areas', id, '');
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to delete area' }); }
});

// ════════════════════════════════════════════════════════════
// SECTORS — Alias of SECTIONS (new nomenclature: Area=state, Sector=county)
// Routes accept sector_code/sector_name in body, map to sector_code/sector_name
// GET returns rows with both naming conventions for transition compatibility
// ════════════════════════════════════════════════════════════

router.get('/geography/sectors', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const areaId = req.query.area_id ? parseInt(req.query.area_id as string, 10) : null;
    let query = `
      SELECT s.*,
        s.sector_code AS sector_code, s.sector_name AS sector_name,
        a.area_name, a.area_code,
        (SELECT COUNT(*) FROM dispatch_zones WHERE sector_id = s.id) as zone_count
      FROM dispatch_sectors s
      LEFT JOIN dispatch_areas a ON a.id = s.area_id
    `;
    const params: any[] = [];
    if (areaId) { query += ' WHERE s.area_id = ?'; params.push(areaId); }
    query += ' ORDER BY s.sort_order, s.sector_name';
    const sectors = db.prepare(query).all(...params);
    setCacheHeaders(res, 30);
    res.json(sectors);
  } catch (err: any) {
    if (err?.message?.includes('no such table')) { res.json([]); return; }
    res.status(500).json({ error: 'Failed to load sectors' });
  }
});

router.post('/geography/sectors', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const sector_code = req.body.sector_code || req.body.sector_code;
    const sector_name = req.body.sector_name || req.body.sector_name;
    const { area_id, color, description, supervisor, radio_channel, notes, sort_order } = req.body;
    if (!sector_code || !sector_name) { res.status(400).json({ error: 'sector_code and sector_name required' }); return; }
    const result = db.prepare(`
      INSERT INTO dispatch_sectors (sector_code, sector_name, area_id, color, description, supervisor, radio_channel, notes, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sector_code, sector_name, area_id || null, color || '#888888', description, supervisor, radio_channel, notes, sort_order || 0);
    auditLog(req, 'CREATE', 'dispatch_sectors', result.lastInsertRowid as number, JSON.stringify(req.body));
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) { res.status(409).json({ error: 'Sector code already exists' }); return; }
    res.status(500).json({ error: 'Failed to create sector' });
  }
});

router.put('/geography/sectors/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    const old = db.prepare('SELECT * FROM dispatch_sectors WHERE id = ?').get(id);
    if (!old) { res.status(404).json({ error: 'Sector not found' }); return; }
    // Accept both sector_* and section_* field names
    const body = { ...req.body };
    if (body.sector_code !== undefined) body.sector_code = body.sector_code;
    if (body.sector_name !== undefined) body.sector_name = body.sector_name;
    const fields = ['sector_code', 'sector_name', 'area_id', 'color', 'description', 'supervisor', 'radio_channel', 'notes', 'sort_order', 'active'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) { updates.push(`${f} = ?`); values.push(body[f]); }
    }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    updates.push('updated_at = ?'); values.push(now());
    values.push(id);
    db.prepare(`UPDATE dispatch_sectors SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    auditLog(req, 'UPDATE', 'dispatch_sectors', id, JSON.stringify(req.body));
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to update sector' }); }
});

router.delete('/geography/sectors/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    db.prepare('UPDATE dispatch_zones SET sector_id = NULL WHERE sector_id = ?').run(id);
    db.prepare('DELETE FROM dispatch_sectors WHERE id = ?').run(id);
    auditLog(req, 'DELETE', 'dispatch_sectors', id, '');
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to delete sector' }); }
});

// ════════════════════════════════════════════════════════════
// ZONES — Third-level divisions within sectors
// ════════════════════════════════════════════════════════════

router.get('/geography/zones', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const sectionId = req.query.sector_id ? parseInt(req.query.sector_id as string, 10) : null;
    let query = `
      SELECT z.*,
        s.sector_code, s.sector_name,
        (SELECT COUNT(*) FROM dispatch_beats WHERE zone_id = z.id) as beat_count,
        (SELECT COUNT(*) FROM calls_for_service WHERE zone_id = z.zone_code AND status NOT IN ('closed','archived','cancelled')) as active_calls
      FROM dispatch_zones z
      LEFT JOIN dispatch_sectors s ON s.id = z.sector_id
    `;
    const params: any[] = [];
    if (sectionId) { query += ' WHERE z.sector_id = ?'; params.push(sectionId); }
    query += ' ORDER BY z.sort_order, z.zone_name';
    const zones = db.prepare(query).all(...params);
    setCacheHeaders(res, 30);
    res.json(zones);
  } catch (err: any) {
    if (err?.message?.includes('no such table')) { res.json([]); return; }
    res.status(500).json({ error: 'Failed to load zones' });
  }
});

router.post('/geography/zones', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { zone_code, zone_name, sector_id, color, description, primary_unit, backup_unit, radio_channel, hazard_notes, notes, population_estimate, sq_miles, sort_order } = req.body;
    if (!zone_code || !zone_name) { res.status(400).json({ error: 'zone_code and zone_name required' }); return; }
    const result = db.prepare(`
      INSERT INTO dispatch_zones (zone_code, zone_name, sector_id, color, description, primary_unit, backup_unit, radio_channel, hazard_notes, notes, population_estimate, sq_miles, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(zone_code, zone_name, sector_id || null, color, description, primary_unit, backup_unit, radio_channel, hazard_notes, notes, population_estimate, sq_miles, sort_order || 0);
    auditLog(req, 'CREATE', 'dispatch_zones', result.lastInsertRowid as number, JSON.stringify(req.body));
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) { res.status(409).json({ error: 'Zone code already exists' }); return; }
    res.status(500).json({ error: 'Failed to create zone' });
  }
});

router.put('/geography/zones/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    const old = db.prepare('SELECT * FROM dispatch_zones WHERE id = ?').get(id);
    if (!old) { res.status(404).json({ error: 'Zone not found' }); return; }
    const fields = ['zone_code', 'zone_name', 'sector_id', 'color', 'description', 'primary_unit', 'backup_unit', 'radio_channel', 'hazard_notes', 'notes', 'population_estimate', 'sq_miles', 'sort_order', 'active'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    updates.push('updated_at = ?'); values.push(now());
    values.push(id);
    db.prepare(`UPDATE dispatch_zones SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    auditLog(req, 'UPDATE', 'dispatch_zones', id, JSON.stringify(req.body));
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to update zone' }); }
});

router.delete('/geography/zones/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    db.prepare('UPDATE dispatch_beats SET zone_id = NULL WHERE zone_id = ?').run(id);
    db.prepare('DELETE FROM dispatch_zones WHERE id = ?').run(id);
    auditLog(req, 'DELETE', 'dispatch_zones', id, '');
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to delete zone' }); }
});

// ════════════════════════════════════════════════════════════
// BEATS — Lowest-level patrol areas within zones
// ════════════════════════════════════════════════════════════

router.get('/geography/beats', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const zoneId = req.query.zone_id ? parseInt(req.query.zone_id as string, 10) : null;
    const search = req.query.search as string | undefined;
    let query = `
      SELECT b.*,
        z.zone_code, z.zone_name,
        s.sector_code, s.sector_name,
        (SELECT COUNT(*) FROM calls_for_service WHERE beat_id = b.beat_code AND status NOT IN ('closed','archived','cancelled')) as active_calls
      FROM dispatch_beats b
      LEFT JOIN dispatch_zones z ON z.id = b.zone_id
      LEFT JOIN dispatch_sectors s ON s.id = z.sector_id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (zoneId) { query += ' AND b.zone_id = ?'; params.push(zoneId); }
    if (search && search.length >= 1 && search.length <= 100) {
      const s = '%' + escapeLike(search) + '%';
      query += " AND (b.beat_code LIKE ? ESCAPE '\\' OR b.beat_name LIKE ? ESCAPE '\\' OR b.beat_descriptor LIKE ? ESCAPE '\\')";
      params.push(s, s, s);
    }
    query += ' ORDER BY b.sort_order, b.beat_name';
    const beats = db.prepare(query).all(...params);
    setCacheHeaders(res, 30);
    res.json(beats);
  } catch (err: any) {
    if (err?.message?.includes('no such table')) { res.json([]); return; }
    res.status(500).json({ error: 'Failed to load beats' });
  }
});

router.post('/geography/beats', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    // Audit 2026-04-11: previous handler dropped premise_alerts on create
    // (PUT accepted it). New beats had to be created then re-edited to
    // attach premise alerts.
    const { beat_code, beat_name, beat_descriptor, zone_id, dispatch_code, color, assigned_unit, backup_unit, hazard_notes, premise_alerts, patrol_frequency, priority_modifier, population_estimate, sq_miles, notes, sort_order } = req.body;
    if (!beat_code || !beat_name) { res.status(400).json({ error: 'beat_code and beat_name required' }); return; }
    const result = db.prepare(`
      INSERT INTO dispatch_beats (beat_code, beat_name, beat_descriptor, zone_id, dispatch_code, color, assigned_unit, backup_unit, hazard_notes, premise_alerts, patrol_frequency, priority_modifier, population_estimate, sq_miles, notes, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(beat_code, beat_name, beat_descriptor, zone_id || null, dispatch_code, color, assigned_unit, backup_unit, hazard_notes, premise_alerts || null, patrol_frequency || 'normal', priority_modifier || 0, population_estimate, sq_miles, notes, sort_order || 0);
    auditLog(req, 'CREATE', 'dispatch_beats', result.lastInsertRowid as number, JSON.stringify(req.body));
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) { res.status(409).json({ error: 'Beat code already exists' }); return; }
    res.status(500).json({ error: 'Failed to create beat' });
  }
});

router.put('/geography/beats/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    const old = db.prepare('SELECT * FROM dispatch_beats WHERE id = ?').get(id);
    if (!old) { res.status(404).json({ error: 'Beat not found' }); return; }
    const fields = ['beat_code', 'beat_name', 'beat_descriptor', 'zone_id', 'dispatch_code', 'color', 'assigned_unit', 'backup_unit', 'hazard_notes', 'premise_alerts', 'patrol_frequency', 'priority_modifier', 'population_estimate', 'sq_miles', 'notes', 'sort_order', 'active'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    updates.push('updated_at = ?'); values.push(now());
    values.push(id);
    db.prepare(`UPDATE dispatch_beats SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    auditLog(req, 'UPDATE', 'dispatch_beats', id, JSON.stringify(req.body));
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to update beat' }); }
});

router.delete('/geography/beats/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    db.prepare('DELETE FROM dispatch_beats WHERE id = ?').run(id);
    auditLog(req, 'DELETE', 'dispatch_beats', id, '');
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to delete beat' }); }
});

// ════════════════════════════════════════════════════════════
// DISPATCH CODES — 10-codes, signal codes, penal codes
// ════════════════════════════════════════════════════════════

router.get('/geography/codes', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;
    let query = 'SELECT * FROM dispatch_codes WHERE 1=1';
    const params: any[] = [];
    if (category && category !== 'all') { query += ' AND category = ?'; params.push(category); }
    if (search && search.length >= 1 && search.length <= 100) {
      const s = '%' + escapeLike(search) + '%';
      query += " AND (code LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')";
      params.push(s, s);
    }
    query += ' ORDER BY sort_order, code';
    const codes = db.prepare(query).all(...params);
    setCacheHeaders(res, 60);
    res.json(codes);
  } catch (err: any) {
    if (err?.message?.includes('no such table')) { res.json([]); return; }
    res.status(500).json({ error: 'Failed to load dispatch codes' });
  }
});

router.get('/geography/codes/lookup/:code', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const code = req.params.code;
    const result = db.prepare('SELECT * FROM dispatch_codes WHERE code = ?').get(code);
    if (!result) { res.json({ found: false }); return; }
    res.json({ found: true, ...(result as object) });
  } catch { res.status(500).json({ error: 'Lookup failed' }); }
});

router.post('/geography/codes', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { code, description, category, priority, color, requires_backup, officer_safety, ems_needed, fire_needed, notes, sort_order } = req.body;
    if (!code || !description) { res.status(400).json({ error: 'code and description required' }); return; }
    const result = db.prepare(`
      INSERT INTO dispatch_codes (code, description, category, priority, color, requires_backup, officer_safety, ems_needed, fire_needed, notes, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(code, description, category || 'general', priority || 'P3', color || '#6b7280', requires_backup ? 1 : 0, officer_safety ? 1 : 0, ems_needed ? 1 : 0, fire_needed ? 1 : 0, notes, sort_order || 0);
    auditLog(req, 'CREATE', 'dispatch_codes', result.lastInsertRowid as number, JSON.stringify(req.body));
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) { res.status(409).json({ error: 'Dispatch code already exists' }); return; }
    res.status(500).json({ error: 'Failed to create dispatch code' });
  }
});

router.put('/geography/codes/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    const old = db.prepare('SELECT * FROM dispatch_codes WHERE id = ?').get(id);
    if (!old) { res.status(404).json({ error: 'Dispatch code not found' }); return; }
    const fields = ['code', 'description', 'category', 'priority', 'color', 'requires_backup', 'officer_safety', 'ems_needed', 'fire_needed', 'notes', 'sort_order', 'active'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    updates.push('updated_at = ?'); values.push(now());
    values.push(id);
    db.prepare(`UPDATE dispatch_codes SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    auditLog(req, 'UPDATE', 'dispatch_codes', id, JSON.stringify(req.body));
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to update dispatch code' }); }
});

router.delete('/geography/codes/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    db.prepare('DELETE FROM dispatch_codes WHERE id = ?').run(id);
    auditLog(req, 'DELETE', 'dispatch_codes', id, '');
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to delete dispatch code' }); }
});

// ════════════════════════════════════════════════════════════
// PREMISE ALERTS — Persistent location-based warnings
// ════════════════════════════════════════════════════════════

router.get('/geography/premise-alerts', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const address = req.query.address as string | undefined;
    const lat = req.query.lat ? parseFloat(req.query.lat as string) : null;
    const lng = req.query.lng ? parseFloat(req.query.lng as string) : null;
    const radius = req.query.radius ? parseFloat(req.query.radius as string) : 0.005; // ~500m default

    let query = 'SELECT * FROM premise_alerts WHERE active = 1';
    const params: any[] = [];

    if (address && address.length >= 2 && address.length <= 200) {
      const s = '%' + escapeLike(address) + '%';
      query += " AND address LIKE ? ESCAPE '\\'";
      params.push(s);
    } else if (lat !== null && lng !== null) {
      // Bounding box proximity search
      query += ' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?';
      params.push(lat - radius, lat + radius, lng - radius, lng + radius);
    }

    // Filter expired alerts
    query += " AND (expires_at IS NULL OR expires_at > datetime('now'))";
    query += ' ORDER BY alert_level DESC, created_at DESC LIMIT 100';

    const alerts = db.prepare(query).all(...params);
    res.json(alerts);
  } catch (err: any) {
    if (err?.message?.includes('no such table')) { res.json([]); return; }
    res.status(500).json({ error: 'Failed to load premise alerts' });
  }
});

router.post('/geography/premise-alerts', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { address, latitude, longitude, alert_type, alert_level, title, description, flags, expires_at } = req.body;
    if (!address || !title) { res.status(400).json({ error: 'address and title required' }); return; }
    const userId = (req as any).user?.userId || (req as any).user?.id;
    const result = db.prepare(`
      INSERT INTO premise_alerts (address, latitude, longitude, alert_type, alert_level, title, description, flags, expires_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(address, latitude, longitude, alert_type || 'caution', alert_level || 'info', title, description, JSON.stringify(flags || []), expires_at, userId);
    auditLog(req, 'CREATE', 'premise_alerts', result.lastInsertRowid as number, JSON.stringify(req.body));
    res.json({ success: true, id: result.lastInsertRowid });
  } catch { res.status(500).json({ error: 'Failed to create premise alert' }); }
});

router.put('/geography/premise-alerts/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    const old = db.prepare('SELECT * FROM premise_alerts WHERE id = ?').get(id);
    if (!old) { res.status(404).json({ error: 'Premise alert not found' }); return; }
    const fields = ['address', 'latitude', 'longitude', 'alert_type', 'alert_level', 'title', 'description', 'flags', 'expires_at', 'active'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(f === 'flags' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    updates.push('updated_at = ?'); values.push(now());
    values.push(id);
    db.prepare(`UPDATE premise_alerts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    auditLog(req, 'UPDATE', 'premise_alerts', id, JSON.stringify(req.body));
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to update premise alert' }); }
});

router.delete('/geography/premise-alerts/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    db.prepare('DELETE FROM premise_alerts WHERE id = ?').run(id);
    auditLog(req, 'DELETE', 'premise_alerts', id, '');
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to delete premise alert' }); }
});

// ════════════════════════════════════════════════════════════
// GEOGRAPHY TREE — Full hierarchy in one call
// ════════════════════════════════════════════════════════════

router.get('/geography/tree', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const areas = db.prepare('SELECT * FROM dispatch_areas WHERE active = 1 ORDER BY sort_order, area_name').all() as any[];
    const sectors = db.prepare(`
      SELECT s.*, a.area_code, a.area_name
      FROM dispatch_sectors s LEFT JOIN dispatch_areas a ON a.id = s.area_id
      WHERE s.active = 1 ORDER BY s.sort_order, s.sector_name
    `).all() as any[];
    const zones = db.prepare(`
      SELECT z.*, s.sector_code, s.sector_name
      FROM dispatch_zones z LEFT JOIN dispatch_sectors s ON s.id = z.sector_id
      WHERE z.active = 1 ORDER BY z.sort_order, z.zone_name
    `).all() as any[];
    const beats = db.prepare(`
      SELECT b.*, z.zone_code, z.zone_name, s.sector_code, s.sector_name
      FROM dispatch_beats b
      LEFT JOIN dispatch_zones z ON z.id = b.zone_id
      LEFT JOIN dispatch_sectors s ON s.id = z.sector_id
      WHERE b.active = 1 ORDER BY b.sort_order, b.beat_name
    `).all() as any[];

    // Build nested 4-level tree: areas → sectors → zones → beats
    const tree = areas.map((area: any) => ({
      ...area,
      sectors: sectors
        .filter((s: any) => s.area_id === area.id)
        .map((sector: any) => ({
          ...sector,
          zones: zones
            .filter((z: any) => z.sector_id === sector.id)
            .map((zone: any) => ({
              ...zone,
              beats: beats.filter((b: any) => b.zone_id === zone.id),
            })),
        })),
    }));

    // Orphaned sectors (no area)
    const orphanSectors = sectors
      .filter((s: any) => !s.area_id)
      .map((sector: any) => ({
        ...sector,
        zones: zones
          .filter((z: any) => z.sector_id === sector.id)
          .map((zone: any) => ({
            ...zone,
            beats: beats.filter((b: any) => b.zone_id === zone.id),
          })),
      }));

    setCacheHeaders(res, 30);
    res.json({ areas: tree, unassigned_sectors: orphanSectors });
  } catch (err: any) {
    if (err?.message?.includes('no such table')) { res.json({ areas: [], unassigned_sectors: [] }); return; }
    res.status(500).json({ error: 'Failed to load geography tree' });
  }
});

// ════════════════════════════════════════════════════════════
// GEOGRAPHY STATS — Call counts, response times by area
// ════════════════════════════════════════════════════════════

router.get('/geography/stats', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();

    // Call counts by section
    const sectionStats = db.prepare(`
      SELECT sector_id as code, sector_name as name,
        COUNT(*) as total_calls,
        SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) as p1_calls,
        SUM(CASE WHEN priority = 'P2' THEN 1 ELSE 0 END) as p2_calls,
        SUM(CASE WHEN status NOT IN ('closed','archived','cancelled') THEN 1 ELSE 0 END) as active_calls,
        AVG(CASE WHEN dispatched_at IS NOT NULL AND enroute_at IS NOT NULL
          THEN (julianday(enroute_at) - julianday(dispatched_at)) * 86400 END) as avg_response_sec
      FROM calls_for_service
      WHERE created_at >= ? AND sector_id IS NOT NULL AND sector_id != ''
      GROUP BY sector_id, sector_name
      ORDER BY total_calls DESC
    `).all(cutoff);

    // Call counts by zone
    const zoneStats = db.prepare(`
      SELECT zone_id as code, zone_name as name, sector_id,
        COUNT(*) as total_calls,
        SUM(CASE WHEN status NOT IN ('closed','archived','cancelled') THEN 1 ELSE 0 END) as active_calls,
        AVG(CASE WHEN dispatched_at IS NOT NULL AND enroute_at IS NOT NULL
          THEN (julianday(enroute_at) - julianday(dispatched_at)) * 86400 END) as avg_response_sec
      FROM calls_for_service
      WHERE created_at >= ? AND zone_id IS NOT NULL AND zone_id != ''
      GROUP BY zone_id, zone_name
      ORDER BY total_calls DESC
    `).all(cutoff);

    // Call counts by beat
    const beatStats = db.prepare(`
      SELECT beat_id as code, beat_name as name, zone_id,
        COUNT(*) as total_calls,
        SUM(CASE WHEN status NOT IN ('closed','archived','cancelled') THEN 1 ELSE 0 END) as active_calls
      FROM calls_for_service
      WHERE created_at >= ? AND beat_id IS NOT NULL AND beat_id != ''
      GROUP BY beat_id, beat_name
      ORDER BY total_calls DESC
    `).all(cutoff);

    // Top incident types by section
    const topTypes = db.prepare(`
      SELECT sector_id, incident_type, COUNT(*) as cnt
      FROM calls_for_service
      WHERE created_at >= ? AND sector_id IS NOT NULL AND sector_id != ''
      GROUP BY sector_id, incident_type
      ORDER BY sector_id, cnt DESC
    `).all(cutoff);

    setCacheHeaders(res, 120);
    res.json({ days, section_stats: sectionStats, zone_stats: zoneStats, beat_stats: beatStats, top_types: topTypes });
  } catch (err: any) {
    if (err?.message?.includes('no such table') || err?.message?.includes('no such column')) {
      res.json({ days: 30, section_stats: [], zone_stats: [], beat_stats: [], top_types: [] });
      return;
    }
    res.status(500).json({ error: 'Failed to load geography stats' });
  }
});

// ════════════════════════════════════════════════════════════
// GPS → BEAT IDENTIFICATION — Endpoint for coordinate lookup
// ════════════════════════════════════════════════════════════

router.get('/geography/identify', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'Valid lat and lng required' });
      return;
    }

    const beat = identifyBeat(lat, lng);
    if (!beat) { res.json({ found: false }); return; }

    // Look up normalized geography
    const beatRecord = db.prepare(`
      SELECT b.*, z.zone_code, z.zone_name, s.sector_code, s.sector_name, a.area_code, a.area_name
      FROM dispatch_beats b
      LEFT JOIN dispatch_zones z ON z.id = b.zone_id
      LEFT JOIN dispatch_sectors s ON s.id = z.sector_id
      LEFT JOIN dispatch_areas a ON a.id = s.area_id
      WHERE b.beat_code = ? OR b.beat_code LIKE ?
      LIMIT 1
    `).get(beat.beat_code, '%' + beat.district_letter) as any;

    // Check premise alerts near this location
    const alerts = db.prepare(`
      SELECT * FROM premise_alerts
      WHERE active = 1
        AND (expires_at IS NULL OR expires_at > datetime('now'))
        AND latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
      ORDER BY alert_level DESC
      LIMIT 5
    `).all(lat - 0.003, lat + 0.003, lng - 0.003, lng + 0.003);

    if (beatRecord) {
      res.json({
        found: true,
        area: { code: beatRecord.area_code, name: beatRecord.area_name },
        sector: { code: beatRecord.sector_code, name: beatRecord.sector_name },
        zone: { code: beatRecord.zone_code, name: beatRecord.zone_name },
        beat: {
          code: beatRecord.beat_code, name: beatRecord.beat_name,
          descriptor: beatRecord.beat_descriptor, dispatch_code: beatRecord.dispatch_code,
          assigned_unit: beatRecord.assigned_unit, hazard_notes: beatRecord.hazard_notes,
        },
        premise_alerts: alerts,
      });
    } else {
      // Fallback to raw geofence data
      res.json({
        found: true,
        area: null,
        sector: { code: beat.district_letter, name: beat.district_letter },
        zone: { code: beat.city_code, name: beat.city },
        beat: { code: beat.beat_code, name: beat.beat_id, descriptor: null, dispatch_code: null, assigned_unit: null, hazard_notes: null },
        premise_alerts: alerts,
      });
    }
  } catch (err: any) {
    if (err?.message?.includes('no such table')) {
      // Graceful fallback — just use geofence
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      const beat = identifyBeat(lat, lng);
      if (!beat) { res.json({ found: false }); return; }
      res.json({
        found: true, area: null,
        section: { code: beat.district_letter, name: beat.district_letter },
        zone: { code: beat.city_code, name: beat.city },
        beat: { code: beat.beat_code, name: beat.beat_id },
        premise_alerts: [],
      });
      return;
    }
    res.status(500).json({ error: 'Failed to identify geography' });
  }
});

export default router;
