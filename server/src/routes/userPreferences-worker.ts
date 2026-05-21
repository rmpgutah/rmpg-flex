import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken } from '../worker-middleware/auth';
import { D1Db, localNow } from '../worker-middleware/d1Helpers';

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

const ALLOWED_FIELDS = new Set(Object.keys(DEFAULTS));

export function mountUserPreferencesRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/user/preferences
  api.get('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const userId = c.get('user').userId;

      let prefs = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId) as any;

      if (!prefs) {
        return c.json({ ...DEFAULTS, user_id: userId });
      }

      return c.json(prefs);
    } catch {
      return c.json({ error: 'Failed to get user preferences', code: 'FAILED_TO_GET_USER' }, 500);
    }
  });

  // PUT /api/user/preferences — partial update
  api.put('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const userId = c.get('user').userId;
      const updates = await c.req.json();

      if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        return c.json({ error: 'Request body must be an object', code: 'REQUEST_BODY_MUST_BE' }, 400);
      }

      if (Object.keys(updates).length > 50) {
        return c.json({ error: 'Too many fields in request', code: 'TOO_MANY_FIELDS_IN' }, 400);
      }

      const validUpdates: Record<string, any> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (ALLOWED_FIELDS.has(key)) {
          if (value !== null && typeof value === 'object') {
            if (key === 'dashboard_widgets' && typeof value === 'object') {
              validUpdates[key] = JSON.stringify(value);
              continue;
            }
            return c.json({ error: `Invalid value type for ${key}` }, 400);
          }
          if (key === 'font_scale' && (typeof value !== 'number' || value < 0.5 || value > 3.0)) {
            return c.json({ error: 'font_scale must be between 0.5 and 3.0', code: 'FONTSCALE_MUST_BE_BETWEEN' }, 400);
          }
          if (/^notify_/.test(key) && key !== 'notify_credential_email' && value !== 0 && value !== 1 && value !== true && value !== false) {
            return c.json({ error: `${key} must be 0 or 1` }, 400);
          }
          if (key === 'compact_mode' && value !== 0 && value !== 1 && value !== true && value !== false) {
            return c.json({ error: 'compact_mode must be 0 or 1', code: 'COMPACTMODE_MUST_BE_0' }, 400);
          }
          if (key === 'show_map_labels' && value !== 0 && value !== 1 && value !== true && value !== false) {
            return c.json({ error: 'show_map_labels must be 0 or 1', code: 'SHOWMAPLABELS_MUST_BE_0' }, 400);
          }
          if (key === 'dispatch_show_cleared' && value !== 0 && value !== 1 && value !== true && value !== false) {
            return c.json({ error: 'dispatch_show_cleared must be 0 or 1', code: 'DISPATCHSHOWCLEARED_MUST_BE_0' }, 400);
          }
          if (key === 'default_map_style' && typeof value === 'string' && !['dark', 'light', 'satellite', 'terrain'].includes(value)) {
            return c.json({ error: 'Invalid default_map_style', code: 'INVALID_DEFAULTMAPSTYLE' }, 400);
          }
          if (key === 'dispatch_sort' && typeof value === 'string' && !['priority', 'time', 'status'].includes(value)) {
            return c.json({ error: 'Invalid dispatch_sort value', code: 'INVALID_DISPATCHSORT_VALUE' }, 400);
          }
          if (typeof value === 'string' && value.length > 5000) {
            return c.json({ error: `Value for ${key} is too long` }, 400);
          }
          validUpdates[key] = value;
        }
      }

      if (Object.keys(validUpdates).length === 0) {
        return c.json({ error: 'No valid preference fields provided', code: 'NO_VALID_PREFERENCE_FIELDS' }, 400);
      }

      const existing = await db.prepare('SELECT user_id FROM user_preferences WHERE user_id = ?').get(userId);
      if (!existing) {
        await db.prepare('INSERT INTO user_preferences (user_id) VALUES (?)').run(userId);
      }

      const setClauses: string[] = [];
      const values: any[] = [];
      for (const [key, value] of Object.entries(validUpdates)) {
        setClauses.push(`${key} = ?`);
        values.push(value);
      }
      setClauses.push('updated_at = ?');
      values.push(localNow());
      values.push(userId);

      await db.prepare(`UPDATE user_preferences SET ${setClauses.join(', ')} WHERE user_id = ?`).run(...values);

      const updated = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);

      return c.json(updated);
    } catch {
      return c.json({ error: 'Failed to update user preferences', code: 'FAILED_TO_UPDATE_USER' }, 500);
    }
  });

  // POST /api/user/preferences/reset — reset to defaults
  api.post('/reset', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const userId = c.get('user').userId;

      await db.prepare('DELETE FROM user_preferences WHERE user_id = ?').run(userId);

      return c.json({ ...DEFAULTS, user_id: userId });
    } catch {
      return c.json({ error: 'Failed to reset user preferences', code: 'FAILED_TO_RESET_USER' }, 500);
    }
  });

  // Feature 37: Recently viewed items
  api.get('/recently-viewed', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const userId = c.get('user').userId;
      const user = await db.prepare('SELECT recently_viewed FROM users WHERE id = ?').get(userId) as any;
      let items: any[] = [];
      try { items = JSON.parse(user?.recently_viewed || '[]'); } catch { items = []; }
      return c.json({ data: items });
    } catch {
      return c.json({ error: 'Server error in userPreferences', code: 'USERPREFERENCES_ERROR' }, 500);
    }
  });

  api.post('/recently-viewed', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const userId = c.get('user').userId;
      const body = await c.req.json();
      const { entity_type, entity_id, title } = body;
      if (!entity_type || !entity_id) return c.json({ error: 'entity_type and entity_id required', code: 'ENTITYTYPE_AND_ENTITYID_REQUIRED' }, 400);

      const user = await db.prepare('SELECT recently_viewed FROM users WHERE id = ?').get(userId) as any;
      let items: any[];
      try { items = JSON.parse(user?.recently_viewed || '[]'); } catch { items = []; }
      items = items.filter((i: any) => !(i.entity_type === entity_type && i.entity_id === entity_id));
      items.unshift({ entity_type, entity_id, title: title || '', viewed_at: localNow() });
      items = items.slice(0, 20);

      await db.prepare('UPDATE users SET recently_viewed = ? WHERE id = ?').run(JSON.stringify(items), userId);
      return c.json({ data: items });
    } catch {
      return c.json({ error: 'Server error in userPreferences', code: 'USERPREFERENCES_ERROR' }, 500);
    }
  });

  // Feature 38: Favorites/bookmarks
  api.get('/favorites', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const userId = c.get('user').userId;
      const user = await db.prepare('SELECT favorites FROM users WHERE id = ?').get(userId) as any;
      let items: any[] = [];
      try { items = JSON.parse(user?.favorites || '[]'); } catch { items = []; }
      return c.json({ data: items });
    } catch {
      return c.json({ error: 'Server error in userPreferences', code: 'USERPREFERENCES_ERROR' }, 500);
    }
  });

  api.post('/favorites', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const userId = c.get('user').userId;
      const body = await c.req.json();
      const { entity_type, entity_id, title } = body;
      if (!entity_type || !entity_id) return c.json({ error: 'entity_type and entity_id required', code: 'ENTITYTYPE_AND_ENTITYID_REQUIRED' }, 400);

      const user = await db.prepare('SELECT favorites FROM users WHERE id = ?').get(userId) as any;
      let items: any[];
      try { items = JSON.parse(user?.favorites || '[]'); } catch { items = []; }
      if (!items.find((i: any) => i.entity_type === entity_type && i.entity_id === entity_id)) {
        items.push({ entity_type, entity_id, title: title || '', added_at: localNow() });
      }

      await db.prepare('UPDATE users SET favorites = ? WHERE id = ?').run(JSON.stringify(items), userId);
      return c.json({ data: items });
    } catch {
      return c.json({ error: 'Server error in userPreferences', code: 'USERPREFERENCES_ERROR' }, 500);
    }
  });

  api.delete('/favorites/:entity_type/:entity_id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const userId = c.get('user').userId;
      const entityType = c.req.param('entity_type');
      const entityId = c.req.param('entity_id');
      const user = await db.prepare('SELECT favorites FROM users WHERE id = ?').get(userId) as any;
      let items: any[] = [];
      try { items = JSON.parse(user?.favorites || '[]'); } catch { items = []; }
      items = items.filter((i: any) => !(i.entity_type === entityType && String(i.entity_id) === entityId));
      await db.prepare('UPDATE users SET favorites = ? WHERE id = ?').run(JSON.stringify(items), userId);
      return c.json({ data: items });
    } catch {
      return c.json({ error: 'Server error in userPreferences', code: 'USERPREFERENCES_ERROR' }, 500);
    }
  });

  app.route('/api/user/preferences', api);
}
