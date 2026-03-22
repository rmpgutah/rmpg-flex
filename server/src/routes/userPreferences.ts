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
  quiet_hours_start: null,
  quiet_hours_end: null,
  font_scale: 1.0,
  compact_mode: 0,
  show_map_labels: 1,
  default_map_style: 'dark',
  dashboard_widgets: null,
  dispatch_sort: 'priority',
  dispatch_show_cleared: 0,
  theme_preference: 'dark',
  font_size_preference: 'medium',
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
    console.error('[UserPreferences] GET error:', error?.message);
    res.status(500).json({ error: 'Failed to get user preferences' });
  }
});

// PUT /api/user/preferences — partial update
router.put('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const updates = req.body;

    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      res.status(400).json({ error: 'Request body must be an object' });
      return;
    }

    // Reject excessively large payloads
    if (Object.keys(updates).length > 50) {
      res.status(400).json({ error: 'Too many fields in request' });
      return;
    }

    // Filter to only allowed fields and validate value types
    const validUpdates: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (ALLOWED_FIELDS.has(key)) {
        // Reject complex objects — only allow primitives and null
        if (value !== null && typeof value === 'object') {
          // Allow dashboard_widgets as JSON string
          if (key === 'dashboard_widgets' && typeof value === 'object') {
            validUpdates[key] = JSON.stringify(value);
            continue;
          }
          res.status(400).json({ error: `Invalid value type for ${key}` });
          return;
        }
        // Validate numeric ranges for specific fields
        if (key === 'font_scale' && (typeof value !== 'number' || value < 0.5 || value > 3.0)) {
          res.status(400).json({ error: 'font_scale must be between 0.5 and 3.0' });
          return;
        }
        if (/^notify_/.test(key) && key !== 'notify_credential_email' && value !== 0 && value !== 1 && value !== true && value !== false) {
          res.status(400).json({ error: `${key} must be 0 or 1` });
          return;
        }
        if (key === 'compact_mode' && value !== 0 && value !== 1 && value !== true && value !== false) {
          res.status(400).json({ error: 'compact_mode must be 0 or 1' });
          return;
        }
        if (key === 'show_map_labels' && value !== 0 && value !== 1 && value !== true && value !== false) {
          res.status(400).json({ error: 'show_map_labels must be 0 or 1' });
          return;
        }
        if (key === 'dispatch_show_cleared' && value !== 0 && value !== 1 && value !== true && value !== false) {
          res.status(400).json({ error: 'dispatch_show_cleared must be 0 or 1' });
          return;
        }
        if (key === 'default_map_style' && typeof value === 'string' && !['dark', 'light', 'satellite', 'terrain'].includes(value)) {
          res.status(400).json({ error: 'Invalid default_map_style' });
          return;
        }
        if (key === 'dispatch_sort' && typeof value === 'string' && !['priority', 'time', 'status'].includes(value)) {
          res.status(400).json({ error: 'Invalid dispatch_sort value' });
          return;
        }
        // Validate string value lengths
        if (typeof value === 'string' && value.length > 5000) {
          res.status(400).json({ error: `Value for ${key} is too long` });
          return;
        }
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
    console.error('[UserPreferences] PUT error:', error?.message);
    res.status(500).json({ error: 'Failed to update user preferences' });
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
    console.error('[UserPreferences] RESET error:', error?.message);
    res.status(500).json({ error: 'Failed to reset user preferences' });
  }
});

// ═══════════════════════════════════════════════════════════
// Feature 37: Recently viewed items
// ═══════════════════════════════════════════════════════════
router.get('/recently-viewed', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const user = db.prepare('SELECT recently_viewed FROM users WHERE id = ?').get(userId) as any;
    const items = JSON.parse(user?.recently_viewed || '[]');
    res.json({ data: items });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/recently-viewed', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const { entity_type, entity_id, title } = req.body;
    if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_type and entity_id required' });

    const user = db.prepare('SELECT recently_viewed FROM users WHERE id = ?').get(userId) as any;
    let items = JSON.parse(user?.recently_viewed || '[]');
    // Remove duplicates and add to front
    items = items.filter((i: any) => !(i.entity_type === entity_type && i.entity_id === entity_id));
    items.unshift({ entity_type, entity_id, title: title || '', viewed_at: new Date().toISOString() });
    items = items.slice(0, 20); // Keep max 20 items

    db.prepare('UPDATE users SET recently_viewed = ? WHERE id = ?').run(JSON.stringify(items), userId);
    res.json({ data: items });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════
// Feature 38: Favorites/bookmarks
// ═══════════════════════════════════════════════════════════
router.get('/favorites', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const user = db.prepare('SELECT favorites FROM users WHERE id = ?').get(userId) as any;
    const items = JSON.parse(user?.favorites || '[]');
    res.json({ data: items });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/favorites', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const { entity_type, entity_id, title } = req.body;
    if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_type and entity_id required' });

    const user = db.prepare('SELECT favorites FROM users WHERE id = ?').get(userId) as any;
    let items = JSON.parse(user?.favorites || '[]');
    // Don't add duplicates
    if (!items.find((i: any) => i.entity_type === entity_type && i.entity_id === entity_id)) {
      items.push({ entity_type, entity_id, title: title || '', added_at: new Date().toISOString() });
    }

    db.prepare('UPDATE users SET favorites = ? WHERE id = ?').run(JSON.stringify(items), userId);
    res.json({ data: items });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/favorites/:entity_type/:entity_id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const user = db.prepare('SELECT favorites FROM users WHERE id = ?').get(userId) as any;
    let items = JSON.parse(user?.favorites || '[]');
    items = items.filter((i: any) => !(i.entity_type === req.params.entity_type && String(i.entity_id) === req.params.entity_id));
    db.prepare('UPDATE users SET favorites = ? WHERE id = ?').run(JSON.stringify(items), userId);
    res.json({ data: items });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

export default router;
