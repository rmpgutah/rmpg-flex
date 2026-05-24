import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, localNow } from '../worker-middleware/d1Helpers';
import { auditLog } from '../worker-middleware/auditLogger';
import { deriveCryptoKey } from './integrations-worker';

const CONFIG_KEY = 'map_settings';
const CATEGORY = 'map_settings';

const DEFAULT_SETTINGS = {
  default_center_lat: 40.7608,
  default_center_lng: -111.891,
  default_zoom: 12,
  min_zoom: 1,
  max_zoom: 22,
  default_style: 'dark',
  enabled_styles: ['dark', 'night_nav', 'satellite', 'streets', 'terrain', 'light'],
  show_attribution: false,
  rotation_enabled: false,
  max_bounds_sw_lat: null,
  max_bounds_sw_lng: null,
  max_bounds_ne_lat: null,
  max_bounds_ne_lng: null,
  custom_style_url: '',
  clustering_enabled: true,
  cluster_radius: 50,
  cluster_max_zoom: 14,
};

export function mountAdminMapConfigRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/admin/map-config
  api.get('/map-config', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const row = await db.prepare(
        "SELECT config_value FROM system_config WHERE config_key = ? AND category = ? AND is_active = 1 LIMIT 1"
      ).get(CONFIG_KEY, CATEGORY) as { config_value: string } | null;

      const settings = row ? { ...DEFAULT_SETTINGS, ...JSON.parse(row.config_value) } : { ...DEFAULT_SETTINGS };
      return c.json(settings);
    } catch (error: any) {
      return c.json({ error: 'Failed to get map config', code: 'MAP_CONFIG_GET_ERROR' }, 500);
    }
  });

  // PUT /api/admin/map-config
  api.put('/map-config', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const merged = { ...DEFAULT_SETTINGS, ...body };
      const configValue = JSON.stringify(merged);

      const existing = await db.prepare(
        "SELECT id FROM system_config WHERE config_key = ? AND category = ? AND is_active = 1 LIMIT 1"
      ).get(CONFIG_KEY, CATEGORY) as { id: number } | null;

      const now = localNow();

      if (existing) {
        await db.prepare(
          "UPDATE system_config SET config_value = ?, updated_at = ? WHERE id = ?"
        ).run(configValue, now, existing.id);
      } else {
        await db.prepare(
          "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, 0, 1, ?, ?)"
        ).run(CONFIG_KEY, configValue, CATEGORY, now, now);
      }

      await auditLog(db, c, 'config_updated', 'system_config', 0, 'Updated map settings');
      return c.json(merged);
    } catch (error: any) {
      return c.json({ error: 'Failed to save map config', code: 'MAP_CONFIG_SAVE_ERROR' }, 500);
    }
  });

  // GET /api/admin/mapbox-config - Fix dead endpoint in mapboxLoader.ts
  // Checks env var first, then DB (which stores raw on Worker — no encryption).
  api.get('/mapbox-config', async (c) => {
    try {
      const envToken = ((c.env as any).MAPBOX_ACCESS_TOKEN || '').trim();
      if (envToken) {
        return c.json({ mapbox_access_token: envToken });
      }

      const db = new D1Db(c.env.DB);
      const row = await db.prepare(
        "SELECT config_value FROM system_config WHERE config_key = 'mapbox_access_token' AND is_active = 1 LIMIT 1"
      ).get() as { config_value: string } | null;

      // Attempt decryption in case token was stored in encrypted format,
      // fall back to raw value
      let token = row?.config_value || '';
      if (token && token.includes(':') && c.env.JWT_SECRET) {
        try {
          const key = await deriveCryptoKey(String(c.env.JWT_SECRET));
          const parts = token.split(':');
          if (parts.length === 3) {
            const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
            const iv = fromHex(parts[0]);
            const authTag = fromHex(parts[1]);
            const ciphertext = fromHex(parts[2]);
            const combined = new Uint8Array(ciphertext.length + authTag.length);
            combined.set(ciphertext);
            combined.set(authTag, ciphertext.length);
            const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined);
            token = new TextDecoder().decode(decrypted);
          }
        } catch { /* not encrypted — use raw */ }
      }

      return c.json({ mapbox_access_token: token });
    } catch (error: any) {
      return c.json({ mapbox_access_token: '' });
    }
  });

  app.route('/api/admin', api);
}
