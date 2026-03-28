import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcastFleetUpdate } from '../utils/websocket';
import { localNow, localToday } from '../utils/timeUtils';

const execAsync = promisify(exec);

/** Extract video duration using ffprobe. */
async function extractVideoDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { timeout: 30000 }
    );
    const seconds = parseFloat(stdout.trim());
    return isFinite(seconds) ? Math.round(seconds) : null;
  } catch {
    return null;
  }
}

const __filename_f = fileURLToPath(import.meta.url);
const __dirname_f = path.dirname(__filename_f);
const DASHCAM_DIR = process.env.RMPG_UPLOADS_DIR
  ? path.join(process.env.RMPG_UPLOADS_DIR, 'dashcam')
  : path.resolve(__dirname_f, '../../uploads/dashcam');

if (!fs.existsSync(DASHCAM_DIR)) {
  fs.mkdirSync(DASHCAM_DIR, { recursive: true });
}

const VIDEO_MIME_TYPES = new Set([
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
    if (VIDEO_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed. Accepted: MP4, MOV, AVI, WebM`));
    }
  },
});

const router = Router();

// All fleet routes require authentication
router.use(authenticateToken);

// ─── GET /api/fleet ─ List fleet vehicles with filters ────────────
router.get('/', (req: Request, res: Response) => {
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
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / perPage),
      },
    });
  } catch (error: any) {
    console.error('Error fetching fleet vehicles:', error);
    res.status(500).json({ error: 'Failed to fetch fleet vehicles', code: 'FAILED_TO_FETCH_FLEET' });
  }
});

// ─── GET /api/fleet/analytics ─ Fleet-wide aggregate analytics ────
router.get('/analytics', (req: Request, res: Response) => {
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
      case 'all': dateCutoff = '2000-01-01'; break;
      default: dateCutoff = new Date(now.getTime() - 90 * 86400000).toISOString();
    }

    res.set('Cache-Control', 'private, max-age=120');

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
    
      LIMIT 1000
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

    // ── Enhanced analytics: cost_per_mile_ranking ──
    const costPerMileRanking = db.prepare(`
      SELECT fv.id, fv.vehicle_number, fv.make, fv.model, fv.year, fv.current_mileage,
        COALESCE(m.maint_cost, 0) AS maintenance_cost,
        COALESCE(f.fuel_cost, 0) AS fuel_cost,
        (COALESCE(m.maint_cost, 0) + COALESCE(f.fuel_cost, 0)) AS total_cost,
        CASE WHEN fv.current_mileage > 0
          THEN ROUND((COALESCE(m.maint_cost, 0) + COALESCE(f.fuel_cost, 0)) * 1.0 / fv.current_mileage, 4)
          ELSE NULL END AS cost_per_mile
      FROM fleet_vehicles fv
      LEFT JOIN (SELECT vehicle_id, SUM(cost) AS maint_cost FROM fleet_maintenance WHERE cost IS NOT NULL GROUP BY vehicle_id) m ON m.vehicle_id = fv.id
      LEFT JOIN (SELECT vehicle_id, SUM(total_cost) AS fuel_cost FROM fleet_fuel_logs WHERE total_cost IS NOT NULL GROUP BY vehicle_id) f ON f.vehicle_id = fv.id
      WHERE fv.current_mileage > 0
      ORDER BY cost_per_mile DESC
      LIMIT 10
    `).all() as any[];

    // ── Enhanced analytics: service_compliance ──
    const nowISO = localNow();
    const serviceCompliant = db.prepare(`
      SELECT COUNT(*) AS count FROM fleet_vehicles
      WHERE status != 'retired' AND (next_service_due IS NULL OR next_service_due > ?)
    `).get(nowISO) as any;
    const serviceOverdue = db.prepare(`
      SELECT COUNT(*) AS count FROM fleet_vehicles
      WHERE status != 'retired' AND next_service_due IS NOT NULL AND next_service_due <= ?
    `).get(nowISO) as any;
    const serviceTotal = (serviceCompliant.count || 0) + (serviceOverdue.count || 0);
    const serviceCompliance = {
      compliant: serviceCompliant.count || 0,
      overdue: serviceOverdue.count || 0,
      rate: serviceTotal > 0 ? Math.round(((serviceCompliant.count || 0) / serviceTotal) * 1000) / 10 : 100,
    };

    // ── Enhanced analytics: inspection_pass_rate ──
    const inspTotal = db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN overall_result = 'pass' THEN 1 ELSE 0 END) AS passed,
        SUM(CASE WHEN overall_result = 'fail' THEN 1 ELSE 0 END) AS failed
      FROM fleet_inspections WHERE inspection_date >= ?
    `).get(dateCutoff) as any;
    const inspectionPassRate = {
      total: inspTotal.total || 0,
      passed: inspTotal.passed || 0,
      failed: inspTotal.failed || 0,
      rate: (inspTotal.total || 0) > 0 ? Math.round(((inspTotal.passed || 0) / inspTotal.total) * 1000) / 10 : 100,
    };

    // ── Enhanced analytics: fuel_economy_ranking (top 10 by avg MPG) ──
    const fuelEconomyRanking = db.prepare(`
      SELECT fv.id, fv.vehicle_number, fv.make, fv.model, fv.year,
        ROUND(SUM(fl.miles_driven) * 1.0 / SUM(fl.gallons), 1) AS avg_mpg,
        SUM(fl.gallons) AS total_gallons, SUM(fl.miles_driven) AS total_miles
      FROM fleet_vehicles fv
      INNER JOIN fleet_fuel_logs fl ON fl.vehicle_id = fv.id
      WHERE fl.gallons > 0 AND fl.miles_driven > 0
      GROUP BY fv.id
      HAVING total_gallons > 0
      ORDER BY avg_mpg DESC
      LIMIT 10
    `).all() as any[];

    // ── Enhanced analytics: utilization ──
    const assignedCount = db.prepare(`SELECT COUNT(*) AS count FROM fleet_vehicles WHERE assigned_unit_id IS NOT NULL AND status != 'retired'`).get() as any;
    const unassignedCount = db.prepare(`SELECT COUNT(*) AS count FROM fleet_vehicles WHERE assigned_unit_id IS NULL AND status != 'retired'`).get() as any;
    const utilizationTotal = (assignedCount.count || 0) + (unassignedCount.count || 0);
    const utilization = {
      assigned: assignedCount.count || 0,
      unassigned: unassignedCount.count || 0,
      rate: utilizationTotal > 0 ? Math.round(((assignedCount.count || 0) / utilizationTotal) * 1000) / 10 : 0,
    };

    // ── Compute fleet-wide average MPG ──
    const allMpg = Object.values(mpgByMonth);
    const fleetTotalMiles = allMpg.reduce((s, m) => s + m.total_miles, 0);
    const fleetTotalGallons = allMpg.reduce((s, m) => s + m.total_gallons, 0);
    const avgMpg = fleetTotalGallons > 0 ? Math.round((fleetTotalMiles / fleetTotalGallons) * 10) / 10 : null;

    res.json({
      maintenance_cost_trend: maintenanceCostTrend,
      mileage_distribution: mileageBuckets.map(b => ({ range: b.range, count: b.count })),
      status_breakdown: statusWithColors,
      fuel_economy_trend: fuelEconomyTrend,
      fleet_summary: {
        total_vehicles: totalVehicles.count,
        avg_mileage: Math.round(avgMileage.avg || 0),
        avg_mpg: avgMpg,
        total_maintenance_cost: totalMaintCost.total || 0,
        total_fuel_cost: totalFuelCost.total || 0,
        vehicles_needing_service: vehiclesNeedingService.count,
        inspections_failing: inspectionsFailing.count,
      },
      cost_per_mile_ranking: costPerMileRanking,
      service_compliance: serviceCompliance,
      inspection_pass_rate: inspectionPassRate,
      fuel_economy_ranking: fuelEconomyRanking,
      utilization,
    });
  } catch (error: any) {
    console.error('Error fetching fleet analytics:', error);
    res.status(500).json({ error: 'Failed to fetch fleet analytics', code: 'FAILED_TO_FETCH_FLEET' });
  }
});

// ─── GET /api/fleet/service-alerts ─ Service & compliance alerts ────
router.get('/service-alerts', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const nowISO = localNow();
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 86400000).toISOString();

    // Overdue service
    const overdueService = db.prepare(`
      SELECT id AS vehicle_id, vehicle_number, make, model, year, next_service_due AS due_date
      FROM fleet_vehicles
      WHERE next_service_due IS NOT NULL AND next_service_due < ? AND status != 'retired'
      ORDER BY next_service_due ASC
    `).all(nowISO).map((v: any) => ({ ...v, issue: 'Overdue service', severity: 'critical' }));

    // Upcoming service (within 30 days)
    const upcomingService = db.prepare(`
      SELECT id AS vehicle_id, vehicle_number, make, model, year, next_service_due AS due_date
      FROM fleet_vehicles
      WHERE next_service_due IS NOT NULL AND next_service_due >= ? AND next_service_due <= ? AND status != 'retired'
      ORDER BY next_service_due ASC
    `).all(nowISO, thirtyDaysFromNow).map((v: any) => ({ ...v, issue: 'Service due soon', severity: 'warning' }));

    // Expired registration
    const expiredRegistration = db.prepare(`
      SELECT id AS vehicle_id, vehicle_number, make, model, year, registration_expiry AS due_date
      FROM fleet_vehicles
      WHERE registration_expiry IS NOT NULL AND registration_expiry < ? AND status != 'retired'
      ORDER BY registration_expiry ASC
    `).all(nowISO).map((v: any) => ({ ...v, issue: 'Expired registration', severity: 'critical' }));

    // Expired insurance
    const expiredInsurance = db.prepare(`
      SELECT id AS vehicle_id, vehicle_number, make, model, year, insurance_expiry AS due_date
      FROM fleet_vehicles
      WHERE insurance_expiry IS NOT NULL AND insurance_expiry < ? AND status != 'retired'
      ORDER BY insurance_expiry ASC
    `).all(nowISO).map((v: any) => ({ ...v, issue: 'Expired insurance', severity: 'critical' }));

    // Failed inspections (most recent inspection per vehicle = fail)
    const failedInspections = db.prepare(`
      SELECT fv.id AS vehicle_id, fv.vehicle_number, fv.make, fv.model, fv.year,
        fi.inspection_date AS due_date
      FROM fleet_vehicles fv
      INNER JOIN fleet_inspections fi ON fi.vehicle_id = fv.id
      WHERE fi.id = (
        SELECT fi2.id FROM fleet_inspections fi2
        WHERE fi2.vehicle_id = fv.id ORDER BY fi2.inspection_date DESC LIMIT 1
      ) AND fi.overall_result = 'fail' AND fv.status != 'retired'
      ORDER BY fi.inspection_date DESC
    `).all().map((v: any) => ({ ...v, issue: 'Failed inspection', severity: 'critical' }));

    res.json({
      overdue_service: overdueService,
      upcoming_service: upcomingService,
      expired_registration: expiredRegistration,
      expired_insurance: expiredInsurance,
      failed_inspections: failedInspections,
      all_alerts: [...overdueService, ...expiredRegistration, ...expiredInsurance, ...failedInspections, ...upcomingService],
    });
  } catch (error: any) {
    console.error('Error fetching service alerts:', error);
    res.status(500).json({ error: 'Failed to fetch service alerts' });
  }
});

// ─── GET /api/fleet/cost-breakdown ─ Per-vehicle cost breakdown ────
router.get('/cost-breakdown', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    const costBreakdown = db.prepare(`
      SELECT fv.id, fv.vehicle_number, fv.make, fv.model, fv.year, fv.current_mileage,
        COALESCE(m.maint_cost, 0) AS maintenance_cost,
        COALESCE(f.fuel_cost, 0) AS fuel_cost,
        (COALESCE(m.maint_cost, 0) + COALESCE(f.fuel_cost, 0)) AS total_cost,
        CASE WHEN fv.current_mileage > 0
          THEN ROUND((COALESCE(m.maint_cost, 0) + COALESCE(f.fuel_cost, 0)) * 1.0 / fv.current_mileage, 4)
          ELSE NULL END AS cost_per_mile
      FROM fleet_vehicles fv
      LEFT JOIN (SELECT vehicle_id, SUM(cost) AS maint_cost FROM fleet_maintenance WHERE cost IS NOT NULL GROUP BY vehicle_id) m ON m.vehicle_id = fv.id
      LEFT JOIN (SELECT vehicle_id, SUM(total_cost) AS fuel_cost FROM fleet_fuel_logs WHERE total_cost IS NOT NULL GROUP BY vehicle_id) f ON f.vehicle_id = fv.id
      WHERE fv.status != 'retired'
      ORDER BY total_cost DESC
    `).all();

    res.json({ vehicles: costBreakdown });
  } catch (error: any) {
    console.error('Error fetching cost breakdown:', error);
    res.status(500).json({ error: 'Failed to fetch cost breakdown' });
  }
});

// ─── GET /api/fleet/map ─ Fleet vehicles with GPS for map overlay ──
router.get('/map', (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Check if cpgps_vehicles table exists for GPS data
    let hasCpgps = false;
    try {
      db.prepare("SELECT 1 FROM cpgps_vehicles LIMIT 0").run();
      hasCpgps = true;
    } catch {
      // Table doesn't exist — return vehicles without GPS
    }

    let rows: any[];

    if (hasCpgps) {
      rows = db.prepare(`
        SELECT fv.id, fv.vehicle_number, fv.make, fv.model, fv.year, fv.plate_number,
               fv.status, fv.current_mileage, fv.next_service_due, fv.assigned_unit_id,
               u.call_sign AS assigned_call_sign,
               cv.last_lat AS gps_lat, cv.last_lon AS gps_lon,
               cv.last_speed AS gps_speed, cv.last_heading AS gps_heading,
               cv.last_reported_at AS gps_reported_at
        FROM fleet_vehicles fv
        LEFT JOIN units u ON u.id = fv.assigned_unit_id
        LEFT JOIN cpgps_vehicles cv ON cv.vehicle_id = fv.id
        WHERE fv.status != 'retired'
        ORDER BY fv.vehicle_number
      
        LIMIT 1000
      `).all();
    } else {
      rows = db.prepare(`
        SELECT fv.id, fv.vehicle_number, fv.make, fv.model, fv.year, fv.plate_number,
               fv.status, fv.current_mileage, fv.next_service_due, fv.assigned_unit_id,
               u.call_sign AS assigned_call_sign,
               NULL AS gps_lat, NULL AS gps_lon,
               NULL AS gps_speed, NULL AS gps_heading,
               NULL AS gps_reported_at
        FROM fleet_vehicles fv
        LEFT JOIN units u ON u.id = fv.assigned_unit_id
        WHERE fv.status != 'retired'
        ORDER BY fv.vehicle_number
      
        LIMIT 1000
      `).all();
    }

    res.json(rows);
  } catch (error) {
    console.error('Error fetching fleet map data:', error);
    res.status(500).json({ error: 'Failed to fetch fleet map data', code: 'FAILED_TO_FETCH_FLEET' });
  }
});

// ─── GET /api/fleet/:id ─ Get single fleet vehicle ────────────────
router.get('/:id', (req: Request, res: Response) => {
  try {
    // Avoid matching sub-routes that are handled by other route definitions
    if (['maintenance', 'analytics', 'map'].includes(req.params.id as string)) {
      res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
      return;
    }

    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      res.status(400).json({ error: 'Invalid vehicle ID', code: 'INVALID_VEHICLE_ID' });
      return;
    }

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
      res.status(404).json({ error: 'Fleet vehicle not found', code: 'FLEET_VEHICLE_NOT_FOUND' });
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
    console.error('Error fetching fleet vehicle:', error);
    res.status(500).json({ error: 'Failed to fetch fleet vehicle', code: 'FAILED_TO_FETCH_FLEET' });
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
      next_service_mileage,
      insurance_expiry,
      registration_expiry,
      equipment,
      notes,
    } = req.body;

    if (!vehicle_number) {
      res.status(400).json({ error: 'vehicle_number is required', code: 'VEHICLENUMBER_IS_REQUIRED' });
      return;
    }

    // Check for duplicate vehicle_number
    const existing = db.prepare('SELECT id FROM fleet_vehicles WHERE vehicle_number = ?').get(vehicle_number);
    if (existing) {
      res.status(409).json({ error: 'A vehicle with this vehicle_number already exists', code: 'A_VEHICLE_WITH_THIS' });
      return;
    }

    const equipmentJson = Array.isArray(equipment) ? JSON.stringify(equipment) : (equipment || '[]');

    const result = db.prepare(`
      INSERT INTO fleet_vehicles (
        vehicle_number, make, model, year, color, vin,
        plate_number, plate_state, current_mileage, next_service_mileage,
        insurance_expiry, registration_expiry, equipment, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vehicle_number,
      make || null,
      model || null,
      year || null,
      color || null,
      vin || null,
      plate_number || null,
      plate_state || null,
      current_mileage || null,
      next_service_mileage || null,
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

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, ?, 'fleet_vehicle', ?, ?, ?)
    `).run(
      req.user!.userId,
      'fleet_vehicle_created',
      result.lastInsertRowid,
      `Created fleet vehicle: ${vehicle_number}`,
      req.ip || 'unknown'
    );

    res.status(201).json({
      ...created,
      equipment: safeParseJson(created.equipment, []),
    });
  } catch (error: any) {
    console.error('Error creating fleet vehicle:', error);
    res.status(500).json({ error: 'Failed to create fleet vehicle', code: 'FAILED_TO_CREATE_FLEET' });
  }
});

// ─── PUT /api/fleet/:id ─ Update fleet vehicle ───────────────────
router.put('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Fleet vehicle not found', code: 'FLEET_VEHICLE_NOT_FOUND' });
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
        res.status(409).json({ error: 'A vehicle with this vehicle_number already exists', code: 'A_VEHICLE_WITH_THIS' });
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
      next_service_mileage: v => v ?? null,
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

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, ?, 'fleet_vehicle', ?, ?, ?)
    `).run(
      req.user!.userId,
      'fleet_vehicle_updated',
      id,
      `Updated fleet vehicle: ${updated.vehicle_number}`,
      req.ip || 'unknown'
    );

    res.json({
      ...updated,
      equipment: safeParseJson(updated.equipment, []),
    });
  } catch (error: any) {
    console.error('Error updating fleet vehicle:', error);
    res.status(500).json({ error: 'Failed to update fleet vehicle', code: 'FAILED_TO_UPDATE_FLEET' });
  }
});

// ─── PUT /api/fleet/:id/assign ─ Assign vehicle to unit ──────────
router.put('/:id/assign', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { unit_id } = req.body;

    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found', code: 'FLEET_VEHICLE_NOT_FOUND' });
      return;
    }

    // If assigning to a unit, verify the unit exists
    if (unit_id !== null && unit_id !== undefined) {
      const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unit_id) as any;
      if (!unit) {
        res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' });
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

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, ?, 'fleet_vehicle', ?, ?, ?)
    `).run(
      req.user!.userId,
      unit_id ? 'fleet_vehicle_assigned' : 'fleet_vehicle_unassigned',
      id,
      actionDetail,
      req.ip || 'unknown'
    );

    res.json({
      ...updated,
      equipment: safeParseJson(updated.equipment, []),
    });
  } catch (error: any) {
    console.error('Error assigning fleet vehicle:', error);
    res.status(500).json({ error: 'Failed to assign fleet vehicle', code: 'FAILED_TO_ASSIGN_FLEET' });
  }
});

// DELETE /api/fleet/:id - Delete fleet vehicle (retired + unassigned only)
router.delete('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(req.params.id) as any;
    if (!vehicle) { res.status(404).json({ error: 'Fleet vehicle not found', code: 'FLEET_VEHICLE_NOT_FOUND' }); return; }
    if (vehicle.status !== 'retired') {
      res.status(400).json({ error: 'Only retired vehicles can be deleted', code: 'ONLY_RETIRED_VEHICLES_CAN' }); return;
    }
    if (vehicle.assigned_unit_id) {
      res.status(400).json({ error: 'Unassign vehicle from unit before deleting', code: 'UNASSIGN_VEHICLE_FROM_UNIT' }); return;
    }

    const delTx = db.transaction(() => {
      db.prepare('DELETE FROM fleet_maintenance WHERE vehicle_id = ?').run(vehicle.id);
      db.prepare('DELETE FROM fleet_fuel_logs WHERE vehicle_id = ?').run(vehicle.id);
      db.prepare('DELETE FROM fleet_inspections WHERE vehicle_id = ?').run(vehicle.id);
      db.prepare('DELETE FROM fleet_assignments WHERE vehicle_id = ?').run(vehicle.id);
      db.prepare('DELETE FROM fleet_personnel_notes WHERE vehicle_id = ?').run(vehicle.id);
      db.prepare('DELETE FROM fleet_vehicles WHERE id = ?').run(vehicle.id);
      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'fleet_vehicle_deleted', 'fleet_vehicle', ?, ?, ?)`).run(
        req.user!.userId, vehicle.id, `Deleted fleet vehicle: ${vehicle.vehicle_number}`, req.ip || 'unknown');
    });
    delTx();
    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error('Delete fleet vehicle error:', error);
    res.status(500).json({ error: 'Failed to delete fleet vehicle', code: 'DELETE_FLEET_VEHICLE_ERROR' });
  }
});

// POST /api/fleet/:id/archive
router.post('/:id/archive', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(req.params.id) as any;
    if (!vehicle) { res.status(404).json({ error: 'Fleet vehicle not found', code: 'FLEET_VEHICLE_NOT_FOUND' }); return; }
    if (vehicle.archived_at) { res.status(400).json({ error: 'Vehicle is already archived', code: 'VEHICLE_IS_ALREADY_ARCHIVED' }); return; }

    const now = localNow();
    db.prepare('UPDATE fleet_vehicles SET archived_at = ? WHERE id = ?').run(now, vehicle.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'fleet_vehicle_archived', 'fleet_vehicle', ?, ?, ?)`).run(
      req.user!.userId, vehicle.id, `Archived fleet vehicle: ${vehicle.vehicle_number}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT fv.*, u.call_sign AS assigned_unit_call_sign FROM fleet_vehicles fv LEFT JOIN units u ON fv.assigned_unit_id = u.id WHERE fv.id = ?').get(vehicle.id) as any;
    res.json({ ...updated, equipment: safeParseJson(updated.equipment, []) });
  } catch (error: any) {
    console.error('Archive fleet vehicle error:', error);
    res.status(500).json({ error: 'Failed to archive fleet vehicle', code: 'ARCHIVE_FLEET_VEHICLE_ERROR' });
  }
});

// POST /api/fleet/:id/unarchive
router.post('/:id/unarchive', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(req.params.id) as any;
    if (!vehicle) { res.status(404).json({ error: 'Fleet vehicle not found', code: 'FLEET_VEHICLE_NOT_FOUND' }); return; }
    if (!vehicle.archived_at) { res.status(400).json({ error: 'Vehicle is not archived', code: 'VEHICLE_IS_NOT_ARCHIVED' }); return; }

    db.prepare('UPDATE fleet_vehicles SET archived_at = NULL WHERE id = ?').run(vehicle.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'fleet_vehicle_unarchived', 'fleet_vehicle', ?, ?, ?)`).run(
      req.user!.userId, vehicle.id, `Unarchived fleet vehicle: ${vehicle.vehicle_number}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT fv.*, u.call_sign AS assigned_unit_call_sign FROM fleet_vehicles fv LEFT JOIN units u ON fv.assigned_unit_id = u.id WHERE fv.id = ?').get(vehicle.id) as any;
    res.json({ ...updated, equipment: safeParseJson(updated.equipment, []) });
  } catch (error: any) {
    console.error('Unarchive fleet vehicle error:', error);
    res.status(500).json({ error: 'Failed to unarchive fleet vehicle', code: 'UNARCHIVE_FLEET_VEHICLE_ERROR' });
  }
});

// ─── GET /api/fleet/:id/maintenance ─ Maintenance history ────────
router.get('/:id/maintenance', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { page = '1', per_page = '25' } = req.query;

    // Verify vehicle exists
    const vehicle = db.prepare('SELECT id FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found', code: 'FLEET_VEHICLE_NOT_FOUND' });
      return;
    }

    const pageNum = parseInt(page as string, 10) || 1;
    const perPage = parseInt(per_page as string, 10) || 25;
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
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / perPage),
      },
    });
  } catch (error: any) {
    console.error('Error fetching maintenance history:', error);
    res.status(500).json({ error: 'Failed to fetch maintenance history', code: 'FAILED_TO_FETCH_MAINTENANCE' });
  }
});

// ─── POST /api/fleet/:id/maintenance ─ Log maintenance record ────
router.post('/:id/maintenance', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found', code: 'FLEET_VEHICLE_NOT_FOUND' });
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
      res.status(400).json({ error: 'description is required', code: 'DESCRIPTION_IS_REQUIRED' });
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
      mileage_at_service || null,
      cost || null,
      vendor || null,
      performed_by || null,
      performed_at || localNow(),
      next_due_date || null,
      next_due_mileage || null,
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
      fleetSetValues.push(mileage_at_service || null);
    }
    fleetSetValues.push(id);
    db.prepare(`UPDATE fleet_vehicles SET ${fleetSetClauses.join(', ')} WHERE id = ?`).run(...fleetSetValues);

    const record = db.prepare('SELECT * FROM fleet_maintenance WHERE id = ?').get(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, ?, 'fleet_vehicle', ?, ?, ?)
    `).run(
      req.user!.userId,
      'fleet_maintenance_logged',
      id,
      `Logged ${type || 'maintenance'} for vehicle ${vehicle.vehicle_number}: ${description}`,
      req.ip || 'unknown'
    );

    res.status(201).json(record);
  } catch (error: any) {
    console.error('Error logging maintenance record:', error);
    res.status(500).json({ error: 'Failed to log maintenance record', code: 'FAILED_TO_LOG_MAINTENANCE' });
  }
});

// PUT /api/fleet/maintenance/:id - Update maintenance record
router.put('/maintenance/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_maintenance WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Maintenance record not found', code: 'MAINTENANCE_RECORD_NOT_FOUND' }); return; }

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
    res.json(updated);
  } catch (error: any) {
    console.error('Update maintenance error:', error);
    res.status(500).json({ error: 'Failed to update maintenance', code: 'UPDATE_MAINTENANCE_ERROR' });
  }
});

// DELETE /api/fleet/maintenance/:id
router.delete('/maintenance/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_maintenance WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Maintenance record not found', code: 'MAINTENANCE_RECORD_NOT_FOUND' }); return; }
    db.prepare('DELETE FROM fleet_maintenance WHERE id = ?').run(req.params.id);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'fleet_maintenance_deleted', 'fleet_vehicle', ?, ?, ?)`).run(
      req.user!.userId, record.vehicle_id, `Deleted maintenance record: ${record.description}`, req.ip || 'unknown');
    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error('Delete maintenance error:', error);
    res.status(500).json({ error: 'Failed to delete maintenance', code: 'DELETE_MAINTENANCE_ERROR' });
  }
});

// POST /api/fleet/maintenance/:id/archive
router.post('/maintenance/:id/archive', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_maintenance WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Maintenance record not found', code: 'MAINTENANCE_RECORD_NOT_FOUND' }); return; }
    if (record.archived_at) { res.status(400).json({ error: 'Already archived', code: 'ALREADY_ARCHIVED' }); return; }
    const now = localNow();
    db.prepare('UPDATE fleet_maintenance SET archived_at = ? WHERE id = ?').run(now, record.id);
    const updated = db.prepare('SELECT * FROM fleet_maintenance WHERE id = ?').get(record.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Archive maintenance error:', error);
    res.status(500).json({ error: 'Failed to archive maintenance', code: 'ARCHIVE_MAINTENANCE_ERROR' });
  }
});

// POST /api/fleet/maintenance/:id/unarchive
router.post('/maintenance/:id/unarchive', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_maintenance WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Maintenance record not found', code: 'MAINTENANCE_RECORD_NOT_FOUND' }); return; }
    if (!record.archived_at) { res.status(400).json({ error: 'Not archived', code: 'NOT_ARCHIVED' }); return; }
    db.prepare('UPDATE fleet_maintenance SET archived_at = NULL WHERE id = ?').run(record.id);
    const updated = db.prepare('SELECT * FROM fleet_maintenance WHERE id = ?').get(record.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Unarchive maintenance error:', error);
    res.status(500).json({ error: 'Failed to unarchive maintenance', code: 'UNARCHIVE_MAINTENANCE_ERROR' });
  }
});

// ─── GET /api/fleet/:id/fuel ─ Fuel logs with summary ─────────────
router.get('/:id/fuel', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { page = '1', per_page = '50' } = req.query;

    const vehicle = db.prepare('SELECT id FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found', code: 'FLEET_VEHICLE_NOT_FOUND' });
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
    
      LIMIT 1000
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
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / perPage),
      },
    });
  } catch (error: any) {
    console.error('Error fetching fuel logs:', error);
    res.status(500).json({ error: 'Failed to fetch fuel logs', code: 'FAILED_TO_FETCH_FUEL' });
  }
});

// ─── POST /api/fleet/:id/fuel ─ Log a fuel entry ─────────────────
router.post('/:id/fuel', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found', code: 'FLEET_VEHICLE_NOT_FOUND' });
      return;
    }

    const { fuel_date, gallons, cost_per_gallon, total_cost, odometer_reading, fuel_type, station, notes } = req.body;

    if (!fuel_date || !gallons) {
      res.status(400).json({ error: 'fuel_date and gallons are required', code: 'FUELDATE_AND_GALLONS_ARE' });
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
      cost_per_gallon || null,
      computedTotal,
      odometer_reading || null,
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

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, ?, 'fleet_vehicle', ?, ?, ?)
    `).run(
      req.user!.userId,
      'fleet_fuel_logged',
      id,
      `Logged ${gallons} gal fuel for vehicle ${vehicle.vehicle_number}`,
      req.ip || 'unknown'
    );

    res.status(201).json(record);
  } catch (error: any) {
    console.error('Error logging fuel entry:', error);
    res.status(500).json({ error: 'Failed to log fuel entry', code: 'FAILED_TO_LOG_FUEL' });
  }
});

// PUT /api/fleet/fuel/:id - Update fuel log
router.put('/fuel/:id', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Fuel log not found', code: 'FUEL_LOG_NOT_FOUND' }); return; }

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
    res.json(updated);
  } catch (error: any) {
    console.error('Update fuel log error:', error);
    res.status(500).json({ error: 'Failed to update fuel log', code: 'UPDATE_FUEL_LOG_ERROR' });
  }
});

// DELETE /api/fleet/fuel/:id
router.delete('/fuel/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Fuel log not found', code: 'FUEL_LOG_NOT_FOUND' }); return; }
    db.prepare('DELETE FROM fleet_fuel_logs WHERE id = ?').run(req.params.id);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'fleet_fuel_deleted', 'fleet_vehicle', ?, ?, ?)`).run(
      req.user!.userId, record.vehicle_id, `Deleted fuel log: ${record.gallons} gal on ${record.fuel_date}`, req.ip || 'unknown');
    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error('Delete fuel log error:', error);
    res.status(500).json({ error: 'Failed to delete fuel log', code: 'DELETE_FUEL_LOG_ERROR' });
  }
});

// POST /api/fleet/fuel/:id/archive
router.post('/fuel/:id/archive', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Fuel log not found', code: 'FUEL_LOG_NOT_FOUND' }); return; }
    if (record.archived_at) { res.status(400).json({ error: 'Already archived', code: 'ALREADY_ARCHIVED' }); return; }
    const now = localNow();
    db.prepare('UPDATE fleet_fuel_logs SET archived_at = ? WHERE id = ?').run(now, record.id);
    const updated = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(record.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Archive fuel log error:', error);
    res.status(500).json({ error: 'Failed to archive fuel log', code: 'ARCHIVE_FUEL_LOG_ERROR' });
  }
});

// POST /api/fleet/fuel/:id/unarchive
router.post('/fuel/:id/unarchive', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Fuel log not found', code: 'FUEL_LOG_NOT_FOUND' }); return; }
    if (!record.archived_at) { res.status(400).json({ error: 'Not archived', code: 'NOT_ARCHIVED' }); return; }
    db.prepare('UPDATE fleet_fuel_logs SET archived_at = NULL WHERE id = ?').run(record.id);
    const updated = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(record.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Unarchive fuel log error:', error);
    res.status(500).json({ error: 'Failed to unarchive fuel log', code: 'UNARCHIVE_FUEL_LOG_ERROR' });
  }
});

// ─── GET /api/fleet/:id/inspections ─ Inspection history ──────────
router.get('/:id/inspections', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { page = '1', per_page = '25', type } = req.query;

    const vehicle = db.prepare('SELECT id FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found', code: 'FLEET_VEHICLE_NOT_FOUND' });
      return;
    }

    let whereClause = 'WHERE vehicle_id = ?';
    const params: any[] = [id];
    if (type) {
      whereClause += ' AND inspection_type = ?';
      params.push(type);
    }

    const pageNum = parseInt(page as string, 10) || 1;
    const perPage = parseInt(per_page as string, 10) || 25;
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
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / perPage),
      },
    });
  } catch (error: any) {
    console.error('Error fetching inspections:', error);
    res.status(500).json({ error: 'Failed to fetch inspections', code: 'FAILED_TO_FETCH_INSPECTIONS' });
  }
});

// ─── POST /api/fleet/:id/inspections ─ Create inspection ─────────
router.post('/:id/inspections', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found', code: 'FLEET_VEHICLE_NOT_FOUND' });
      return;
    }

    const { inspection_type, inspector_name, inspection_date, overall_result, mileage, items, notes } = req.body;

    if (!inspection_type || !inspector_name || !inspection_date || !overall_result) {
      res.status(400).json({ error: 'inspection_type, inspector_name, inspection_date, and overall_result are required', code: 'INSPECTIONTYPE_INSPECTORNAME_INSPECTIONDATE_AND' });
      return;
    }

    if (!Array.isArray(items)) {
      res.status(400).json({ error: 'items must be an array', code: 'ITEMS_MUST_BE_AN' });
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
      mileage || null,
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

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, ?, 'fleet_vehicle', ?, ?, ?)
    `).run(
      req.user!.userId,
      'fleet_inspection_logged',
      id,
      `Logged ${inspection_type} inspection (${overall_result}) for vehicle ${vehicle.vehicle_number}`,
      req.ip || 'unknown'
    );

    res.status(201).json({
      ...record,
      items: safeParseJson(record.items, []),
    });
  } catch (error: any) {
    console.error('Error creating inspection:', error);
    res.status(500).json({ error: 'Failed to create inspection', code: 'FAILED_TO_CREATE_INSPECTION' });
  }
});

// PUT /api/fleet/inspections/:id - Update inspection
router.put('/inspections/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_inspections WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Inspection not found', code: 'INSPECTION_NOT_FOUND' }); return; }

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
    res.json({ ...updated, items: safeParseJson(updated.items, []) });
  } catch (error: any) {
    console.error('Update inspection error:', error);
    res.status(500).json({ error: 'Failed to update inspection', code: 'UPDATE_INSPECTION_ERROR' });
  }
});

// DELETE /api/fleet/inspections/:id
router.delete('/inspections/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_inspections WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Inspection not found', code: 'INSPECTION_NOT_FOUND' }); return; }
    db.prepare('DELETE FROM fleet_inspections WHERE id = ?').run(req.params.id);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'fleet_inspection_deleted', 'fleet_vehicle', ?, ?, ?)`).run(
      req.user!.userId, record.vehicle_id, `Deleted ${record.inspection_type} inspection`, req.ip || 'unknown');
    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error('Delete inspection error:', error);
    res.status(500).json({ error: 'Failed to delete inspection', code: 'DELETE_INSPECTION_ERROR' });
  }
});

// POST /api/fleet/inspections/:id/archive
router.post('/inspections/:id/archive', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_inspections WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Inspection not found', code: 'INSPECTION_NOT_FOUND' }); return; }
    if (record.archived_at) { res.status(400).json({ error: 'Already archived', code: 'ALREADY_ARCHIVED' }); return; }
    const now = localNow();
    db.prepare('UPDATE fleet_inspections SET archived_at = ? WHERE id = ?').run(now, record.id);
    const updated = db.prepare('SELECT * FROM fleet_inspections WHERE id = ?').get(record.id) as any;
    res.json({ ...updated, items: safeParseJson(updated.items, []) });
  } catch (error: any) {
    console.error('Archive inspection error:', error);
    res.status(500).json({ error: 'Failed to archive inspection', code: 'ARCHIVE_INSPECTION_ERROR' });
  }
});

// POST /api/fleet/inspections/:id/unarchive
router.post('/inspections/:id/unarchive', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_inspections WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Inspection not found', code: 'INSPECTION_NOT_FOUND' }); return; }
    if (!record.archived_at) { res.status(400).json({ error: 'Not archived', code: 'NOT_ARCHIVED' }); return; }
    db.prepare('UPDATE fleet_inspections SET archived_at = NULL WHERE id = ?').run(record.id);
    const updated = db.prepare('SELECT * FROM fleet_inspections WHERE id = ?').get(record.id) as any;
    res.json({ ...updated, items: safeParseJson(updated.items, []) });
  } catch (error: any) {
    console.error('Unarchive inspection error:', error);
    res.status(500).json({ error: 'Failed to unarchive inspection', code: 'UNARCHIVE_INSPECTION_ERROR' });
  }
});

// ─── GET /api/fleet/:id/assignments ─ Assignment history ──────────
router.get('/:id/assignments', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { page = '1', per_page = '50' } = req.query;

    const vehicle = db.prepare('SELECT id FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found', code: 'FLEET_VEHICLE_NOT_FOUND' });
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
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / perPage),
      },
    });
  } catch (error: any) {
    console.error('Error fetching assignment history:', error);
    res.status(500).json({ error: 'Failed to fetch assignment history', code: 'FAILED_TO_FETCH_ASSIGNMENT' });
  }
});

// ─── GET /api/fleet/:id/personnel ─ Aggregated officer data ───────
router.get('/:id/personnel', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const vehicle = db.prepare('SELECT id, assigned_unit_id FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found', code: 'FLEET_VEHICLE_NOT_FOUND' });
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
            rank, department, address, city, state, zip, date_of_birth, hire_date, termination_date,
            shift_preference, dl_number, dl_state, dl_expiry, blood_type, allergies, uniform_size,
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
        
          LIMIT 1000
        `).all(unit.officer_id);

        // Today's schedule
        const today = localToday();
        todaySchedule = db.prepare(`
          SELECT s.*, p.name as property_name
          FROM schedules s
          LEFT JOIN properties p ON s.property_id = p.id
          WHERE s.officer_id = ? AND s.shift_date = ?
        
          LIMIT 1000
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
    
      LIMIT 1000
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
    console.error('Error fetching fleet personnel:', error);
    res.status(500).json({ error: 'Failed to fetch fleet personnel data', code: 'FAILED_TO_FETCH_FLEET' });
  }
});

// ─── POST /api/fleet/:id/personnel-notes ─ Add note ──────────────
router.post('/:id/personnel-notes', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { note, officer_id, officer_name } = req.body;

    if (!note || !note.trim()) {
      res.status(400).json({ error: 'Note text is required', code: 'NOTE_TEXT_IS_REQUIRED' });
      return;
    }

    const vehicle = db.prepare('SELECT id FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Fleet vehicle not found', code: 'FLEET_VEHICLE_NOT_FOUND' });
      return;
    }

    // Get the creating user's name
    const creator = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;

    const result = db.prepare(`
      INSERT INTO fleet_personnel_notes (vehicle_id, officer_id, officer_name, note, created_by, created_by_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, officer_id || null, officer_name || null, note.trim(), req.user!.userId, creator?.full_name || 'Unknown', localNow());

    const created = db.prepare('SELECT * FROM fleet_personnel_notes WHERE id = ?').get(result.lastInsertRowid) as any;

    res.status(201).json(created);
  } catch (error: any) {
    console.error('Error creating personnel note:', error);
    res.status(500).json({ error: 'Failed to create personnel note', code: 'FAILED_TO_CREATE_PERSONNEL' });
  }
});

// ─── DELETE /api/fleet/:id/personnel-notes/:noteId ─ Delete note ──
router.delete('/:id/personnel-notes/:noteId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id, noteId } = req.params;

    const note = db.prepare('SELECT id FROM fleet_personnel_notes WHERE id = ? AND vehicle_id = ?').get(noteId, id) as any;
    if (!note) {
      res.status(404).json({ error: 'Note not found', code: 'NOTE_NOT_FOUND' });
      return;
    }

    db.prepare('DELETE FROM fleet_personnel_notes WHERE id = ?').run(noteId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting personnel note:', error);
    res.status(500).json({ error: 'Failed to delete personnel note', code: 'FAILED_TO_DELETE_PERSONNEL' });
  }
});

// ─── POST /api/fleet/import/simply-fleet ─ Bulk import SF data ───
router.post('/import/simply-fleet', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { fillups, services, vehicle_number } = req.body;

    if (!vehicle_number) {
      res.status(400).json({ error: 'vehicle_number is required to match import data', code: 'VEHICLENUMBER_IS_REQUIRED_TO' });
      return;
    }

    // Find vehicle by vehicle_number
    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE vehicle_number = ?').get(vehicle_number) as any;
    if (!vehicle) {
      res.status(404).json({ error: `Vehicle ${vehicle_number} not found. Create it first.` });
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
            f.quantity || f.gallons || null,
            f.total_cost || null,
            f.odometer || null,
            f.station || null,
            f.notes || null,
            f.distance || null,
            f.efficiency || null,
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
            s.total_cost || null,
            s.odometer || null,
            s.station || s.vendor || null,
            s.labor_cost || null,
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

    // Activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'fleet_import', 'fleet_vehicle', ?, ?, ?)
    `).run(
      req.user!.userId, vehicle.id,
      `Simply Fleet import for ${vehicle_number}: ${fuelInserted} fuel logs, ${serviceInserted} service records (${fuelSkipped + serviceSkipped} duplicates skipped)`,
      req.ip || 'unknown',
    );

    res.json({
      success: true,
      vehicle_id: vehicle.id,
      vehicle_number,
      fuel: { inserted: fuelInserted, skipped: fuelSkipped },
      services: { inserted: serviceInserted, skipped: serviceSkipped },
    });
  } catch (error: any) {
    console.error('Simply Fleet import error:', error);
    res.status(500).json({ error: 'Failed to import Simply Fleet data', code: 'FAILED_TO_IMPORT_SIMPLY' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DASH CAMERAS
// ═══════════════════════════════════════════════════════════════════

// GET /api/fleet/dash-cameras — List all dash cameras
router.get('/dash-cameras', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const cameras = db.prepare(`
      SELECT dc.*,
        fv.vehicle_number, fv.make AS vehicle_make, fv.model AS vehicle_model,
        fv.year AS vehicle_year
      FROM dash_cameras dc
      LEFT JOIN fleet_vehicles fv ON dc.vehicle_id = fv.id
      ORDER BY dc.created_at DESC
    
      LIMIT 1000
    `).all();
    res.json(cameras);
  } catch (error: any) {
    console.error('List dash cameras error:', error);
    res.status(500).json({ error: 'Failed to list dash cameras', code: 'LIST_DASH_CAMERAS_ERROR' });
  }
});

// POST /api/fleet/dash-cameras — Create
router.post('/dash-cameras', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { vehicle_id, camera_id, make, model, firmware_version, storage_capacity_gb, channel_count, status, condition, installed_at, removed_at, notes } = req.body;
    if (!vehicle_id || !camera_id) {
      res.status(400).json({ error: 'vehicle_id and camera_id are required', code: 'VEHICLEID_AND_CAMERAID_ARE' });
      return;
    }
    const result = db.prepare(`
      INSERT INTO dash_cameras (vehicle_id, camera_id, make, model, firmware_version, storage_capacity_gb, channel_count, status, condition, installed_at, removed_at, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vehicle_id, camera_id, make || null, model || null, firmware_version || null,
      storage_capacity_gb || 32, channel_count || 2,
      status || 'available', condition || 'good',
      installed_at || null, removed_at || null, notes || null, String(req.user!.userId)
    );
    const cam = db.prepare(`
      SELECT dc.*, fv.vehicle_number, fv.make AS vehicle_make, fv.model AS vehicle_model, fv.year AS vehicle_year
      FROM dash_cameras dc LEFT JOIN fleet_vehicles fv ON dc.vehicle_id = fv.id WHERE dc.id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json(cam);
  } catch (error: any) {
    if (error?.message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'Camera ID already exists', code: 'CAMERA_ID_ALREADY_EXISTS' });
      return;
    }
    console.error('Create dash camera error:', error);
    res.status(500).json({ error: 'Failed to create dash camera', code: 'CREATE_DASH_CAMERA_ERROR' });
  }
});

// PUT /api/fleet/dash-cameras/:id — Update
router.put('/dash-cameras/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM dash_cameras WHERE id = ?').get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'Dash camera not found', code: 'DASH_CAMERA_NOT_FOUND' }); return; }
    const fields = ['vehicle_id', 'camera_id', 'make', 'model', 'firmware_version', 'storage_capacity_gb', 'channel_count', 'status', 'condition', 'installed_at', 'removed_at', 'notes'];
    const setClauses: string[] = [];
    const vals: any[] = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        setClauses.push(`${f} = ?`);
        vals.push(req.body[f] === '' ? null : req.body[f]);
      }
    }
    if (setClauses.length > 0) {
      setClauses.push('updated_at = ?');
      vals.push(localNow());
      vals.push(req.params.id);
      db.prepare(`UPDATE dash_cameras SET ${setClauses.join(', ')} WHERE id = ?`).run(...vals);
    }
    const cam = db.prepare(`
      SELECT dc.*, fv.vehicle_number, fv.make AS vehicle_make, fv.model AS vehicle_model, fv.year AS vehicle_year
      FROM dash_cameras dc LEFT JOIN fleet_vehicles fv ON dc.vehicle_id = fv.id WHERE dc.id = ?
    `).get(req.params.id);
    res.json(cam);
  } catch (error: any) {
    console.error('Update dash camera error:', error);
    res.status(500).json({ error: 'Failed to update dash camera', code: 'UPDATE_DASH_CAMERA_ERROR' });
  }
});

// DELETE /api/fleet/dash-cameras/:id — Delete
router.delete('/dash-cameras/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM dash_cameras WHERE id = ?').get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'Dash camera not found', code: 'DASH_CAMERA_NOT_FOUND' }); return; }
    db.prepare('DELETE FROM dashcam_videos WHERE camera_id = ?').run(req.params.id);
    db.prepare('DELETE FROM dash_cameras WHERE id = ?').run(req.params.id);
    res.json({ message: 'Dash camera deleted' });
  } catch (error: any) {
    console.error('Delete dash camera error:', error);
    res.status(500).json({ error: 'Failed to delete dash camera', code: 'DELETE_DASH_CAMERA_ERROR' });
  }
});

// DELETE /api/fleet/dash-cameras/bulk — Bulk delete
router.delete('/dash-cameras/bulk', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { cameraIds } = req.body;
    if (!Array.isArray(cameraIds) || cameraIds.length === 0) {
      res.status(400).json({ error: 'cameraIds array required', code: 'CAMERAIDS_ARRAY_REQUIRED' });
      return;
    }
    const placeholders = cameraIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM dashcam_videos WHERE camera_id IN (${placeholders})`).run(...cameraIds);
    const result = db.prepare(`DELETE FROM dash_cameras WHERE id IN (${placeholders})`).run(...cameraIds);
    res.json({ deleted: result.changes });
  } catch (error: any) {
    console.error('Bulk delete dash cameras error:', error);
    res.status(500).json({ error: 'Failed to bulk delete dash cameras', code: 'BULK_DELETE_DASH_CAMERAS' });
  }
});

// ─── Dash Camera Videos ────────────────────────────────────────────

// GET /api/fleet/dashcam-videos — List all videos
router.get('/dashcam-videos', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const videos = db.prepare(`
      SELECT v.*, dc.camera_id AS camera_serial, fv.vehicle_number
      FROM dashcam_videos v
      LEFT JOIN dash_cameras dc ON v.camera_id = dc.id
      LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
      ORDER BY v.created_at DESC
    
      LIMIT 1000
    `).all();
    res.json(videos);
  } catch (error: any) {
    console.error('List dashcam videos error:', error);
    res.status(500).json({ error: 'Failed to list dashcam videos', code: 'LIST_DASHCAM_VIDEOS_ERROR' });
  }
});

// POST /api/fleet/dashcam-videos — Upload video
router.post('/dashcam-videos', requireRole('admin'), (req: Request, res: Response) => {
  req.setTimeout(600000);
  res.setTimeout(600000);
  try {
    if (!fs.existsSync(DASHCAM_DIR)) fs.mkdirSync(DASHCAM_DIR, { recursive: true });
    fs.accessSync(DASHCAM_DIR, fs.constants.W_OK);
  } catch (dirErr: any) {
    res.status(503).json({ error: `Upload storage is unavailable: ${dirErr.message}` });
    return;
  }
  try {
    dashcamUpload.single('video')(req, res, (multerErr: any) => {
      if (multerErr) {
        res.status(400).json({ error: multerErr.message || 'Upload failed' });
        return;
      }
      try {
        const db = getDb();
        const file = req.file;
        if (!file) { res.status(400).json({ error: 'No video file provided', code: 'NO_VIDEO_FILE_PROVIDED' }); return; }
        const { camera_id, vehicle_id, title, duration_seconds, recorded_at, case_number, classification, gps_lat, gps_lon, notes } = req.body;
        if (!camera_id || !vehicle_id || !title) {
          if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
          res.status(400).json({ error: 'camera_id, vehicle_id, and title are required', code: 'CAMERAID_VEHICLEID_AND_TITLE' });
          return;
        }
        const diskStat = fs.statSync(file.path);
        const verifiedSize = diskStat.size;
        const relativePath = path.relative(DASHCAM_DIR, file.path);
        const result = db.prepare(`
          INSERT INTO dashcam_videos (camera_id, vehicle_id, title, file_path, file_size, duration_seconds, mime_type, recorded_at, case_number, classification, gps_lat, gps_lon, notes, uploaded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          camera_id, vehicle_id, title, relativePath, verifiedSize,
          duration_seconds || null, file.mimetype,
          recorded_at || localNow(), case_number || null,
          classification || 'routine', gps_lat || null, gps_lon || null,
          notes || null, String(req.user!.userId)
        );
        const video = db.prepare(`
          SELECT v.*, dc.camera_id AS camera_serial, fv.vehicle_number
          FROM dashcam_videos v
          LEFT JOIN dash_cameras dc ON v.camera_id = dc.id
          LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
          WHERE v.id = ?
        `).get(result.lastInsertRowid);
        // Fire-and-forget: extract duration with ffprobe
        const fullFilePath = path.resolve(DASHCAM_DIR, relativePath);
        extractVideoDuration(fullFilePath).then((probedDuration) => {
          if (probedDuration != null) {
            try {
              getDb().prepare('UPDATE dashcam_videos SET duration_seconds = ?, updated_at = ? WHERE id = ?')
                .run(probedDuration, localNow(), result.lastInsertRowid);
            } catch { /* ffprobe update failed */ }
          }
        }).catch(() => {});
        res.status(201).json(video);
      } catch (error: any) {
        console.error('Upload dashcam video DB error:', error);
        res.status(500).json({ error: `Upload processing failed: ${error?.message || 'Internal server error'}` });
      }
    });
  } catch (outerErr: any) {
    if (!res.headersSent) res.status(500).json({ error: `Upload failed: ${outerErr?.message || 'Internal server error'}` });
  }
});

// GET /api/fleet/dashcam-videos/:id/stream — Stream with Range support
router.get('/dashcam-videos/:id/stream', (req: Request, res: Response, next) => {
  if (!req.headers['authorization'] && req.query.token) {
    req.headers['authorization'] = `Bearer ${req.query.token}`;
  }
  next();
}, authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(req.params.id) as any;
    if (!video) { res.status(404).json({ error: 'Video not found', code: 'VIDEO_NOT_FOUND' }); return; }
    const filePath = path.resolve(DASHCAM_DIR, video.file_path);
    if (!filePath.startsWith(DASHCAM_DIR) || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Video file not found on disk', code: 'VIDEO_FILE_NOT_FOUND' });
      return;
    }
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': video.mime_type || 'video/mp4',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': video.mime_type || 'video/mp4',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error: any) {
    console.error('Stream dashcam video error:', error);
    res.status(500).json({ error: 'Failed to stream dashcam video', code: 'STREAM_DASHCAM_VIDEO_ERROR' });
  }
});

// DELETE /api/fleet/dashcam-videos/:id — Delete video + file
router.delete('/dashcam-videos/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'Video not found', code: 'VIDEO_NOT_FOUND' }); return; }
    const filePath = path.resolve(DASHCAM_DIR, existing.file_path);
    if (filePath.startsWith(DASHCAM_DIR) && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    db.prepare('DELETE FROM dashcam_videos WHERE id = ?').run(req.params.id);
    res.json({ message: 'Video deleted' });
  } catch (error: any) {
    console.error('Delete dashcam video error:', error);
    res.status(500).json({ error: 'Failed to delete dashcam video', code: 'DELETE_DASHCAM_VIDEO_ERROR' });
  }
});

// PUT /api/fleet/dashcam-videos/bulk — Bulk classify
router.put('/dashcam-videos/bulk', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { videoIds, classification } = req.body;
    if (!Array.isArray(videoIds) || videoIds.length === 0 || !classification) {
      res.status(400).json({ error: 'videoIds array and classification required', code: 'VIDEOIDS_ARRAY_AND_CLASSIFICATION' });
      return;
    }
    const placeholders = videoIds.map(() => '?').join(',');
    db.prepare(`UPDATE dashcam_videos SET classification = ?, updated_at = ? WHERE id IN (${placeholders})`)
      .run(classification, localNow(), ...videoIds);
    res.json({ updated: videoIds.length });
  } catch (error: any) {
    console.error('Bulk classify dashcam videos error:', error);
    res.status(500).json({ error: 'Failed to bulk classify dashcam videos', code: 'BULK_CLASSIFY_DASHCAM_VIDEOS' });
  }
});

// DELETE /api/fleet/dashcam-videos/bulk — Bulk delete
router.delete('/dashcam-videos/bulk', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { videoIds } = req.body;
    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      res.status(400).json({ error: 'videoIds array required', code: 'VIDEOIDS_ARRAY_REQUIRED' });
      return;
    }
    // Delete files from disk
    const placeholders = videoIds.map(() => '?').join(',');
    const videos = db.prepare(`SELECT * FROM dashcam_videos WHERE id IN (${placeholders})`).all(...videoIds) as any[];
    for (const v of videos) {
      const fp = path.resolve(DASHCAM_DIR, v.file_path);
      if (fp.startsWith(DASHCAM_DIR) && fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    const result = db.prepare(`DELETE FROM dashcam_videos WHERE id IN (${placeholders})`).run(...videoIds);
    res.json({ deleted: result.changes });
  } catch (error: any) {
    console.error('Bulk delete dashcam videos error:', error);
    res.status(500).json({ error: 'Failed to bulk delete dashcam videos', code: 'BULK_DELETE_DASHCAM_VIDEOS' });
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

// ═══════════════════════════════════════════════════════════════════════════════
// FLEET FEATURES (31-40)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 31. Vehicle Assignment History ──────────────────────────────────────────
router.get('/:id/assignment-history', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const rows = db.prepare(`
      SELECT fa.*, u.full_name as officer_name_lookup
      FROM fleet_assignments fa
      LEFT JOIN units un ON un.id = fa.unit_id
      LEFT JOIN users u ON u.id = un.officer_id
      WHERE fa.vehicle_id = ?
      ORDER BY fa.assigned_at DESC
    
      LIMIT 1000
    `).all(id);
    res.json(rows);
  } catch (error: any) {
    console.error('Assignment history error:', error);
    res.status(500).json({ error: 'Failed to load assignment history', code: 'FAILED_TO_LOAD_ASSIGNMENT' });
  }
});

// ─── 32. Fuel Efficiency Tracking ────────────────────────────────────────────
router.get('/:id/fuel-efficiency', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' });

    const fuelLogs = db.prepare(`
      SELECT id, fuel_date, gallons, odometer_reading, total_cost
      FROM fleet_fuel_logs
      WHERE vehicle_id = ? AND odometer_reading IS NOT NULL
      ORDER BY fuel_date ASC, id ASC
    
      LIMIT 1000
    `).all(id) as any[];

    const efficiencyData: any[] = [];
    for (let i = 1; i < fuelLogs.length; i++) {
      const prev = fuelLogs[i - 1];
      const curr = fuelLogs[i];
      if (curr.odometer_reading > prev.odometer_reading && curr.gallons > 0) {
        const miles = curr.odometer_reading - prev.odometer_reading;
        const mpg = miles / curr.gallons;
        const costPerMile = curr.total_cost ? curr.total_cost / miles : null;
        efficiencyData.push({
          date: curr.fuel_date,
          miles_driven: miles,
          gallons: curr.gallons,
          mpg: Math.round(mpg * 10) / 10,
          cost_per_mile: costPerMile ? Math.round(costPerMile * 100) / 100 : null,
        });
      }
    }

    const avgMpg = efficiencyData.length > 0
      ? Math.round(efficiencyData.reduce((s, e) => s + e.mpg, 0) / efficiencyData.length * 10) / 10
      : null;

    res.json({ vehicle_id: Number(id), avg_mpg: avgMpg, data: efficiencyData });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load fuel efficiency', code: 'FAILED_TO_LOAD_FUEL' });
  }
});

// ─── 33. Vehicle Inspection Checklist ────────────────────────────────────────
router.get('/inspection-checklist', (_req: Request, res: Response) => {
  // Standard daily vehicle inspection checklist
  const checklist = [
    { category: 'Exterior', items: [
      { id: 'body_damage', label: 'Body damage (dents, scratches)', type: 'pass_fail' },
      { id: 'lights_front', label: 'Headlights / turn signals', type: 'pass_fail' },
      { id: 'lights_rear', label: 'Taillights / brake lights', type: 'pass_fail' },
      { id: 'lights_emergency', label: 'Emergency lights / lightbar', type: 'pass_fail' },
      { id: 'windshield', label: 'Windshield condition', type: 'pass_fail' },
      { id: 'mirrors', label: 'Mirrors', type: 'pass_fail' },
      { id: 'tires', label: 'Tire condition / pressure', type: 'pass_fail' },
      { id: 'antenna', label: 'Radio antenna', type: 'pass_fail' },
    ]},
    { category: 'Interior', items: [
      { id: 'seatbelts', label: 'Seatbelts', type: 'pass_fail' },
      { id: 'horn', label: 'Horn', type: 'pass_fail' },
      { id: 'radio', label: 'Radio / communication equipment', type: 'pass_fail' },
      { id: 'mdt', label: 'MDT / laptop', type: 'pass_fail' },
      { id: 'dashcam', label: 'Dash camera', type: 'pass_fail' },
      { id: 'siren', label: 'Siren', type: 'pass_fail' },
      { id: 'ac_heat', label: 'A/C & heating', type: 'pass_fail' },
      { id: 'cleanliness', label: 'Interior cleanliness', type: 'pass_fail' },
    ]},
    { category: 'Safety Equipment', items: [
      { id: 'first_aid', label: 'First aid kit', type: 'pass_fail' },
      { id: 'fire_extinguisher', label: 'Fire extinguisher', type: 'pass_fail' },
      { id: 'flares', label: 'Road flares / triangles', type: 'pass_fail' },
      { id: 'spare_tire', label: 'Spare tire / jack', type: 'pass_fail' },
    ]},
    { category: 'Fluids', items: [
      { id: 'fuel_level', label: 'Fuel level (minimum 1/2 tank)', type: 'pass_fail' },
      { id: 'oil_level', label: 'Oil level', type: 'pass_fail' },
      { id: 'coolant', label: 'Coolant level', type: 'pass_fail' },
      { id: 'washer_fluid', label: 'Windshield washer fluid', type: 'pass_fail' },
    ]},
  ];
  res.json(checklist);
});

// ─── 34. Maintenance Cost Tracking ───────────────────────────────────────────
router.get('/:id/maintenance-costs', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' });

    const totalCost = db.prepare(
      `SELECT COALESCE(SUM(cost), 0) as total, COALESCE(SUM(labor_cost), 0) as labor_total,
       COUNT(*) as record_count
       FROM fleet_maintenance WHERE vehicle_id = ?`
    ).get(id) as any;

    const byType = db.prepare(`
      SELECT type, COALESCE(SUM(cost), 0) as total_cost, COUNT(*) as count
      FROM fleet_maintenance WHERE vehicle_id = ? AND cost IS NOT NULL
      GROUP BY type ORDER BY total_cost DESC
    `).all(id) as any[];

    const monthly = db.prepare(`
      SELECT strftime('%Y-%m', performed_at) as month,
        COALESCE(SUM(cost), 0) as cost, COUNT(*) as count
      FROM fleet_maintenance WHERE vehicle_id = ?
      GROUP BY month ORDER BY month DESC LIMIT 12
    `).all(id) as any[];

    res.json({
      vehicle_id: Number(id),
      total_parts_cost: totalCost.total || 0,
      total_labor_cost: totalCost.labor_total || 0,
      total_cost: (totalCost.total || 0) + (totalCost.labor_total || 0),
      record_count: totalCost.record_count,
      by_type: byType,
      monthly_trend: monthly.reverse(),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load maintenance costs', code: 'FAILED_TO_LOAD_MAINTENANCE' });
  }
});

// ─── 35. Vehicle Status Dashboard ────────────────────────────────────────────
router.get('/status-dashboard', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const vehicles = db.prepare(`
      SELECT fv.id, fv.vehicle_number, fv.make, fv.model, fv.year, fv.status,
        fv.current_mileage, fv.next_service_due, fv.insurance_expiry, fv.registration_expiry,
        u.call_sign as assigned_unit
      FROM fleet_vehicles fv
      LEFT JOIN units u ON u.id = fv.assigned_unit_id
      WHERE fv.archived_at IS NULL
      ORDER BY fv.vehicle_number
    
      LIMIT 1000
    `).all() as any[];

    const now = localToday();
    const statusSummary: Record<string, number> = {};

    const enriched = vehicles.map((v: any) => {
      statusSummary[v.status] = (statusSummary[v.status] || 0) + 1;
      const alerts: string[] = [];
      if (v.insurance_expiry && v.insurance_expiry <= now) alerts.push('insurance_expired');
      if (v.registration_expiry && v.registration_expiry <= now) alerts.push('registration_expired');
      if (v.next_service_due && v.next_service_due <= now) alerts.push('service_overdue');
      return { ...v, alerts };
    });

    // Recall count
    let openRecalls = 0;
    try {
      const rc = db.prepare(`SELECT COUNT(*) as cnt FROM fleet_recalls WHERE status = 'open'`).get() as any;
      openRecalls = rc?.cnt || 0;
    } catch { /* table may not exist */ }

    res.json({ vehicles: enriched, status_summary: statusSummary, open_recalls: openRecalls });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load status dashboard', code: 'FAILED_TO_LOAD_STATUS' });
  }
});

// ─── 36. Tire Tracking ───────────────────────────────────────────────────────
router.get('/:id/tires', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM fleet_tires WHERE vehicle_id = ? ORDER BY position').all(req.params.id);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load tires', code: 'FAILED_TO_LOAD_TIRES' });
  }
});

router.post('/:id/tires', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicleId = req.params.id;
    const { position, brand, model, size, install_date, tread_depth, notes } = req.body;
    if (!position) return res.status(400).json({ error: 'position is required', code: 'POSITION_IS_REQUIRED' });
    const now = localNow();
    const result = db.prepare(
      `INSERT INTO fleet_tires (vehicle_id, position, brand, model, size, install_date, tread_depth, last_measured, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(vehicleId, position, brand || null, model || null, size || null,
      install_date || null, tread_depth || null, tread_depth ? now.substring(0, 10) : null, notes || null, now, now);
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to add tire', code: 'FAILED_TO_ADD_TIRE' });
  }
});

router.put('/tires/:tireId', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { tread_depth, brand, model, notes } = req.body;
    const now = localNow();
    const sets: string[] = ['updated_at = ?'];
    const vals: any[] = [now];
    if (tread_depth !== undefined) { sets.push('tread_depth = ?'); vals.push(tread_depth); sets.push('last_measured = ?'); vals.push(now.substring(0, 10)); }
    if (brand !== undefined) { sets.push('brand = ?'); vals.push(brand); }
    if (model !== undefined) { sets.push('model = ?'); vals.push(model); }
    if (notes !== undefined) { sets.push('notes = ?'); vals.push(notes); }
    vals.push(req.params.tireId);
    db.prepare(`UPDATE fleet_tires SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update tire', code: 'FAILED_TO_UPDATE_TIRE' });
  }
});

// ─── 37. Vehicle Damage Reporting ────────────────────────────────────────────
router.get('/:id/damage-reports', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT dr.*, u.full_name as reported_by_name
      FROM fleet_damage_reports dr
      LEFT JOIN users u ON u.id = dr.reported_by
      WHERE dr.vehicle_id = ? ORDER BY dr.damage_date DESC
    
      LIMIT 1000
    `).all(req.params.id);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load damage reports', code: 'FAILED_TO_LOAD_DAMAGE' });
  }
});

router.post('/:id/damage-reports', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicleId = req.params.id;
    const { damage_date, damage_type, location_on_vehicle, severity, description,
            repair_estimate, photos, insurance_claim_number } = req.body;
    if (!damage_date || !damage_type || !description) {
      return res.status(400).json({ error: 'damage_date, damage_type, and description are required', code: 'DAMAGEDATE_DAMAGETYPE_AND_DESCRIPTION' });
    }
    const now = localNow();
    const result = db.prepare(
      `INSERT INTO fleet_damage_reports (vehicle_id, reported_by, damage_date, damage_type, location_on_vehicle,
       severity, description, repair_estimate, photos, insurance_claim_number, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(vehicleId, req.user!.userId, damage_date, damage_type, location_on_vehicle || null,
      severity || 'minor', description, repair_estimate || null,
      JSON.stringify(photos || []), insurance_claim_number || null, now, now);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'fleet_damage_reported', 'fleet_vehicle', ?, ?, ?)`).run(
      req.user!.userId, vehicleId, `Damage reported: ${damage_type} - ${description}`, req.ip || 'unknown');

    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create damage report', code: 'FAILED_TO_CREATE_DAMAGE' });
  }
});

router.put('/damage-reports/:reportId', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { repair_status, repair_cost, insurance_claim_number } = req.body;
    const now = localNow();
    const sets: string[] = ['updated_at = ?'];
    const vals: any[] = [now];
    if (repair_status) { sets.push('repair_status = ?'); vals.push(repair_status); }
    if (repair_cost !== undefined) { sets.push('repair_cost = ?'); vals.push(repair_cost); }
    if (insurance_claim_number !== undefined) { sets.push('insurance_claim_number = ?'); vals.push(insurance_claim_number); }
    vals.push(req.params.reportId);
    db.prepare(`UPDATE fleet_damage_reports SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update damage report', code: 'FAILED_TO_UPDATE_DAMAGE' });
  }
});

// ─── 38. Fleet Utilization Report ────────────────────────────────────────────
router.get('/utilization-report', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '30' } = req.query;
    const cutoff = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();

    const vehicles = db.prepare(`
      SELECT fv.id, fv.vehicle_number, fv.make, fv.model, fv.year, fv.status
      FROM fleet_vehicles fv WHERE fv.archived_at IS NULL
      ORDER BY fv.vehicle_number
    
      LIMIT 1000
    `).all() as any[];

    const result = vehicles.map((v: any) => {
      const fuelLogs = db.prepare(
        `SELECT COUNT(*) as cnt FROM fleet_fuel_logs WHERE vehicle_id = ? AND fuel_date >= ?`
      ).get(v.id, cutoff.substring(0, 10)) as any;

      const assignments = db.prepare(
        `SELECT COUNT(*) as cnt FROM fleet_assignments WHERE vehicle_id = ? AND assigned_at >= ?`
      ).get(v.id, cutoff) as any;

      const inspections = db.prepare(
        `SELECT COUNT(*) as cnt FROM fleet_inspections WHERE vehicle_id = ? AND inspection_date >= ?`
      ).get(v.id, cutoff.substring(0, 10)) as any;

      return {
        ...v,
        fuel_log_count: fuelLogs?.cnt || 0,
        assignment_count: assignments?.cnt || 0,
        inspection_count: inspections?.cnt || 0,
        utilization_score: (fuelLogs?.cnt || 0) + (assignments?.cnt || 0) * 2,
      };
    });

    result.sort((a: any, b: any) => b.utilization_score - a.utilization_score);
    const avgScore = result.length > 0
      ? Math.round(result.reduce((s: number, v: any) => s + v.utilization_score, 0) / result.length)
      : 0;

    res.json({
      period_days: Number(days),
      vehicles: result,
      most_used: result[0] || null,
      least_used: result[result.length - 1] || null,
      avg_utilization_score: avgScore,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate utilization report', code: 'FAILED_TO_GENERATE_UTILIZATION' });
  }
});

// ─── 39. Vehicle Recall Alerts ───────────────────────────────────────────────
router.get('/recalls', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { vehicle_id, status } = req.query;
    let sql = `SELECT r.*, fv.vehicle_number, fv.make, fv.model, fv.year, fv.vin
               FROM fleet_recalls r
               JOIN fleet_vehicles fv ON fv.id = r.vehicle_id WHERE 1=1`;
    const params: any[] = [];
    if (vehicle_id) { sql += ' AND r.vehicle_id = ?'; params.push(Number(vehicle_id)); }
    if (status) { sql += ' AND r.status = ?'; params.push(status); }
    sql += ' ORDER BY r.created_at DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load recalls', code: 'FAILED_TO_LOAD_RECALLS' });
  }
});

router.post('/recalls', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { vehicle_id, recall_number, manufacturer, description, severity, remedy } = req.body;
    if (!vehicle_id || !recall_number || !description) {
      return res.status(400).json({ error: 'vehicle_id, recall_number, and description are required', code: 'VEHICLEID_RECALLNUMBER_AND_DESCRIPTION' });
    }
    const now = localNow();
    const result = db.prepare(
      `INSERT INTO fleet_recalls (vehicle_id, recall_number, manufacturer, description, severity, remedy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(vehicle_id, recall_number, manufacturer || null, description, severity || 'standard', remedy || null, now, now);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'fleet_recall_created', 'fleet_vehicle', ?, ?, ?)`).run(
      req.user!.userId, vehicle_id, `Recall: ${recall_number} - ${description}`, req.ip || 'unknown');

    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create recall', code: 'FAILED_TO_CREATE_RECALL' });
  }
});

router.put('/recalls/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const { status, scheduled_date, completed_date } = req.body;
    const now = localNow();
    const sets: string[] = ['updated_at = ?'];
    const vals: any[] = [now];
    if (status) { sets.push('status = ?'); vals.push(status); }
    if (scheduled_date !== undefined) { sets.push('scheduled_date = ?'); vals.push(scheduled_date); }
    if (completed_date !== undefined) { sets.push('completed_date = ?'); vals.push(completed_date); }
    vals.push(id);
    db.prepare(`UPDATE fleet_recalls SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update recall', code: 'FAILED_TO_UPDATE_RECALL' });
  }
});

// ─── 40. Fuel Card Assignment ────────────────────────────────────────────────
router.get('/fuel-cards', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { vehicle_id, status } = req.query;
    let sql = `SELECT fc.*, fv.vehicle_number
               FROM fleet_fuel_cards fc
               LEFT JOIN fleet_vehicles fv ON fv.id = fc.vehicle_id WHERE 1=1`;
    const params: any[] = [];
    if (vehicle_id) { sql += ' AND fc.vehicle_id = ?'; params.push(Number(vehicle_id)); }
    if (status) { sql += ' AND fc.status = ?'; params.push(status); }
    sql += ' ORDER BY fc.card_number';
    res.json(db.prepare(sql).all(...params));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load fuel cards', code: 'FAILED_TO_LOAD_FUEL' });
  }
});

router.post('/fuel-cards', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { card_number, vehicle_id, provider, monthly_limit, pin_last4, expiry_date, notes } = req.body;
    if (!card_number) return res.status(400).json({ error: 'card_number is required', code: 'CARDNUMBER_IS_REQUIRED' });
    const now = localNow();
    const result = db.prepare(
      `INSERT INTO fleet_fuel_cards (card_number, vehicle_id, provider, monthly_limit, pin_last4, expiry_date, notes, assigned_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(card_number, vehicle_id || null, provider || null, monthly_limit || null,
      pin_last4 || null, expiry_date || null, notes || null, vehicle_id ? now : null, now, now);
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Card number already exists', code: 'CARD_NUMBER_ALREADY_EXISTS' });
    res.status(500).json({ error: 'Failed to create fuel card', code: 'FAILED_TO_CREATE_FUEL' });
  }
});

router.put('/fuel-cards/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const { vehicle_id, status, monthly_limit, notes } = req.body;
    const now = localNow();
    const sets: string[] = ['updated_at = ?'];
    const vals: any[] = [now];
    if (vehicle_id !== undefined) { sets.push('vehicle_id = ?'); vals.push(vehicle_id); sets.push('assigned_at = ?'); vals.push(vehicle_id ? now : null); }
    if (status) { sets.push('status = ?'); vals.push(status); }
    if (monthly_limit !== undefined) { sets.push('monthly_limit = ?'); vals.push(monthly_limit); }
    if (notes !== undefined) { sets.push('notes = ?'); vals.push(notes); }
    vals.push(id);
    db.prepare(`UPDATE fleet_fuel_cards SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update fuel card', code: 'FAILED_TO_UPDATE_FUEL' });
  }
});

// ── Feature 16: Vehicle pre-trip checklist ────────────────────────
// POST /api/fleet/pretrip - Submit pre-trip checklist
router.post('/pretrip', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      vehicle_id, lights_ok, brakes_ok, radio_ok, mdt_ok, camera_ok,
      tires_ok, fluids_ok, exterior_ok, interior_ok, emergency_equipment_ok, notes,
    } = req.body;

    if (!vehicle_id) { res.status(400).json({ error: 'vehicle_id is required', code: 'VEHICLEID_IS_REQUIRED' }); return; }

    const checks = [lights_ok, brakes_ok, radio_ok, mdt_ok, camera_ok, tires_ok, fluids_ok, exterior_ok, interior_ok, emergency_equipment_ok];
    const overall_pass = checks.every(c => c) ? 1 : 0;
    const today = localNow().split('T')[0];

    const result = db.prepare(`
      INSERT INTO fleet_pretrip_checklists (vehicle_id, officer_id, shift_date,
        lights_ok, brakes_ok, radio_ok, mdt_ok, camera_ok, tires_ok, fluids_ok,
        exterior_ok, interior_ok, emergency_equipment_ok, notes, overall_pass, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(vehicle_id, req.user!.userId, today,
      lights_ok ? 1 : 0, brakes_ok ? 1 : 0, radio_ok ? 1 : 0, mdt_ok ? 1 : 0,
      camera_ok ? 1 : 0, tires_ok ? 1 : 0, fluids_ok ? 1 : 0, exterior_ok ? 1 : 0,
      interior_ok ? 1 : 0, emergency_equipment_ok ? 1 : 0, notes || null, overall_pass, localNow());

    res.status(201).json({ success: true, id: Number(result.lastInsertRowid), overall_pass: !!overall_pass });
  } catch (error: any) {
    console.error('Pre-trip checklist error:', error);
    res.status(500).json({ error: 'Failed to save pre-trip checklist', code: 'FAILED_TO_SAVE_PRETRIP' });
  }
});

// GET /api/fleet/pretrip/:vehicleId - Get pre-trip history for a vehicle
router.get('/pretrip/:vehicleId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const checklists = db.prepare(`
      SELECT fpc.*, u.full_name as officer_name
      FROM fleet_pretrip_checklists fpc
      LEFT JOIN users u ON fpc.officer_id = u.id
      WHERE fpc.vehicle_id = ?
      ORDER BY fpc.completed_at DESC
      LIMIT 50
    `).all(req.params.vehicleId);
    res.json(checklists);
  } catch (error: any) {
    console.error('Get pre-trip checklists error:', error);
    res.status(500).json({ error: 'Failed to get pre-trip checklists', code: 'GET_PRETRIP_CHECKLISTS_ERROR' });
  }
});

// ── Feature 17: Vehicle mileage tracking from GPS breadcrumbs ─────
// GET /api/fleet/daily-mileage/:vehicleId - Get daily mileage from GPS
router.get('/daily-mileage/:vehicleId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '30' } = req.query;
    const dayCount = parseInt(days as string, 10) || 30;

    // Get the unit assigned to this vehicle
    const unit = db.prepare('SELECT id FROM units WHERE vehicle_id = ?').get(req.params.vehicleId) as any;
    if (!unit) { res.json([]); return; }

    const breadcrumbs = db.prepare(`
      SELECT DATE(recorded_at) as day, latitude, longitude, recorded_at
      FROM gps_breadcrumbs
      WHERE unit_id = ? AND recorded_at >= datetime('now', '-${dayCount} days', 'localtime')
      ORDER BY recorded_at ASC
    
      LIMIT 1000
    `).all(unit.id) as any[];

    // Group by day and calculate distance
    const byDay: Record<string, { points: any[] }> = {};
    for (const bc of breadcrumbs) {
      if (!byDay[bc.day]) byDay[bc.day] = { points: [] };
      byDay[bc.day].points.push(bc);
    }

    const dailyMileage = Object.entries(byDay).map(([day, data]) => {
      let miles = 0;
      for (let i = 1; i < data.points.length; i++) {
        const prev = data.points[i - 1];
        const curr = data.points[i];
        const R = 3959;
        const dLat = (curr.latitude - prev.latitude) * Math.PI / 180;
        const dLon = (curr.longitude - prev.longitude) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(prev.latitude * Math.PI / 180) * Math.cos(curr.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        miles += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }
      return { date: day, miles: Math.round(miles * 10) / 10, breadcrumb_count: data.points.length };
    });

    res.json(dailyMileage);
  } catch (error: any) {
    console.error('Daily mileage error:', error);
    res.status(500).json({ error: 'Failed to daily mileage', code: 'DAILY_MILEAGE_ERROR' });
  }
});

// ── Feature 18: Fleet maintenance calendar ────────────────────────
// GET /api/fleet/maintenance-calendar - Calendar view of upcoming maintenance
router.get('/maintenance-calendar', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { start, end } = req.query;
    const now = localNow();
    const startDate = start || now.split('T')[0];
    const endDate = end || new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0];

    // Upcoming scheduled maintenance
    const scheduled = db.prepare(`
      SELECT fm.id, fm.vehicle_id, fm.maintenance_type, fm.description, fm.scheduled_date,
        fm.cost, fm.status, fv.vehicle_number, fv.make, fv.model, fv.year
      FROM fleet_maintenance fm
      JOIN fleet_vehicles fv ON fm.vehicle_id = fv.id
      WHERE fm.scheduled_date BETWEEN ? AND ?
      ORDER BY fm.scheduled_date ASC
    
      LIMIT 1000
    `).all(startDate, endDate) as any[];

    // Vehicles with next_service_due
    const dueSoon = db.prepare(`
      SELECT id, vehicle_number, make, model, year, next_service_due, next_service_type, current_mileage
      FROM fleet_vehicles
      WHERE next_service_due IS NOT NULL AND next_service_due BETWEEN ? AND ?
      ORDER BY next_service_due ASC
    
      LIMIT 1000
    `).all(startDate, endDate) as any[];

    res.json({
      scheduled_maintenance: scheduled,
      vehicles_due_for_service: dueSoon,
    });
  } catch (error: any) {
    console.error('Maintenance calendar error:', error);
    res.status(500).json({ error: 'Failed to maintenance calendar', code: 'MAINTENANCE_CALENDAR_ERROR' });
  }
});

// ── Feature 19: Vehicle swap logging ──────────────────────────────
// POST /api/fleet/vehicle-swap - Log a vehicle swap
router.post('/vehicle-swap', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { from_vehicle_id, to_vehicle_id, reason } = req.body;
    if (!to_vehicle_id) { res.status(400).json({ error: 'to_vehicle_id is required', code: 'TOVEHICLEID_IS_REQUIRED' }); return; }

    const result = db.prepare(`
      INSERT INTO fleet_vehicle_swaps (officer_id, from_vehicle_id, to_vehicle_id, reason, swapped_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.user!.userId, from_vehicle_id || null, to_vehicle_id, reason || null, localNow());

    // Update the unit's vehicle_id if they have one
    try {
      db.prepare('UPDATE units SET vehicle_id = ? WHERE officer_id = ?').run(to_vehicle_id, req.user!.userId);
    } catch { /* unit may not exist */ }

    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    console.error('Vehicle swap error:', error);
    res.status(500).json({ error: 'Failed to vehicle swap', code: 'VEHICLE_SWAP_ERROR' });
  }
});

// GET /api/fleet/vehicle-swaps - Get swap history
router.get('/vehicle-swaps', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date, officer_id, limit = '50' } = req.query;
    const limitNum = parseInt(limit as string, 10) || 50;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (date) { whereClause += ' AND DATE(vs.swapped_at) = ?'; params.push(date); }
    if (officer_id) { whereClause += ' AND vs.officer_id = ?'; params.push(officer_id); }

    const swaps = db.prepare(`
      SELECT vs.*, u.full_name as officer_name,
        fv1.vehicle_number as from_vehicle_number,
        fv2.vehicle_number as to_vehicle_number
      FROM fleet_vehicle_swaps vs
      LEFT JOIN users u ON vs.officer_id = u.id
      LEFT JOIN fleet_vehicles fv1 ON vs.from_vehicle_id = fv1.id
      LEFT JOIN fleet_vehicles fv2 ON vs.to_vehicle_id = fv2.id
      ${whereClause}
      ORDER BY vs.swapped_at DESC
      LIMIT ?
    `).all(...params, limitNum);

    res.json(swaps);
  } catch (error: any) {
    console.error('Get vehicle swaps error:', error);
    res.status(500).json({ error: 'Failed to get vehicle swaps', code: 'GET_VEHICLE_SWAPS_ERROR' });
  }
});

// ── Feature 20: Fleet cost-per-mile ───────────────────────────────
// GET /api/fleet/cost-per-mile/:vehicleId - Calculate cost per mile
router.get('/cost-per-mile/:vehicleId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicleId = req.params.vehicleId;

    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(vehicleId) as any;
    if (!vehicle) { res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }); return; }

    // Total fuel cost
    const fuelCost = db.prepare(
      'SELECT COALESCE(SUM(total_cost), 0) as total FROM fleet_fuel_logs WHERE vehicle_id = ?'
    ).get(vehicleId) as any;

    // Total maintenance cost
    const maintCost = db.prepare(
      'SELECT COALESCE(SUM(cost), 0) as total FROM fleet_maintenance WHERE vehicle_id = ? AND cost IS NOT NULL'
    ).get(vehicleId) as any;

    const totalCost = (fuelCost.total || 0) + (maintCost.total || 0);
    const mileage = vehicle.current_mileage || 0;

    res.json({
      vehicle_id: vehicleId,
      vehicle_number: vehicle.vehicle_number,
      total_fuel_cost: Math.round((fuelCost.total || 0) * 100) / 100,
      total_maintenance_cost: Math.round((maintCost.total || 0) * 100) / 100,
      total_cost: Math.round(totalCost * 100) / 100,
      current_mileage: mileage,
      cost_per_mile: mileage > 0 ? Math.round((totalCost / mileage) * 100) / 100 : null,
      fuel_cost_per_mile: mileage > 0 ? Math.round(((fuelCost.total || 0) / mileage) * 100) / 100 : null,
      maintenance_cost_per_mile: mileage > 0 ? Math.round(((maintCost.total || 0) / mileage) * 100) / 100 : null,
    });
  } catch (error: any) {
    console.error('Cost per mile error:', error);
    res.status(500).json({ error: 'Failed to cost per mile', code: 'COST_PER_MILE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// UPGRADE BATCH — Fleet Management Enhancements
// ═══════════════════════════════════════════════════════════════════════════

// ── U1: Service Interval Alerts — vehicles approaching or past service ──
router.get('/service-interval-alerts', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const today = localToday();

    const vehicles = db.prepare(`
      SELECT id, vehicle_number, make, model, year, current_mileage,
        next_service_due, next_service_type, next_service_mileage, status
      FROM fleet_vehicles
      WHERE archived_at IS NULL AND next_service_due IS NOT NULL
      ORDER BY next_service_due ASC
      LIMIT 500
    `).all() as any[];

    const alerts: any[] = [];
    for (const v of vehicles) {
      const dueDate = v.next_service_due;
      const daysUntil = Math.floor((new Date(dueDate).getTime() - new Date(today).getTime()) / 86400000);
      let severity: 'overdue' | 'critical' | 'warning' | 'upcoming' = 'upcoming';
      if (daysUntil < 0) severity = 'overdue';
      else if (daysUntil <= 7) severity = 'critical';
      else if (daysUntil <= 30) severity = 'warning';
      else continue;

      let mileageAlert = false;
      if (v.next_service_mileage && v.current_mileage) {
        const milesUntil = v.next_service_mileage - v.current_mileage;
        if (milesUntil <= 500) mileageAlert = true;
      }

      alerts.push({
        vehicle_id: v.id, vehicle_number: v.vehicle_number,
        make: v.make, model: v.model, year: v.year,
        service_type: v.next_service_type || 'General Service',
        due_date: dueDate, days_until: daysUntil, severity,
        mileage_alert: mileageAlert, current_mileage: v.current_mileage,
        service_mileage: v.next_service_mileage,
      });
    }

    res.json({ alerts, total: alerts.length });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load service interval alerts', code: 'SERVICE_INTERVAL_ALERTS_ERROR' });
  }
});

// ── U2: Mileage Tracking Summary ────────────────────────────────────
router.get('/mileage-summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicles = db.prepare(`
      SELECT id, vehicle_number, make, model, year, current_mileage, status, next_service_mileage
      FROM fleet_vehicles WHERE archived_at IS NULL AND current_mileage IS NOT NULL
      ORDER BY current_mileage DESC LIMIT 500
    `).all() as any[];

    const totalMileage = vehicles.reduce((s: number, v: any) => s + (v.current_mileage || 0), 0);
    const avgMileage = vehicles.length > 0 ? Math.round(totalMileage / vehicles.length) : 0;
    const highMileage = vehicles.filter((v: any) => v.current_mileage >= 100000);
    const needsServiceSoon = vehicles.filter((v: any) =>
      v.next_service_mileage && v.current_mileage && (v.next_service_mileage - v.current_mileage) <= 1000
    );

    res.json({
      total_vehicles: vehicles.length, total_fleet_mileage: totalMileage,
      average_mileage: avgMileage, highest_mileage: vehicles[0] || null,
      high_mileage_count: highMileage.length,
      needs_service_by_mileage: needsServiceSoon.length, vehicles,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load mileage summary', code: 'MILEAGE_SUMMARY_ERROR' });
  }
});

// ── U3: Fleet-Wide Assignment History ───────────────────────────────
router.get('/assignment-history-all', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '90' } = req.query;
    const cutoff = new Date(Date.now() - parseInt(days as string, 10) * 86400000).toISOString();
    const rows = db.prepare(`
      SELECT fa.*, fv.vehicle_number, fv.make, fv.model,
        u.full_name as officer_name, un.call_sign
      FROM fleet_assignments fa
      JOIN fleet_vehicles fv ON fv.id = fa.vehicle_id
      LEFT JOIN units un ON un.id = fa.unit_id
      LEFT JOIN users u ON u.id = un.officer_id
      WHERE fa.assigned_at >= ?
      ORDER BY fa.assigned_at DESC LIMIT 1000
    `).all(cutoff);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load assignment history', code: 'ASSIGNMENT_HISTORY_ALL_ERROR' });
  }
});

// ── U4: Fleet-Wide Maintenance Cost Summary ─────────────────────────
router.get('/maintenance-cost-summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const yearFilter = req.query.year ? String(req.query.year) : new Date().getFullYear().toString();

    const perVehicle = db.prepare(`
      SELECT fv.id, fv.vehicle_number, fv.make, fv.model, fv.year,
        COALESCE(SUM(fm.cost), 0) as parts_cost, COALESCE(SUM(fm.labor_cost), 0) as labor_cost,
        COUNT(fm.id) as work_order_count
      FROM fleet_vehicles fv
      LEFT JOIN fleet_maintenance fm ON fm.vehicle_id = fv.id AND strftime('%Y', fm.performed_at) = ?
      WHERE fv.archived_at IS NULL GROUP BY fv.id
      ORDER BY (COALESCE(SUM(fm.cost), 0) + COALESCE(SUM(fm.labor_cost), 0)) DESC LIMIT 500
    `).all(yearFilter) as any[];

    const totalParts = perVehicle.reduce((s: number, v: any) => s + v.parts_cost, 0);
    const totalLabor = perVehicle.reduce((s: number, v: any) => s + v.labor_cost, 0);

    const byType = db.prepare(`
      SELECT maintenance_type as type, COALESCE(SUM(cost), 0) as cost, COUNT(*) as count
      FROM fleet_maintenance WHERE strftime('%Y', performed_at) = ? AND cost IS NOT NULL
      GROUP BY maintenance_type ORDER BY cost DESC
    `).all(yearFilter) as any[];

    res.json({
      year: yearFilter,
      total_parts_cost: Math.round(totalParts * 100) / 100,
      total_labor_cost: Math.round(totalLabor * 100) / 100,
      total_cost: Math.round((totalParts + totalLabor) * 100) / 100,
      per_vehicle: perVehicle.map((v: any) => ({ ...v, total_cost: Math.round((v.parts_cost + v.labor_cost) * 100) / 100 })),
      by_type: byType,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load maintenance cost summary', code: 'MAINTENANCE_COST_SUMMARY_ERROR' });
  }
});

// ── U5: Inspection Pass/Fail Stats ──────────────────────────────────
router.get('/inspection-stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - parseInt(req.query.days as string || '90', 10) * 86400000).toISOString().split('T')[0];

    const stats = db.prepare(`SELECT overall_result, COUNT(*) as count FROM fleet_inspections WHERE inspection_date >= ? GROUP BY overall_result`).all(cutoff) as any[];
    const byVehicle = db.prepare(`
      SELECT fv.vehicle_number, fv.id as vehicle_id, COUNT(*) as total_inspections,
        SUM(CASE WHEN fi.overall_result = 'pass' THEN 1 ELSE 0 END) as pass_count,
        SUM(CASE WHEN fi.overall_result = 'fail' THEN 1 ELSE 0 END) as fail_count,
        MAX(fi.inspection_date) as last_inspection
      FROM fleet_inspections fi JOIN fleet_vehicles fv ON fv.id = fi.vehicle_id
      WHERE fi.inspection_date >= ? GROUP BY fi.vehicle_id ORDER BY fail_count DESC LIMIT 200
    `).all(cutoff) as any[];

    const total = stats.reduce((s: number, r: any) => s + r.count, 0);
    const passCount = stats.find((s: any) => s.overall_result === 'pass')?.count || 0;
    const failCount = stats.find((s: any) => s.overall_result === 'fail')?.count || 0;

    res.json({
      total_inspections: total, pass_count: passCount, fail_count: failCount,
      pass_rate: total > 0 ? Math.round((passCount / total) * 1000) / 10 : 0,
      by_vehicle: byVehicle.map((v: any) => ({ ...v, pass_rate: v.total_inspections > 0 ? Math.round((v.pass_count / v.total_inspections) * 1000) / 10 : 0 })),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load inspection stats', code: 'INSPECTION_STATS_ERROR' });
  }
});

// ── U6: Overdue Inspection Alerts ───────────────────────────────────
router.get('/overdue-inspections', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const today = localToday();
    const vehicles = db.prepare(`
      SELECT fv.id, fv.vehicle_number, fv.make, fv.model, fv.year, fv.status,
        MAX(fi.inspection_date) as last_inspection_date, fi.overall_result as last_result
      FROM fleet_vehicles fv LEFT JOIN fleet_inspections fi ON fi.vehicle_id = fv.id
      WHERE fv.archived_at IS NULL AND fv.status = 'in_service'
      GROUP BY fv.id HAVING last_inspection_date IS NULL OR last_inspection_date < date(?, '-30 days')
      ORDER BY last_inspection_date ASC LIMIT 200
    `).all(today) as any[];

    const alerts = vehicles.map((v: any) => {
      const daysSince = v.last_inspection_date ? Math.floor((new Date(today).getTime() - new Date(v.last_inspection_date).getTime()) / 86400000) : null;
      return { ...v, days_since_inspection: daysSince, severity: daysSince === null ? 'never_inspected' : daysSince > 60 ? 'critical' : 'warning' };
    });
    res.json({ alerts, total: alerts.length });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load overdue inspections', code: 'OVERDUE_INSPECTIONS_ERROR' });
  }
});

// ── U7: Inspection Checklist Templates CRUD ─────────────────────────
router.get('/inspection-templates', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS fleet_inspection_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT,
      vehicle_type TEXT DEFAULT 'all', items TEXT NOT NULL DEFAULT '[]',
      is_default INTEGER DEFAULT 0, created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    )`);
    res.json(db.prepare('SELECT * FROM fleet_inspection_templates ORDER BY is_default DESC, name ASC').all());
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load inspection templates', code: 'INSPECTION_TEMPLATES_ERROR' });
  }
});

router.post('/inspection-templates', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS fleet_inspection_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT,
      vehicle_type TEXT DEFAULT 'all', items TEXT NOT NULL DEFAULT '[]',
      is_default INTEGER DEFAULT 0, created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    )`);
    const { name, description, vehicle_type, items, is_default } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required', code: 'NAME_REQUIRED' });
    const now = localNow();
    const result = db.prepare(`INSERT INTO fleet_inspection_templates (name, description, vehicle_type, items, is_default, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(name, description || null, vehicle_type || 'all', JSON.stringify(items || []), is_default ? 1 : 0, req.user!.userId, now, now);
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create inspection template', code: 'CREATE_INSPECTION_TEMPLATE_ERROR' });
  }
});

router.put('/inspection-templates/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, description, vehicle_type, items, is_default } = req.body;
    const sets: string[] = []; const vals: any[] = [];
    if (name !== undefined) { sets.push('name = ?'); vals.push(name); }
    if (description !== undefined) { sets.push('description = ?'); vals.push(description); }
    if (vehicle_type !== undefined) { sets.push('vehicle_type = ?'); vals.push(vehicle_type); }
    if (items !== undefined) { sets.push('items = ?'); vals.push(JSON.stringify(items)); }
    if (is_default !== undefined) { sets.push('is_default = ?'); vals.push(is_default ? 1 : 0); }
    if (sets.length === 0) return res.status(400).json({ error: 'No fields', code: 'NO_FIELDS' });
    sets.push('updated_at = ?'); vals.push(localNow()); vals.push(req.params.id);
    db.prepare(`UPDATE fleet_inspection_templates SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update inspection template', code: 'UPDATE_INSPECTION_TEMPLATE_ERROR' });
  }
});

// ── U8: Fleet Cost Per Mile Analytics ───────────────────────────────
router.get('/fleet-cost-analytics', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicles = db.prepare(`
      SELECT fv.id, fv.vehicle_number, fv.make, fv.model, fv.year, fv.current_mileage,
        COALESCE((SELECT SUM(total_cost) FROM fleet_fuel_logs WHERE vehicle_id = fv.id), 0) as fuel_cost,
        COALESCE((SELECT SUM(cost) FROM fleet_maintenance WHERE vehicle_id = fv.id), 0) as maint_cost
      FROM fleet_vehicles fv WHERE fv.archived_at IS NULL AND fv.current_mileage > 0
      ORDER BY fv.vehicle_number LIMIT 500
    `).all() as any[];

    const result = vehicles.map((v: any) => {
      const totalCost = (v.fuel_cost || 0) + (v.maint_cost || 0);
      return { ...v, total_cost: Math.round(totalCost * 100) / 100,
        cost_per_mile: v.current_mileage > 0 ? Math.round((totalCost / v.current_mileage) * 100) / 100 : null,
        fuel_cost_per_mile: v.current_mileage > 0 ? Math.round((v.fuel_cost / v.current_mileage) * 100) / 100 : null,
        maint_cost_per_mile: v.current_mileage > 0 ? Math.round((v.maint_cost / v.current_mileage) * 100) / 100 : null,
      };
    });
    const totalFleetCost = result.reduce((s: number, v: any) => s + v.total_cost, 0);
    const totalFleetMiles = result.reduce((s: number, v: any) => s + (v.current_mileage || 0), 0);

    res.json({ vehicles: result, fleet_total_cost: Math.round(totalFleetCost * 100) / 100,
      fleet_total_miles: totalFleetMiles,
      fleet_avg_cost_per_mile: totalFleetMiles > 0 ? Math.round((totalFleetCost / totalFleetMiles) * 100) / 100 : null });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load fleet cost analytics', code: 'FLEET_COST_ANALYTICS_ERROR' });
  }
});

// ── U9: Update vehicle mileage ──────────────────────────────────────
router.put('/:id/mileage', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { mileage } = req.body;
    if (mileage === undefined || mileage === null) return res.status(400).json({ error: 'mileage is required', code: 'MILEAGE_REQUIRED' });
    const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(req.params.id) as any;
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' });

    const now = localNow();
    db.exec(`CREATE TABLE IF NOT EXISTS fleet_mileage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER NOT NULL,
      previous_mileage INTEGER, new_mileage INTEGER NOT NULL,
      recorded_by INTEGER, recorded_at TEXT NOT NULL
    )`);
    db.prepare(`INSERT INTO fleet_mileage_log (vehicle_id, previous_mileage, new_mileage, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?)`).run(req.params.id, vehicle.current_mileage, mileage, req.user!.userId, now);
    db.prepare('UPDATE fleet_vehicles SET current_mileage = ?, updated_at = ? WHERE id = ?').run(mileage, now, req.params.id);

    let serviceDue = false;
    if (vehicle.next_service_mileage && mileage >= vehicle.next_service_mileage) serviceDue = true;
    broadcastFleetUpdate({ type: 'mileage_updated', vehicle_id: Number(req.params.id), mileage });
    res.json({ success: true, service_due: serviceDue });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update mileage', code: 'UPDATE_MILEAGE_ERROR' });
  }
});

// ── U10: Vehicle mileage history ────────────────────────────────────
router.get('/:id/mileage-history', (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS fleet_mileage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER NOT NULL,
      previous_mileage INTEGER, new_mileage INTEGER NOT NULL,
      recorded_by INTEGER, recorded_at TEXT NOT NULL
    )`);
    const rows = db.prepare(`SELECT fml.*, u.full_name as recorded_by_name FROM fleet_mileage_log fml LEFT JOIN users u ON u.id = fml.recorded_by WHERE fml.vehicle_id = ? ORDER BY fml.recorded_at DESC LIMIT 200`).all(req.params.id);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load mileage history', code: 'MILEAGE_HISTORY_ERROR' });
  }
});

// ── U11: Fleet Notifications ────────────────────────────────────────
router.get('/notifications', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const today = localToday();
    const notifications: any[] = [];

    const serviceDue = db.prepare(`SELECT id, vehicle_number, next_service_due, next_service_type FROM fleet_vehicles WHERE archived_at IS NULL AND next_service_due IS NOT NULL AND next_service_due <= date(?, '+7 days')`).all(today) as any[];
    for (const v of serviceDue) {
      const daysUntil = Math.floor((new Date(v.next_service_due).getTime() - new Date(today).getTime()) / 86400000);
      notifications.push({ type: 'service_due', severity: daysUntil < 0 ? 'critical' : 'warning',
        message: `${v.vehicle_number}: ${v.next_service_type || 'Service'} ${daysUntil < 0 ? 'overdue by ' + Math.abs(daysUntil) + ' days' : 'due in ' + daysUntil + ' days'}`,
        vehicle_id: v.id, date: v.next_service_due });
    }

    const expiring = db.prepare(`SELECT id, vehicle_number, insurance_expiry, registration_expiry FROM fleet_vehicles WHERE archived_at IS NULL AND ((insurance_expiry IS NOT NULL AND insurance_expiry <= date(?, '+30 days')) OR (registration_expiry IS NOT NULL AND registration_expiry <= date(?, '+30 days')))`).all(today, today) as any[];
    for (const v of expiring) {
      if (v.insurance_expiry) notifications.push({ type: 'insurance_expiring', severity: v.insurance_expiry <= today ? 'critical' : 'warning', message: `${v.vehicle_number}: Insurance ${v.insurance_expiry <= today ? 'expired' : 'expiring'} ${v.insurance_expiry}`, vehicle_id: v.id, date: v.insurance_expiry });
      if (v.registration_expiry) notifications.push({ type: 'registration_expiring', severity: v.registration_expiry <= today ? 'critical' : 'warning', message: `${v.vehicle_number}: Registration ${v.registration_expiry <= today ? 'expired' : 'expiring'} ${v.registration_expiry}`, vehicle_id: v.id, date: v.registration_expiry });
    }

    notifications.sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity as string] || 9) - ({ critical: 0, warning: 1, info: 2 }[b.severity as string] || 9));
    res.json({ notifications, total: notifications.length });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load fleet notifications', code: 'FLEET_NOTIFICATIONS_ERROR' });
  }
});

export default router;
