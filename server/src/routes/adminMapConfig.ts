import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import { decryptConfigValue } from '../utils/configEncryption';

const router = Router();
router.use(authenticateToken);

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

// GET /api/admin/map-config - Get full map settings
router.get('/map-config', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = ? AND is_active = 1 LIMIT 1"
    ).get(CONFIG_KEY, CATEGORY) as { config_value: string } | undefined;

    const settings = row ? { ...DEFAULT_SETTINGS, ...JSON.parse(row.config_value) } : { ...DEFAULT_SETTINGS };
    res.json(settings);
  } catch (error: any) {
    console.error('Get map config error:', error);
    res.status(500).json({ error: 'Failed to get map config', code: 'MAP_CONFIG_GET_ERROR' });
  }
});

// PUT /api/admin/map-config - Save full map settings
router.put('/map-config', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const body = req.body;

    const merged = { ...DEFAULT_SETTINGS, ...body };
    const configValue = JSON.stringify(merged);

    const existing = db.prepare(
      "SELECT id FROM system_config WHERE config_key = ? AND category = ? AND is_active = 1 LIMIT 1"
    ).get(CONFIG_KEY, CATEGORY) as { id: number } | undefined;

    const now = localNow();

    if (existing) {
      db.prepare(
        "UPDATE system_config SET config_value = ?, updated_at = ? WHERE id = ?"
      ).run(configValue, now, existing.id);
    } else {
      db.prepare(
        "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, 0, 1, ?, ?)"
      ).run(CONFIG_KEY, configValue, CATEGORY, now, now);
    }

    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'config_updated', 'system_config', 0, ?, ?)"
    ).run(req.user!.userId, `Updated map settings`, req.ip || 'unknown');

    res.json(merged);
  } catch (error: any) {
    console.error('Save map config error:', error);
    res.status(500).json({ error: 'Failed to save map config', code: 'MAP_CONFIG_SAVE_ERROR' });
  }
});

// GET /api/admin/mapbox-config - Resolve Mapbox access token (fixes dead endpoint in mapboxLoader.ts)
router.get('/mapbox-config', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'mapbox_access_token' AND is_active = 1 LIMIT 1"
    ).get() as { config_value: string } | undefined;

    let token = row?.config_value || '';
    if (token) {
      try {
        token = decryptConfigValue(token);
      } catch {
        // Not encrypted — return as-is (e.g. stored via Worker path)
      }
    }

    res.json({ mapbox_access_token: token });
  } catch (error: any) {
    console.error('Get mapbox config error:', error);
    res.status(500).json({ error: 'Failed to get mapbox config', code: 'MAPBOX_CONFIG_GET_ERROR' });
  }
});

export default router;
