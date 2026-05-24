/**
 * Recommended units — replaces the broken legacy /closest-unit endpoint.
 *
 * The legacy proximityAlerts.findNearestUnits() queries `dispatch_units`
 * (wrong table — actual table is `units`) and `gps_locations` (wrong —
 * actual table is `gps_breadcrumbs`), so it always returns []. This
 * endpoint queries the real tables and enriches with officer names.
 *
 * GET /api/dispatch/calls/:id/recommended-units?limit=5
 */
import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { validateParamIdMiddleware } from '../../middleware/sanitize';
import { paramStr } from '../../utils/reqHelpers';
import { haversineDistance } from '../../utils/proximityAlerts';
import { logger } from '../../utils/logger';

const router = Router();

const GPS_STALE_MINUTES = 10;
const URBAN_SPEED_MPH = 25;
const DEFAULT_LIMIT = 5;

router.get(
  '/calls/:id/recommended-units',
  validateParamIdMiddleware,
  requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const callId = Number(paramStr(req.params.id));
      const limit = Math.max(1, Math.min(20, Number(req.query.limit ?? DEFAULT_LIMIT)));

      const call = db.prepare('SELECT id, latitude, longitude FROM calls_for_service WHERE id = ?').get(callId) as { id: number; latitude: number | null; longitude: number | null } | undefined;
      if (!call) { res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }); return; }
      if (call.latitude == null || call.longitude == null) {
        res.json({ recommended: [], reason: 'Call has no geocoded location' });
        return;
      }

      const cutoff = new Date(Date.now() - GPS_STALE_MINUTES * 60 * 1000).toISOString();

      // Pull every available unit's most-recent breadcrumb within the freshness window.
      const rows = db.prepare(`
        SELECT u.id, u.call_sign, u.status, u.officer_id,
               usr.full_name as officer_name, usr.badge_number,
               b.latitude, b.longitude, b.recorded_at
        FROM units u
        LEFT JOIN users usr ON u.officer_id = usr.id
        INNER JOIN (
          SELECT unit_id, latitude, longitude, recorded_at,
                 ROW_NUMBER() OVER (PARTITION BY unit_id ORDER BY recorded_at DESC) as rn
          FROM gps_breadcrumbs
          WHERE recorded_at >= ?
        ) b ON b.unit_id = u.id AND b.rn = 1
        WHERE u.status IN ('available')
          AND b.latitude IS NOT NULL
          AND b.longitude IS NOT NULL
      `).all(cutoff) as Array<{
        id: number; call_sign: string; status: string; officer_id: number | null;
        officer_name: string | null; badge_number: string | null;
        latitude: number; longitude: number; recorded_at: string;
      }>;

      const recommended = rows.map((r) => {
        const distMeters = haversineDistance(call.latitude!, call.longitude!, r.latitude, r.longitude);
        const distMiles = distMeters / 1609.34;
        const etaMinutes = Math.round((distMiles / URBAN_SPEED_MPH) * 60 * 10) / 10;
        return {
          unit_id: r.id,
          call_sign: r.call_sign,
          status: r.status,
          officer_id: r.officer_id,
          officer_name: r.officer_name,
          badge_number: r.badge_number,
          distance_meters: Math.round(distMeters),
          distance_miles: Math.round(distMiles * 100) / 100,
          eta_minutes: etaMinutes,
          gps_recorded_at: r.recorded_at,
        };
      });

      recommended.sort((a, b) => a.distance_meters - b.distance_meters);
      res.json({ recommended: recommended.slice(0, limit), total_candidates: recommended.length });
    } catch (err: any) {
      logger.error({ err }, 'recommended-units failed');
      res.status(500).json({ error: 'Failed to fetch recommended units', code: 'RECOMMENDED_UNITS_ERROR' });
    }
  },
);

export default router;
