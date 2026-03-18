/**
 * User Preferences API
 *
 * GET  /api/user/preferences       — fetch current user's preferences
 * PUT  /api/user/preferences       — update current user's preferences (partial)
 * POST /api/user/preferences/reset — reset all preferences to defaults
 */
import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import { auditLog } from '../utils/auditLogger';

const router = Router();
router.use(authenticateToken);

// Default values — used when a user has no row in user_preferences yet
const DEFAULTS = {
  // ── Notifications ────────────────────────────────────────────
  notify_dispatch_email: 1,
  notify_dispatch_inapp: 1,
  notify_bolo_email: 1,
  notify_bolo_inapp: 1,
  notify_warrant_email: 0,
  notify_warrant_inapp: 1,
  notify_system_email: 0,
  notify_system_inapp: 1,
  notify_credential_email: 1,
  notify_credential_inapp: 1,
  notify_pso_email: 1,
  notify_pso_inapp: 1,
  quiet_hours_start: null as null | string,
  quiet_hours_end: null as null | string,
  // ── UI / Theme ───────────────────────────────────────────────
  font_scale: 1.0,
  compact_mode: 0,
  date_format: 'MM/DD/YYYY',
  time_format: '12h',
  // timezone is mandatory America/Denver — not user-configurable
  default_landing_page: '/',
  sidebar_collapsed: 0,
  show_unit_status_bar: 1,
  show_call_timer: 1,
  show_bolo_banner: 1,
  // ── Sounds ───────────────────────────────────────────────────
  status_sounds_enabled: 1,
  notification_sounds: 1,
  dispatch_audio_alerts: 1,
  // ── Map ──────────────────────────────────────────────────────
  show_map_labels: 1,
  default_map_style: 'dark',
  map_default_zoom: 13,
  map_traffic_overlay: 0,
  map_satellite_default: 0,
  gps_track_display: 'trail',        // 'trail' | 'dot' | 'none'
  show_weather_widget: 1,
  // ── Dispatch ─────────────────────────────────────────────────
  dashboard_widgets: null as null | string,
  dispatch_sort: 'priority',
  dispatch_show_cleared: 0,
  highlight_own_unit: 1,
  // ── Patrol ───────────────────────────────────────────────────
  patrol_log_auto_open: 0,
  // ── Records / Warrants ───────────────────────────────────────
  auto_geocode_calls: 1,
  warrant_auto_attach: 1,
};

// Allowed fields for update — prevents SQL injection via dynamic column names
const ALLOWED_FIELDS = new Set(Object.keys(DEFAULTS));

// GET /api/user/preferences
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;

    let prefs = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId) as any;

    if (!prefs) {
      // Return defaults without creating a row (lazy initialization)
      res.json({ ...DEFAULTS, user_id: userId });
      return;
    }

    res.json(prefs);
  } catch (error: any) {
    console.error('[UserPreferences] GET error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/user/preferences — partial update
router.put('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const updates = req.body;

    if (!updates || typeof updates !== 'object') {
      res.status(400).json({ error: 'Request body must be an object' });
      return;
    }

    // Filter to only allowed fields
    const validUpdates: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (ALLOWED_FIELDS.has(key)) {
        validUpdates[key] = value;
      }
    }

    if (Object.keys(validUpdates).length === 0) {
      res.status(400).json({ error: 'No valid preference fields provided' });
      return;
    }

    // Ensure row exists (upsert)
    const existing = db.prepare('SELECT user_id FROM user_preferences WHERE user_id = ?').get(userId);
    if (!existing) {
      db.prepare('INSERT INTO user_preferences (user_id) VALUES (?)').run(userId);
    }

    // Build dynamic UPDATE
    const setClauses: string[] = [];
    const values: any[] = [];
    for (const [key, value] of Object.entries(validUpdates)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
    setClauses.push('updated_at = ?');
    values.push(localNow());
    values.push(userId);

    db.prepare(`UPDATE user_preferences SET ${setClauses.join(', ')} WHERE user_id = ?`).run(...values);

    const updated = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);

    auditLog(req, 'preferences_updated', 'user_preferences', userId,
      `Updated preferences: ${Object.keys(validUpdates).join(', ')}`);

    res.json(updated);
  } catch (error: any) {
    console.error('[UserPreferences] PUT error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/user/preferences/reset — reset to defaults
router.post('/reset', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;

    db.prepare('DELETE FROM user_preferences WHERE user_id = ?').run(userId);

    auditLog(req, 'preferences_reset', 'user_preferences', userId,
      'Reset all preferences to defaults');

    res.json({ ...DEFAULTS, user_id: userId });
  } catch (error: any) {
    console.error('[UserPreferences] RESET error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
