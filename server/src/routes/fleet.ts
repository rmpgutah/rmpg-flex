import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcastFleetUpdate } from '../utils/websocket';
import { localNow, localToday } from '../utils/timeUtils';
import { pathInside } from '../utils/pathSafety';

const execFileAsync = promisify(execFile);

/** Extract video duration using ffprobe. */
async function extractVideoDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
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

// ─── Fuel receipt uploads ────────────────────────────────────
// Small images/PDFs (< 10 MB) attached per fuel log for audit trail.
// Flat filename in uploads/fuel-receipts/ — path-safety check happens on
// read via safeFuelReceiptPath() so a poisoned receipt_path in the DB can't
// traverse outside the dir.
const FUEL_RECEIPT_DIR = process.env.RMPG_UPLOADS_DIR
  ? path.join(process.env.RMPG_UPLOADS_DIR, 'fuel-receipts')
  : path.resolve(__dirname_f, '../../uploads/fuel-receipts');
if (!fs.existsSync(FUEL_RECEIPT_DIR)) {
  fs.mkdirSync(FUEL_RECEIPT_DIR, { recursive: true });
}

function safeFuelReceiptPath(relativeFilename: string | null | undefined): string | null {
  if (!relativeFilename || typeof relativeFilename !== 'string') return null;
  const resolved = path.resolve(FUEL_RECEIPT_DIR, path.basename(relativeFilename));
  const rel = path.relative(FUEL_RECEIPT_DIR, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

const fuelReceiptStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, FUEL_RECEIPT_DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '.bin').toLowerCase();
    cb(null, `receipt_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});
const FUEL_RECEIPT_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
]);
const fuelReceiptUpload = multer({
  storage: fuelReceiptStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5, parts: 6, fieldSize: 64 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (FUEL_RECEIPT_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error(`File type ${file.mimetype} not allowed. Use JPG, PNG, WebP, HEIC, or PDF.`));
  },
});

// ─── Fuel outlier / fraud detection ──────────────────────────
//
// Returns a list of human-readable flag strings. Empty array = clean.
// Run on POST (new entry) and PUT (edit) so operators see a banner when
// something looks wrong. Flags are STORED in the row as a JSON array and
// rendered in the UI next to the entry — they don't block the insert,
// they just prompt review. A cleared record (no flags) stores NULL to
// keep the column compact.
//
// Thresholds are tuned for a small patrol fleet (sedans / SUVs with
// 15–25 gal tanks). Tank overflow uses vehicle.tank_capacity if present,
// otherwise falls back to a generous 30 gal so the flag only fires on
// clearly-impossible entries.
function detectFuelLogFlags(
  db: ReturnType<typeof getDb>,
  vehicleId: number,
  entry: {
    id?: number;
    fuel_date: string;
    gallons: number;
    cost_per_gallon: number | null;
    odometer_reading: number | null;
    station: string | null;
  },
): string[] {
  const flags: string[] = [];

  const vehicle = db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(vehicleId) as any;
  const tankCap = Number(vehicle?.tank_capacity) || 30;

  // 1. Tank overflow — +10% tolerance for spillage / rounding / topped-up tank.
  if (entry.gallons > tankCap * 1.1) {
    flags.push(`tank-overflow:${entry.gallons.toFixed(2)}gal-vs-${tankCap}gal-capacity`);
  }

  // 2. Price spike — $/gal > $6 or >2× the 90-day average for this vehicle.
  if (entry.cost_per_gallon != null && entry.cost_per_gallon > 6) {
    flags.push(`price-spike:${entry.cost_per_gallon.toFixed(3)}/gal-over-$6`);
  }
  const avgSql = `
    SELECT AVG(cost_per_gallon) AS avg_cpg
    FROM fleet_fuel_logs
    WHERE vehicle_id = ? AND cost_per_gallon IS NOT NULL
      AND fuel_date >= date('now', '-90 days')
      ${entry.id ? 'AND id != ?' : ''}
  `;
  const avgArgs = entry.id ? [vehicleId, entry.id] : [vehicleId];
  const recentAvgRow = db.prepare(avgSql).get(...avgArgs) as any;
  const avgCpg = Number(recentAvgRow?.avg_cpg);
  if (
    entry.cost_per_gallon != null && avgCpg > 0 &&
    entry.cost_per_gallon > avgCpg * 2
  ) {
    flags.push(`price-spike:${entry.cost_per_gallon.toFixed(3)}-vs-90day-avg-${avgCpg.toFixed(3)}`);
  }

  // 3. MPG anomaly — compute MPG from the immediately-prior entry's odometer.
  //    Flag when computed MPG deviates >50% from the vehicle's 90-day avg MPG.
  if (entry.odometer_reading != null && entry.gallons > 0) {
    const priorSql = `
      SELECT odometer_reading, fuel_date FROM fleet_fuel_logs
      WHERE vehicle_id = ? AND odometer_reading IS NOT NULL
        AND fuel_date < ?
        ${entry.id ? 'AND id != ?' : ''}
      ORDER BY fuel_date DESC, id DESC LIMIT 1
    `;
    const priorArgs = entry.id
      ? [vehicleId, entry.fuel_date, entry.id]
      : [vehicleId, entry.fuel_date];
    const prior = db.prepare(priorSql).get(...priorArgs) as any;
    if (prior?.odometer_reading != null && entry.odometer_reading > prior.odometer_reading) {
      const dist = entry.odometer_reading - prior.odometer_reading;
      const mpg = dist / entry.gallons;
      const vehicleAvg = Number(vehicle?.avg_mpg);
      if (vehicleAvg > 0 && (mpg > vehicleAvg * 1.5 || mpg < vehicleAvg * 0.5)) {
        flags.push(`mpg-anomaly:${mpg.toFixed(1)}mpg-vs-${vehicleAvg.toFixed(1)}avg`);
      }
      // Also flag clearly-impossible MPG (e.g., > 60 on a V8 patrol cruiser
      // is almost certainly an odometer typo or missing prior entry).
      if (mpg > 60) {
        flags.push(`mpg-anomaly:${mpg.toFixed(1)}mpg-implausibly-high`);
      } else if (mpg < 3) {
        flags.push(`mpg-anomaly:${mpg.toFixed(1)}mpg-implausibly-low`);
      }
    }
  }

  // 4. Rapid duplicate — another fill within 30 min at a different station.
  //    Common fuel-card abuse pattern (split transaction across stations).
  const nearbySql = `
    SELECT id, fuel_date, station FROM fleet_fuel_logs
    WHERE vehicle_id = ?
      AND ABS(strftime('%s', fuel_date) - strftime('%s', ?)) < 1800
      ${entry.id ? 'AND id != ?' : ''}
    LIMIT 1
  `;
  const nearbyArgs = entry.id
    ? [vehicleId, entry.fuel_date, entry.id]
    : [vehicleId, entry.fuel_date];
  const nearbyRow = db.prepare(nearbySql).get(...nearbyArgs) as any;
  if (nearbyRow) {
    const otherStation = (nearbyRow.station || '').trim().toLowerCase();
    const thisStation = (entry.station || '').trim().toLowerCase();
    if (otherStation && thisStation && otherStation !== thisStation) {
      flags.push(`rapid-duplicate:another-fill-within-30min-at-${nearbyRow.station}`);
    } else if (!otherStation || !thisStation) {
      flags.push('rapid-duplicate:another-fill-within-30min');
    }
  }

  return flags;
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
  limits: { fileSize: 10 * 1024 * 1024 * 1024, files: 1, fields: 20, parts: 25, fieldSize: 1024 * 1024 },
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
        ROUND(SUM(COALESCE(fl.distance, 0)) * 1.0 / NULLIF(SUM(fl.gallons), 0), 1) AS avg_mpg,
        SUM(fl.gallons) AS total_gallons, SUM(COALESCE(fl.distance, 0)) AS total_miles
      FROM fleet_vehicles fv
      INNER JOIN fleet_fuel_logs fl ON fl.vehicle_id = fv.id
      WHERE fl.gallons > 0 AND fl.archived_at IS NULL
      GROUP BY fv.id
      HAVING total_gallons > 0 AND avg_mpg IS NOT NULL
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

    // ── Daily fleet usage from GPS breadcrumbs (last 30 days) ──
    let dailyUsage: any[] = [];
    try {
      dailyUsage = db.prepare(`
        SELECT DATE(recorded_at) as date, COUNT(DISTINCT call_sign) as active_vehicles,
               COUNT(*) as total_pings,
               SUM(CASE WHEN speed > 0 THEN 1 ELSE 0 END) as moving_pings
        FROM gps_breadcrumbs
        WHERE recorded_at >= datetime('now', '-30 days')
        GROUP BY DATE(recorded_at) ORDER BY date
      `).all() as any[];
    } catch { /* gps_breadcrumbs table may not exist */ }

    // ── Maintenance forecast: top 5 vehicles closest to needing service ──
    let maintenanceForecast: any[] = [];
    try {
      const forecastRows = db.prepare(`
        SELECT v.id, v.vehicle_number, v.current_mileage, v.next_service_due, v.next_service_mileage,
          CASE WHEN julianday(MAX(f.fuel_date)) - julianday(MIN(f.fuel_date)) > 0
            THEN (MAX(f.odometer_reading) - MIN(f.odometer_reading)) / (julianday(MAX(f.fuel_date)) - julianday(MIN(f.fuel_date)))
            ELSE 0 END as avg_daily_miles
        FROM fleet_vehicles v LEFT JOIN fleet_fuel_logs f ON v.id = f.vehicle_id
        WHERE v.status != 'retired'
        GROUP BY v.id
      `).all() as any[];

      maintenanceForecast = forecastRows
        .filter((r: any) => (r.next_service_mileage != null || r.next_service_due != null) && r.current_mileage != null)
        .map((r: any) => {
          // Calculate by mileage if threshold exists, otherwise by date
          let estDays: number | null = null;
          let milesUntilService: number | null = null;
          if (r.next_service_mileage != null && r.current_mileage != null) {
            milesUntilService = r.next_service_mileage - r.current_mileage;
            estDays = r.avg_daily_miles > 0 ? Math.round(milesUntilService / r.avg_daily_miles) : null;
          } else if (r.next_service_due) {
            const dueDate = new Date(r.next_service_due);
            const now = new Date();
            estDays = Math.round((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          }
          return { ...r, miles_until_service: milesUntilService, est_days_until_service: estDays };
        })
        .sort((a: any, b: any) => {
          const aDays = a.est_days_until_service ?? 9999;
          const bDays = b.est_days_until_service ?? 9999;
          return aDays - bDays;
        })
        .slice(0, 5);
    } catch { /* graceful fallback */ }

    // ── Oldest vehicle year ──
    const oldestVehicle = db.prepare(`
      SELECT MIN(year) as oldest_year FROM fleet_vehicles WHERE status != 'retired' AND year IS NOT NULL
    `).get() as any;

    // ── Average daily miles from fuel logs ──
    const avgDailyMilesRow = db.prepare(`
      SELECT CASE WHEN julianday(MAX(fuel_date)) - julianday(MIN(fuel_date)) > 0
        THEN ROUND((MAX(odometer_reading) - MIN(odometer_reading)) * 1.0 / (julianday(MAX(fuel_date)) - julianday(MIN(fuel_date))), 1)
        ELSE 0 END as avg_daily_miles
      FROM fleet_fuel_logs WHERE odometer_reading IS NOT NULL
    `).get() as any;

    // ── Top 5 most common maintenance issues ──
    const topIssues = db.prepare(`
      SELECT type, COUNT(*) as count, SUM(cost) as total_cost
      FROM fleet_maintenance WHERE archived_at IS NULL AND type IS NOT NULL
      GROUP BY type ORDER BY count DESC LIMIT 5
    `).all() as any[];

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
      daily_usage: dailyUsage,
      maintenance_forecast: maintenanceForecast,
      oldest_vehicle_year: oldestVehicle?.oldest_year || null,
      avg_daily_miles: avgDailyMilesRow?.avg_daily_miles || 0,
      top_issues: topIssues,
    });
  } catch (error: any) {
    console.error('Error fetching fleet analytics:', error);
    res.status(500).json({ error: 'Failed to fetch fleet analytics', code: 'FAILED_TO_FETCH_FLEET' });
  }
});

// ─── GET /api/fleet/vehicle-comparison ─ Compare 2-5 vehicles side by side ────
router.get('/vehicle-comparison', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const idsParam = req.query.ids as string;
    if (!idsParam) { res.status(400).json({ error: 'ids query parameter required' }); return; }

    const ids = idsParam.split(',').map(Number).filter(n => !isNaN(n) && n > 0);
    if (ids.length < 2 || ids.length > 5) {
      res.status(400).json({ error: 'Provide 2-5 vehicle IDs' }); return;
    }

    const placeholders = ids.map(() => '?').join(',');
    const vehicles = db.prepare(`
      SELECT fv.id, fv.vehicle_number, fv.make, fv.model, fv.year, fv.current_mileage, fv.status,
        COALESCE(m.total_maintenance_cost, 0) AS total_maintenance_cost,
        COALESCE(f.total_fuel_cost, 0) AS total_fuel_cost,
        (COALESCE(m.total_maintenance_cost, 0) + COALESCE(f.total_fuel_cost, 0)) AS total_cost,
        CASE WHEN fv.current_mileage > 0
          THEN ROUND((COALESCE(m.total_maintenance_cost, 0) + COALESCE(f.total_fuel_cost, 0)) * 1.0 / fv.current_mileage, 4)
          ELSE NULL END AS cost_per_mile,
        f.avg_mpg,
        COALESCE(insp.inspection_count, 0) AS inspection_count,
        CASE WHEN COALESCE(insp.inspection_count, 0) > 0
          THEN ROUND(COALESCE(insp.passed_count, 0) * 100.0 / insp.inspection_count, 1)
          ELSE NULL END AS inspection_pass_rate,
        m.last_service_date,
        CASE WHEN m.last_service_date IS NOT NULL
          THEN CAST(julianday('now') - julianday(m.last_service_date) AS INTEGER)
          ELSE NULL END AS days_since_last_service,
        COALESCE(a.assignment_count, 0) AS assignment_count
      FROM fleet_vehicles fv
      LEFT JOIN (
        SELECT vehicle_id, SUM(cost) AS total_maintenance_cost, MAX(performed_at) AS last_service_date
        FROM fleet_maintenance WHERE archived_at IS NULL AND cost IS NOT NULL
        GROUP BY vehicle_id
      ) m ON m.vehicle_id = fv.id
      LEFT JOIN (
        SELECT vehicle_id, SUM(total_cost) AS total_fuel_cost,
          ROUND(SUM(COALESCE(distance, 0)) * 1.0 / NULLIF(SUM(gallons), 0), 1) AS avg_mpg
        FROM fleet_fuel_logs WHERE archived_at IS NULL AND gallons > 0
        GROUP BY vehicle_id
      ) f ON f.vehicle_id = fv.id
      LEFT JOIN (
        SELECT vehicle_id, COUNT(*) AS inspection_count,
          SUM(CASE WHEN overall_result = 'pass' THEN 1 ELSE 0 END) AS passed_count
        FROM fleet_inspections GROUP BY vehicle_id
      ) insp ON insp.vehicle_id = fv.id
      LEFT JOIN (
        SELECT assigned_unit_id, COUNT(*) AS assignment_count
        FROM fleet_vehicles WHERE assigned_unit_id IS NOT NULL
        GROUP BY assigned_unit_id
      ) a ON a.assigned_unit_id = fv.assigned_unit_id
      WHERE fv.id IN (${placeholders})
    `).all(...ids) as any[];

    res.json({ vehicles });
  } catch (error: any) {
    console.error('Error fetching vehicle comparison:', error);
    res.status(500).json({ error: 'Failed to fetch vehicle comparison', code: 'VEHICLE_COMPARISON_ERROR' });
  }
});

// ─── GET /api/fleet/cost-trends ─ Monthly cost breakdown (last 12 months) ────
router.get('/cost-trends', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - 365 * 86400000).toISOString();

    const maintByMonth = db.prepare(`
      SELECT strftime('%Y-%m', performed_at) AS month, SUM(cost) AS maintenance_cost
      FROM fleet_maintenance
      WHERE performed_at >= ? AND cost IS NOT NULL AND archived_at IS NULL
      GROUP BY month
    `).all(cutoff) as any[];

    const fuelByMonth = db.prepare(`
      SELECT strftime('%Y-%m', fuel_date) AS month, SUM(total_cost) AS fuel_cost
      FROM fleet_fuel_logs
      WHERE fuel_date >= ? AND total_cost IS NOT NULL AND archived_at IS NULL
      GROUP BY month
    `).all(cutoff) as any[];

    const vehicleCount = (db.prepare(`SELECT COUNT(*) AS count FROM fleet_vehicles WHERE status != 'retired'`).get() as any).count;

    // Merge into monthly totals
    const monthMap: Record<string, { month: string; maintenance_cost: number; fuel_cost: number; total_cost: number; vehicle_count: number }> = {};
    for (const r of maintByMonth) {
      if (!monthMap[r.month]) monthMap[r.month] = { month: r.month, maintenance_cost: 0, fuel_cost: 0, total_cost: 0, vehicle_count: vehicleCount };
      monthMap[r.month].maintenance_cost = r.maintenance_cost || 0;
    }
    for (const r of fuelByMonth) {
      if (!monthMap[r.month]) monthMap[r.month] = { month: r.month, maintenance_cost: 0, fuel_cost: 0, total_cost: 0, vehicle_count: vehicleCount };
      monthMap[r.month].fuel_cost = r.fuel_cost || 0;
    }
    for (const key of Object.keys(monthMap)) {
      monthMap[key].total_cost = monthMap[key].maintenance_cost + monthMap[key].fuel_cost;
    }

    const trends = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));
    res.json({ cost_trends: trends });
  } catch (error: any) {
    console.error('Error fetching cost trends:', error);
    res.status(500).json({ error: 'Failed to fetch cost trends', code: 'COST_TRENDS_ERROR' });
  }
});

// ─── GET /api/fleet/vehicle-lifecycle ─ Vehicle lifecycle analysis ────
router.get('/vehicle-lifecycle', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const currentYear = new Date().getFullYear();

    const vehicles = db.prepare(`
      SELECT fv.id, fv.vehicle_number, fv.year, fv.current_mileage, fv.status,
        COALESCE(m.total_cost, 0) + COALESCE(f.total_cost, 0) AS total_lifetime_cost
      FROM fleet_vehicles fv
      LEFT JOIN (
        SELECT vehicle_id, SUM(cost) AS total_cost
        FROM fleet_maintenance WHERE archived_at IS NULL AND cost IS NOT NULL
        GROUP BY vehicle_id
      ) m ON m.vehicle_id = fv.id
      LEFT JOIN (
        SELECT vehicle_id, SUM(total_cost) AS total_cost
        FROM fleet_fuel_logs WHERE archived_at IS NULL AND total_cost IS NOT NULL
        GROUP BY vehicle_id
      ) f ON f.vehicle_id = fv.id
      WHERE fv.status != 'retired' AND fv.year IS NOT NULL
    `).all() as any[];

    const lifecycle = vehicles.map((v: any) => {
      const ageYears = Math.max(currentYear - v.year, 1);
      const currentMileage = v.current_mileage || 0;
      const avgAnnualMileage = Math.round(currentMileage / ageYears);
      const costPerYear = Math.round((v.total_lifetime_cost || 0) / ageYears);
      const milesRemaining = Math.max(150000 - currentMileage, 0);
      const estimatedRemainingLifeYears = avgAnnualMileage > 0
        ? Math.round((milesRemaining / avgAnnualMileage) * 10) / 10
        : null;
      return {
        id: v.id,
        vehicle_number: v.vehicle_number,
        year: v.year,
        status: v.status,
        age_years: ageYears,
        current_mileage: currentMileage,
        avg_annual_mileage: avgAnnualMileage,
        total_lifetime_cost: v.total_lifetime_cost || 0,
        cost_per_year: costPerYear,
        estimated_remaining_life_years: estimatedRemainingLifeYears,
      };
    });

    res.json({ lifecycle });
  } catch (error: any) {
    console.error('Error fetching vehicle lifecycle:', error);
    res.status(500).json({ error: 'Failed to fetch vehicle lifecycle', code: 'VEHICLE_LIFECYCLE_ERROR' });
  }
});

// ─── GET /api/fleet/daily-costs ─ Daily cost breakdown (maintenance + fuel) ────
router.get('/daily-costs', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { period = '90d' } = req.query;

    let days = 90;
    switch (period) {
      case '30d': days = 30; break;
      case '90d': days = 90; break;
      case '1y': days = 365; break;
      case 'all': days = 3650; break;
    }

    const maintCosts = db.prepare(`
      SELECT DATE(performed_at) as date, SUM(cost) as cost, 'maintenance' as type
      FROM fleet_maintenance
      WHERE performed_at >= date('now', '-' || ? || ' days') AND cost IS NOT NULL
      GROUP BY DATE(performed_at)
    `).all(days) as any[];

    const fuelCosts = db.prepare(`
      SELECT DATE(fuel_date) as date, SUM(total_cost) as cost, 'fuel' as type
      FROM fleet_fuel_logs
      WHERE fuel_date >= date('now', '-' || ? || ' days') AND total_cost IS NOT NULL
      GROUP BY DATE(fuel_date)
    `).all(days) as any[];

    // Merge into daily totals
    const dailyMap: Record<string, { date: string; maintenance_cost: number; fuel_cost: number }> = {};
    for (const r of maintCosts) {
      if (!dailyMap[r.date]) dailyMap[r.date] = { date: r.date, maintenance_cost: 0, fuel_cost: 0 };
      dailyMap[r.date].maintenance_cost += r.cost || 0;
    }
    for (const r of fuelCosts) {
      if (!dailyMap[r.date]) dailyMap[r.date] = { date: r.date, maintenance_cost: 0, fuel_cost: 0 };
      dailyMap[r.date].fuel_cost += r.cost || 0;
    }

    const dailyCosts = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    res.set('Cache-Control', 'private, max-age=300');
    res.json({ daily_costs: dailyCosts });
  } catch (error: any) {
    console.error('Error fetching daily costs:', error);
    res.status(500).json({ error: 'Failed to fetch daily costs', code: 'DAILY_COSTS_ERROR' });
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
    const id = parseInt(req.params.id as string, 10);
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
      status,
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

    const validStatuses = ['in_service', 'out_of_service', 'maintenance', 'retired'];
    const safeStatus = status && validStatuses.includes(status) ? status : 'in_service';

    const result = db.prepare(`
      INSERT INTO fleet_vehicles (
        vehicle_number, make, model, year, color, vin,
        plate_number, plate_state, current_mileage, next_service_mileage,
        insurance_expiry, registration_expiry, equipment, notes,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      safeStatus,
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
    broadcastFleetUpdate({ action: 'vehicle_created', vehicle_id: created.id });
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
      last_service_date: v => v ?? null, next_service_due: v => v ?? null,
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

    // God Mode: admin can override odometer readings (including lowering)
    if (req.user?.role === 'admin' && current_mileage !== undefined && existing.current_mileage && current_mileage < existing.current_mileage) {
      auditLog(req, 'ADMIN_OVERRIDE', 'fleet_vehicle', parseInt(id as string), `Admin God Mode: overriding odometer on ${existing.vehicle_number} (${existing.current_mileage} → ${current_mileage})`);
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
    broadcastFleetUpdate({ action: 'vehicle_updated', vehicle_id: Number(id) });
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
    // God Mode: admin can delete vehicles regardless of status
    if (req.user?.role !== 'admin') {
      if (vehicle.status !== 'retired') {
        res.status(400).json({ error: 'Only retired vehicles can be deleted', code: 'ONLY_RETIRED_VEHICLES_CAN' }); return;
      }
      if (vehicle.assigned_unit_id) {
        res.status(400).json({ error: 'Unassign vehicle from unit before deleting', code: 'UNASSIGN_VEHICLE_FROM_UNIT' }); return;
      }
    } else if (vehicle.status !== 'retired' || vehicle.assigned_unit_id) {
      auditLog(req, 'ADMIN_OVERRIDE', 'fleet_vehicle', vehicle.id, `Admin God Mode: deleting vehicle ${vehicle.vehicle_number} (status=${vehicle.status}, assigned=${!!vehicle.assigned_unit_id})`);
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
    broadcastFleetUpdate({ action: 'vehicle_deleted', vehicle_id: Number(req.params.id) });
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

// ─── GET /api/fleet/:id/fuel ─ Fuel logs with summary + efficiency ─────────────
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
    // Cap raised from 200 → 10000 (2026-04-14): the Fuel tab now requests
    // every entry in one shot for client-side period filtering. Other
    // paginated callers still work because they explicitly send smaller
    // per_page values; only callers asking for big pages get them.
    const perPage = Math.min(10000, Math.max(1, parseInt(per_page as string, 10) || 50));
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
        COUNT(*) AS log_count,
        MIN(fuel_date) AS first_date,
        MAX(fuel_date) AS last_date
      FROM fleet_fuel_logs WHERE vehicle_id = ?
    `).get(id) as any;

    // Fetch ALL fuel logs in chronological order for efficiency calculations
    const allLogs = db.prepare(`
      SELECT id, fuel_date, gallons, odometer_reading, total_cost, distance
      FROM fleet_fuel_logs
      WHERE vehicle_id = ?
      ORDER BY fuel_date ASC, id ASC
      LIMIT 5000
    `).all(id) as any[];

    // Compute per-entry efficiency: mpg, distance, cost_per_mile, running_avg_mpg
    const efficiencyMap: Record<number, { mpg: number | null; distance: number | null; cost_per_mile: number | null; running_avg_mpg: number | null }> = {};
    let cumulativeMiles = 0;
    let cumulativeGallons = 0;
    let bestMpg: number | null = null;
    let worstMpg: number | null = null;
    let totalDistance = 0;

    for (let i = 0; i < allLogs.length; i++) {
      const curr = allLogs[i];
      let dist: number | null = null;
      let mpg: number | null = null;
      let costPerMile: number | null = null;

      // Use distance column if available, otherwise compute from consecutive odometer readings
      if (curr.distance != null && curr.distance > 0) {
        dist = curr.distance;
      } else if (i > 0 && curr.odometer_reading != null) {
        // Find previous log with odometer
        for (let j = i - 1; j >= 0; j--) {
          if (allLogs[j].odometer_reading != null && curr.odometer_reading > allLogs[j].odometer_reading) {
            dist = curr.odometer_reading - allLogs[j].odometer_reading;
            break;
          }
        }
      }

      if (dist != null && dist > 0 && curr.gallons > 0) {
        mpg = Math.round((dist / curr.gallons) * 10) / 10;
        cumulativeMiles += dist;
        cumulativeGallons += curr.gallons;
        totalDistance += dist;

        if (bestMpg === null || mpg > bestMpg) bestMpg = mpg;
        if (worstMpg === null || mpg < worstMpg) worstMpg = mpg;
      }

      if (dist != null && dist > 0 && curr.total_cost != null && curr.total_cost > 0) {
        costPerMile = Math.round((curr.total_cost / dist) * 1000) / 1000;
      }

      const runningAvgMpg = cumulativeGallons > 0
        ? Math.round((cumulativeMiles / cumulativeGallons) * 10) / 10
        : null;

      efficiencyMap[curr.id] = { mpg, distance: dist, cost_per_mile: costPerMile, running_avg_mpg: runningAvgMpg };
    }

    // Compute average MPG from cumulative
    const avgMpg = cumulativeGallons > 0 ? Math.round((cumulativeMiles / cumulativeGallons) * 10) / 10 : null;

    // Cost per mile overall
    const overallCostPerMile = totalDistance > 0 && summaryRow.total_cost > 0
      ? Math.round((summaryRow.total_cost / totalDistance) * 1000) / 1000
      : null;

    // Fuel cost per day
    let fuelCostPerDay: number | null = null;
    if (summaryRow.first_date && summaryRow.last_date && summaryRow.total_cost > 0) {
      const firstMs = new Date(summaryRow.first_date).getTime();
      const lastMs = new Date(summaryRow.last_date).getTime();
      const days = Math.max(1, (lastMs - firstMs) / (1000 * 60 * 60 * 24));
      fuelCostPerDay = Math.round((summaryRow.total_cost / days) * 100) / 100;
    }

    // Attach efficiency data to paginated logs
    const enrichedLogs = logs.map((log: any) => {
      const eff = efficiencyMap[log.id];
      return {
        ...log,
        mpg: eff?.mpg ?? null,
        calc_distance: eff?.distance ?? null,
        cost_per_mile: eff?.cost_per_mile ?? null,
        running_avg_mpg: eff?.running_avg_mpg ?? null,
      };
    });

    res.json({
      data: enrichedLogs,
      summary: {
        total_gallons: summaryRow.total_gallons,
        total_cost: summaryRow.total_cost,
        avg_mpg: avgMpg,
        avg_cost_per_gallon: summaryRow.avg_cost_per_gallon ? Math.round(summaryRow.avg_cost_per_gallon * 1000) / 1000 : 0,
        log_count: summaryRow.log_count,
        best_mpg: bestMpg,
        worst_mpg: worstMpg,
        total_distance: totalDistance > 0 ? Math.round(totalDistance * 10) / 10 : null,
        cost_per_mile: overallCostPerMile,
        fuel_cost_per_day: fuelCostPerDay,
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

    const {
      fuel_date, gallons, cost_per_gallon, total_cost, odometer_reading,
      fuel_type, station, notes,
      // 2026-04-14 v2: optional driver + card attribution. Both null-allowed
      // so legacy clients that don't send them continue to work unchanged.
      driver_officer_id, fuel_card_id,
    } = req.body;

    if (!fuel_date || !gallons) {
      res.status(400).json({ error: 'fuel_date and gallons are required', code: 'FUELDATE_AND_GALLONS_ARE' });
      return;
    }

    const computedTotal = total_cost != null ? total_cost : (cost_per_gallon ? gallons * cost_per_gallon : null);

    // Compute outlier flags before INSERT — so the row we just wrote and the
    // row we return below are identical (no second pass). Flags don't block
    // the insert, they surface a warning banner in the UI so an operator can
    // review / confirm / correct the entry.
    const flagsArr = detectFuelLogFlags(db, Number(id), {
      fuel_date,
      gallons: Number(gallons),
      cost_per_gallon: cost_per_gallon != null ? Number(cost_per_gallon) : null,
      odometer_reading: odometer_reading != null ? Number(odometer_reading) : null,
      station: station ?? null,
    });
    const flagsJson = flagsArr.length > 0 ? JSON.stringify(flagsArr) : null;

    const result = db.prepare(`
      INSERT INTO fleet_fuel_logs (
        vehicle_id, fuel_date, gallons, cost_per_gallon, total_cost,
        odometer_reading, fuel_type, station, notes, created_by, created_at, flags,
        driver_officer_id, fuel_card_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      localNow(),
      flagsJson,
      driver_officer_id || null,
      fuel_card_id || null,
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
      // v2 fields — supported in both PUT (explicit edit) and POST (create).
      driver_officer_id: v => v ?? null, fuel_card_id: v => v ?? null,
    };
    for (const [key, transform] of Object.entries(fFieldMap)) {
      if (fBodyKeys.includes(key)) { fFields.push(`${key} = ?`); fValues.push(transform(req.body[key])); }
    }
    if (fFields.length > 0) {
      fValues.push(req.params.id);
      db.prepare(`UPDATE fleet_fuel_logs SET ${fFields.join(', ')} WHERE id = ?`).run(...fValues);
    }

    // Re-evaluate flags against the just-updated row — PUT can change any
    // input that affects detectFuelLogFlags (gallons, cost_per_gallon,
    // odometer, station, date), so we refetch and re-compute rather than
    // trying to reason about which fields were touched.
    const refetched = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(req.params.id) as any;
    const newFlags = detectFuelLogFlags(db, Number(refetched.vehicle_id), {
      id: Number(req.params.id),
      fuel_date: refetched.fuel_date,
      gallons: Number(refetched.gallons),
      cost_per_gallon: refetched.cost_per_gallon != null ? Number(refetched.cost_per_gallon) : null,
      odometer_reading: refetched.odometer_reading != null ? Number(refetched.odometer_reading) : null,
      station: refetched.station ?? null,
    });
    db.prepare('UPDATE fleet_fuel_logs SET flags = ? WHERE id = ?').run(
      newFlags.length > 0 ? JSON.stringify(newFlags) : null,
      req.params.id,
    );

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

// ═══════════════════════════════════════════════════════════════════
// Fuel-log enhancements (2026-04-14):
//   - Receipt attachment (upload / stream / delete)
//   - CSV import from fuel-card statements (preview + commit)
//   - CSV export of fuel logs
//
// Path ordering: the literal /fuel/import/*, /fuel/export/*,
// /fuel/:id/receipt routes must be declared BEFORE any /fuel/:id route
// that uses a numeric param validator — Express matches top-down and a
// param route would swallow "import" / "export" / etc. otherwise.
// ═══════════════════════════════════════════════════════════════════

// POST /api/fleet/fuel/:id/receipt — attach a receipt to a fuel log
router.post('/fuel/:id/receipt', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  fuelReceiptUpload.single('receipt')(req, res, (multerErr: any) => {
    const cleanup = () => {
      const p = req.file?.path;
      // pathInside() proves containment to CodeQL — multer paths use
      // crypto.randomBytes filenames so they're already safe, but the
      // analyzer treats req.file.path as tainted by upload origin.
      if (p && pathInside(p, FUEL_RECEIPT_DIR) && fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch { /* ignore */ }
      }
    };
    if (multerErr) {
      cleanup();
      res.status(400).json({ error: multerErr.message || 'Receipt upload failed' });
      return;
    }
    try {
      if (!req.file) { res.status(400).json({ error: 'No receipt file provided' }); return; }

      const db = getDb();
      const record = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(req.params.id) as any;
      if (!record) { cleanup(); res.status(404).json({ error: 'Fuel log not found', code: 'FUEL_LOG_NOT_FOUND' }); return; }

      // Replace old receipt if any — don't leave orphans on disk.
      if (record.receipt_path) {
        const oldAbs = safeFuelReceiptPath(record.receipt_path);
        if (oldAbs && fs.existsSync(oldAbs)) {
          try { fs.unlinkSync(oldAbs); } catch { /* best effort */ }
        }
      }

      db.prepare('UPDATE fleet_fuel_logs SET receipt_path = ? WHERE id = ?').run(req.file.filename, record.id);
      const updated = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(record.id);
      auditLog(req, 'fleet_fuel_receipt_attached', 'fleet_fuel_log', Number(record.id), `Attached receipt to fuel log ${record.id}`);
      res.json(updated);
    } catch (err: any) {
      cleanup();
      console.error('[fuel receipt upload] error:', err?.message, err?.stack);
      res.status(500).json({ error: 'Failed to attach receipt' });
    }
  });
});

// GET /api/fleet/fuel/:id/receipt — stream the receipt file (inline)
router.get('/fuel/:id/receipt', (req: Request, res: Response, next) => {
  // Accept ?token= for <img>/iframe viewers that can't set auth header.
  if (!req.headers['authorization'] && typeof req.query.token === 'string' && req.query.token.length < 2048) {
    req.headers['authorization'] = `Bearer ${req.query.token}`;
  }
  next();
}, authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT receipt_path FROM fleet_fuel_logs WHERE id = ?').get(req.params.id) as any;
    if (!record || !record.receipt_path) { res.status(404).json({ error: 'No receipt for this log' }); return; }
    const absPath = safeFuelReceiptPath(record.receipt_path);
    if (!absPath || !fs.existsSync(absPath)) { res.status(404).json({ error: 'Receipt file missing on disk' }); return; }
    const ext = path.extname(absPath).toLowerCase();
    const mimes: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif',
      '.pdf': 'application/pdf',
    };
    res.setHeader('Content-Type', mimes[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(absPath)}"`);
    fs.createReadStream(absPath).pipe(res);
  } catch (err: any) {
    console.error('[fuel receipt stream] error:', err?.message);
    res.status(500).json({ error: 'Failed to stream receipt' });
  }
});

// DELETE /api/fleet/fuel/:id/receipt — detach + remove receipt file
router.delete('/fuel/:id/receipt', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM fleet_fuel_logs WHERE id = ?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Fuel log not found', code: 'FUEL_LOG_NOT_FOUND' }); return; }
    if (!record.receipt_path) { res.json({ success: true, alreadyGone: true }); return; }
    const absPath = safeFuelReceiptPath(record.receipt_path);
    if (absPath && fs.existsSync(absPath)) {
      try { fs.unlinkSync(absPath); } catch { /* best effort */ }
    }
    db.prepare('UPDATE fleet_fuel_logs SET receipt_path = NULL WHERE id = ?').run(record.id);
    auditLog(req, 'fleet_fuel_receipt_removed', 'fleet_fuel_log', Number(record.id), `Removed receipt from fuel log ${record.id}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[fuel receipt delete] error:', err?.message);
    res.status(500).json({ error: 'Failed to delete receipt' });
  }
});

// ─── CSV import from fuel-card statements ─────────────────────────
//
// Flow: upload CSV → server parses + matches vehicles → client previews
// + fixes any unmatched rows → client POSTs `rows` array to /import/commit.
// We don't write anything to fleet_fuel_logs during preview.
//
// Column mapping is fuzzy: we scan headers case-insensitively and accept
// common aliases from WEX, Voyager, Fuelman, and generic exports. Rows
// with no matching vehicle come back `matched: false` so the UI can let
// an operator pick the vehicle manually before committing.
function parseCsv(text: string): string[][] {
  // Minimal RFC 4180 CSV parser — handles quoted fields with embedded
  // commas and doubled-quote escapes. Good enough for fuel-card exports
  // which don't use exotic dialects.
  const rows: string[][] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const row: string[] = [];
    let field = '';
    let inQuote = false;
    while (i < n) {
      const ch = text[i];
      if (inQuote) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; }
          else { inQuote = false; i++; }
        } else { field += ch; i++; }
      } else {
        if (ch === '"') { inQuote = true; i++; }
        else if (ch === ',') { row.push(field); field = ''; i++; }
        else if (ch === '\r') { i++; }
        else if (ch === '\n') { row.push(field); field = ''; i++; break; }
        else { field += ch; i++; }
      }
    }
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
    if (i >= n) break;
  }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function pickHeader(headers: string[], aliases: string[]): number {
  const norm = headers.map(h => h.toLowerCase().trim().replace(/[\s_-]+/g, ''));
  for (const alias of aliases) {
    const a = alias.toLowerCase().replace(/[\s_-]+/g, '');
    const idx = norm.indexOf(a);
    if (idx >= 0) return idx;
  }
  return -1;
}

// POST /api/fleet/fuel/import/preview — multipart CSV, returns parsed + matched rows
router.post('/fuel/import/preview', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  const csvUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5, parts: 6 },
    fileFilter: (_req, file, cb) => {
      const ok = /\.csv$/i.test(file.originalname || '') ||
                 file.mimetype === 'text/csv' ||
                 file.mimetype === 'application/vnd.ms-excel';
      cb(ok ? null : new Error('Only .csv files are allowed'), ok);
    },
  });
  csvUpload.single('file')(req, res, (multerErr: any) => {
    if (multerErr) { res.status(400).json({ error: multerErr.message }); return; }
    try {
      if (!req.file) { res.status(400).json({ error: 'No CSV file provided' }); return; }
      const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, ''); // strip BOM
      const rows = parseCsv(text);
      if (rows.length < 2) { res.status(400).json({ error: 'CSV is empty or has no data rows' }); return; }

      const headers = rows[0];
      const dateIdx = pickHeader(headers, ['fuel_date', 'date', 'transaction date', 'posted date', 'trans date']);
      const gallonsIdx = pickHeader(headers, ['gallons', 'quantity', 'gal', 'qty', 'units']);
      const cpgIdx = pickHeader(headers, ['cost_per_gallon', 'unit price', 'price per gallon', 'price/gal', 'ppg']);
      const totalIdx = pickHeader(headers, ['total_cost', 'amount', 'net amount', 'total', 'trans amount']);
      const odoIdx = pickHeader(headers, ['odometer_reading', 'odometer', 'mileage', 'miles', 'odo']);
      const vehIdx = pickHeader(headers, ['vehicle', 'unit', 'asset id', 'asset', 'vehicle id', 'vehicle number']);
      const plateIdx = pickHeader(headers, ['license', 'plate', 'license plate', 'tag']);
      const cardIdx = pickHeader(headers, ['card #', 'card number', 'fuel card', 'card']);
      const stationIdx = pickHeader(headers, ['station', 'merchant', 'location', 'merchant name']);
      const typeIdx = pickHeader(headers, ['fuel_type', 'grade', 'product', 'fuel type']);

      if (dateIdx < 0 || gallonsIdx < 0) {
        res.status(400).json({
          error: 'CSV is missing a recognizable "date" or "gallons" column',
          headersDetected: headers,
        });
        return;
      }

      const db = getDb();
      const allVehicles = db.prepare(`
        SELECT id, vehicle_number, plate, make, model, year
        FROM fleet_vehicles WHERE archived_at IS NULL
      `).all() as any[];
      const byNumber: Record<string, any> = {};
      const byPlate: Record<string, any> = {};
      for (const v of allVehicles) {
        if (v.vehicle_number) byNumber[String(v.vehicle_number).toLowerCase().trim()] = v;
        if (v.plate) byPlate[String(v.plate).toLowerCase().trim()] = v;
      }
      const cardVehicleMap: Record<string, any> = {};
      try {
        const cards = db.prepare('SELECT card_number, vehicle_id FROM fleet_fuel_cards WHERE vehicle_id IS NOT NULL').all() as any[];
        for (const c of cards) {
          const v = allVehicles.find(x => x.id === c.vehicle_id);
          if (v && c.card_number) cardVehicleMap[String(c.card_number).trim()] = v;
        }
      } catch { /* fuel_cards table may not be populated yet */ }

      const parseNum = (s: string | undefined): number | null => {
        if (s == null) return null;
        const clean = String(s).replace(/[$,\s]/g, '');
        const n = parseFloat(clean);
        return isNaN(n) ? null : n;
      };
      const parseDate = (s: string | undefined): string | null => {
        if (!s) return null;
        const trimmed = s.trim();
        // Accept ISO, MM/DD/YYYY, MM-DD-YYYY with optional HH:MM[:SS] suffix.
        const d = new Date(trimmed);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
        return null;
      };
      const normalizeFuelType = (s: string | undefined): 'regular' | 'premium' | 'diesel' => {
        if (!s) return 'regular';
        const v = s.toLowerCase();
        if (v.includes('diesel') || v.includes('dsl')) return 'diesel';
        if (v.includes('premium') || v.includes('93') || v.includes('91')) return 'premium';
        return 'regular';
      };

      const out = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const rawVeh = (vehIdx >= 0 ? row[vehIdx] : '') || '';
        const rawPlate = (plateIdx >= 0 ? row[plateIdx] : '') || '';
        const rawCard = (cardIdx >= 0 ? row[cardIdx] : '') || '';
        const vehMatch =
          (rawVeh && byNumber[rawVeh.toLowerCase().trim()]) ||
          (rawPlate && byPlate[rawPlate.toLowerCase().trim()]) ||
          (rawCard && cardVehicleMap[rawCard.trim()]) ||
          null;

        const gallons = parseNum(row[gallonsIdx]);
        const parsedDate = parseDate(row[dateIdx]);
        const warnings: string[] = [];
        if (gallons == null || gallons <= 0) warnings.push('gallons missing or invalid');
        if (!parsedDate) warnings.push('date missing or unparseable');
        if (!vehMatch) warnings.push('no vehicle match');

        out.push({
          row_index: r,
          raw: row,
          matched: !!vehMatch,
          vehicle_id: vehMatch?.id ?? null,
          vehicle_display: vehMatch
            ? `#${vehMatch.vehicle_number} — ${[vehMatch.year, vehMatch.make, vehMatch.model].filter(Boolean).join(' ')}`
            : null,
          vehicle_hint: rawVeh || rawPlate || rawCard || null,
          fuel_date: parsedDate,
          gallons,
          cost_per_gallon: cpgIdx >= 0 ? parseNum(row[cpgIdx]) : null,
          total_cost: totalIdx >= 0 ? parseNum(row[totalIdx]) : null,
          odometer_reading: odoIdx >= 0 ? parseNum(row[odoIdx]) : null,
          station: stationIdx >= 0 ? (row[stationIdx] || '').trim() || null : null,
          fuel_type: typeIdx >= 0 ? normalizeFuelType(row[typeIdx]) : 'regular',
          warnings,
        });
      }

      res.json({
        headers,
        column_map: {
          fuel_date: dateIdx >= 0 ? headers[dateIdx] : null,
          gallons: gallonsIdx >= 0 ? headers[gallonsIdx] : null,
          cost_per_gallon: cpgIdx >= 0 ? headers[cpgIdx] : null,
          total_cost: totalIdx >= 0 ? headers[totalIdx] : null,
          odometer_reading: odoIdx >= 0 ? headers[odoIdx] : null,
          vehicle: vehIdx >= 0 ? headers[vehIdx] : null,
          plate: plateIdx >= 0 ? headers[plateIdx] : null,
          card: cardIdx >= 0 ? headers[cardIdx] : null,
          station: stationIdx >= 0 ? headers[stationIdx] : null,
          fuel_type: typeIdx >= 0 ? headers[typeIdx] : null,
        },
        row_count: out.length,
        matched_count: out.filter(r => r.matched).length,
        rows: out,
      });
    } catch (err: any) {
      console.error('[fuel import preview] error:', err?.message, err?.stack);
      res.status(500).json({ error: 'Failed to parse CSV' });
    }
  });
});

// POST /api/fleet/fuel/import/commit — insert reviewed rows in a transaction
router.post('/fuel/import/commit', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const { rows } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: 'rows array is required' });
      return;
    }
    const db = getDb();
    const insertStmt = db.prepare(`
      INSERT INTO fleet_fuel_logs (
        vehicle_id, fuel_date, gallons, cost_per_gallon, total_cost,
        odometer_reading, fuel_type, station, notes, created_by, created_at, source, flags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?)
    `);
    const now = localNow();
    const errors: { row_index: number; error: string }[] = [];
    let inserted = 0;

    // Wrap in a transaction so a mid-batch failure rolls back cleanly.
    const runAll = db.transaction((batch: any[]) => {
      for (const r of batch) {
        try {
          if (!r.vehicle_id || !r.fuel_date || !r.gallons || Number(r.gallons) <= 0) {
            errors.push({ row_index: r.row_index ?? -1, error: 'missing vehicle_id, fuel_date, or gallons' });
            continue;
          }
          const gallons = Number(r.gallons);
          const cpg = r.cost_per_gallon != null ? Number(r.cost_per_gallon) : null;
          const total = r.total_cost != null ? Number(r.total_cost)
                      : (cpg != null ? gallons * cpg : null);
          const flags = detectFuelLogFlags(db, Number(r.vehicle_id), {
            fuel_date: r.fuel_date,
            gallons,
            cost_per_gallon: cpg,
            odometer_reading: r.odometer_reading != null ? Number(r.odometer_reading) : null,
            station: r.station ?? null,
          });
          insertStmt.run(
            r.vehicle_id,
            r.fuel_date,
            gallons,
            cpg,
            total,
            r.odometer_reading ?? null,
            r.fuel_type || 'regular',
            r.station ?? null,
            r.notes ?? null,
            req.user!.userId,
            now,
            flags.length > 0 ? JSON.stringify(flags) : null,
          );
          inserted++;
        } catch (rowErr: any) {
          errors.push({ row_index: r.row_index ?? -1, error: rowErr?.message || 'insert failed' });
        }
      }
    });
    runAll(rows);

    auditLog(req, 'fleet_fuel_bulk_imported', 'fleet_fuel_log', 0,
      `CSV import: ${inserted} inserted, ${errors.length} errors`);
    res.json({ inserted, errors });
  } catch (err: any) {
    console.error('[fuel import commit] error:', err?.message, err?.stack);
    res.status(500).json({ error: 'Failed to commit import' });
  }
});

// GET /api/fleet/fuel/export.csv — CSV export (optionally filtered by vehicle)
router.get('/fuel/export.csv', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicleId = req.query.vehicle_id ? Number(req.query.vehicle_id) : null;
    const from = typeof req.query.from === 'string' ? req.query.from : null;
    const to = typeof req.query.to === 'string' ? req.query.to : null;

    let sql = `
      SELECT fl.*, fv.vehicle_number, fv.plate, fv.make, fv.model, fv.year, u.username AS created_by_username
      FROM fleet_fuel_logs fl
      LEFT JOIN fleet_vehicles fv ON fv.id = fl.vehicle_id
      LEFT JOIN users u ON u.id = fl.created_by
      WHERE 1=1
    `;
    const args: any[] = [];
    if (vehicleId) { sql += ' AND fl.vehicle_id = ?'; args.push(vehicleId); }
    if (from) { sql += ' AND fl.fuel_date >= ?'; args.push(from); }
    if (to)   { sql += ' AND fl.fuel_date <= ?'; args.push(to); }
    sql += ' ORDER BY fl.fuel_date DESC, fl.id DESC';
    const logs = db.prepare(sql).all(...args) as any[];

    const csvEscape = (v: any): string => {
      if (v == null) return '';
      const s = String(v);
      if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const cols = [
      'id', 'vehicle_number', 'plate', 'vehicle', 'fuel_date', 'gallons',
      'cost_per_gallon', 'total_cost', 'odometer_reading', 'fuel_type',
      'station', 'notes', 'source', 'flags', 'created_by', 'created_at',
    ];
    const lines = [cols.join(',')];
    for (const l of logs) {
      const vehicle = [l.year, l.make, l.model].filter(Boolean).join(' ');
      lines.push([
        l.id, l.vehicle_number, l.plate, vehicle, l.fuel_date, l.gallons,
        l.cost_per_gallon, l.total_cost, l.odometer_reading, l.fuel_type,
        l.station, l.notes, l.source || 'manual',
        l.flags ? JSON.parse(l.flags).join('; ') : '',
        l.created_by_username, l.created_at,
      ].map(csvEscape).join(','));
    }

    const filename = vehicleId
      ? `fuel-logs-vehicle-${vehicleId}-${localToday()}.csv`
      : `fuel-logs-${localToday()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + lines.join('\n')); // BOM so Excel recognises UTF-8
  } catch (err: any) {
    console.error('[fuel export] error:', err?.message);
    res.status(500).json({ error: 'Failed to export fuel logs' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Fuel v2 (2026-04-14 expansion): budgets, per-officer analytics,
// per-card spend, and a fleet-wide aggregate for the analytics page.
//
// Each endpoint is independently authenticated but the router-level
// authenticateToken middleware (applied in index.ts) has already run;
// we only opt into role checks via requireRole() for writes.
// ═══════════════════════════════════════════════════════════════════

// ─── Period helpers for the budget forecast ──────────────────────
// Given a period type, returns { start, end, days_elapsed, days_total }
// with the convention that `end` is exclusive (first moment of the next
// period) so `fuel_date < end` catches everything in the period. All
// dates are strings in local-time format (YYYY-MM-DD), matching what
// the server writes to fuel_date.
function currentPeriodBounds(period: 'monthly' | 'quarterly' | 'annual', asOfIso?: string) {
  const now = asOfIso ? new Date(asOfIso) : new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-11
  let startDate: Date;
  let endDate: Date;
  if (period === 'monthly') {
    startDate = new Date(y, m, 1);
    endDate = new Date(y, m + 1, 1);
  } else if (period === 'quarterly') {
    const qStart = Math.floor(m / 3) * 3;
    startDate = new Date(y, qStart, 1);
    endDate = new Date(y, qStart + 3, 1);
  } else {
    startDate = new Date(y, 0, 1);
    endDate = new Date(y + 1, 0, 1);
  }
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const msPerDay = 86400_000;
  const daysTotal = Math.round((endDate.getTime() - startDate.getTime()) / msPerDay);
  const daysElapsed = Math.max(1, Math.min(daysTotal, Math.ceil((now.getTime() - startDate.getTime()) / msPerDay)));
  return { start: iso(startDate), end: iso(endDate), days_total: daysTotal, days_elapsed: daysElapsed };
}

// ── Budget CRUD ──────────────────────────────────────────────────

// GET /api/fleet/fuel/budgets — list all budgets (optionally filtered)
router.get('/fuel/budgets', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { vehicle_id, scope } = req.query;
    let sql = `
      SELECT b.*, fv.vehicle_number, fv.make, fv.model, fv.year
      FROM fleet_fuel_budgets b
      LEFT JOIN fleet_vehicles fv ON fv.id = b.vehicle_id
      WHERE 1=1
    `;
    const args: any[] = [];
    if (vehicle_id) { sql += ' AND b.vehicle_id = ?'; args.push(Number(vehicle_id)); }
    if (scope === 'fleet') { sql += ' AND b.vehicle_id IS NULL'; }
    if (scope === 'vehicle') { sql += ' AND b.vehicle_id IS NOT NULL'; }
    sql += ' ORDER BY b.effective_from DESC, b.id DESC';
    const rows = db.prepare(sql).all(...args);
    res.json({ data: rows });
  } catch (err: any) {
    console.error('[fuel budgets list] error:', err?.message);
    res.status(500).json({ error: 'Failed to list budgets' });
  }
});

// POST /api/fleet/fuel/budgets — create a new budget
router.post('/fuel/budgets', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { vehicle_id, period_type, budget_amount, alert_threshold_pct, effective_from, effective_to, notes } = req.body;
    if (!period_type || !['monthly', 'quarterly', 'annual'].includes(period_type)) {
      res.status(400).json({ error: 'period_type must be monthly/quarterly/annual' });
      return;
    }
    const amount = Number(budget_amount);
    if (!isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'budget_amount must be positive' });
      return;
    }
    const threshold = alert_threshold_pct != null ? Number(alert_threshold_pct) : 80;
    if (!isFinite(threshold) || threshold < 0 || threshold > 100) {
      res.status(400).json({ error: 'alert_threshold_pct must be 0..100' });
      return;
    }
    const result = db.prepare(`
      INSERT INTO fleet_fuel_budgets (
        vehicle_id, period_type, budget_amount, alert_threshold_pct,
        effective_from, effective_to, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vehicle_id || null,
      period_type,
      amount,
      threshold,
      effective_from || localToday(),
      effective_to || null,
      notes ?? null,
      req.user!.userId,
    );
    const created = db.prepare('SELECT * FROM fleet_fuel_budgets WHERE id = ?').get(result.lastInsertRowid);
    auditLog(req, 'fleet_fuel_budget_created', 'fleet_fuel_budget', Number(result.lastInsertRowid),
      `Created ${period_type} fuel budget $${amount} for ${vehicle_id ? `vehicle ${vehicle_id}` : 'fleet'}`);
    res.status(201).json(created);
  } catch (err: any) {
    console.error('[fuel budgets create] error:', err?.message);
    res.status(500).json({ error: 'Failed to create budget' });
  }
});

// PUT /api/fleet/fuel/budgets/:id — update fields
router.put('/fuel/budgets/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM fleet_fuel_budgets WHERE id = ?').get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'Budget not found' }); return; }
    const map: Record<string, (v: any) => any> = {
      period_type: v => v ?? null,
      budget_amount: v => v != null ? Number(v) : null,
      alert_threshold_pct: v => v != null ? Number(v) : null,
      effective_from: v => v ?? null,
      effective_to: v => v ?? null,
      notes: v => v ?? null,
      vehicle_id: v => v ?? null,
    };
    const sets: string[] = [];
    const vals: any[] = [];
    for (const [k, t] of Object.entries(map)) {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) {
        sets.push(`${k} = ?`); vals.push(t(req.body[k]));
      }
    }
    if (sets.length > 0) {
      sets.push("updated_at = datetime('now','localtime')");
      vals.push(req.params.id);
      db.prepare(`UPDATE fleet_fuel_budgets SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
    const updated = db.prepare('SELECT * FROM fleet_fuel_budgets WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err: any) {
    console.error('[fuel budgets update] error:', err?.message);
    res.status(500).json({ error: 'Failed to update budget' });
  }
});

// DELETE /api/fleet/fuel/budgets/:id
router.delete('/fuel/budgets/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM fleet_fuel_budgets WHERE id = ?').get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'Budget not found' }); return; }
    db.prepare('DELETE FROM fleet_fuel_budgets WHERE id = ?').run(req.params.id);
    auditLog(req, 'fleet_fuel_budget_deleted', 'fleet_fuel_budget', Number(req.params.id),
      `Deleted ${existing.period_type} fuel budget`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[fuel budgets delete] error:', err?.message);
    res.status(500).json({ error: 'Failed to delete budget' });
  }
});

// GET /api/fleet/fuel/budgets/summary — budget with current spend + forecast
// Query params:
//   vehicle_id  (optional) — when provided, uses the best-match vehicle
//                            budget; when omitted, uses the fleet-level
//                            budget (vehicle_id IS NULL on the row)
//   as_of       (optional) — ISO date to evaluate against, defaults to now
//
// Response includes: budget, current-period spend, projected end-of-period
// spend (linear burn-rate extrapolation), variance %, and a status flag
// suitable for UI colouring (on_track / watch / warning / over).
router.get('/fuel/budgets/summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicleId = req.query.vehicle_id ? Number(req.query.vehicle_id) : null;
    const asOf = typeof req.query.as_of === 'string' ? req.query.as_of : undefined;
    const today = asOf || new Date().toISOString().slice(0, 10);

    // Select the best-match budget: one matching vehicle_id (or NULL for
    // fleet), effective on `today`, preferring the most-recently-started.
    const budget = db.prepare(`
      SELECT * FROM fleet_fuel_budgets
      WHERE (${vehicleId ? 'vehicle_id = ?' : 'vehicle_id IS NULL'})
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY effective_from DESC LIMIT 1
    `).get(...(vehicleId ? [vehicleId, today, today] : [today, today])) as any;

    if (!budget) {
      res.json({
        has_budget: false,
        vehicle_id: vehicleId,
        message: 'No active budget for this scope',
      });
      return;
    }

    const bounds = currentPeriodBounds(budget.period_type, asOf);
    const spendSql = `
      SELECT COALESCE(SUM(total_cost), 0) AS total
      FROM fleet_fuel_logs
      WHERE total_cost IS NOT NULL
        AND fuel_date >= ? AND fuel_date < ?
        ${vehicleId ? 'AND vehicle_id = ?' : ''}
    `;
    const spendArgs = vehicleId ? [bounds.start, bounds.end, vehicleId] : [bounds.start, bounds.end];
    const spendRow = db.prepare(spendSql).get(...spendArgs) as any;
    const spent = Number(spendRow.total) || 0;

    const pctSpent = Math.round((spent / budget.budget_amount) * 1000) / 10; // 1 decimal
    const dailyRate = spent / bounds.days_elapsed;
    const forecast = Math.round(dailyRate * bounds.days_total * 100) / 100;
    const variancePct = Math.round((forecast / budget.budget_amount - 1) * 1000) / 10;

    let status: 'on_track' | 'watch' | 'warning' | 'over';
    if (pctSpent >= 100) status = 'over';
    else if (pctSpent >= budget.alert_threshold_pct || variancePct >= 10) status = 'warning';
    else if (variancePct >= -5) status = 'watch';
    else status = 'on_track';

    res.json({
      has_budget: true,
      budget,
      vehicle_id: vehicleId,
      period: {
        type: budget.period_type,
        start: bounds.start,
        end: bounds.end,
        days_total: bounds.days_total,
        days_elapsed: bounds.days_elapsed,
        days_remaining: Math.max(0, bounds.days_total - bounds.days_elapsed),
      },
      spend: {
        actual: Math.round(spent * 100) / 100,
        pct_of_budget: pctSpent,
        daily_rate: Math.round(dailyRate * 100) / 100,
        forecast,
        variance_pct: variancePct,
      },
      status,
    });
  } catch (err: any) {
    console.error('[fuel budgets summary] error:', err?.message);
    res.status(500).json({ error: 'Failed to compute budget summary' });
  }
});

// ── Per-officer analytics ───────────────────────────────────────

// GET /api/fleet/fuel/analytics/by-officer — aggregate fuel behaviour
// per driver officer. Rows with NULL driver_officer_id are bucketed
// under "(unassigned)" so they're visible in the dashboard.
router.get('/fuel/analytics/by-officer', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const since = typeof req.query.since === 'string' ? req.query.since : null;
    const sql = `
      SELECT
        fl.driver_officer_id                         AS officer_id,
        u.username                                   AS username,
        u.full_name                                  AS full_name,
        COUNT(*)                                     AS fill_count,
        SUM(fl.gallons)                              AS total_gallons,
        SUM(fl.total_cost)                           AS total_cost,
        AVG(fl.cost_per_gallon)                      AS avg_cpg,
        SUM(CASE WHEN fl.flags IS NOT NULL THEN 1 ELSE 0 END) AS flag_count
      FROM fleet_fuel_logs fl
      LEFT JOIN users u ON u.id = fl.driver_officer_id
      WHERE 1=1
        ${since ? 'AND fl.fuel_date >= ?' : ''}
      GROUP BY fl.driver_officer_id
      ORDER BY total_cost DESC NULLS LAST
    `;
    const rows = (since ? db.prepare(sql).all(since) : db.prepare(sql).all()) as any[];
    // Compute running avg MPG per officer via the same distance-between-
    // fills approach the per-vehicle view uses, scoped to each officer.
    // Done in JS rather than SQL because SQLite lacks window-lag for this
    // without extra complexity.
    const allLogs = db.prepare(`
      SELECT driver_officer_id, vehicle_id, fuel_date, gallons, odometer_reading
      FROM fleet_fuel_logs
      WHERE driver_officer_id IS NOT NULL
        AND odometer_reading IS NOT NULL
        ${since ? 'AND fuel_date >= ?' : ''}
      ORDER BY driver_officer_id, vehicle_id, fuel_date ASC
    `).all(...(since ? [since] : [])) as any[];
    const mpgAgg: Record<string, { miles: number; gal: number }> = {};
    const prev: Record<string, { odo: number }> = {};
    for (const l of allLogs) {
      const key = `${l.driver_officer_id}:${l.vehicle_id}`;
      const p = prev[key];
      if (p && l.odometer_reading > p.odo) {
        const dist = l.odometer_reading - p.odo;
        const officerKey = String(l.driver_officer_id);
        if (!mpgAgg[officerKey]) mpgAgg[officerKey] = { miles: 0, gal: 0 };
        mpgAgg[officerKey].miles += dist;
        mpgAgg[officerKey].gal += l.gallons;
      }
      prev[key] = { odo: l.odometer_reading };
    }
    const enriched = rows.map(r => {
      const key = r.officer_id != null ? String(r.officer_id) : null;
      const agg = key ? mpgAgg[key] : null;
      const avgMpg = agg && agg.gal > 0 ? Math.round((agg.miles / agg.gal) * 10) / 10 : null;
      return {
        ...r,
        display_name: r.full_name || r.username || (r.officer_id == null ? '(unassigned)' : `officer-${r.officer_id}`),
        avg_mpg: avgMpg,
        avg_cpg: r.avg_cpg != null ? Math.round(r.avg_cpg * 1000) / 1000 : null,
        total_cost: r.total_cost != null ? Math.round(r.total_cost * 100) / 100 : 0,
        total_gallons: r.total_gallons != null ? Math.round(r.total_gallons * 1000) / 1000 : 0,
        flag_rate: r.fill_count > 0 ? Math.round((r.flag_count / r.fill_count) * 1000) / 10 : 0,
      };
    });
    res.json({ data: enriched });
  } catch (err: any) {
    console.error('[fuel analytics by-officer] error:', err?.message, err?.stack);
    res.status(500).json({ error: 'Failed to compute per-officer analytics' });
  }
});

// ── Per-card spend ──────────────────────────────────────────────

// GET /api/fleet/fuel/analytics/by-card — current-month spend per fuel
// card with over-limit / near-limit flags. Cards with no fills still
// appear so the dashboard shows their zero spend against the limit.
router.get('/fuel/analytics/by-card', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const period = (req.query.period as string) === 'quarterly' ? 'quarterly'
                 : (req.query.period as string) === 'annual' ? 'annual'
                 : 'monthly';
    const bounds = currentPeriodBounds(period as any);
    const rows = db.prepare(`
      SELECT
        fc.id                    AS card_id,
        fc.card_number           AS card_number,
        fc.provider              AS provider,
        fc.status                AS status,
        fc.monthly_limit         AS monthly_limit,
        fc.vehicle_id            AS vehicle_id,
        fv.vehicle_number        AS vehicle_number,
        fv.make                  AS vehicle_make,
        fv.model                 AS vehicle_model,
        COALESCE(s.spent, 0)     AS spent,
        COALESCE(s.fill_count, 0) AS fill_count
      FROM fleet_fuel_cards fc
      LEFT JOIN fleet_vehicles fv ON fv.id = fc.vehicle_id
      LEFT JOIN (
        SELECT fuel_card_id, SUM(total_cost) AS spent, COUNT(*) AS fill_count
        FROM fleet_fuel_logs
        WHERE fuel_date >= ? AND fuel_date < ?
          AND fuel_card_id IS NOT NULL
        GROUP BY fuel_card_id
      ) s ON s.fuel_card_id = fc.id
      ORDER BY s.spent DESC NULLS LAST, fc.card_number
    `).all(bounds.start, bounds.end) as any[];

    const enriched = rows.map(r => {
      const limit = Number(r.monthly_limit) || 0;
      const pct = limit > 0 ? Math.round((r.spent / limit) * 1000) / 10 : null;
      let cardStatus: 'ok' | 'watch' | 'over' | 'unlimited';
      if (!limit) cardStatus = 'unlimited';
      else if (pct! >= 100) cardStatus = 'over';
      else if (pct! >= 80) cardStatus = 'watch';
      else cardStatus = 'ok';
      return { ...r, spent: Math.round(r.spent * 100) / 100, pct_of_limit: pct, spend_status: cardStatus };
    });

    res.json({ period, bounds, data: enriched });
  } catch (err: any) {
    console.error('[fuel analytics by-card] error:', err?.message, err?.stack);
    res.status(500).json({ error: 'Failed to compute per-card analytics' });
  }
});

// ── Fleet-wide analytics aggregate ──────────────────────────────

// GET /api/fleet/fuel/analytics/yoy-trend — year-over-year monthly comparison
//
// Returns two parallel arrays: current year and prior year, each with
// per-month totals (cost, gallons, fills). The client overlays the
// prior-year data as ghost bars on the existing trend chart when the
// user toggles "vs Last Year".
router.get('/fuel/analytics/yoy-trend', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = new Date();
    const y = now.getFullYear();
    const currentYearStart = `${y}-01-01`;
    const priorYearStart   = `${y - 1}-01-01`;
    const priorYearEnd     = `${y - 1}-12-31`;

    const monthlyQuery = `
      SELECT strftime('%m', fuel_date) AS month,
             SUM(total_cost) AS cost,
             SUM(gallons) AS gallons,
             COUNT(*) AS fills
      FROM fleet_fuel_logs
      WHERE fuel_date >= ? AND fuel_date <= ? AND total_cost IS NOT NULL
      GROUP BY month ORDER BY month
    `;
    const current = db.prepare(monthlyQuery).all(currentYearStart, now.toISOString().slice(0, 10)) as any[];
    const prior   = db.prepare(monthlyQuery).all(priorYearStart, priorYearEnd) as any[];

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const fmt = (rows: any[]) => rows.map(r => ({
      month: r.month,
      cost: round2(Number(r.cost) || 0),
      gallons: round2(Number(r.gallons) || 0),
      fills: Number(r.fills) || 0,
    }));

    const sumCost = (rows: any[]) => rows.reduce((s, r) => s + (Number(r.cost) || 0), 0);
    const sumGal  = (rows: any[]) => rows.reduce((s, r) => s + (Number(r.gallons) || 0), 0);
    const curCost = sumCost(current);
    const priCost = sumCost(prior);
    const curGal  = sumGal(current);
    const priGal  = sumGal(prior);

    res.json({
      current_year: { year: y, months: fmt(current) },
      prior_year:   { year: y - 1, months: fmt(prior) },
      yoy_delta: {
        cost_pct:    priCost > 0 ? round2(((curCost - priCost) / priCost) * 100) : null,
        gallons_pct: priGal > 0  ? round2(((curGal - priGal) / priGal) * 100)    : null,
      },
    });
  } catch (err: any) {
    console.error('[fuel yoy-trend] error:', err?.message);
    res.status(500).json({ error: 'Failed to compute YoY trend' });
  }
});

// GET /api/fleet/cost-analytics/yoy-trend — year-over-year for total costs
// (fuel + maintenance + accessories + utilities — the time-stamped streams)
router.get('/cost-analytics/yoy-trend', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = new Date();
    const y = now.getFullYear();
    const currentYearStart = `${y}-01-01`;
    const priorYearStart   = `${y - 1}-01-01`;
    const priorYearEnd     = `${y - 1}-12-31`;

    const monthlyQuery = `
      SELECT month, SUM(cost) AS cost FROM (
        SELECT strftime('%m', fuel_date) AS month, SUM(total_cost) AS cost FROM fleet_fuel_logs
          WHERE fuel_date >= ? AND fuel_date <= ? AND total_cost IS NOT NULL GROUP BY month
        UNION ALL
        SELECT strftime('%m', performed_at) AS month, SUM(cost) AS cost FROM fleet_maintenance
          WHERE performed_at >= ? AND performed_at <= ? AND cost IS NOT NULL GROUP BY month
        UNION ALL
        SELECT strftime('%m', installed_date) AS month, SUM(cost) AS cost FROM fleet_accessories
          WHERE installed_date >= ? AND installed_date <= ? AND archived_at IS NULL GROUP BY month
        UNION ALL
        SELECT strftime('%m', period_start) AS month, SUM(cost_amount) AS cost FROM fleet_utility_costs
          WHERE period_start >= ? AND period_start <= ? AND archived_at IS NULL GROUP BY month
      )
      WHERE month IS NOT NULL
      GROUP BY month ORDER BY month
    `;
    const current = db.prepare(monthlyQuery).all(
      currentYearStart, now.toISOString().slice(0, 10),
      currentYearStart, now.toISOString().slice(0, 10),
      currentYearStart, now.toISOString().slice(0, 10),
      currentYearStart, now.toISOString().slice(0, 10),
    ) as any[];
    const prior = db.prepare(monthlyQuery).all(
      priorYearStart, priorYearEnd,
      priorYearStart, priorYearEnd,
      priorYearStart, priorYearEnd,
      priorYearStart, priorYearEnd,
    ) as any[];

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const fmt = (rows: any[]) => rows.map(r => ({ month: r.month, cost: round2(Number(r.cost) || 0) }));
    const sum = (rows: any[]) => rows.reduce((s, r) => s + (Number(r.cost) || 0), 0);
    const curTotal = sum(current);
    const priTotal = sum(prior);

    res.json({
      current_year: { year: y, months: fmt(current) },
      prior_year:   { year: y - 1, months: fmt(prior) },
      yoy_delta: {
        cost_pct: priTotal > 0 ? round2(((curTotal - priTotal) / priTotal) * 100) : null,
      },
    });
  } catch (err: any) {
    console.error('[cost yoy-trend] error:', err?.message);
    res.status(500).json({ error: 'Failed to compute cost YoY trend' });
  }
});

// GET /api/fleet/fuel/gauges — per-vehicle fuel-level estimates
//
// Returns a compact row per vehicle with enough data to render a tank-
// level gauge on the Fleet grid without an N+1 per-vehicle fetch.
//
// Estimation math:
//   last_fill_gallons       = gallons on the most recent fuel_logs row
//   tank_capacity           = vehicle.tank_capacity (NULL → client falls back)
//   days_since_fill         = days between last fill and today
//   avg_daily_gallons       = 90-day total gallons / 90 (empty → null)
//   estimated_burned        = avg_daily_gallons * days_since_fill
//   estimated_current_gal   = max(0, last_fill_gallons - estimated_burned)
//                             clamped to 0..tank_capacity
//   estimated_pct           = estimated_current_gal / tank_capacity
//   days_remaining          = estimated_current_gal / avg_daily_gallons
//   status                  = 'critical' if days_remaining < 1
//                             'low'      if days_remaining < 3
//                             'ok'       otherwise
//                             'unknown'  when we can't compute
//
// Notes:
//   - We treat the last fill as "topped off to last_fill_gallons" only for
//     the starting-point estimate. This is intentionally conservative —
//     the real current level is bounded above by tank_capacity, so we
//     clamp. Over multi-fill periods the estimate naturally resets at
//     each fill because we always use the LATEST last_fill row.
//   - A vehicle with no fills ever returns status='unknown' and no numbers.
router.get('/fuel/gauges', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicles = db.prepare(`
      SELECT id, vehicle_number, tank_capacity
      FROM fleet_vehicles
      WHERE archived_at IS NULL
    `).all() as any[];

    const lastFillStmt = db.prepare(`
      SELECT fuel_date, gallons
      FROM fleet_fuel_logs
      WHERE vehicle_id = ?
      ORDER BY fuel_date DESC, id DESC LIMIT 1
    `);
    const avgDailyStmt = db.prepare(`
      SELECT COALESCE(SUM(gallons), 0) AS total
      FROM fleet_fuel_logs
      WHERE vehicle_id = ? AND fuel_date >= date('now', '-90 days')
    `);

    const now = Date.now();
    const out = vehicles.map((v) => {
      const last = lastFillStmt.get(v.id) as any;
      if (!last) {
        return {
          vehicle_id: v.id,
          vehicle_number: v.vehicle_number,
          tank_capacity: v.tank_capacity ?? null,
          status: 'unknown' as const,
          last_fill_date: null,
          last_fill_gallons: null,
          days_since_fill: null,
          avg_daily_gallons: null,
          estimated_current_gallons: null,
          estimated_pct: null,
          days_remaining: null,
        };
      }

      const lastMs = new Date(last.fuel_date).getTime();
      const daysSince = Math.max(0, Math.floor((now - lastMs) / 86400_000));
      const agg = avgDailyStmt.get(v.id) as any;
      const totalLast90 = Number(agg?.total) || 0;
      const avgDaily = totalLast90 > 0 ? totalLast90 / 90 : null;

      const tank = Number(v.tank_capacity) || null;
      const lastGal = Number(last.gallons) || 0;
      let estimatedCurrent: number | null = null;
      let pct: number | null = null;
      let daysRemaining: number | null = null;
      let status: 'ok' | 'low' | 'critical' | 'unknown' = 'unknown';

      if (avgDaily != null) {
        estimatedCurrent = Math.max(0, lastGal - avgDaily * daysSince);
        if (tank) estimatedCurrent = Math.min(estimatedCurrent, tank);
        daysRemaining = avgDaily > 0 ? estimatedCurrent / avgDaily : null;
        if (tank && tank > 0) pct = Math.max(0, Math.min(1, estimatedCurrent / tank));

        if (daysRemaining == null) status = 'unknown';
        else if (daysRemaining < 1) status = 'critical';
        else if (daysRemaining < 3) status = 'low';
        else status = 'ok';
      }

      return {
        vehicle_id: v.id,
        vehicle_number: v.vehicle_number,
        tank_capacity: tank,
        status,
        last_fill_date: last.fuel_date,
        last_fill_gallons: Math.round(lastGal * 100) / 100,
        days_since_fill: daysSince,
        avg_daily_gallons: avgDaily != null ? Math.round(avgDaily * 1000) / 1000 : null,
        estimated_current_gallons: estimatedCurrent != null ? Math.round(estimatedCurrent * 100) / 100 : null,
        estimated_pct: pct != null ? Math.round(pct * 1000) / 10 : null, // 0..100, 1 decimal
        days_remaining: daysRemaining != null ? Math.round(daysRemaining * 10) / 10 : null,
      };
    });

    res.json({ data: out });
  } catch (err: any) {
    console.error('[fuel gauges] error:', err?.message, err?.stack);
    res.status(500).json({ error: 'Failed to compute fuel gauges' });
  }
});

// GET /api/fleet/fuel/analytics/overview — everything the analytics page
// needs in one call: totals, per-vehicle cost+MPG rankings, monthly trend,
// flagged-entry leaderboard, and top/bottom station frequency.
router.get('/fuel/analytics/overview', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(30, Math.min(365, parseInt(String(req.query.days || 90), 10) || 90));
    const sinceDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

    const totals = db.prepare(`
      SELECT COUNT(*) AS fill_count,
             COALESCE(SUM(gallons), 0) AS total_gallons,
             COALESCE(SUM(total_cost), 0) AS total_cost,
             AVG(cost_per_gallon) AS avg_cpg,
             SUM(CASE WHEN flags IS NOT NULL THEN 1 ELSE 0 END) AS flag_count
      FROM fleet_fuel_logs
      WHERE fuel_date >= ?
    `).get(sinceDate) as any;

    // Per-vehicle rankings — cost, gallons, computed MPG, and flag rate.
    const vehicleRows = db.prepare(`
      SELECT fv.id, fv.vehicle_number, fv.make, fv.model, fv.year, fv.avg_mpg,
             COALESCE(x.fills, 0) AS fill_count,
             COALESCE(x.cost, 0) AS total_cost,
             COALESCE(x.gallons, 0) AS total_gallons,
             COALESCE(x.flag_count, 0) AS flag_count
      FROM fleet_vehicles fv
      LEFT JOIN (
        SELECT vehicle_id,
               COUNT(*) AS fills,
               SUM(total_cost) AS cost,
               SUM(gallons) AS gallons,
               SUM(CASE WHEN flags IS NOT NULL THEN 1 ELSE 0 END) AS flag_count
        FROM fleet_fuel_logs
        WHERE fuel_date >= ?
        GROUP BY vehicle_id
      ) x ON x.vehicle_id = fv.id
      WHERE fv.archived_at IS NULL
      ORDER BY total_cost DESC
    `).all(sinceDate) as any[];

    // Monthly trend for the selected window — cost + gallons per month.
    const monthlyTrend = db.prepare(`
      SELECT strftime('%Y-%m', fuel_date) AS month,
             SUM(total_cost) AS cost,
             SUM(gallons) AS gallons,
             COUNT(*) AS fills
      FROM fleet_fuel_logs
      WHERE fuel_date >= ?
      GROUP BY month
      ORDER BY month
    `).all(sinceDate) as any[];

    // Top 10 stations by fill count + total spent.
    const topStations = db.prepare(`
      SELECT COALESCE(NULLIF(TRIM(station), ''), '(unknown)') AS station,
             COUNT(*) AS fill_count,
             SUM(total_cost) AS total_spent,
             AVG(cost_per_gallon) AS avg_cpg
      FROM fleet_fuel_logs
      WHERE fuel_date >= ?
      GROUP BY station
      ORDER BY fill_count DESC
      LIMIT 10
    `).all(sinceDate) as any[];

    // Flagged-entry leaderboard — which vehicles accrue the most flags.
    const flaggedLeaderboard = db.prepare(`
      SELECT fv.id, fv.vehicle_number, fv.make, fv.model,
             COUNT(*) AS flagged_count
      FROM fleet_fuel_logs fl
      JOIN fleet_vehicles fv ON fv.id = fl.vehicle_id
      WHERE fl.flags IS NOT NULL AND fl.fuel_date >= ?
      GROUP BY fv.id
      ORDER BY flagged_count DESC
      LIMIT 10
    `).all(sinceDate) as any[];

    res.json({
      since: sinceDate,
      days,
      totals: {
        fill_count: Number(totals.fill_count) || 0,
        total_gallons: Math.round((Number(totals.total_gallons) || 0) * 1000) / 1000,
        total_cost: Math.round((Number(totals.total_cost) || 0) * 100) / 100,
        avg_cpg: totals.avg_cpg != null ? Math.round(totals.avg_cpg * 1000) / 1000 : null,
        flag_count: Number(totals.flag_count) || 0,
        flag_rate: totals.fill_count > 0 ? Math.round((Number(totals.flag_count) / Number(totals.fill_count)) * 1000) / 10 : 0,
      },
      vehicles: vehicleRows.map((v: any) => ({
        ...v,
        total_cost: Math.round((Number(v.total_cost) || 0) * 100) / 100,
        total_gallons: Math.round((Number(v.total_gallons) || 0) * 1000) / 1000,
        flag_rate: v.fill_count > 0 ? Math.round((v.flag_count / v.fill_count) * 1000) / 10 : 0,
      })),
      monthly_trend: monthlyTrend,
      top_stations: topStations.map(s => ({
        station: s.station,
        fill_count: Number(s.fill_count),
        total_spent: Math.round((Number(s.total_spent) || 0) * 100) / 100,
        avg_cpg: s.avg_cpg != null ? Math.round(s.avg_cpg * 1000) / 1000 : null,
      })),
      flagged_leaderboard: flaggedLeaderboard,
    });
  } catch (err: any) {
    console.error('[fuel analytics overview] error:', err?.message, err?.stack);
    res.status(500).json({ error: 'Failed to compute fuel analytics overview' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Fleet operating-cost categories (2026-04-14):
//   - Loans (vehicle financing)
//   - Insurance policies
//   - Accessories (one-time installed equipment)
//   - Utility costs (recurring — electricity, storage, etc.)
//
// Each category has a uniform CRUD shape:
//   GET    /api/fleet/:id/<category>           — list for a vehicle
//   POST   /api/fleet/:id/<category>           — create
//   PUT    /api/fleet/<category>/:id           — update
//   DELETE /api/fleet/<category>/:id           — delete
//
// The factory function below registers all four routes for a single
// table, validating only the fields that table accepts. This keeps the
// wire format consistent and the routing table small.
// ═══════════════════════════════════════════════════════════════════
function registerCostCategoryRoutes(opts: {
  pathSegment: string;            // 'loans' | 'insurance' | 'accessories' | 'utilities'
  tableName: string;              // matching table in the DB
  vehicleScoped: boolean;         // true = vehicle_id required on insert
  requiredFields: string[];       // e.g. ['original_amount', 'monthly_payment']
  fieldMap: Record<string, (v: any) => any>;
  auditAction: string;            // 'fleet_loan_created', etc.
  entityType: string;             // 'fleet_loan', etc.
}) {
  // GET — list for a vehicle (or fleet-wide for utilities)
  router.get(`/:id/${opts.pathSegment}`, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const id = req.params.id;
      // For vehicleScoped tables we always filter by vehicle. For the
      // utilities table (vehicleScoped=false), the path-segment :id is
      // still the vehicle id but we additionally include any rows where
      // vehicle_id IS NULL (fleet-wide allocations).
      const sql = opts.vehicleScoped
        ? `SELECT * FROM ${opts.tableName} WHERE vehicle_id = ? AND archived_at IS NULL ORDER BY created_at DESC`
        : `SELECT * FROM ${opts.tableName} WHERE (vehicle_id = ? OR vehicle_id IS NULL) AND archived_at IS NULL ORDER BY created_at DESC`;
      const rows = db.prepare(sql).all(id);
      res.json({ data: rows });
    } catch (err: any) {
      console.error(`[fleet ${opts.pathSegment} list] error:`, err?.message);
      res.status(500).json({ error: `Failed to list ${opts.pathSegment}` });
    }
  });

  // POST — create
  router.post(`/:id/${opts.pathSegment}`, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const id = Number(req.params.id);
      const vehicle = db.prepare('SELECT id FROM fleet_vehicles WHERE id = ?').get(id) as any;
      if (!vehicle) { res.status(404).json({ error: 'Fleet vehicle not found' }); return; }

      // Required-field check up front — gives a clean 400 instead of an
      // SQL constraint failure deep in the engine.
      for (const f of opts.requiredFields) {
        if (req.body[f] == null || req.body[f] === '') {
          res.status(400).json({ error: `${f} is required` });
          return;
        }
      }

      const cols: string[] = ['vehicle_id', 'created_by'];
      const placeholders: string[] = ['?', '?'];
      const values: any[] = [id, req.user!.userId];
      for (const [k, t] of Object.entries(opts.fieldMap)) {
        if (Object.prototype.hasOwnProperty.call(req.body, k)) {
          cols.push(k); placeholders.push('?'); values.push(t(req.body[k]));
        }
      }

      const result = db.prepare(`INSERT INTO ${opts.tableName} (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`).run(...values);
      const created = db.prepare(`SELECT * FROM ${opts.tableName} WHERE id = ?`).get(result.lastInsertRowid);
      auditLog(req, opts.auditAction, opts.entityType, Number(result.lastInsertRowid),
        `Created ${opts.pathSegment.replace(/s$/, '')} for vehicle ${id}`);
      broadcastFleetUpdate({ action: 'cost_added', category: opts.pathSegment, vehicle_id: id, id: Number(result.lastInsertRowid) });
      res.status(201).json(created);
    } catch (err: any) {
      console.error(`[fleet ${opts.pathSegment} create] error:`, err?.message);
      res.status(500).json({ error: `Failed to create ${opts.pathSegment}` });
    }
  });

  // PUT — update
  router.put(`/${opts.pathSegment}/:id`, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare(`SELECT * FROM ${opts.tableName} WHERE id = ?`).get(req.params.id) as any;
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
      const sets: string[] = [];
      const vals: any[] = [];
      for (const [k, t] of Object.entries(opts.fieldMap)) {
        if (Object.prototype.hasOwnProperty.call(req.body, k)) {
          sets.push(`${k} = ?`); vals.push(t(req.body[k]));
        }
      }
      if (sets.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
      sets.push("updated_at = datetime('now','localtime')");
      vals.push(req.params.id);
      db.prepare(`UPDATE ${opts.tableName} SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      const updated = db.prepare(`SELECT * FROM ${opts.tableName} WHERE id = ?`).get(req.params.id);
      res.json(updated);
    } catch (err: any) {
      console.error(`[fleet ${opts.pathSegment} update] error:`, err?.message);
      res.status(500).json({ error: `Failed to update ${opts.pathSegment}` });
    }
  });

  // DELETE — soft-delete via archived_at (consistent with other fleet tables)
  router.delete(`/${opts.pathSegment}/:id`, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare(`SELECT * FROM ${opts.tableName} WHERE id = ?`).get(req.params.id) as any;
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
      db.prepare(`UPDATE ${opts.tableName} SET archived_at = datetime('now','localtime') WHERE id = ?`).run(req.params.id);
      auditLog(req, opts.auditAction.replace('_created', '_deleted'), opts.entityType, Number(req.params.id),
        `Archived ${opts.pathSegment.replace(/s$/, '')}`);
      res.json({ success: true });
    } catch (err: any) {
      console.error(`[fleet ${opts.pathSegment} delete] error:`, err?.message);
      res.status(500).json({ error: `Failed to delete ${opts.pathSegment}` });
    }
  });
}

registerCostCategoryRoutes({
  pathSegment: 'loans',
  tableName: 'fleet_loans',
  vehicleScoped: true,
  requiredFields: ['original_amount', 'monthly_payment', 'start_date'],
  fieldMap: {
    lender:           v => v ?? null,
    original_amount:  v => v != null ? Number(v) : null,
    current_balance:  v => v != null ? Number(v) : null,
    monthly_payment:  v => v != null ? Number(v) : null,
    interest_rate:    v => v != null ? Number(v) : null,
    term_months:      v => v != null ? parseInt(String(v), 10) : null,
    start_date:       v => v ?? null,
    payoff_date:      v => v ?? null,
    status:           v => v ?? null,
    notes:            v => v ?? null,
  },
  auditAction: 'fleet_loan_created',
  entityType: 'fleet_loan',
});

registerCostCategoryRoutes({
  pathSegment: 'insurance',
  tableName: 'fleet_insurance_policies',
  vehicleScoped: true,
  requiredFields: ['premium_amount', 'effective_from'],
  fieldMap: {
    carrier:           v => v ?? null,
    policy_number:     v => v ?? null,
    coverage_type:     v => v ?? null,
    premium_amount:    v => v != null ? Number(v) : null,
    premium_frequency: v => v ?? null,
    effective_from:    v => v ?? null,
    expires_at:        v => v ?? null,
    deductible:        v => v != null ? Number(v) : null,
    liability_limit:   v => v != null ? Number(v) : null,
    status:            v => v ?? null,
    notes:             v => v ?? null,
  },
  auditAction: 'fleet_insurance_created',
  entityType: 'fleet_insurance_policy',
});

registerCostCategoryRoutes({
  pathSegment: 'accessories',
  tableName: 'fleet_accessories',
  vehicleScoped: true,
  requiredFields: ['name', 'installed_date'],
  fieldMap: {
    name:           v => v ?? null,
    category:       v => v ?? null,
    installed_date: v => v ?? null,
    removed_date:   v => v ?? null,
    cost:           v => v != null ? Number(v) : 0,
    vendor:         v => v ?? null,
    warranty_until: v => v ?? null,
    serial_number:  v => v ?? null,
    status:         v => v ?? null,
    notes:          v => v ?? null,
  },
  auditAction: 'fleet_accessory_created',
  entityType: 'fleet_accessory',
});

registerCostCategoryRoutes({
  pathSegment: 'utilities',
  tableName: 'fleet_utility_costs',
  vehicleScoped: false,    // utilities can be fleet-wide (vehicle_id NULL)
  requiredFields: ['category', 'cost_amount', 'period_start'],
  fieldMap: {
    category:       v => v ?? null,
    provider:       v => v ?? null,
    cost_amount:    v => v != null ? Number(v) : null,
    cost_frequency: v => v ?? null,
    period_start:   v => v ?? null,
    period_end:     v => v ?? null,
    notes:          v => v ?? null,
  },
  auditAction: 'fleet_utility_created',
  entityType: 'fleet_utility_cost',
});

// GET /api/fleet/:id/cost-timeline — unified chronological cost ledger
//
// The six cost streams (fuel, maintenance, loans, insurance, accessories,
// utilities) don't live in one table — but operators want to see them as
// one linear sequence of money-out events. This endpoint unions them into
// a single sorted list with a common shape.
//
// Notes:
//   - Loan + insurance entries are SYNTHESISED from their monthly cadence:
//     we generate one ledger row per payment period (capped by today),
//     since neither table stores per-payment history. An optional future
//     fleet_loan_payments / fleet_insurance_payments ledger could replace
//     this synthesis with real transactions; the wire format here is
//     deliberately compatible with either source.
//   - Utilities are expanded to per-period rows too when cost_frequency
//     is monthly/quarterly/etc., so a "$100/month parking for 12 months"
//     row in the table becomes 12 ledger entries.
//   - Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD (both optional).
interface TimelineEntry {
  date: string;              // YYYY-MM-DD
  category: 'fuel' | 'maintenance' | 'loan' | 'insurance' | 'accessory' | 'utility';
  amount: number;
  description: string;
  reference_id: number | string;  // source row id
  synthetic: boolean;        // true = extrapolated from recurring config
}

router.get('/:id/cost-timeline', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const vehicle = db.prepare('SELECT id FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) { res.status(404).json({ error: 'Fleet vehicle not found' }); return; }

    const from = typeof req.query.from === 'string' ? req.query.from : null;
    const to   = typeof req.query.to   === 'string' ? req.query.to   : null;
    const dateFilter = (d: string) =>
      (!from || d >= from) && (!to || d <= to);

    const entries: TimelineEntry[] = [];

    // ── Fuel ───────────────────────────────────────────────────
    const fuelLogs = db.prepare(`
      SELECT id, fuel_date, gallons, total_cost, station
      FROM fleet_fuel_logs
      WHERE vehicle_id = ? AND total_cost IS NOT NULL
    `).all(id) as any[];
    for (const f of fuelLogs) {
      const date = String(f.fuel_date).slice(0, 10);
      if (!dateFilter(date)) continue;
      entries.push({
        date,
        category: 'fuel',
        amount: Number(f.total_cost) || 0,
        description: `${Number(f.gallons).toFixed(2)} gal${f.station ? ` at ${f.station}` : ''}`,
        reference_id: f.id,
        synthetic: false,
      });
    }

    // ── Maintenance ────────────────────────────────────────────
    // Column is `performed_at` (not service_date — that's a derived
    // alias on fleet_vehicles, not the maintenance table itself).
    const maint = db.prepare(`
      SELECT id, performed_at, type, description, cost
      FROM fleet_maintenance
      WHERE vehicle_id = ? AND cost IS NOT NULL
    `).all(id) as any[];
    for (const m of maint) {
      const date = String(m.performed_at).slice(0, 10);
      if (!dateFilter(date)) continue;
      entries.push({
        date,
        category: 'maintenance',
        amount: Number(m.cost) || 0,
        description: `${m.type || 'Service'}${m.description ? ` — ${m.description}` : ''}`,
        reference_id: m.id,
        synthetic: false,
      });
    }

    // ── Accessories (one-time) ─────────────────────────────────
    const accessories = db.prepare(`
      SELECT id, installed_date, name, cost
      FROM fleet_accessories
      WHERE vehicle_id = ? AND archived_at IS NULL AND cost > 0
    `).all(id) as any[];
    for (const a of accessories) {
      const date = String(a.installed_date).slice(0, 10);
      if (!dateFilter(date)) continue;
      entries.push({
        date,
        category: 'accessory',
        amount: Number(a.cost) || 0,
        description: `Installed: ${a.name}`,
        reference_id: a.id,
        synthetic: false,
      });
    }

    // ── Loans: synthesise one ledger row per month since start ─
    const loans = db.prepare(`
      SELECT id, lender, monthly_payment, start_date, term_months, payoff_date, status
      FROM fleet_loans
      WHERE vehicle_id = ? AND archived_at IS NULL
    `).all(id) as any[];
    const todayIso = new Date().toISOString().slice(0, 10);
    for (const l of loans) {
      const start = new Date(l.start_date);
      if (isNaN(start.getTime())) continue;
      const endCandidate = l.payoff_date
        ? new Date(l.payoff_date)
        : l.term_months
          ? new Date(start.getFullYear(), start.getMonth() + Number(l.term_months), start.getDate())
          : new Date();
      const end = endCandidate < new Date() ? endCandidate : new Date();
      // Walk month by month from start until end (inclusive on start-of-month).
      let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      while (cursor <= end) {
        const date = cursor.toISOString().slice(0, 10);
        if (date <= todayIso && dateFilter(date)) {
          entries.push({
            date,
            category: 'loan',
            amount: Number(l.monthly_payment) || 0,
            description: `Loan payment${l.lender ? ` · ${l.lender}` : ''}`,
            reference_id: `loan-${l.id}-${date}`,
            synthetic: true,
          });
        }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
      }
    }

    // ── Insurance: synthesise one ledger row per billing period ─
    const policies = db.prepare(`
      SELECT id, carrier, premium_amount, premium_frequency, effective_from, expires_at, status
      FROM fleet_insurance_policies
      WHERE vehicle_id = ? AND archived_at IS NULL
    `).all(id) as any[];
    const freqMonths: Record<string, number> = {
      monthly: 1, quarterly: 3, semi_annual: 6, annual: 12,
    };
    for (const p of policies) {
      const start = new Date(p.effective_from);
      if (isNaN(start.getTime())) continue;
      const endCandidate = p.expires_at ? new Date(p.expires_at) : new Date();
      const end = endCandidate < new Date() ? endCandidate : new Date();
      const step = freqMonths[p.premium_frequency] || 1;
      let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      while (cursor <= end) {
        const date = cursor.toISOString().slice(0, 10);
        if (date <= todayIso && dateFilter(date)) {
          entries.push({
            date,
            category: 'insurance',
            amount: Number(p.premium_amount) || 0,
            description: `Insurance premium${p.carrier ? ` · ${p.carrier}` : ''} (${p.premium_frequency.replace('_', '-')})`,
            reference_id: `insurance-${p.id}-${date}`,
            synthetic: true,
          });
        }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + step, cursor.getDate());
      }
    }

    // ── Utilities: one entry at period_start for one-time, or expanded
    //    per-period rows for recurring. Caps at today so we don't project
    //    future months.
    const utilities = db.prepare(`
      SELECT id, category, provider, cost_amount, cost_frequency, period_start, period_end
      FROM fleet_utility_costs
      WHERE (vehicle_id = ? OR vehicle_id IS NULL) AND archived_at IS NULL
    `).all(id) as any[];
    for (const u of utilities) {
      const start = new Date(u.period_start);
      if (isNaN(start.getTime())) continue;
      if (u.cost_frequency === 'one_time') {
        const date = String(u.period_start).slice(0, 10);
        if (dateFilter(date)) {
          entries.push({
            date,
            category: 'utility',
            amount: Number(u.cost_amount) || 0,
            description: `${u.category}${u.provider ? ` · ${u.provider}` : ''}`,
            reference_id: u.id,
            synthetic: false,
          });
        }
        continue;
      }
      const endCandidate = u.period_end ? new Date(u.period_end) : new Date();
      const end = endCandidate < new Date() ? endCandidate : new Date();
      const step = freqMonths[u.cost_frequency] || 1;
      let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      while (cursor <= end) {
        const date = cursor.toISOString().slice(0, 10);
        if (date <= todayIso && dateFilter(date)) {
          entries.push({
            date,
            category: 'utility',
            amount: Number(u.cost_amount) || 0,
            description: `${u.category}${u.provider ? ` · ${u.provider}` : ''} (${String(u.cost_frequency).replace('_', '-')})`,
            reference_id: `utility-${u.id}-${date}`,
            synthetic: true,
          });
        }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + step, cursor.getDate());
      }
    }

    // Sort chronologically, newest first. Ties broken by category order
    // so the same-day sequence reads consistently across pages.
    const categoryOrder: Record<TimelineEntry['category'], number> = {
      fuel: 0, maintenance: 1, loan: 2, insurance: 3, accessory: 4, utility: 5,
    };
    entries.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return categoryOrder[a.category] - categoryOrder[b.category];
    });

    // Running totals (computed oldest-first, then flipped back).
    const oldestFirst = [...entries].reverse();
    let running = 0;
    const runningByEntry: number[] = [];
    for (const e of oldestFirst) {
      running += e.amount;
      runningByEntry.push(running);
    }
    const runningMap = new Map<number, number>();
    oldestFirst.forEach((e, i) => runningMap.set(i, runningByEntry[i]));
    const totalAll = running;

    // Per-category totals (over the filtered window).
    const byCategory: Record<string, { count: number; amount: number }> = {};
    for (const e of entries) {
      if (!byCategory[e.category]) byCategory[e.category] = { count: 0, amount: 0 };
      byCategory[e.category].count += 1;
      byCategory[e.category].amount += e.amount;
    }
    for (const k of Object.keys(byCategory)) {
      byCategory[k].amount = Math.round(byCategory[k].amount * 100) / 100;
    }

    res.json({
      entries: entries.map(e => ({ ...e, amount: Math.round(e.amount * 100) / 100 })),
      total: Math.round(totalAll * 100) / 100,
      by_category: byCategory,
      range: { from, to, count: entries.length },
    });
  } catch (err: any) {
    console.error('[fleet cost-timeline] error:', err?.message, err?.stack);
    res.status(500).json({ error: 'Failed to build cost timeline' });
  }
});

// GET /api/fleet/cost-analytics/overview — fleet-wide TCO aggregate
//
// Sister to /fleet/fuel/analytics/overview but covers all six cost streams.
// Returns totals, per-vehicle rankings, category breakdown, and a monthly
// trend line — everything the Cost Analytics page needs in one call.
router.get('/cost-analytics/overview', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(30, Math.min(730, parseInt(String(req.query.days || 365), 10) || 365));
    const sinceDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

    // For fleet-wide totals we sum actual recorded amounts (fuel,
    // maintenance, accessories, utilities) plus extrapolated totals for
    // loans and insurance using the same rule the summary endpoint uses.
    const fuel = db.prepare(`
      SELECT COALESCE(SUM(total_cost), 0) AS total, COUNT(*) AS fills
      FROM fleet_fuel_logs WHERE fuel_date >= ? AND total_cost IS NOT NULL
    `).get(sinceDate) as any;
    const maint = db.prepare(`
      SELECT COALESCE(SUM(cost), 0) AS total, COUNT(*) AS events
      FROM fleet_maintenance WHERE performed_at >= ? AND cost IS NOT NULL
    `).get(sinceDate) as any;
    const accessories = db.prepare(`
      SELECT COALESCE(SUM(cost), 0) AS total, COUNT(*) AS events
      FROM fleet_accessories WHERE installed_date >= ? AND archived_at IS NULL
    `).get(sinceDate) as any;
    const utilities = db.prepare(`
      SELECT COALESCE(SUM(cost_amount), 0) AS total, COUNT(*) AS events
      FROM fleet_utility_costs WHERE period_start >= ? AND archived_at IS NULL
    `).get(sinceDate) as any;

    // Loans + insurance: extrapolate over the window using monthly cadence.
    const windowMonths = days / 30.44;
    const activeLoans = db.prepare(`
      SELECT vehicle_id, monthly_payment, start_date, term_months, status
      FROM fleet_loans WHERE archived_at IS NULL
    `).all() as any[];
    let loanTotal = 0;
    for (const l of activeLoans) {
      const start = new Date(l.start_date);
      const monthsElapsed = Math.max(0, (Date.now() - start.getTime()) / (30.44 * 86400_000));
      const cappedMonths = l.term_months ? Math.min(l.term_months, monthsElapsed) : monthsElapsed;
      const monthsInWindow = Math.min(cappedMonths, windowMonths);
      loanTotal += (Number(l.monthly_payment) || 0) * monthsInWindow;
    }
    const policies = db.prepare(`
      SELECT premium_amount, premium_frequency FROM fleet_insurance_policies
      WHERE archived_at IS NULL
    `).all() as any[];
    const freqPerYear: Record<string, number> = { monthly: 12, quarterly: 4, semi_annual: 2, annual: 1 };
    let insuranceTotal = 0;
    for (const p of policies) {
      const annual = (Number(p.premium_amount) || 0) * (freqPerYear[p.premium_frequency] || 12);
      insuranceTotal += annual * (days / 365.25);
    }

    // Per-vehicle TCO ranking — fuel + maintenance + accessories tallied
    // from actuals, loans + insurance from extrapolation at vehicle scope.
    const vehicleRows = db.prepare(`
      SELECT fv.id, fv.vehicle_number, fv.make, fv.model, fv.year, fv.current_mileage,
        COALESCE(f.cost, 0) AS fuel_cost,
        COALESCE(m.cost, 0) AS maint_cost,
        COALESCE(a.cost, 0) AS accessory_cost,
        COALESCE(u.cost, 0) AS utility_cost
      FROM fleet_vehicles fv
      LEFT JOIN (SELECT vehicle_id, SUM(total_cost) AS cost FROM fleet_fuel_logs WHERE fuel_date >= ? AND total_cost IS NOT NULL GROUP BY vehicle_id) f ON f.vehicle_id = fv.id
      LEFT JOIN (SELECT vehicle_id, SUM(cost) AS cost FROM fleet_maintenance WHERE performed_at >= ? AND cost IS NOT NULL GROUP BY vehicle_id) m ON m.vehicle_id = fv.id
      LEFT JOIN (SELECT vehicle_id, SUM(cost) AS cost FROM fleet_accessories WHERE installed_date >= ? AND archived_at IS NULL GROUP BY vehicle_id) a ON a.vehicle_id = fv.id
      LEFT JOIN (SELECT vehicle_id, SUM(cost_amount) AS cost FROM fleet_utility_costs WHERE period_start >= ? AND archived_at IS NULL GROUP BY vehicle_id) u ON u.vehicle_id = fv.id
      WHERE fv.archived_at IS NULL
    `).all(sinceDate, sinceDate, sinceDate, sinceDate) as any[];

    // Attribute loan + insurance totals per vehicle (extrapolated).
    const vehicleCosts = new Map<number, { loan: number; insurance: number }>();
    for (const l of activeLoans) {
      const start = new Date(l.start_date);
      const monthsElapsed = Math.max(0, (Date.now() - start.getTime()) / (30.44 * 86400_000));
      const cappedMonths = l.term_months ? Math.min(l.term_months, monthsElapsed) : monthsElapsed;
      const monthsInWindow = Math.min(cappedMonths, windowMonths);
      const paid = (Number(l.monthly_payment) || 0) * monthsInWindow;
      const entry = vehicleCosts.get(l.vehicle_id) || { loan: 0, insurance: 0 };
      entry.loan += paid;
      vehicleCosts.set(l.vehicle_id, entry);
    }
    const vehiclePolicies = db.prepare(`
      SELECT vehicle_id, premium_amount, premium_frequency
      FROM fleet_insurance_policies WHERE archived_at IS NULL
    `).all() as any[];
    for (const p of vehiclePolicies) {
      const annual = (Number(p.premium_amount) || 0) * (freqPerYear[p.premium_frequency] || 12);
      const paid = annual * (days / 365.25);
      const entry = vehicleCosts.get(p.vehicle_id) || { loan: 0, insurance: 0 };
      entry.insurance += paid;
      vehicleCosts.set(p.vehicle_id, entry);
    }

    const vehicles = vehicleRows.map(v => {
      const extra = vehicleCosts.get(v.id) || { loan: 0, insurance: 0 };
      const total = (Number(v.fuel_cost) || 0) + (Number(v.maint_cost) || 0)
        + (Number(v.accessory_cost) || 0) + (Number(v.utility_cost) || 0)
        + extra.loan + extra.insurance;
      return {
        id: v.id,
        vehicle_number: v.vehicle_number,
        make: v.make, model: v.model, year: v.year,
        current_mileage: v.current_mileage,
        fuel_cost: Math.round((Number(v.fuel_cost) || 0) * 100) / 100,
        maint_cost: Math.round((Number(v.maint_cost) || 0) * 100) / 100,
        loan_cost: Math.round(extra.loan * 100) / 100,
        insurance_cost: Math.round(extra.insurance * 100) / 100,
        accessory_cost: Math.round((Number(v.accessory_cost) || 0) * 100) / 100,
        utility_cost: Math.round((Number(v.utility_cost) || 0) * 100) / 100,
        total: Math.round(total * 100) / 100,
        cost_per_mile: v.current_mileage > 0 ? Math.round((total / v.current_mileage) * 1000) / 1000 : null,
      };
    }).sort((a, b) => b.total - a.total);

    // Monthly trend (fuel + maintenance + accessories + utilities — the
    // ones with a real date). Loans/insurance are smooth-line monthlies
    // so adding them would flatten the trend, not illuminate it.
    const monthlyTrend = db.prepare(`
      SELECT month, SUM(cost) AS cost FROM (
        SELECT strftime('%Y-%m', fuel_date) AS month, SUM(total_cost) AS cost FROM fleet_fuel_logs WHERE fuel_date >= ? AND total_cost IS NOT NULL GROUP BY month
        UNION ALL
        SELECT strftime('%Y-%m', performed_at) AS month, SUM(cost) AS cost FROM fleet_maintenance WHERE performed_at >= ? AND cost IS NOT NULL GROUP BY month
        UNION ALL
        SELECT strftime('%Y-%m', installed_date) AS month, SUM(cost) AS cost FROM fleet_accessories WHERE installed_date >= ? AND archived_at IS NULL GROUP BY month
        UNION ALL
        SELECT strftime('%Y-%m', period_start) AS month, SUM(cost_amount) AS cost FROM fleet_utility_costs WHERE period_start >= ? AND archived_at IS NULL GROUP BY month
      )
      WHERE month IS NOT NULL
      GROUP BY month ORDER BY month
    `).all(sinceDate, sinceDate, sinceDate, sinceDate) as any[];

    const round = (n: number) => Math.round(n * 100) / 100;
    const totals = {
      fuel:        round(Number(fuel.total) || 0),
      maintenance: round(Number(maint.total) || 0),
      loan:        round(loanTotal),
      insurance:   round(insuranceTotal),
      accessories: round(Number(accessories.total) || 0),
      utilities:   round(Number(utilities.total) || 0),
    };
    const totalAll = round(
      totals.fuel + totals.maintenance + totals.loan +
      totals.insurance + totals.accessories + totals.utilities,
    );

    // ── Anomaly detection (three independent rules) ──────────────
    //
    // We compute three flags per vehicle and return them alongside the
    // ranking. The client page renders a separate "Anomalies" section
    // that filters this vehicles array to rows where anomalies.length > 0.
    //
    // Rule 1: cost-per-mile outlier (>1.5× fleet average).
    //   Uses mean of per-vehicle cost_per_mile values (excluding nulls).
    //   We use the mean rather than median because the small fleet size
    //   (~dozens) makes the median flap on single-vehicle changes, and
    //   because operators care about absolute spend — a mean-biased
    //   threshold catches outliers better at this scale.
    //
    // Rule 2: month-over-month spend spike (>50% vs trailing 3-month avg).
    //   Computed from the monthly per-vehicle spend (fuel+maint+acc+util —
    //   the time-stamped streams). Loans/insurance are smooth recurring so
    //   excluding them avoids false positives from the monthly cadence.
    //
    // Rule 3: category imbalance (one category > 60% of the vehicle's total).
    //   Reveals "this vehicle is all repair costs" type patterns.
    const validCpms = vehicles.map(v => v.cost_per_mile).filter((n): n is number => n != null && n > 0);
    const fleetAvgCpm = validCpms.length > 0
      ? validCpms.reduce((s, n) => s + n, 0) / validCpms.length
      : 0;
    const cpmThreshold = fleetAvgCpm * 1.5;

    // Pre-compute per-vehicle monthly spend over the window so Rule 2 can
    // compare last month vs trailing-3 average without re-querying per vehicle.
    const perVehicleMonthly = db.prepare(`
      SELECT vehicle_id, month, SUM(cost) AS cost FROM (
        SELECT vehicle_id, strftime('%Y-%m', fuel_date) AS month, SUM(total_cost) AS cost
          FROM fleet_fuel_logs WHERE fuel_date >= ? AND total_cost IS NOT NULL GROUP BY vehicle_id, month
        UNION ALL
        SELECT vehicle_id, strftime('%Y-%m', performed_at) AS month, SUM(cost) AS cost
          FROM fleet_maintenance WHERE performed_at >= ? AND cost IS NOT NULL GROUP BY vehicle_id, month
        UNION ALL
        SELECT vehicle_id, strftime('%Y-%m', installed_date) AS month, SUM(cost) AS cost
          FROM fleet_accessories WHERE installed_date >= ? AND archived_at IS NULL GROUP BY vehicle_id, month
        UNION ALL
        SELECT vehicle_id, strftime('%Y-%m', period_start) AS month, SUM(cost_amount) AS cost
          FROM fleet_utility_costs WHERE period_start >= ? AND archived_at IS NULL AND vehicle_id IS NOT NULL GROUP BY vehicle_id, month
      )
      WHERE month IS NOT NULL
      GROUP BY vehicle_id, month ORDER BY vehicle_id, month
    `).all(sinceDate, sinceDate, sinceDate, sinceDate) as any[];

    const monthlyByVehicle = new Map<number, { month: string; cost: number }[]>();
    for (const r of perVehicleMonthly) {
      const list = monthlyByVehicle.get(r.vehicle_id) || [];
      list.push({ month: r.month, cost: Number(r.cost) || 0 });
      monthlyByVehicle.set(r.vehicle_id, list);
    }

    const vehiclesWithAnomalies = vehicles.map(v => {
      const anomalies: Array<{ kind: string; severity: 'watch' | 'alert'; detail: string }> = [];

      // Rule 1: cost-per-mile outlier
      if (v.cost_per_mile != null && fleetAvgCpm > 0 && v.cost_per_mile > cpmThreshold) {
        const ratio = v.cost_per_mile / fleetAvgCpm;
        anomalies.push({
          kind: 'cpm_outlier',
          severity: ratio > 2 ? 'alert' : 'watch',
          detail: `$${v.cost_per_mile.toFixed(3)}/mi is ${ratio.toFixed(2)}× fleet avg ($${fleetAvgCpm.toFixed(3)}/mi)`,
        });
      }

      // Rule 2: MoM spike. Need 4+ months of data to compare against.
      const months = monthlyByVehicle.get(v.id) || [];
      if (months.length >= 4) {
        const last = months[months.length - 1];
        const prior3 = months.slice(-4, -1);
        const prior3Avg = prior3.reduce((s, m) => s + m.cost, 0) / prior3.length;
        if (prior3Avg > 0 && last.cost > prior3Avg * 1.5) {
          const pct = ((last.cost / prior3Avg) - 1) * 100;
          anomalies.push({
            kind: 'mom_spike',
            severity: pct > 100 ? 'alert' : 'watch',
            detail: `${last.month} spend ($${last.cost.toFixed(0)}) is +${pct.toFixed(0)}% vs trailing 3-mo avg ($${prior3Avg.toFixed(0)})`,
          });
        }
      }

      // Rule 3: category imbalance. Ignore vehicles with <$500 total — the
      // percentage math gets noisy on trivially-small rows.
      if (v.total >= 500) {
        const cats: Array<[string, number]> = [
          ['fuel', v.fuel_cost], ['maintenance', v.maint_cost],
          ['loan', v.loan_cost], ['insurance', v.insurance_cost],
          ['accessories', v.accessory_cost], ['utilities', v.utility_cost],
        ];
        for (const [name, amount] of cats) {
          const pct = amount / v.total;
          if (pct > 0.6) {
            anomalies.push({
              kind: 'category_imbalance',
              severity: pct > 0.75 ? 'alert' : 'watch',
              detail: `${name} is ${(pct * 100).toFixed(0)}% of TCO ($${amount.toFixed(0)} of $${v.total.toFixed(0)})`,
            });
            break; // At most one category can dominate; first hit is enough.
          }
        }
      }

      return { ...v, anomalies };
    });

    res.json({
      since: sinceDate,
      days,
      totals,
      total_all: totalAll,
      counts: {
        fuel_fills: Number(fuel.fills) || 0,
        maintenance_events: Number(maint.events) || 0,
        accessory_installs: Number(accessories.events) || 0,
        utility_entries: Number(utilities.events) || 0,
        active_loans: activeLoans.length,
        active_policies: policies.length,
      },
      fleet_avg_cost_per_mile: Math.round(fleetAvgCpm * 1000) / 1000,
      vehicles: vehiclesWithAnomalies,
      monthly_trend: monthlyTrend.map((r: any) => ({
        month: r.month,
        cost: round(Number(r.cost) || 0),
      })),
    });
  } catch (err: any) {
    console.error('[fleet cost-analytics overview] error:', err?.message, err?.stack);
    res.status(500).json({ error: 'Failed to compute fleet cost analytics' });
  }
});

// GET /api/fleet/:id/cost-summary — total cost-of-ownership rollup
//
// Combines fuel + maintenance + the four new cost categories into one
// per-vehicle picture. Loan + insurance numbers are EXTRAPOLATED from
// monthly/annualised figures (we don't track per-payment ledger entries),
// while accessories and utilities are summed as actual recorded charges.
//
// Response shape is intentionally flat so the client can render it as
// a stat-card grid without further computation.
router.get('/:id/cost-summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const vehicle = db.prepare('SELECT id, current_mileage FROM fleet_vehicles WHERE id = ?').get(id) as any;
    if (!vehicle) { res.status(404).json({ error: 'Fleet vehicle not found' }); return; }

    const fuel = db.prepare('SELECT COALESCE(SUM(total_cost), 0) AS total FROM fleet_fuel_logs WHERE vehicle_id = ?').get(id) as any;
    const maintenance = db.prepare('SELECT COALESCE(SUM(cost), 0) AS total FROM fleet_maintenance WHERE vehicle_id = ?').get(id) as any;
    const accessories = db.prepare('SELECT COALESCE(SUM(cost), 0) AS total FROM fleet_accessories WHERE vehicle_id = ? AND archived_at IS NULL').get(id) as any;

    // Active loans — sum monthly_payment × months elapsed since start_date,
    // capped at term_months. This gives "actual paid so far" for each loan.
    const loans = db.prepare(`
      SELECT id, monthly_payment, start_date, term_months, payoff_date, status
      FROM fleet_loans
      WHERE vehicle_id = ? AND archived_at IS NULL
    `).all(id) as any[];
    let loanPaidToDate = 0;
    let monthlyLoanCommitment = 0;
    for (const l of loans) {
      const start = new Date(l.start_date);
      const monthsElapsed = Math.max(0, Math.floor((Date.now() - start.getTime()) / (30.44 * 86400_000)));
      const cappedMonths = l.term_months ? Math.min(l.term_months, monthsElapsed) : monthsElapsed;
      loanPaidToDate += (Number(l.monthly_payment) || 0) * cappedMonths;
      if (l.status === 'active') monthlyLoanCommitment += Number(l.monthly_payment) || 0;
    }

    // Insurance premiums — annualised then summed across active policies.
    const insurancePolicies = db.prepare(`
      SELECT premium_amount, premium_frequency, effective_from, expires_at, status
      FROM fleet_insurance_policies
      WHERE vehicle_id = ? AND archived_at IS NULL
    `).all(id) as any[];
    const freqMultiplier: Record<string, number> = {
      monthly: 12, quarterly: 4, semi_annual: 2, annual: 1,
    };
    let annualInsurance = 0;
    let insurancePaidToDate = 0;
    for (const p of insurancePolicies) {
      const annual = (Number(p.premium_amount) || 0) * (freqMultiplier[p.premium_frequency] || 12);
      if (p.status === 'active') annualInsurance += annual;
      const start = new Date(p.effective_from);
      const yearsElapsed = Math.max(0, (Date.now() - start.getTime()) / (365.25 * 86400_000));
      insurancePaidToDate += annual * yearsElapsed;
    }

    // Utilities — sum recorded charges directly. cost_frequency is
    // informational only (the period_start..period_end is what matters).
    const utilities = db.prepare(`
      SELECT COALESCE(SUM(cost_amount), 0) AS total
      FROM fleet_utility_costs
      WHERE (vehicle_id = ? OR vehicle_id IS NULL) AND archived_at IS NULL
    `).get(id) as any;

    const round = (n: number) => Math.round(n * 100) / 100;
    const totalLifetime = round(
      (Number(fuel.total) || 0) +
      (Number(maintenance.total) || 0) +
      (Number(accessories.total) || 0) +
      loanPaidToDate +
      insurancePaidToDate +
      (Number(utilities.total) || 0),
    );

    res.json({
      vehicle_id: Number(id),
      categories: {
        fuel:        round(Number(fuel.total) || 0),
        maintenance: round(Number(maintenance.total) || 0),
        loans:       round(loanPaidToDate),
        insurance:   round(insurancePaidToDate),
        accessories: round(Number(accessories.total) || 0),
        utilities:   round(Number(utilities.total) || 0),
      },
      total_lifetime: totalLifetime,
      monthly_commitment: {
        loan:      round(monthlyLoanCommitment),
        insurance: round(annualInsurance / 12),
        total:     round(monthlyLoanCommitment + annualInsurance / 12),
      },
      cost_per_mile: vehicle.current_mileage > 0
        ? Math.round((totalLifetime / vehicle.current_mileage) * 1000) / 1000
        : null,
    });
  } catch (err: any) {
    console.error('[fleet cost-summary] error:', err?.message, err?.stack);
    res.status(500).json({ error: 'Failed to compute cost summary' });
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
    // Audit 2026-04-11: previous handler only accepted 3 fields. Users
    // could not correct typos in description, severity, photos, repair
    // estimate, or any other column. Expanded to the full editable set.
    const fieldMap: Record<string, (v: any) => any> = {
      damage_date: v => v ?? null,
      damage_type: v => v ?? null,
      location_on_vehicle: v => v ?? null,
      severity: v => v ?? null,
      description: v => v ?? null,
      repair_estimate: v => v ?? null,
      repair_status: v => v ?? null,
      repair_cost: v => v ?? null,
      insurance_claim_number: v => v ?? null,
      photos: v => Array.isArray(v) ? JSON.stringify(v) : (v ?? null),
      status: v => v ?? null,
    };
    const sets: string[] = [];
    const vals: any[] = [];
    for (const [key, transform] of Object.entries(fieldMap)) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        sets.push(`${key} = ?`);
        vals.push(transform(req.body[key]));
      }
    }
    if (sets.length === 0) { res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' }); return; }
    sets.push('updated_at = ?');
    vals.push(localNow());
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

// ── Health Scores: 0-100 composite score per vehicle ────────────────
router.get('/health-scores', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const nowISO = localNow();

    const vehicles = db.prepare(`
      SELECT id, vehicle_number, make, model, year, current_mileage, status,
             next_service_due, last_service_date
      FROM fleet_vehicles
      WHERE status != 'retired' AND archived_at IS NULL
    `).all() as any[];

    // Batch-load cost per mile
    const costRows = db.prepare(`
      SELECT fv.id,
        (COALESCE(m.mc, 0) + COALESCE(f.fc, 0)) AS total_cost,
        fv.current_mileage
      FROM fleet_vehicles fv
      LEFT JOIN (SELECT vehicle_id, SUM(cost) AS mc FROM fleet_maintenance WHERE cost IS NOT NULL GROUP BY vehicle_id) m ON m.vehicle_id = fv.id
      LEFT JOIN (SELECT vehicle_id, SUM(total_cost) AS fc FROM fleet_fuel_logs WHERE total_cost IS NOT NULL GROUP BY vehicle_id) f ON f.vehicle_id = fv.id
      WHERE fv.status != 'retired' AND fv.archived_at IS NULL
    `).all() as any[];
    const costMap: Record<number, number> = {};
    for (const r of costRows) {
      costMap[r.id] = r.current_mileage > 0 ? r.total_cost / r.current_mileage : 0;
    }

    // Batch-load latest inspection result per vehicle
    const inspRows = db.prepare(`
      SELECT vehicle_id, overall_result FROM fleet_inspections
      WHERE id IN (
        SELECT MAX(id) FROM fleet_inspections GROUP BY vehicle_id
      )
    `).all() as any[];
    const inspMap: Record<number, string> = {};
    for (const r of inspRows) {
      inspMap[r.vehicle_id] = r.overall_result;
    }

    const currentYear = new Date().getFullYear();
    const nowDate = new Date(nowISO);

    const results = vehicles.map((v: any) => {
      const age = v.year ? currentYear - v.year : 5;
      const ageFactor = Math.max(0, Math.min(100, 100 - Math.max(0, age - 2) * 10));

      const miles = v.current_mileage || 0;
      let mileageFactor = 100;
      if (miles >= 200000) mileageFactor = 0;
      else if (miles > 25000) mileageFactor = Math.round(100 - ((miles - 25000) / (200000 - 25000)) * 100);

      let serviceFactor = 100;
      if (v.next_service_due) {
        const dueDate = new Date(v.next_service_due);
        const daysOverdue = Math.floor((nowDate.getTime() - dueDate.getTime()) / 86400000);
        if (daysOverdue > 0) {
          serviceFactor = Math.max(0, Math.round(100 - (daysOverdue / 90) * 100));
        }
      }

      const inspResult = inspMap[v.id];
      let inspectionFactor = 100;
      if (inspResult === 'pass') inspectionFactor = 100;
      else if (inspResult === 'needs_attention') inspectionFactor = 50;
      else if (inspResult === 'fail') inspectionFactor = 0;

      const cpm = costMap[v.id] || 0;
      let costFactor = 100;
      if (cpm >= 0.50) costFactor = 0;
      else if (cpm > 0.10) costFactor = Math.round(100 - ((cpm - 0.10) / (0.50 - 0.10)) * 100);

      const healthScore = Math.round(
        ageFactor * 0.20 + mileageFactor * 0.20 + serviceFactor * 0.25 + inspectionFactor * 0.20 + costFactor * 0.15
      );

      let statusLabel: string;
      if (healthScore >= 80) statusLabel = 'Excellent';
      else if (healthScore >= 60) statusLabel = 'Good';
      else if (healthScore >= 40) statusLabel = 'Fair';
      else if (healthScore >= 20) statusLabel = 'Poor';
      else statusLabel = 'Critical';

      return {
        vehicle_id: v.id, vehicle_number: v.vehicle_number, make: v.make, model: v.model, year: v.year,
        health_score: healthScore,
        factors: { age: ageFactor, mileage: mileageFactor, service: serviceFactor, inspection: inspectionFactor, cost: costFactor },
        status_label: statusLabel,
      };
    });

    res.json({ health_scores: results });
  } catch (error: any) {
    console.error('Error computing health scores:', error);
    res.status(500).json({ error: 'Failed to compute health scores', code: 'HEALTH_SCORES_ERROR' });
  }
});

// ── Maintenance Schedule: upcoming maintenance for all vehicles ─────
router.get('/maintenance-schedule', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const today = localToday();
    const nowDate = new Date(today);

    const vehicles = db.prepare(`
      SELECT v.id, v.vehicle_number, v.current_mileage,
             v.next_service_due, v.next_service_mileage, v.next_service_type,
             CASE WHEN julianday(MAX(f.fuel_date)) - julianday(MIN(f.fuel_date)) > 0
               THEN (MAX(f.odometer_reading) - MIN(f.odometer_reading)) / (julianday(MAX(f.fuel_date)) - julianday(MIN(f.fuel_date)))
               ELSE 0 END as avg_daily_miles
      FROM fleet_vehicles v
      LEFT JOIN fleet_fuel_logs f ON v.id = f.vehicle_id AND f.odometer_reading IS NOT NULL
      WHERE v.status != 'retired' AND v.archived_at IS NULL
        AND (v.next_service_due IS NOT NULL OR v.next_service_mileage IS NOT NULL)
      GROUP BY v.id
    `).all() as any[];

    const schedule = vehicles.map((v: any) => {
      let daysUntil: number | null = null;
      let milesUntil: number | null = null;
      if (v.next_service_due) { daysUntil = Math.floor((new Date(v.next_service_due).getTime() - nowDate.getTime()) / 86400000); }
      if (v.next_service_mileage && v.current_mileage) { milesUntil = v.next_service_mileage - v.current_mileage; }
      let urgency: string = 'ok';
      const effectiveDays = daysUntil ?? 9999;
      const effectiveMiles = milesUntil ?? 999999;
      if (effectiveDays < 0 || effectiveMiles < 0) urgency = 'overdue';
      else if (effectiveDays <= 7 || effectiveMiles <= 500) urgency = 'critical';
      else if (effectiveDays <= 30 || effectiveMiles <= 2000) urgency = 'upcoming';
      return { vehicle_id: v.id, vehicle_number: v.vehicle_number, service_type: v.next_service_type || 'Scheduled Service', due_date: v.next_service_due || null, due_mileage: v.next_service_mileage || null, days_until: daysUntil, miles_until: milesUntil, urgency };
    }).sort((a: any, b: any) => {
      const urgencyOrder: Record<string, number> = { overdue: 0, critical: 1, upcoming: 2, ok: 3 };
      return (urgencyOrder[a.urgency] ?? 4) - (urgencyOrder[b.urgency] ?? 4);
    });

    res.json({ schedule });
  } catch (error: any) {
    console.error('Error fetching maintenance schedule:', error);
    res.status(500).json({ error: 'Failed to fetch maintenance schedule', code: 'MAINT_SCHEDULE_ERROR' });
  }
});

// ── Maintenance Templates ───────────────────────────────────────────
router.post('/maintenance-templates', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(`CREATE TABLE IF NOT EXISTS fleet_maintenance_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, service_type TEXT NOT NULL, interval_months INTEGER, interval_miles INTEGER, estimated_cost REAL, checklist TEXT DEFAULT '[]', is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')))`).run();
    const { name, service_type, interval_months, interval_miles, estimated_cost, checklist } = req.body;
    if (!name || !service_type) { return res.status(400).json({ error: 'name and service_type are required' }); }
    const result = db.prepare(`INSERT INTO fleet_maintenance_templates (name, service_type, interval_months, interval_miles, estimated_cost, checklist) VALUES (?, ?, ?, ?, ?, ?)`).run(name, service_type, interval_months || null, interval_miles || null, estimated_cost || null, JSON.stringify(checklist || []));
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('Error creating maintenance template:', error);
    res.status(500).json({ error: 'Failed to create maintenance template', code: 'MAINT_TEMPLATE_ERROR' });
  }
});

router.get('/maintenance-templates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(`CREATE TABLE IF NOT EXISTS fleet_maintenance_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, service_type TEXT NOT NULL, interval_months INTEGER, interval_miles INTEGER, estimated_cost REAL, checklist TEXT DEFAULT '[]', is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')))`).run();
    const templates = db.prepare('SELECT * FROM fleet_maintenance_templates WHERE is_active = 1 ORDER BY name').all() as any[];
    const parsed = templates.map((t: any) => ({ ...t, checklist: safeParseJson(t.checklist, []) }));
    res.json({ templates: parsed });
  } catch (error: any) {
    console.error('Error fetching maintenance templates:', error);
    res.status(500).json({ error: 'Failed to fetch maintenance templates', code: 'MAINT_TEMPLATES_ERROR' });
  }
});

// ── Driver / Officer Performance (last 30 days) ────────────────────
router.get('/driver-performance', (req: Request, res: Response) => {
  try {
    const db = getDb();
    let gpsStats: any[] = [];
    try { gpsStats = db.prepare(`SELECT call_sign, officer_name, COUNT(*) AS total_pings, SUM(CASE WHEN speed > 0 THEN 1 ELSE 0 END) AS moving_pings, AVG(CASE WHEN speed > 0 THEN speed ELSE NULL END) AS avg_speed, MAX(speed) AS max_speed, MIN(recorded_at) AS first_ping, MAX(recorded_at) AS last_ping FROM gps_breadcrumbs WHERE recorded_at >= datetime('now', 'localtime', '-30 days') AND call_sign IS NOT NULL AND call_sign != '' GROUP BY call_sign`).all() as any[]; } catch { /* table may not exist */ }
    if (gpsStats.length === 0) { return res.json({ drivers: [] }); }
    const fuelByUnit: Record<string, { totalMiles: number; totalGallons: number }> = {};
    try { const fuelRows = db.prepare(`SELECT u.call_sign, SUM(COALESCE(fl.distance, 0)) AS total_miles, SUM(fl.gallons) AS total_gallons FROM fleet_fuel_logs fl JOIN fleet_vehicles fv ON fl.vehicle_id = fv.id JOIN units u ON fv.assigned_unit_id = u.id WHERE fl.fuel_date >= date('now', 'localtime', '-30 days') AND fl.gallons > 0 GROUP BY u.call_sign`).all() as any[]; for (const r of fuelRows) { fuelByUnit[r.call_sign] = { totalMiles: r.total_miles || 0, totalGallons: r.total_gallons || 0 }; } } catch { /* graceful */ }
    const inspByOfficer: Record<string, { total: number; passed: number }> = {};
    try { const inspRows = db.prepare(`SELECT inspector_name, COUNT(*) AS total, SUM(CASE WHEN overall_result = 'pass' THEN 1 ELSE 0 END) AS passed FROM fleet_inspections WHERE inspection_date >= date('now', 'localtime', '-30 days') GROUP BY inspector_name`).all() as any[]; for (const r of inspRows) { inspByOfficer[r.inspector_name] = { total: r.total, passed: r.passed }; } } catch { /* graceful */ }
    const damageByUnit: Record<string, number> = {};
    try { const dmgRows = db.prepare(`SELECT u.call_sign, COUNT(*) AS damage_count FROM fleet_damage_reports dr JOIN fleet_vehicles fv ON dr.vehicle_id = fv.id JOIN units u ON fv.assigned_unit_id = u.id WHERE dr.damage_date >= date('now', 'localtime', '-30 days') GROUP BY u.call_sign`).all() as any[]; for (const r of dmgRows) { damageByUnit[r.call_sign] = r.damage_count; } } catch { /* graceful */ }
    const drivers = gpsStats.map((g: any) => {
      const totalPings = g.total_pings || 1;
      const movingPings = g.moving_pings || 0;
      const idlePct = Math.round(((totalPings - movingPings) / totalPings) * 100);
      let totalHours = 0;
      if (g.first_ping && g.last_ping) { totalHours = Math.round((new Date(g.last_ping).getTime() - new Date(g.first_ping).getTime()) / 3600000); }
      const movingHours = totalHours * (movingPings / totalPings);
      const totalMiles = Math.round((g.avg_speed || 0) * movingHours);
      const fuel = fuelByUnit[g.call_sign];
      const avgMpg = fuel && fuel.totalGallons > 0 ? Math.round((fuel.totalMiles / fuel.totalGallons) * 10) / 10 : null;
      const insp = inspByOfficer[g.officer_name || ''];
      const inspectionScore = insp && insp.total > 0 ? Math.round((insp.passed / insp.total) * 100) : 100;
      const damageCount = damageByUnit[g.call_sign] || 0;
      const fuelScore = avgMpg != null ? Math.min(100, Math.round((avgMpg / 25) * 100)) : 50;
      const idleScore = Math.max(0, 100 - idlePct);
      const speedScore = (g.max_speed || 0) <= 80 ? 100 : Math.max(0, 100 - ((g.max_speed - 80) * 5));
      const damageScore = damageCount === 0 ? 100 : Math.max(0, 100 - damageCount * 25);
      const overallScore = Math.round(fuelScore * 0.30 + idleScore * 0.20 + speedScore * 0.20 + inspectionScore * 0.20 + damageScore * 0.10);
      return { officer_name: g.officer_name || g.call_sign, call_sign: g.call_sign, total_miles: totalMiles, total_hours: totalHours, idle_pct: idlePct, avg_speed: Math.round((g.avg_speed || 0) * 10) / 10, max_speed: Math.round((g.max_speed || 0) * 10) / 10, avg_mpg: avgMpg, inspection_score: inspectionScore, damage_count: damageCount, overall_score: overallScore };
    }).sort((a: any, b: any) => b.overall_score - a.overall_score);
    res.json({ drivers });
  } catch (error: any) {
    console.error('Error computing driver performance:', error);
    res.status(500).json({ error: 'Failed to compute driver performance', code: 'DRIVER_PERF_ERROR' });
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

// ── Fleet CSV Export ─────────────────────────────────────────────────────────
router.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT fv.vehicle_number, fv.make, fv.model, fv.year, fv.color, fv.vin,
             fv.license_plate, fv.status, fv.assigned_officer_name,
             fv.current_mileage, fv.next_service_due, fv.insurance_expiry,
             fv.registration_expiry, fv.purchase_date, fv.purchase_price,
             fv.fuel_type, fv.notes, fv.created_at
      FROM fleet_vehicles fv
      WHERE fv.archived_at IS NULL
      ORDER BY fv.vehicle_number
      LIMIT 10000
    `).all() as any[];
    const headers = ['Vehicle #', 'Make', 'Model', 'Year', 'Color', 'VIN', 'License Plate', 'Status', 'Assigned Officer', 'Mileage', 'Next Service', 'Insurance Expiry', 'Registration Expiry', 'Purchase Date', 'Purchase Price', 'Fuel Type', 'Notes', 'Created'];
    const csv = [
      headers.join(','),
      ...rows.map((r: any) => [
        r.vehicle_number, r.make, r.model, r.year, r.color,
        (r.vin || '').replace(/"/g, '""'), r.license_plate, r.status,
        (r.assigned_officer_name || '').replace(/"/g, '""'),
        r.current_mileage, r.next_service_due, r.insurance_expiry,
        r.registration_expiry, r.purchase_date, r.purchase_price,
        r.fuel_type, (r.notes || '').replace(/"/g, '""'), r.created_at
      ].map(v => `"${v || ''}"`).join(','))
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="fleet_export_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (error: any) {
    console.error('Fleet CSV export error:', error);
    res.status(500).json({ error: 'Failed to export fleet data', code: 'FLEET_EXPORT_ERROR' });
  }
});

export default router;
