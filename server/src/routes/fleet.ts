import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow, localToday } from '../utils/timeUtils';
import { queueOverlayProcessing, type DashCamOverlayConfig } from '../utils/videoOverlay';
import { auditLog } from '../utils/auditLogger';
import { validateParamId } from '../middleware/sanitize';
import { broadcast } from '../utils/websocket';
import { sendCsv } from '../utils/csvExport';

const execFileAsync = promisify(execFile);
const __filename_f = fileURLToPath(import.meta.url);
const __dirname_f = path.dirname(__filename_f);

// ── Dash camera video storage ───────────────────────────────
const DASHCAM_DIR = process.env.RMPG_UPLOADS_DIR
  ? path.join(process.env.RMPG_UPLOADS_DIR, 'dashcam')
  : path.resolve(__dirname_f, '../../uploads/dashcam');

if (!fs.existsSync(DASHCAM_DIR)) {
  fs.mkdirSync(DASHCAM_DIR, { recursive: true });
}

const DASHCAM_MIME_TYPES = new Set([
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska',
]);

const dashcamStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const now = new Date();
    const subDir = path.join(DASHCAM_DIR, `${now.getFullYear()}`, String(now.getMonth() + 1).padStart(2, '0'));
    if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });
    cb(null, subDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const dashcamUpload = multer({
  storage: dashcamStorage,
  fileFilter: (_req, file, cb) => {
    if (DASHCAM_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed. Accepted: MP4, MOV, AVI, WebM`));
    }
  },
});

/** Extract video duration using ffprobe */
async function extractDashcamDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
      { timeout: 30000 },
    );
    const seconds = parseFloat(stdout.trim());
    return isFinite(seconds) ? Math.round(seconds) : null;
  } catch {
    return null;
  }
}

const router = Router();

// Promote query-string token to Authorization header for <video> streaming only
router.use((req: Request, _res: Response, next: NextFunction) => {
  if (!req.headers['authorization'] && req.query.token && /\/(stream|download|thumbnail)/.test(req.path)) {
    req.headers['authorization'] = `Bearer ${req.query.token}`;
  }
  next();
});

// All fleet routes require authentication
router.use(authenticateToken);

// ─── GET /api/fleet ─ List fleet vehicles with filters ────────────
router.get('/', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      status,
      assigned,
      archived,
      page = '1',
      per_page = '50',
    } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (status) {
      whereClause += ' AND fv.status = ?';
      params.push(status);
    }

    if (assigned === '1') {
      whereClause += ' AND fv.assigned_unit_id IS NOT NULL';
    } else if (assigned === '0') {
      whereClause += ' AND fv.assigned_unit_id IS NULL';
    }

    // Archive filter
    if (archived === 'true') {
      whereClause += ' AND fv.archived_at IS NOT NULL';
    } else if (archived !== 'all') {
      whereClause += ' AND fv.archived_at IS NULL';
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(per_page as string, 10) || 50));
    const offset = (pageNum - 1) * perPage;

    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM fleet_vehicles fv ${whereClause}`
    ).get(...params) as any;

    const vehicles = db.prepare(`
      SELECT
        fv.*,
        u.call_sign AS assigned_unit_call_sign
      FROM fleet_vehicles fv
      LEFT JOIN units u ON fv.assigned_unit_id = u.id
      ${whereClause}
      ORDER BY fv.vehicle_number
      LIMIT ? OFFSET ?
    `).all(...params, perPage, offset);

    // Parse equipment JSON for each vehicle
    const parsed = (vehicles as any[]).map((v) => ({
      ...v,
      equipment: safeParseJson(v.equipment, []),
    }));

    res.json({
      data: parsed,
      pagination: {
        page: pageNum,
        per_page: perPage,
        total: countRow?.total ?? 0,
        totalPages: perPage > 0 ? Math.ceil((countRow?.total ?? 0) / perPage) : 0,
      },
    });
  } catch (error: any) {
    console.error('Error fetching fleet vehicles:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch fleet vehicles' });
  }
});

// ─── GET /api/fleet/analytics ─ Fleet-wide aggregate analytics ────
router.get('/analytics', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { period = '90d' } = req.query;

    // Determine date cutoff
    let dateCutoff: string;
    const now = new Date();
    switch (period) {
      case '30d': dateCutoff = new Date(now.getTime() - 30 * 86400000).toISOString(); break;
      case '90d': dateCutoff = new Date(now.getTime() - 90 * 86400000).toISOString(); break;
      case '1y': dateCutoff = new Date(now.getTime() - 365 * 86400000).toISOString(); break;
      case 'all': dateCutoff = '2000-01-01T00:00:00.000Z'; break;
      default: dateCutoff = new Date(now.getTime() - 90 * 86400000).toISOString();
    }

    // Maintenance cost trend (monthly)
    const maintenanceCostTrend = db.prepare(`
      SELECT strftime('%Y-%m', performed_at) AS month, SUM(cost) AS total_cost, COUNT(*) AS count
      FROM fleet_maintenance
      WHERE performed_at >= ? AND cost IS NOT NULL
      GROUP BY month ORDER BY month
    `).all(dateCutoff) as any[];

    // Mileage distribution (bucket vehicles)
    const allVehicles = db.prepare('SELECT current_mileage FROM fleet_vehicles WHERE current_mileage IS NOT NULL').all() as any[];
    const mileageBuckets = [
      { range: '0-25k', min: 0, max: 25000, count: 0 },
      { range: '25k-50k', min: 25000, max: 50000, count: 0 },
      { range: '50k-75k', min: 50000, max: 75000, count: 0 },
      { range: '75k-100k', min: 75000, max: 100000, count: 0 },
      { range: '100k+', min: 100000, max: Infinity, count: 0 },
    ];
    for (const v of allVehicles) {
      for (const bucket of mileageBuckets) {
        if (v.current_mileage >= bucket.min && v.current_mileage < bucket.max) {
          bucket.count++;
          break;
        }
      }
    }

    // Status breakdown
    const statusBreakdown = db.prepare(`
      SELECT status, COUNT(*) AS count FROM fleet_vehicles GROUP BY status
    `).all() as any[];
    const statusColors: Record<string, string> = {
      in_service: '#22c55e', maintenance: '#f59e0b', out_of_service: '#ef4444', retired: '#6b7280',
    };
    const statusWithColors = statusBreakdown.map((s: any) => ({
      ...s, color: statusColors[s.status] || '#6b7280',
    }));

    // Fuel economy trend (monthly) — computed from consecutive fuel logs per vehicle
    const fuelTrend = db.prepare(`
      SELECT strftime('%Y-%m', fuel_date) AS month,
        SUM(gallons) AS total_gallons,
        SUM(total_cost) AS total_cost,
        COUNT(*) AS log_count
      FROM fleet_fuel_logs
      WHERE fuel_date >= ?
      GROUP BY month ORDER BY month
    `).all(dateCutoff) as any[];

    // Compute approximate MPG per month from odometer-based logs
    const fuelLogsWithOdo = db.prepare(`
      SELECT vehicle_id, fuel_date, gallons, odometer_reading
      FROM fleet_fuel_logs
      WHERE fuel_date >= ? AND odometer_reading IS NOT NULL
      ORDER BY vehicle_id, fuel_date
    `).all(dateCutoff) as any[];

    // Group by vehicle, compute per-interval MPG
    const mpgByMonth: Record<string, { total_miles: number; total_gallons: number }> = {};
    let prevByVehicle: Record<number, { odometer: number; date: string }> = {};
    for (const log of fuelLogsWithOdo) {
      const prev = prevByVehicle[log.vehicle_id];
      if (prev && log.odometer_reading > prev.odometer) {
        const miles = log.odometer_reading - prev.odometer;
        const month = log.fuel_date.substring(0, 7);
        if (!mpgByMonth[month]) mpgByMonth[month] = { total_miles: 0, total_gallons: 0 };
        mpgByMonth[month].total_miles += miles;
        mpgByMonth[month].total_gallons += log.gallons;
      }
      prevByVehicle[log.vehicle_id] = { odometer: log.odometer_reading, date: log.fuel_date };
    }

    const fuelEconomyTrend = fuelTrend.map((f: any) => ({
      month: f.month,
      total_gallons: f.total_gallons || 0,
      total_cost: f.total_cost || 0,
      avg_mpg: mpgByMonth[f.month]
        ? Math.round((mpgByMonth[f.month].total_miles / mpgByMonth[f.month].total_gallons) * 10) / 10
        : null,
    }));

    // Fleet summary
    const totalVehicles = db.prepare('SELECT COUNT(*) AS count FROM fleet_vehicles').get() as any;
    const avgMileage = db.prepare('SELECT AVG(current_mileage) AS avg FROM fleet_vehicles WHERE current_mileage IS NOT NULL').get() as any;
    const totalMaintCost = db.prepare('SELECT SUM(cost) AS total FROM fleet_maintenance WHERE cost IS NOT NULL').get() as any;
    const totalFuelCost = db.prepare('SELECT SUM(total_cost) AS total FROM fleet_fuel_logs WHERE total_cost IS NOT NULL').get() as any;
    const vehiclesNeedingService = db.prepare(`
      SELECT COUNT(*) AS count FROM fleet_vehicles WHERE next_service_due IS NOT NULL AND next_service_due <= ?
    `).get(localNow()) as any;
    const inspectionsFailing = db.prepare(`
      SELECT COUNT(*) AS count FROM fleet_inspections WHERE overall_result = 'fail' AND inspection_date >= ?
    `).get(dateCutoff) as any;

    res.json({
      maintenance_cost_trend: maintenanceCostTrend,
      mileage_distribution: mileageBuckets.map(b => ({ range: b.range, count: b.count })),
      status_breakdown: statusWithColors,
      fuel_economy_trend: fuelEconomyTrend,
      fleet_summary: {
        total_vehicles: totalVehicles?.count || 0,
        avg_mileage: Math.round(avgMileage?.avg || 0),
        total_maintenance_cost: totalMaintCost?.total || 0,
        total_fuel_cost: totalFuelCost?.total || 0,
        vehicles_needing_service: vehiclesNeedingService?.count || 0,
        inspections_failing: inspectionsFailing?.count || 0,
      },
    });
  } catch (error: any) {
    console.error('Error fetching fleet analytics:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch fleet analytics' });
  }
});

// ─── GET /api/fleet/:id ─ Get single fleet vehicle ────────────────
router.get('/:id', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response, next: NextFunction) => {
  try {
    // Avoid matching sub-routes that are handled by other route definitions
    if (['maintenance', 'analytics', 'dashcam-videos'].includes(req.params.id as string)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    // Fleet IDs are numeric — reject non-numeric to prevent route collisions
    if (!/^\d+$/.test(req.params.id as string)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const db = getDb();
    const { id } = req.params;

    const vehicle = db.prepare(`
      SELECT
        fv.*,
        u.call_sign AS assigned_unit_call_sign,
        u.officer_id AS assigned_officer_id,
        usr.full_name AS assigned_officer_name
      FROM fleet_vehicles fv
      LEFT JOIN units u ON fv.assigned_unit_id = u.id
      LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE fv.id = ?
    `).get(id) as any;

    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found' });
      return;
    }

    // Get last 10 maintenance records
    const maintenance = db.prepare(`
      SELECT * FROM fleet_maintenance
      WHERE vehicle_id = ?
      ORDER BY performed_at DESC
      LIMIT 10
    `).all(id);

    res.json({
      ...vehicle,
      equipment: safeParseJson(vehicle.equipment, []),
      recent_maintenance: maintenance,
    });
  } catch (error: any) {
    console.error('Error fetching fleet vehicle:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch fleet vehicle' });
  }
});

// ─── POST /api/fleet ─ Create fleet vehicle ───────────────────────
router.post('/', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      vehicle_number,
      make,
      model,
      year,
      color,
      vin,
      plate_number,
      plate_state,
      current_mileage,
      insurance_expiry,
      registration_expiry,
      equipment,
      notes,
    } = req.body;

    if (!vehicle_number) {
      res.status(400).json({ error: 'vehicle_number is required' });
      return;
    }

    // Check for duplicate vehicle_number
    const existing = db.prepare('SELECT id FROM fleet_vehicles WHERE vehicle_number = ?').get(vehicle_number);
    if (existing) {
      res.status(409).json({ error: 'A vehicle with this vehicle_number already exists' });
      return;
    }

    const equipmentJson = Array.isArray(equipment) ? JSON.stringify(equipment) : (equipment || '[]');

    const result = db.prepare(`
      INSERT INTO fleet_vehicles (
        vehicle_number, make, model, year, color, vin,
        plate_number, plate_state, current_mileage,
        insurance_expiry, registration_expiry, equipment, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vehicle_number,
      make || null,
      model || null,
      year ?? null,
      color || null,
      vin || null,
      plate_number || null,
      plate_state || null,
      current_mileage ?? null,
      insurance_expiry || null,
      registration_expiry || null,
      equipmentJson,
      notes || null,
      localNow(),
      localNow()
    );

    const created = db.prepare(`
      SELECT fv.*, u.call_sign AS assigned_unit_call_sign
      FROM fleet_vehicles fv
      LEFT JOIN units u ON fv.assigned_unit_id = u.id
      WHERE fv.id = ?
    `).get(result.lastInsertRowid) as any;
    if (!created) { res.status(500).json({ error: 'Failed to retrieve created fleet vehicle' }); return; }

    auditLog(req, 'vehicle_fleet_created', 'fleet_vehicle', result.lastInsertRowid as number, `Created fleet vehicle ${vehicle_number}`);
    broadcast('personnel', 'fleet:created', { id: result.lastInsertRowid, vehicle_number });
    res.status(201).json({
      ...created,
      equipment: safeParseJson(created.equipment, []),
    });
  } catch (error: any) {
    console.error('Error creating fleet vehicle:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to create fleet vehicle' });
  }
});

// ─── PUT /api/fleet/:id ─ Update fleet vehicle ───────────────────
router.put('/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Fleet vehicle not found' });
      return;
    }

    const {
      vehicle_number,
      make,
      model,
      year,
      color,
      vin,
      plate_number,
      plate_state,
      status,
      current_mileage,
      insurance_expiry,
      registration_expiry,
      equipment,
      notes,
    } = req.body;

    // If changing vehicle_number, check for duplicates
    if (vehicle_number && vehicle_number !== existing.vehicle_number) {
      const duplicate = db.prepare('SELECT id FROM fleet_vehicles WHERE vehicle_number = ? AND id != ?').get(vehicle_number, id);
      if (duplicate) {
        res.status(409).json({ error: 'A vehicle with this vehicle_number already exists' });
        return;
      }
    }

    // Build dynamic SET clause — only update fields explicitly provided
    const fFields: string[] = [];
    const fValues: any[] = [];
    const fBodyKeys = Object.keys(req.body);

    const fFieldMap: Record<string, (v: any) => any> = {
      vehicle_number: v => v ?? null, make: v => v ?? null, model: v => v ?? null,
      year: v => v ?? null, color: v => v ?? null, vin: v => v ?? null,
      plate_number: v => v ?? null, plate_state: v => v ?? null,
      status: v => v ?? null, current_mileage: v => v ?? null,
      insurance_expiry: v => v ?? null, registration_expiry: v => v ?? null,
      notes: v => v ?? null,
    };

    for (const [key, transform] of Object.entries(fFieldMap)) {
      if (fBodyKeys.includes(key)) {
        fFields.push(`${key} = ?`);
        fValues.push(transform(req.body[key]));
      }
    }
    if (fBodyKeys.includes('equipment')) {
      fFields.push('equipment = ?');
      const equipmentJson = Array.isArray(equipment) ? JSON.stringify(equipment) : (equipment ?? null);
      fValues.push(equipmentJson);
    }

    if (fFields.length > 0) {
      fFields.push("updated_at = ?");
      fValues.push(localNow());
      fValues.push(id);
      db.prepare(`UPDATE fleet_vehicles SET ${fFields.join(', ')} WHERE id = ?`).run(...fValues);
    }

    const updated = db.prepare(`
      SELECT fv.*, u.call_sign AS assigned_unit_call_sign
      FROM fleet_vehicles fv
      LEFT JOIN units u ON fv.assigned_unit_id = u.id
      WHERE fv.id = ?
    `).get(id) as any;

    auditLog(req, 'vehicle_fleet_updated', 'fleet_vehicle', String(id), `Updated fleet vehicle #${id}`);
    broadcast('personnel', 'fleet:updated', { id: Number(id) });
    res.json({
      ...updated,
      equipment: safeParseJson(updated.equipment, []),
    });
  } catch (error: any) {
    console.error('Error updating fleet vehicle:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to update fleet vehicle' });
  }
});

// ─── PUT /api/fleet/:id/assign ─ Assign vehicle to unit ──────────
router.put('/:id/assign', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { unit_id } = req.body;

    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found' });
      return;
    }

    // If assigning to a unit, verify the unit exists
    if (unit_id !== null && unit_id !== undefined) {
      const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unit_id) as any;
      if (!unit) {
        res.status(404).json({ error: 'Unit not found' });
        return;
      }

      // Check if another vehicle is already assigned to this unit
      const alreadyAssigned = db.prepare(
        'SELECT id, vehicle_number FROM fleet_vehicles WHERE assigned_unit_id = ? AND id != ?'
      ).get(unit_id, id) as any;
      if (alreadyAssigned) {
        res.status(409).json({
          error: `Unit already has vehicle ${alreadyAssigned.vehicle_number} assigned`,
        });
        return;
      }
    }

    // Log assignment history: close any open assignment for this vehicle
    if (vehicle.assigned_unit_id) {
      db.prepare(`
        UPDATE fleet_assignments
        SET unassigned_at = ?
        WHERE vehicle_id = ? AND unassigned_at IS NULL
      `).run(localNow(), id);
    }

    // If assigning to a new unit, create assignment history record
    if (unit_id !== null && unit_id !== undefined) {
      const assignUnit = db.prepare('SELECT call_sign, officer_id FROM units WHERE id = ?').get(unit_id) as any;
      let officerName: string | null = null;
      if (assignUnit?.officer_id) {
        const officer = db.prepare('SELECT full_name FROM users WHERE id = ?').get(assignUnit.officer_id) as any;
        officerName = officer?.full_name || null;
      }
      db.prepare(`
        INSERT INTO fleet_assignments (vehicle_id, unit_id, unit_call_sign, officer_name, assigned_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, unit_id, assignUnit?.call_sign || null, officerName, localNow(), localNow());
    }

    db.prepare(`
      UPDATE fleet_vehicles
      SET assigned_unit_id = ?, updated_at = ?
      WHERE id = ?
    `).run(unit_id ?? null, localNow(), id);

    const updated = db.prepare(`
      SELECT fv.*, u.call_sign AS assigned_unit_call_sign
      FROM fleet_vehicles fv
      LEFT JOIN units u ON fv.assigned_unit_id = u.id
      WHERE fv.id = ?
    `).get(id) as any;

    const actionDetail = unit_id
      ? `Assigned vehicle ${vehicle.vehicle_number} to unit ${updated.assigned_unit_call_sign}`
      : `Unassigned vehicle ${vehicle.vehicle_number} from unit`;

    auditLog(req, 'vehicle_fleet_updated', 'fleet_vehicle', String(id), actionDetail);

    res.json({
      ...updated,
      equipment: safeParseJson(updated.equipment, []),
    });
  } catch (error: any) {
    console.error('Error assigning fleet vehicle:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to assign fleet vehicle' });
  }
});

// DELETE /api/fleet/:id - Delete fleet vehicle (retired + unassigned only)
router.delete('/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(req.params.id) as any;
    if (!vehicle) { res.status(404).json({ error: 'Fleet vehicle not found' }); return; }
    if (vehicle.status !== 'retired') {
      res.status(400).json({ error: 'Only retired vehicles can be deleted' }); return;
    }
    if (vehicle.assigned_unit_id) {
      res.status(400).json({ error: 'Unassign vehicle from unit before deleting' }); return;
    }

    const delTx = db.transaction(() => {
      db.prepare('DELETE FROM fleet_maintenance WHERE vehicle_id = ?').run(vehicle.id);
      db.prepare('DELETE FROM fleet_fuel_logs WHERE vehicle_id = ?').run(vehicle.id);
      db.prepare('DELETE FROM fleet_inspections WHERE vehicle_id = ?').run(vehicle.id);
      db.prepare('DELETE FROM fleet_assignments WHERE vehicle_id = ?').run(vehicle.id);
      db.prepare('DELETE FROM fleet_personnel_notes WHERE vehicle_id = ?').run(vehicle.id);
      db.prepare('DELETE FROM fleet_vehicles WHERE id = ?').run(vehicle.id);
    });
    delTx();
    auditLog(req, 'vehicle_fleet_updated', 'fleet_vehicle', vehicle.id, `Deleted fleet vehicle #${vehicle.id}`);
    broadcast('personnel', 'fleet:deleted', { id: vehicle.id });
    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error('Delete fleet vehicle error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/fleet/:id/archive
router.post('/:id/archive', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(req.params.id) as any;
    if (!vehicle) { res.status(404).json({ error: 'Fleet vehicle not found' }); return; }
    if (vehicle.archived_at) { res.status(400).json({ error: 'Vehicle is already archived' }); return; }

    const now = localNow();
    db.prepare('UPDATE fleet_vehicles SET archived_at = ? WHERE id = ?').run(now, vehicle.id);

    auditLog(req, 'vehicle_fleet_updated', 'fleet_vehicle', vehicle.id, `Archived fleet vehicle #${vehicle.id}`);

    const updated = db.prepare('SELECT fv.*, u.call_sign AS assigned_unit_call_sign FROM fleet_vehicles fv LEFT JOIN units u ON fv.assigned_unit_id = u.id WHERE fv.id = ?').get(vehicle.id) as any;
    if (!updated) { res.status(404).json({ error: 'Vehicle not found after update' }); return; }
    res.json({ ...updated, equipment: safeParseJson(updated.equipment, []) });
  } catch (error: any) {
    console.error('Archive fleet vehicle error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/fleet/:id/unarchive
router.post('/:id/unarchive', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(req.params.id) as any;
    if (!vehicle) { res.status(404).json({ error: 'Fleet vehicle not found' }); return; }
    if (!vehicle.archived_at) { res.status(400).json({ error: 'Vehicle is not archived' }); return; }

    db.prepare('UPDATE fleet_vehicles SET archived_at = NULL WHERE id = ?').run(vehicle.id);

    auditLog(req, 'vehicle_fleet_updated', 'fleet_vehicle', vehicle.id, `Unarchived fleet vehicle #${vehicle.id}`);

    const updated = db.prepare('SELECT fv.*, u.call_sign AS assigned_unit_call_sign FROM fleet_vehicles fv LEFT JOIN units u ON fv.assigned_unit_id = u.id WHERE fv.id = ?').get(vehicle.id) as any;
    if (!updated) { res.status(404).json({ error: 'Vehicle not found after update' }); return; }
    res.json({ ...updated, equipment: safeParseJson(updated.equipment, []) });
  } catch (error: any) {
    console.error('Unarchive fleet vehicle error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/fleet/:id/maintenance ─ Maintenance history ────────
router.get('/:id/maintenance', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { page = '1', per_page = '25' } = req.query;

    // Verify vehicle exists
    const vehicle = db.prepare('SELECT id FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found' });
      return;
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(per_page as string, 10) || 25));
    const offset = (pageNum - 1) * perPage;

    const countRow = db.prepare(
      'SELECT COUNT(*) as total FROM fleet_maintenance WHERE vehicle_id = ?'
    ).get(id) as any;

    const records = db.prepare(`
      SELECT * FROM fleet_maintenance
      WHERE vehicle_id = ?
      ORDER BY performed_at DESC
      LIMIT ? OFFSET ?
    `).all(id, perPage, offset);

    res.json({
      data: records,
      pagination: {
        page: pageNum,
        per_page: perPage,
        total: countRow?.total ?? 0,
        totalPages: perPage > 0 ? Math.ceil((countRow?.total ?? 0) / perPage) : 0,
      },
    });
  } catch (error: any) {
    console.error('Error fetching maintenance history:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch maintenance history' });
  }
});

// ─── POST /api/fleet/:id/maintenance ─ Log maintenance record ────
router.post('/:id/maintenance', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found' });
      return;
    }

    const {
      type,
      description,
      mileage_at_service,
      cost,
      vendor,
      performed_by,
      performed_at,
      next_due_date,
      next_due_mileage,
    } = req.body;

    if (!description) {
      res.status(400).json({ error: 'description is required' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO fleet_maintenance (
        vehicle_id, type, description, mileage_at_service, cost,
        vendor, performed_by, performed_at, next_due_date, next_due_mileage,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      type || null,
      description,
      mileage_at_service ?? null,
      cost ?? null,
      vendor || null,
      performed_by || null,
      performed_at || localNow(),
      next_due_date || null,
      next_due_mileage ?? null,
      localNow()
    );

    // Update the fleet vehicle's last_service_date and next_service_due
    const serviceDate = performed_at
      ? performed_at.substring(0, 10)
      : localToday();

    const fleetSetClauses = [`last_service_date = ?`, `updated_at = ?`];
    const fleetSetValues: any[] = [serviceDate, localNow()];
    if (next_due_date !== undefined) {
      fleetSetClauses.push(`next_service_due = ?`);
      fleetSetValues.push(next_due_date || null);
    }
    if (mileage_at_service !== undefined) {
      fleetSetClauses.push(`current_mileage = ?`);
      fleetSetValues.push(mileage_at_service ?? null);
    }
    fleetSetValues.push(id);
    db.prepare(`UPDATE fleet_vehicles SET ${fleetSetClauses.join(', ')} WHERE id = ?`).run(...fleetSetValues);

    const record = db.prepare('SELECT * FROM fleet_maintenance WHERE id = ?').get(result.lastInsertRowid);
    if (!record) { res.status(500).json({ error: 'Failed to retrieve maintenance record' }); return; }

    auditLog(req, 'maintenance_logged', 'maintenance', result.lastInsertRowid as number, `Logged maintenance for vehicle ${vehicle.vehicle_number}`);

    res.status(201).json(record);
  } catch (error: any) {
    console.error('Error logging maintenance record:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to log maintenance record' });
  }
});

// PUT /api/fleet/maintenance/:id - Update maintenance record
router.put('/maintenance/:id', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_maintenance WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Maintenance record not found' }); return; }

    const mFields: string[] = [];
    const mValues: any[] = [];
    const mBodyKeys = Object.keys(req.body);
    const mFieldMap: Record<string, (v: any) => any> = {
      type: v => v ?? null, description: v => v ?? null, mileage_at_service: v => v ?? null,
      cost: v => v ?? null, vendor: v => v ?? null, performed_by: v => v ?? null,
      performed_at: v => v ?? null, next_due_date: v => v ?? null, next_due_mileage: v => v ?? null,
    };
    for (const [key, transform] of Object.entries(mFieldMap)) {
      if (mBodyKeys.includes(key)) { mFields.push(`${key} = ?`); mValues.push(transform(req.body[key])); }
    }
    if (mFields.length > 0) {
      mValues.push(req.params.id);
      db.prepare(`UPDATE fleet_maintenance SET ${mFields.join(', ')} WHERE id = ?`).run(...mValues);
    }

    const updated = db.prepare('SELECT * FROM fleet_maintenance WHERE id = ?').get(req.params.id);
    auditLog(req, 'maintenance_logged', 'maintenance', String(req.params.id), `Updated maintenance record #${req.params.id}`);
    res.json(updated);
  } catch (error: any) {
    console.error('Update maintenance error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/fleet/maintenance/:id
router.delete('/maintenance/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_maintenance WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Maintenance record not found' }); return; }
    db.prepare('DELETE FROM fleet_maintenance WHERE id = ?').run(req.params.id);
    auditLog(req, 'maintenance_logged', 'maintenance', String(req.params.id), `Deleted maintenance record #${req.params.id}`);
    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error('Delete maintenance error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/fleet/maintenance/:id/archive
router.post('/maintenance/:id/archive', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_maintenance WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Maintenance record not found' }); return; }
    if (record.archived_at) { res.status(400).json({ error: 'Already archived' }); return; }
    const now = localNow();
    db.prepare('UPDATE fleet_maintenance SET archived_at = ? WHERE id = ?').run(now, record.id);
    auditLog(req, 'maintenance_logged', 'maintenance', record.id, `Archived maintenance record #${record.id}`);
    const updated = db.prepare('SELECT * FROM fleet_maintenance WHERE id = ?').get(record.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Archive maintenance error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/fleet/maintenance/:id/unarchive
router.post('/maintenance/:id/unarchive', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_maintenance WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Maintenance record not found' }); return; }
    if (!record.archived_at) { res.status(400).json({ error: 'Not archived' }); return; }
    db.prepare('UPDATE fleet_maintenance SET archived_at = NULL WHERE id = ?').run(record.id);
    auditLog(req, 'maintenance_logged', 'maintenance', record.id, `Unarchived maintenance record #${record.id}`);
    const updated = db.prepare('SELECT * FROM fleet_maintenance WHERE id = ?').get(record.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Unarchive maintenance error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/fleet/:id/fuel ─ Fuel logs with summary ─────────────
router.get('/:id/fuel', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { page = '1', per_page = '50' } = req.query;

    const vehicle = db.prepare('SELECT id FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found' });
      return;
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(per_page as string, 10) || 50));
    const offset = (pageNum - 1) * perPage;

    const countRow = db.prepare('SELECT COUNT(*) as total FROM fleet_fuel_logs WHERE vehicle_id = ?').get(id) as any;

    const logs = db.prepare(`
      SELECT * FROM fleet_fuel_logs
      WHERE vehicle_id = ?
      ORDER BY fuel_date DESC
      LIMIT ? OFFSET ?
    `).all(id, perPage, offset);

    // Compute summary
    const summaryRow = db.prepare(`
      SELECT
        COALESCE(SUM(gallons), 0) AS total_gallons,
        COALESCE(SUM(total_cost), 0) AS total_cost,
        AVG(cost_per_gallon) AS avg_cost_per_gallon,
        COUNT(*) AS log_count
      FROM fleet_fuel_logs WHERE vehicle_id = ?
    `).get(id) as any;

    // Compute average MPG from consecutive odometer readings
    const odoLogs = db.prepare(`
      SELECT gallons, odometer_reading FROM fleet_fuel_logs
      WHERE vehicle_id = ? AND odometer_reading IS NOT NULL
      ORDER BY fuel_date ASC, id ASC
    `).all(id) as any[];

    let totalMiles = 0;
    let totalGallonsForMpg = 0;
    for (let i = 1; i < odoLogs.length; i++) {
      if (odoLogs[i].odometer_reading > odoLogs[i - 1].odometer_reading) {
        totalMiles += odoLogs[i].odometer_reading - odoLogs[i - 1].odometer_reading;
        totalGallonsForMpg += odoLogs[i].gallons;
      }
    }
    const avgMpg = totalGallonsForMpg > 0 ? Math.round((totalMiles / totalGallonsForMpg) * 10) / 10 : null;

    res.json({
      data: logs,
      summary: {
        total_gallons: summaryRow.total_gallons,
        total_cost: summaryRow.total_cost,
        avg_mpg: avgMpg,
        avg_cost_per_gallon: summaryRow.avg_cost_per_gallon ? Math.round(summaryRow.avg_cost_per_gallon * 1000) / 1000 : 0,
        log_count: summaryRow.log_count,
      },
      pagination: {
        page: pageNum,
        per_page: perPage,
        total: countRow?.total ?? 0,
        totalPages: perPage > 0 ? Math.ceil((countRow?.total ?? 0) / perPage) : 0,
      },
    });
  } catch (error: any) {
    console.error('Error fetching fuel logs:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch fuel logs' });
  }
});

// ─── POST /api/fleet/:id/fuel ─ Log a fuel entry ─────────────────
router.post('/:id/fuel', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found' });
      return;
    }

    const { fuel_date, gallons, cost_per_gallon, total_cost, odometer_reading, fuel_type, station, notes } = req.body;

    if (!fuel_date || !gallons) {
      res.status(400).json({ error: 'fuel_date and gallons are required' });
      return;
    }

    const computedTotal = total_cost != null ? total_cost : (cost_per_gallon ? gallons * cost_per_gallon : null);

    const result = db.prepare(`
      INSERT INTO fleet_fuel_logs (
        vehicle_id, fuel_date, gallons, cost_per_gallon, total_cost,
        odometer_reading, fuel_type, station, notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      fuel_date,
      gallons,
      cost_per_gallon ?? null,
      computedTotal,
      odometer_reading ?? null,
      fuel_type || 'regular',
      station || null,
      notes || null,
      req.user!.userId,
      localNow()
    );

    // Update vehicle mileage if odometer is higher
    if (odometer_reading && (!vehicle.current_mileage || odometer_reading > vehicle.current_mileage)) {
      db.prepare(`
        UPDATE fleet_vehicles SET current_mileage = ?, updated_at = ? WHERE id = ?
      `).run(odometer_reading, localNow(), id);
    }

    const record = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(result.lastInsertRowid);
    if (!record) { res.status(500).json({ error: 'Failed to retrieve fuel log' }); return; }

    auditLog(req, 'fuel_logged', 'fuel_log', result.lastInsertRowid as number, `Logged fuel for vehicle ${vehicle.vehicle_number}`);

    res.status(201).json(record);
  } catch (error: any) {
    console.error('Error logging fuel entry:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to log fuel entry' });
  }
});

// PUT /api/fleet/fuel/:id - Update fuel log
router.put('/fuel/:id', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Fuel log not found' }); return; }

    const fFields: string[] = [];
    const fValues: any[] = [];
    const fBodyKeys = Object.keys(req.body);
    const fFieldMap: Record<string, (v: any) => any> = {
      fuel_date: v => v ?? null, gallons: v => v ?? null, cost_per_gallon: v => v ?? null,
      total_cost: v => v ?? null, odometer_reading: v => v ?? null, fuel_type: v => v ?? null,
      station: v => v ?? null, notes: v => v ?? null,
    };
    for (const [key, transform] of Object.entries(fFieldMap)) {
      if (fBodyKeys.includes(key)) { fFields.push(`${key} = ?`); fValues.push(transform(req.body[key])); }
    }
    if (fFields.length > 0) {
      fValues.push(req.params.id);
      db.prepare(`UPDATE fleet_fuel_logs SET ${fFields.join(', ')} WHERE id = ?`).run(...fValues);
    }

    const updated = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(req.params.id);
    auditLog(req, 'fuel_logged', 'fuel_log', String(req.params.id), `Updated fuel log #${req.params.id}`);
    res.json(updated);
  } catch (error: any) {
    console.error('Update fuel log error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/fleet/fuel/:id
router.delete('/fuel/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Fuel log not found' }); return; }
    db.prepare('DELETE FROM fleet_fuel_logs WHERE id = ?').run(req.params.id);
    auditLog(req, 'fuel_logged', 'fuel_log', String(req.params.id), `Deleted fuel log #${req.params.id}`);
    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error('Delete fuel log error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/fleet/fuel/:id/archive
router.post('/fuel/:id/archive', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Fuel log not found' }); return; }
    if (record.archived_at) { res.status(400).json({ error: 'Already archived' }); return; }
    const now = localNow();
    db.prepare('UPDATE fleet_fuel_logs SET archived_at = ? WHERE id = ?').run(now, record.id);
    auditLog(req, 'fuel_logged', 'fuel_log', record.id, `Archived fuel log #${record.id}`);
    const updated = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(record.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Archive fuel log error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/fleet/fuel/:id/unarchive
router.post('/fuel/:id/unarchive', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Fuel log not found' }); return; }
    if (!record.archived_at) { res.status(400).json({ error: 'Not archived' }); return; }
    db.prepare('UPDATE fleet_fuel_logs SET archived_at = NULL WHERE id = ?').run(record.id);
    auditLog(req, 'fuel_logged', 'fuel_log', record.id, `Unarchived fuel log #${record.id}`);
    const updated = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(record.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Unarchive fuel log error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/fleet/:id/inspections ─ Inspection history ──────────
router.get('/:id/inspections', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { page = '1', per_page = '25', type } = req.query;

    const vehicle = db.prepare('SELECT id FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found' });
      return;
    }

    let whereClause = 'WHERE vehicle_id = ?';
    const params: any[] = [id];
    if (type) {
      whereClause += ' AND inspection_type = ?';
      params.push(type);
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(per_page as string, 10) || 25));
    const offset = (pageNum - 1) * perPage;

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM fleet_inspections ${whereClause}`).get(...params) as any;

    const records = db.prepare(`
      SELECT * FROM fleet_inspections
      ${whereClause}
      ORDER BY inspection_date DESC
      LIMIT ? OFFSET ?
    `).all(...params, perPage, offset) as any[];

    // Parse items JSON for each inspection
    const parsed = records.map((r: any) => ({
      ...r,
      items: safeParseJson(r.items, []),
    }));

    res.json({
      data: parsed,
      pagination: {
        page: pageNum,
        per_page: perPage,
        total: countRow?.total ?? 0,
        totalPages: perPage > 0 ? Math.ceil((countRow?.total ?? 0) / perPage) : 0,
      },
    });
  } catch (error: any) {
    console.error('Error fetching inspections:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch inspections' });
  }
});

// ─── POST /api/fleet/:id/inspections ─ Create inspection ─────────
router.post('/:id/inspections', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found' });
      return;
    }

    const { inspection_type, inspector_name, inspection_date, overall_result, mileage, items, notes } = req.body;

    if (!inspection_type || !inspector_name || !inspection_date || !overall_result) {
      res.status(400).json({ error: 'inspection_type, inspector_name, inspection_date, and overall_result are required' });
      return;
    }

    if (!Array.isArray(items)) {
      res.status(400).json({ error: 'items must be an array' });
      return;
    }

    const itemsJson = JSON.stringify(items);

    const result = db.prepare(`
      INSERT INTO fleet_inspections (
        vehicle_id, inspection_type, inspector_name, inspection_date,
        overall_result, mileage, items, notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      inspection_type,
      inspector_name,
      inspection_date,
      overall_result,
      mileage ?? null,
      itemsJson,
      notes || null,
      req.user!.userId,
      localNow()
    );

    // Update vehicle mileage if provided and higher
    if (mileage && (!vehicle.current_mileage || mileage > vehicle.current_mileage)) {
      db.prepare(`
        UPDATE fleet_vehicles SET current_mileage = ?, updated_at = ? WHERE id = ?
      `).run(mileage, localNow(), id);
    }

    const record = db.prepare('SELECT * FROM fleet_inspections WHERE id = ?').get(result.lastInsertRowid) as any;
    if (!record) { res.status(500).json({ error: 'Failed to retrieve inspection record' }); return; }

    auditLog(req, 'inspection_completed', 'inspection', result.lastInsertRowid as number, `Completed inspection for vehicle ${vehicle.vehicle_number}`);

    res.status(201).json({
      ...record,
      items: safeParseJson(record.items, []),
    });
  } catch (error: any) {
    console.error('Error creating inspection:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to create inspection' });
  }
});

// PUT /api/fleet/inspections/:id - Update inspection
router.put('/inspections/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_inspections WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Inspection not found' }); return; }

    const iFields: string[] = [];
    const iValues: any[] = [];
    const iBodyKeys = Object.keys(req.body);
    const iFieldMap: Record<string, (v: any) => any> = {
      inspection_type: v => v ?? null, inspector_name: v => v ?? null, inspection_date: v => v ?? null,
      overall_result: v => v ?? null, mileage: v => v ?? null, notes: v => v ?? null,
    };
    for (const [key, transform] of Object.entries(iFieldMap)) {
      if (iBodyKeys.includes(key)) { iFields.push(`${key} = ?`); iValues.push(transform(req.body[key])); }
    }
    if (iBodyKeys.includes('items')) {
      iFields.push('items = ?');
      iValues.push(JSON.stringify(req.body.items));
    }
    if (iFields.length > 0) {
      iValues.push(req.params.id);
      db.prepare(`UPDATE fleet_inspections SET ${iFields.join(', ')} WHERE id = ?`).run(...iValues);
    }

    const updated = db.prepare('SELECT * FROM fleet_inspections WHERE id = ?').get(req.params.id) as any;
    if (!updated) { res.status(404).json({ error: 'Inspection not found after update' }); return; }
    auditLog(req, 'inspection_completed', 'inspection', String(req.params.id), `Updated inspection #${req.params.id}`);
    res.json({ ...updated, items: safeParseJson(updated.items, []) });
  } catch (error: any) {
    console.error('Update inspection error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/fleet/inspections/:id
router.delete('/inspections/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_inspections WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Inspection not found' }); return; }
    db.prepare('DELETE FROM fleet_inspections WHERE id = ?').run(req.params.id);
    auditLog(req, 'inspection_completed', 'inspection', String(req.params.id), `Deleted inspection #${req.params.id}`);
    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error('Delete inspection error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/fleet/inspections/:id/archive
router.post('/inspections/:id/archive', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_inspections WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Inspection not found' }); return; }
    if (record.archived_at) { res.status(400).json({ error: 'Already archived' }); return; }
    const now = localNow();
    db.prepare('UPDATE fleet_inspections SET archived_at = ? WHERE id = ?').run(now, record.id);
    auditLog(req, 'inspection_completed', 'inspection', record.id, `Archived inspection #${record.id}`);
    const updated = db.prepare('SELECT * FROM fleet_inspections WHERE id = ?').get(record.id) as any;
    if (!updated) { res.status(404).json({ error: 'Inspection not found after update' }); return; }
    res.json({ ...updated, items: safeParseJson(updated.items, []) });
  } catch (error: any) {
    console.error('Archive inspection error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/fleet/inspections/:id/unarchive
router.post('/inspections/:id/unarchive', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_inspections WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Inspection not found' }); return; }
    if (!record.archived_at) { res.status(400).json({ error: 'Not archived' }); return; }
    db.prepare('UPDATE fleet_inspections SET archived_at = NULL WHERE id = ?').run(record.id);
    auditLog(req, 'inspection_completed', 'inspection', record.id, `Unarchived inspection #${record.id}`);
    const updated = db.prepare('SELECT * FROM fleet_inspections WHERE id = ?').get(record.id) as any;
    if (!updated) { res.status(404).json({ error: 'Inspection not found after update' }); return; }
    res.json({ ...updated, items: safeParseJson(updated.items, []) });
  } catch (error: any) {
    console.error('Unarchive inspection error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/fleet/:id/assignments ─ Assignment history ──────────
router.get('/:id/assignments', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { page = '1', per_page = '50' } = req.query;

    const vehicle = db.prepare('SELECT id FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found' });
      return;
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(per_page as string, 10) || 50));
    const offset = (pageNum - 1) * perPage;

    const countRow = db.prepare('SELECT COUNT(*) as total FROM fleet_assignments WHERE vehicle_id = ?').get(id) as any;

    const records = db.prepare(`
      SELECT * FROM fleet_assignments
      WHERE vehicle_id = ?
      ORDER BY assigned_at DESC
      LIMIT ? OFFSET ?
    `).all(id, perPage, offset);

    res.json({
      data: records,
      pagination: {
        page: pageNum,
        per_page: perPage,
        total: countRow?.total ?? 0,
        totalPages: perPage > 0 ? Math.ceil((countRow?.total ?? 0) / perPage) : 0,
      },
    });
  } catch (error: any) {
    console.error('Error fetching assignment history:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch assignment history' });
  }
});

// ─── GET /api/fleet/:id/personnel ─ Aggregated officer data ───────
router.get('/:id/personnel', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const vehicle = db.prepare('SELECT id, assigned_unit_id FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found' });
      return;
    }

    let officer: any = null;
    let unit: any = null;
    let credentials: any[] = [];
    let todaySchedule: any[] = [];
    let activeTimeEntry: any = null;

    if (vehicle.assigned_unit_id) {
      // Get unit + officer
      unit = db.prepare(`
        SELECT u.*, usr.full_name as officer_name, usr.badge_number, usr.phone as officer_phone
        FROM units u
        LEFT JOIN users usr ON u.officer_id = usr.id
        WHERE u.id = ?
      `).get(vehicle.assigned_unit_id) as any;

      if (unit?.officer_id) {
        // Full officer profile
        officer = db.prepare(`
          SELECT id, username, full_name, first_name, last_name, middle_name, email, role, badge_number, phone, status,
            rank, department, hire_date, shift_preference,
            emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
            created_at, updated_at
          FROM users WHERE id = ?
        `).get(unit.officer_id) as any;

        // Credentials
        credentials = db.prepare(`
          SELECT c.*, u.full_name as officer_name, u.badge_number
          FROM credentials c
          LEFT JOIN users u ON c.officer_id = u.id
          WHERE c.officer_id = ?
          ORDER BY c.expiry_date ASC
        `).all(unit.officer_id);

        // Today's schedule
        const today = localToday();
        todaySchedule = db.prepare(`
          SELECT s.*, p.name as property_name
          FROM schedules s
          LEFT JOIN properties p ON s.property_id = p.id
          WHERE s.officer_id = ? AND s.shift_date = ?
        `).all(unit.officer_id, today);

        // Active time entry
        activeTimeEntry = db.prepare(`
          SELECT * FROM time_entries
          WHERE officer_id = ? AND status = 'active'
          ORDER BY clock_in DESC LIMIT 1
        `).get(unit.officer_id) || null;
      }
    }

    // Personnel notes for this vehicle
    const notes = db.prepare(`
      SELECT * FROM fleet_personnel_notes
      WHERE vehicle_id = ?
      ORDER BY created_at DESC
    `).all(id);

    res.json({
      officer,
      unit,
      credentials,
      todaySchedule,
      activeTimeEntry,
      notes,
    });
  } catch (error: any) {
    console.error('Error fetching fleet personnel:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch fleet personnel data' });
  }
});

// ─── POST /api/fleet/:id/personnel-notes ─ Add note ──────────────
router.post('/:id/personnel-notes', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { note, officer_id, officer_name } = req.body;

    if (!note || !note.trim()) {
      res.status(400).json({ error: 'Note text is required' });
      return;
    }

    const vehicle = db.prepare('SELECT id FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found' });
      return;
    }

    // Get the creating user's name
    const creator = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;

    const result = db.prepare(`
      INSERT INTO fleet_personnel_notes (vehicle_id, officer_id, officer_name, note, created_by, created_by_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, officer_id || null, officer_name || null, note.trim(), req.user!.userId, creator?.full_name || 'Unknown', localNow());

    const created = db.prepare('SELECT * FROM fleet_personnel_notes WHERE id = ?').get(result.lastInsertRowid) as any;
    if (!created) { res.status(500).json({ error: 'Failed to retrieve created note' }); return; }

    auditLog(req, 'vehicle_fleet_updated', 'fleet_vehicle', String(id), `Added personnel note for vehicle #${id}`);

    res.status(201).json(created);
  } catch (error: any) {
    console.error('Error creating personnel note:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to create personnel note' });
  }
});

// ─── DELETE /api/fleet/:id/personnel-notes/:noteId ─ Delete note ──
router.delete('/:id/personnel-notes/:noteId', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id, noteId } = req.params;

    const note = db.prepare('SELECT id FROM fleet_personnel_notes WHERE id = ? AND vehicle_id = ?').get(noteId, id) as any;
    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    db.prepare('DELETE FROM fleet_personnel_notes WHERE id = ?').run(noteId);
    auditLog(req, 'vehicle_fleet_updated', 'fleet_vehicle', String(id), `Deleted personnel note #${noteId} from vehicle #${id}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting personnel note:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to delete personnel note' });
  }
});

// ─── POST /api/fleet/import/simply-fleet ─ Bulk import SF data ───
router.post('/import/simply-fleet', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { fillups, services, vehicle_number } = req.body;

    if (!vehicle_number) {
      res.status(400).json({ error: 'vehicle_number is required to match import data' });
      return;
    }

    // Find vehicle by vehicle_number
    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE vehicle_number = ?').get(vehicle_number) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Vehicle not found. Create it first.' });
      return;
    }

    const now = localNow();
    let fuelInserted = 0;
    let serviceInserted = 0;
    let fuelSkipped = 0;
    let serviceSkipped = 0;

    const insertFuel = db.prepare(`
      INSERT INTO fleet_fuel_logs (
        vehicle_id, fuel_date, gallons, total_cost, odometer_reading,
        fuel_type, station, notes, distance, efficiency, source, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, 'regular', ?, ?, ?, ?, 'simply_fleet', ?, ?)
    `);

    const insertMaintenance = db.prepare(`
      INSERT INTO fleet_maintenance (
        vehicle_id, performed_at, type, description, cost,
        mileage_at_service, vendor, labor_cost, service_tasks, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'simply_fleet', ?)
    `);

    // Check for existing import duplicates by date + odometer
    const checkFuelDup = db.prepare(
      `SELECT id FROM fleet_fuel_logs WHERE vehicle_id = ? AND fuel_date = ? AND odometer_reading = ? AND source = 'simply_fleet'`
    );
    const checkServiceDup = db.prepare(
      `SELECT id FROM fleet_maintenance WHERE vehicle_id = ? AND performed_at = ? AND mileage_at_service = ? AND source = 'simply_fleet'`
    );

    // Map service task to valid maintenance type
    const mapServiceType = (task: string): string => {
      const t = (task || '').toLowerCase();
      if (t.includes('oil change') || t.includes('oil & filter')) return 'oil_change';
      if (t.includes('tire r')) return 'tire_rotation';
      if (t.includes('brake')) return 'brake_service';
      if (t.includes('inspection')) return 'inspection';
      if (t.includes('replacement') || t.includes('alignment') || t.includes('repair')) return 'repair';
      return 'other';
    };

    const txn = db.transaction(() => {
      // Import fillups
      if (Array.isArray(fillups)) {
        for (const f of fillups) {
          // Deduplicate: same date + odometer
          const existing = checkFuelDup.get(vehicle.id, f.date, f.odometer);
          if (existing) { fuelSkipped++; continue; }

          insertFuel.run(
            vehicle.id,
            f.date,
            f.quantity ?? f.gallons ?? null,
            f.total_cost ?? null,
            f.odometer ?? null,
            f.station || null,
            f.notes || null,
            f.distance ?? null,
            f.efficiency ?? null,
            req.user!.userId,
            now,
          );
          fuelInserted++;

          // Update vehicle mileage if higher
          if (f.odometer && (!vehicle.current_mileage || f.odometer > vehicle.current_mileage)) {
            db.prepare('UPDATE fleet_vehicles SET current_mileage = ?, updated_at = ? WHERE id = ?')
              .run(f.odometer, now, vehicle.id);
            vehicle.current_mileage = f.odometer;
          }
        }
      }

      // Import services
      if (Array.isArray(services)) {
        for (const s of services) {
          const existing = checkServiceDup.get(vehicle.id, s.date, s.odometer);
          if (existing) { serviceSkipped++; continue; }

          const taskDesc = s.service_task || s.description || 'Service';
          insertMaintenance.run(
            vehicle.id,
            s.date,
            mapServiceType(taskDesc),
            taskDesc,
            s.total_cost ?? null,
            s.odometer ?? null,
            s.station || s.vendor || null,
            s.labor_cost ?? null,
            s.service_task ? JSON.stringify([s.service_task]) : null,
            now,
          );
          serviceInserted++;

          if (s.odometer && (!vehicle.current_mileage || s.odometer > vehicle.current_mileage)) {
            db.prepare('UPDATE fleet_vehicles SET current_mileage = ?, updated_at = ? WHERE id = ?')
              .run(s.odometer, now, vehicle.id);
            vehicle.current_mileage = s.odometer;
          }
        }
      }
    });

    txn();

    auditLog(req, 'vehicle_fleet_updated', 'fleet_vehicle', vehicle.id, `Simply Fleet import: ${fuelInserted} fuel, ${serviceInserted} service records for ${vehicle_number}`);

    res.json({
      success: true,
      vehicle_id: vehicle.id,
      vehicle_number,
      fuel: { inserted: fuelInserted, skipped: fuelSkipped },
      services: { inserted: serviceInserted, skipped: serviceSkipped },
    });
  } catch (error: any) {
    console.error('Simply Fleet import error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to import Simply Fleet data' });
  }
});

// ═══════════════════════════════════════════════════════════════
// DASH CAMERA VIDEO MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// ── GET /api/fleet/dashcam-videos — List all dash cam videos ──
router.get('/dashcam-videos', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { vehicle_id, unit_id, classification } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (vehicle_id) { where += ' AND v.vehicle_id = ?'; params.push(vehicle_id); }
    if (unit_id) { where += ' AND v.unit_id = ?'; params.push(unit_id); }
    if (classification) { where += ' AND v.classification = ?'; params.push(classification); }

    const videos = db.prepare(`
      SELECT v.*, fv.vehicle_number, fv.make as vehicle_make, fv.model as vehicle_model, fv.year as vehicle_year,
             un.call_sign as unit_call_sign
      FROM dashcam_videos v
      LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
      LEFT JOIN units un ON v.unit_id = un.id
      ${where}
      ORDER BY v.recorded_at DESC, v.created_at DESC
      LIMIT 200
    `).all(...params);

    res.json(videos);
  } catch (error: any) {
    console.error('Get dashcam videos error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/fleet/:vehicleId/dashcam-videos — Videos for a vehicle ──
router.get('/:vehicleId/dashcam-videos', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const videos = db.prepare(`
      SELECT v.*, fv.vehicle_number, un.call_sign as unit_call_sign
      FROM dashcam_videos v
      LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
      LEFT JOIN units un ON v.unit_id = un.id
      WHERE v.vehicle_id = ?
      ORDER BY v.recorded_at DESC
    `).all(req.params.vehicleId);

    res.json(videos);
  } catch (error: any) {
    console.error('Get vehicle dashcam videos error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/fleet/dashcam-videos — Upload dash cam video ──
router.post('/dashcam-videos', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  req.setTimeout(600000);
  res.setTimeout(600000);

  try {
    if (!fs.existsSync(DASHCAM_DIR)) fs.mkdirSync(DASHCAM_DIR, { recursive: true });
    fs.accessSync(DASHCAM_DIR, fs.constants.W_OK);
  } catch (dirErr: any) {
    console.error('[Fleet] Upload storage error:', dirErr.message);
    res.status(503).json({ error: 'Upload storage unavailable' });
    return;
  }

  try {
    dashcamUpload.single('video')(req, res, (multerErr: any) => {
      if (multerErr) {
        console.error('[Fleet] Multer upload error:', multerErr.message);
        res.status(400).json({ error: 'Upload failed' });
        return;
      }

      try {
        const db = getDb();
        const file = req.file;
        if (!file) {
          res.status(400).json({ error: 'No video file provided' });
          return;
        }

        const { vehicle_id, unit_id, title, duration_seconds, recorded_at,
                speed_mph, latitude, longitude, address,
                case_number, classification, notes } = req.body;

        if (!title) {
          if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
          res.status(400).json({ error: 'title is required' });
          return;
        }

        const diskStat = fs.statSync(file.path);
        const verifiedSize = diskStat.size;
        const relativePath = path.relative(DASHCAM_DIR, file.path);

        // Auto-populate speed/lat/lon/address from nearest ClearPathGPS event
        let resolvedSpeed = speed_mph ? parseFloat(speed_mph) : null;
        let resolvedLat = latitude ? parseFloat(latitude) : null;
        let resolvedLon = longitude ? parseFloat(longitude) : null;
        let resolvedAddr = address || null;

        if (unit_id && recorded_at && (resolvedSpeed == null || resolvedLat == null)) {
          try {
            const nearestEvent = db.prepare(`
              SELECT speed_mph, latitude, longitude, address
              FROM dashcam_events
              WHERE unit_id = ?
              AND ABS(julianday(event_timestamp) - julianday(?)) < 0.007
              ORDER BY ABS(julianday(event_timestamp) - julianday(?))
              LIMIT 1
            `).get(unit_id, recorded_at, recorded_at) as any;

            if (nearestEvent) {
              if (resolvedSpeed == null && nearestEvent.speed_mph != null) resolvedSpeed = nearestEvent.speed_mph;
              if (resolvedLat == null && nearestEvent.latitude != null) resolvedLat = nearestEvent.latitude;
              if (resolvedLon == null && nearestEvent.longitude != null) resolvedLon = nearestEvent.longitude;
              if (!resolvedAddr && nearestEvent.address) resolvedAddr = nearestEvent.address;
            }
          } catch { /* ClearPathGPS lookup failed — use manual values */ }
        }

        const result = db.prepare(`
          INSERT INTO dashcam_videos (vehicle_id, unit_id, title, file_path, file_size, duration_seconds,
            mime_type, recorded_at, speed_mph, latitude, longitude, address,
            case_number, classification, notes, uploaded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          vehicle_id || null, unit_id || null, title, relativePath, verifiedSize,
          duration_seconds ?? null, file.mimetype,
          recorded_at || localNow(),
          resolvedSpeed, resolvedLat, resolvedLon, resolvedAddr,
          case_number || null, classification || 'routine',
          notes || null, String(req.user!.userId),
        );

        const videoId = result.lastInsertRowid;

        const video = db.prepare(`
          SELECT v.*, fv.vehicle_number, fv.year as vehicle_year, fv.make as vehicle_make, fv.model as vehicle_model,
                 un.call_sign as unit_call_sign
          FROM dashcam_videos v
          LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
          LEFT JOIN units un ON v.unit_id = un.id
          WHERE v.id = ?
        `).get(videoId) as any;

        // Fire-and-forget: extract duration
        const fullFilePath = path.resolve(DASHCAM_DIR, relativePath);
        extractDashcamDuration(fullFilePath).then((dur) => {
          if (dur != null) {
            try {
              getDb().prepare('UPDATE dashcam_videos SET duration_seconds = ?, updated_at = ? WHERE id = ?')
                .run(dur, localNow(), videoId);
            } catch { /* ignore */ }
          }
        }).catch((err) => { console.error('[Fleet] Background operation failed:', err.message || err); });

        // Fire-and-forget: queue overlay burn
        const vehDesc = [video?.vehicle_year, video?.vehicle_make, video?.vehicle_model].filter(Boolean).join(' ');
        const overlayConfig: DashCamOverlayConfig = {
          type: 'dashcam',
          unitCallSign: video?.unit_call_sign || '',
          vehicleDescription: vehDesc,
          recordedAtUnix: Math.floor(new Date(recorded_at || Date.now()).getTime() / 1000),
          speedMph: resolvedSpeed,
          latitude: resolvedLat,
          longitude: resolvedLon,
          address: resolvedAddr || '',
        };
        queueOverlayProcessing(videoId, 'dashcam', fullFilePath, overlayConfig);

        auditLog(req, 'dashcam_uploaded', 'fleet_vehicle', videoId as number, `Uploaded dashcam video: ${title}`);

        res.status(201).json(video);
      } catch (error: any) {
        console.error('Dashcam upload DB error:', error?.message, error?.stack);
        res.status(500).json({ error: 'Upload processing failed' });
      }
    });
  } catch (outerErr: any) {
    console.error('Dashcam upload error:', outerErr?.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Upload failed' });
    }
  }
});

// ── GET /api/fleet/dashcam-videos/:id/stream — Stream with overlay ──
router.get('/dashcam-videos/:id/stream', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(req.params.id) as any;
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // Serve processed (overlaid) file if available
    const servePath = (video.overlay_status === 'complete' && video.processed_file_path)
      ? path.resolve(DASHCAM_DIR, video.processed_file_path)
      : path.resolve(DASHCAM_DIR, video.file_path);

    const filePath = fs.existsSync(servePath) ? servePath : path.resolve(DASHCAM_DIR, video.file_path);

    if (path.relative(DASHCAM_DIR, filePath).startsWith('..') || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Video file not found on disk' });
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const mimeType = filePath.endsWith('.mp4') ? 'video/mp4' : (video.mime_type || 'video/mp4');
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
        res.end();
        return;
      }

      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
      });
      const rangeStream = fs.createReadStream(filePath, { start, end });
      rangeStream.on('error', (err) => { console.error('Stream error:', err); if (!res.headersSent) res.status(500).end(); else res.destroy(); });
      rangeStream.pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': mimeType });
      const fullStream = fs.createReadStream(filePath);
      fullStream.on('error', (err) => { console.error('Stream error:', err); if (!res.headersSent) res.status(500).end(); else res.destroy(); });
      fullStream.pipe(res);
    }
  } catch (error: any) {
    console.error('Stream dashcam video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/fleet/dashcam-videos/:id/download — Force-download with overlay ──
router.get('/dashcam-videos/:id/download', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(req.params.id) as any;
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const servePath = (video.overlay_status === 'complete' && video.processed_file_path)
      ? path.resolve(DASHCAM_DIR, video.processed_file_path)
      : path.resolve(DASHCAM_DIR, video.file_path);

    const filePath = fs.existsSync(servePath) ? servePath : path.resolve(DASHCAM_DIR, video.file_path);

    if (path.relative(DASHCAM_DIR, filePath).startsWith('..') || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Video file not found on disk' });
      return;
    }

    const stat = fs.statSync(filePath);
    const safeTitle = (video.title || `dashcam_${video.id}`).replace(/[^a-zA-Z0-9_\-. ]/g, '_');
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="MVR_${safeTitle}.mp4"`,
    });
    const dlStream = fs.createReadStream(filePath);
    dlStream.on('error', (err) => { console.error('Download stream error:', err); if (!res.headersSent) res.status(500).end(); else res.destroy(); });
    dlStream.pipe(res);
  } catch (error: any) {
    console.error('Download dashcam video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/fleet/dashcam-videos/:id — Update metadata ──
router.put('/dashcam-videos/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const { title, classification, case_number, notes, speed_mph, latitude, longitude, address } = req.body;
    const setClauses: string[] = [];
    const vals: any[] = [];

    if (title !== undefined) { setClauses.push('title = ?'); vals.push(title); }
    if (classification !== undefined) { setClauses.push('classification = ?'); vals.push(classification); }
    if (case_number !== undefined) { setClauses.push('case_number = ?'); vals.push(case_number || null); }
    if (notes !== undefined) { setClauses.push('notes = ?'); vals.push(notes || null); }
    if (speed_mph !== undefined) { setClauses.push('speed_mph = ?'); vals.push(speed_mph != null ? parseFloat(speed_mph) : null); }
    if (latitude !== undefined) { setClauses.push('latitude = ?'); vals.push(latitude != null ? parseFloat(latitude) : null); }
    if (longitude !== undefined) { setClauses.push('longitude = ?'); vals.push(longitude != null ? parseFloat(longitude) : null); }
    if (address !== undefined) { setClauses.push('address = ?'); vals.push(address || null); }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    setClauses.push('updated_at = ?');
    vals.push(localNow());
    vals.push(req.params.id);

    db.prepare(`UPDATE dashcam_videos SET ${setClauses.join(', ')} WHERE id = ?`).run(...vals);

    const updated = db.prepare(`
      SELECT v.*, fv.vehicle_number, un.call_sign as unit_call_sign
      FROM dashcam_videos v
      LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
      LEFT JOIN units un ON v.unit_id = un.id
      WHERE v.id = ?
    `).get(req.params.id);

    auditLog(req, 'dashcam_updated', 'fleet_vehicle', String(req.params.id), `Updated dashcam video #${req.params.id}`);

    res.json(updated);
  } catch (error: any) {
    console.error('Update dashcam video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/fleet/dashcam-videos/:id — Delete video + files ──
router.delete('/dashcam-videos/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // Delete original file
    const filePath = path.resolve(DASHCAM_DIR, existing.file_path);
    if (!path.relative(DASHCAM_DIR, filePath).startsWith('..') && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    // Delete processed overlay file
    if (existing.processed_file_path) {
      const processedPath = path.resolve(DASHCAM_DIR, existing.processed_file_path);
      if (!path.relative(DASHCAM_DIR, processedPath).startsWith('..') && fs.existsSync(processedPath)) {
        fs.unlinkSync(processedPath);
      }
    }

    db.prepare('DELETE FROM dashcam_videos WHERE id = ?').run(req.params.id);
    auditLog(req, 'dashcam_deleted', 'fleet_vehicle', String(req.params.id), `Deleted dashcam video #${req.params.id}`);
    res.json({ message: 'Dash cam video deleted' });
  } catch (error: any) {
    console.error('Delete dashcam video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/fleet/dashcam-videos/:id/reprocess — Re-queue overlay ──
router.post('/dashcam-videos/:id/reprocess', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare(`
      SELECT v.*, fv.vehicle_number, fv.year as vehicle_year, fv.make as vehicle_make, fv.model as vehicle_model,
             un.call_sign as unit_call_sign
      FROM dashcam_videos v
      LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
      LEFT JOIN units un ON v.unit_id = un.id
      WHERE v.id = ?
    `).get(req.params.id) as any;

    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const inputPath = path.resolve(DASHCAM_DIR, video.file_path);
    if (!fs.existsSync(inputPath)) {
      res.status(404).json({ error: 'Original video file not found' });
      return;
    }

    const vehDesc = [video.vehicle_year, video.vehicle_make, video.vehicle_model].filter(Boolean).join(' ');
    const recordedAt = video.recorded_at ? new Date(video.recorded_at) : new Date();
    const config: DashCamOverlayConfig = {
      type: 'dashcam',
      unitCallSign: video.unit_call_sign || '',
      vehicleDescription: vehDesc,
      recordedAtUnix: Math.floor(recordedAt.getTime() / 1000),
      speedMph: video.speed_mph,
      latitude: video.latitude,
      longitude: video.longitude,
      address: video.address || '',
    };

    queueOverlayProcessing(video.id, 'dashcam', inputPath, config);
    auditLog(req, 'dashcam_updated', 'fleet_vehicle', video.id, `Reprocessed overlay for dashcam video #${video.id}`);
    res.json({ message: 'Overlay reprocessing queued', videoId: video.id });
  } catch (error: any) {
    console.error('Reprocess dashcam overlay error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────

function safeParseJson(value: string | null | undefined, fallback: any): any {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// ─── CSV EXPORT ──────────────────────────────────────────

// GET /api/fleet/export/csv — Export fleet vehicles
router.get('/export/csv', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT fv.id, fv.vehicle_number, fv.year, fv.make, fv.model, fv.color,
        fv.vin, fv.plate_number, fv.plate_state, fv.status,
        fv.current_mileage, fv.fuel_type, fv.insurance_policy,
        fv.insurance_expiry, fv.registration_expiry,
        fv.created_at, fv.updated_at,
        u.call_sign as assigned_unit
      FROM fleet_vehicles fv
      LEFT JOIN units u ON fv.assigned_unit_id = u.id
      WHERE fv.archived_at IS NULL
      ORDER BY fv.vehicle_number LIMIT 10000
    `).all();
    sendCsv(res, 'fleet_vehicles_export.csv', [
      { key: 'id', header: 'ID' },
      { key: 'vehicle_number', header: 'Vehicle Number' },
      { key: 'year', header: 'Year' },
      { key: 'make', header: 'Make' },
      { key: 'model', header: 'Model' },
      { key: 'color', header: 'Color' },
      { key: 'vin', header: 'VIN' },
      { key: 'plate_number', header: 'Plate Number' },
      { key: 'plate_state', header: 'Plate State' },
      { key: 'status', header: 'Status' },
      { key: 'current_mileage', header: 'Current Mileage' },
      { key: 'fuel_type', header: 'Fuel Type' },
      { key: 'assigned_unit', header: 'Assigned Unit' },
      { key: 'insurance_policy', header: 'Insurance Policy' },
      { key: 'insurance_expiry', header: 'Insurance Expiry' },
      { key: 'registration_expiry', header: 'Registration Expiry' },
      { key: 'created_at', header: 'Created At' },
    ], rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Export failed' });
  }
});

export default router;
