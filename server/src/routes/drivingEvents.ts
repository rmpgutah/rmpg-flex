// ============================================================
// /api/driving-events — source-agnostic event browse + detail
// ============================================================
// Reads from the unified driving_events table populated by:
//   - ClearPathGPS poller (PR #1 dual-write)
//   - Traccar poller (PR #4 dual-write)
//   - Flex Dashcam AI webhook ingest (PR #2)
//
// All routes require JWT auth — these are operator-facing
// (dispatch, supervisors, IA) not webhook receivers.

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { verifyEvidenceChain } from '../utils/evidenceHasher';

const router = Router();
router.use(authenticateToken);

// ============================================================
// GET /api/driving-events
// List with filters: date range, source, event_type, severity,
// unit_id, officer_id, has_video. Returns most-recent first.
// ============================================================
router.get(
  '/',
  requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'),
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const {
        from, to, source, event_type, severity,
        unit_id, officer_id, has_video, call_id, incident_id,
        limit: limitStr, offset: offsetStr,
      } = req.query;

      const limit = Math.min(500, Math.max(1, parseInt(String(limitStr ?? '100'), 10) || 100));
      const offset = Math.max(0, parseInt(String(offsetStr ?? '0'), 10) || 0);

      let where = 'WHERE 1=1';
      const params: any[] = [];

      if (from)         { where += ' AND e.event_timestamp >= ?'; params.push(String(from)); }
      if (to)           { where += ' AND e.event_timestamp <= ?'; params.push(String(to)); }
      if (source)       { where += ' AND e.source = ?';           params.push(String(source)); }
      if (event_type)   { where += ' AND e.event_type = ?';       params.push(String(event_type)); }
      if (severity)     { where += ' AND e.severity = ?';         params.push(String(severity)); }
      if (unit_id)      { where += ' AND e.unit_id = ?';          params.push(parseInt(String(unit_id), 10)); }
      if (officer_id)   { where += ' AND e.officer_id = ?';       params.push(parseInt(String(officer_id), 10)); }
      if (call_id)      { where += ' AND e.call_id = ?';          params.push(parseInt(String(call_id), 10)); }
      if (incident_id)  { where += ' AND e.incident_id = ?';      params.push(parseInt(String(incident_id), 10)); }
      if (has_video === '1' || has_video === 'true')  { where += ' AND e.has_video = 1'; }
      if (has_video === '0' || has_video === 'false') { where += ' AND e.has_video = 0'; }

      const events = db.prepare(`
        SELECT
          e.id, e.source, e.source_event_id, e.device_id, e.unit_id, e.officer_id,
          e.event_type, e.severity, e.event_timestamp,
          e.latitude, e.longitude, e.heading, e.speed_mph, e.address,
          e.call_id, e.incident_id, e.beat_code,
          e.has_video, e.video_url, e.clip_object_key, e.thumb_object_key,
          e.duration_sec, e.model_version, e.confidence, e.created_at,
          u.call_sign, u.status as unit_status,
          usr.full_name as officer_name, usr.badge_number,
          c.call_number
        FROM driving_events e
        LEFT JOIN units u ON e.unit_id = u.id
        LEFT JOIN users usr ON e.officer_id = usr.id
        LEFT JOIN calls_for_service c ON e.call_id = c.id
        ${where}
        ORDER BY e.event_timestamp DESC, e.id DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      const totalRow = db.prepare(`
        SELECT COUNT(*) as cnt FROM driving_events e ${where}
      `).get(...params) as { cnt: number };

      res.json({
        events,
        total: totalRow.cnt,
        limit,
        offset,
      });
    } catch (err: any) {
      console.error('[driving-events] list error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ============================================================
// GET /api/driving-events/stats
// Aggregate counts by source, event_type, severity for the
// fleet dashboard. Last 24h by default.
// ============================================================
router.get(
  '/stats',
  requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'),
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const since = req.query.since
        ? String(req.query.since)
        : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

      const bySource = db.prepare(`
        SELECT source, COUNT(*) as cnt
        FROM driving_events
        WHERE event_timestamp >= ?
        GROUP BY source
      `).all(since);

      const bySeverity = db.prepare(`
        SELECT severity, COUNT(*) as cnt
        FROM driving_events
        WHERE event_timestamp >= ?
        GROUP BY severity
      `).all(since);

      const byType = db.prepare(`
        SELECT event_type, COUNT(*) as cnt
        FROM driving_events
        WHERE event_timestamp >= ?
        GROUP BY event_type
        ORDER BY cnt DESC
        LIMIT 20
      `).all(since);

      const total = db.prepare(`
        SELECT COUNT(*) as cnt FROM driving_events WHERE event_timestamp >= ?
      `).get(since) as { cnt: number };

      res.json({ since, total: total.cnt, by_source: bySource, by_severity: bySeverity, by_type: byType });
    } catch (err: any) {
      console.error('[driving-events] stats error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ============================================================
// GET /api/driving-events/fleet-health
// Per-unit dashcam health snapshot for the fleet LEDs panel.
// ============================================================
router.get(
  '/fleet-health',
  requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'),
  (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT
          h.id, h.unit_id, h.device_id, h.device_kind,
          h.last_heartbeat_at, h.firmware_version, h.model_version,
          h.gpu_temp_c, h.cpu_temp_c, h.disk_used_pct, h.ram_used_pct,
          h.network_status, h.lte_rssi_dbm, h.last_error, h.uptime_sec,
          h.updated_at,
          u.call_sign, u.status as unit_status,
          usr.full_name as officer_name
        FROM dashcam_health h
        LEFT JOIN units u ON h.unit_id = u.id
        LEFT JOIN users usr ON u.officer_id = usr.id
        ORDER BY u.call_sign ASC, h.unit_id ASC
      `).all();

      // Compute "healthy"/"stale"/"down" status from
      // last_heartbeat_at age. Threshold 90s — devices heartbeat
      // every 30s, so 3-missed = stale.
      const now = Date.now();
      const annotated = rows.map((r: any) => {
        let status: 'healthy' | 'stale' | 'down' = 'down';
        if (r.last_heartbeat_at) {
          const ageMs = now - new Date(r.last_heartbeat_at.replace(' ', 'T')).getTime();
          if (ageMs < 90_000) status = 'healthy';
          else if (ageMs < 600_000) status = 'stale';
        }
        return { ...r, status };
      });

      res.json({ units: annotated });
    } catch (err: any) {
      console.error('[driving-events] fleet-health error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ============================================================
// GET /api/driving-events/:id
// Single event with evidence chain audit. Limited to admin /
// manager / supervisor since this exposes raw_json (vendor
// payload, may contain PII).
// ============================================================
router.get(
  '/:id',
  requireRole('admin', 'manager', 'supervisor'),
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid event ID' });
        return;
      }

      const event = db.prepare(`
        SELECT
          e.*,
          u.call_sign, u.status as unit_status,
          usr.full_name as officer_name, usr.badge_number,
          c.call_number, c.incident_type as call_type
        FROM driving_events e
        LEFT JOIN units u ON e.unit_id = u.id
        LEFT JOIN users usr ON e.officer_id = usr.id
        LEFT JOIN calls_for_service c ON e.call_id = c.id
        WHERE e.id = ?
      `).get(id);

      if (!event) {
        res.status(404).json({ error: 'Event not found' });
        return;
      }

      // Pull associated evidence_hashes entries for this event
      const evidence = db.prepare(`
        SELECT id, artifact_type, artifact_id, sha256, size_bytes,
               storage_uri, captured_at, hashed_at, signer, prev_hash_id
        FROM evidence_hashes
        WHERE artifact_id = ? AND artifact_type = 'driving_event_clip'
        ORDER BY id ASC
      `).all(id);

      // Optional chain audit — admin/manager only
      const chainAudit = (req as any).user?.role === 'admin' || (req as any).user?.role === 'manager'
        ? verifyEvidenceChain('driving_event_clip')
        : null;

      res.json({ event, evidence, chain_audit: chainAudit });
    } catch (err: any) {
      console.error('[driving-events] detail error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
