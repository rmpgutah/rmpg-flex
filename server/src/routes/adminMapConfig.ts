import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import { decryptApiKey } from '../utils/serveManagerClient';

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
  default_pitch: 0,
  default_bearing: 0,
  min_pitch: 0,
  max_pitch: 85,
  scroll_zoom: true,
  box_zoom: true,
  drag_rotate: true,
  drag_pan: true,
  double_click_zoom: true,
  touch_zoom_rotate: true,
  cooperative_gestures: false,
  show_compass: true,
  show_zoom_controls: true,
  keyboard_enabled: true,
  language: '',
  render_world_copies: true,
  fade_duration: 300,
  click_tolerance: 3,
  local_ideograph_font_family: '',
  cross_source_collisions: true,
  default_visible_layers: ['county', 'beat'],
  layer_beat_fill: '#22c55e',
  layer_beat_fill_opacity: 0.2,
  layer_beat_stroke: '#22c55e',
  layer_beat_stroke_opacity: 0.6,
  layer_beat_stroke_weight: 1.2,
  layer_beat_min_zoom: 10,
  layer_county_fill: '#141414',
  layer_county_fill_opacity: 0.15,
  layer_county_stroke: '#444444',
  layer_county_stroke_opacity: 0.5,
  layer_county_stroke_weight: 1.5,
  layer_county_min_zoom: 8,
  layer_municipality_fill: '#a855f7',
  layer_municipality_fill_opacity: 0.06,
  layer_municipality_stroke: '#a855f7',
  layer_municipality_stroke_opacity: 0.35,
  layer_municipality_stroke_weight: 1,
  layer_municipality_min_zoom: 9,
  layer_highway_stroke: '#ef4444',
  layer_highway_stroke_opacity: 0.6,
  layer_highway_stroke_weight: 3,
  layer_state_boundary_stroke: '#ffffff',
  layer_state_boundary_stroke_opacity: 0.3,
  layer_state_boundary_stroke_weight: 2,
  layer_place_fill: '#22c55e',
  layer_place_fill_opacity: 0.7,
  layer_place_stroke: '#22c55e',
  layer_place_stroke_opacity: 0.9,
  layer_place_stroke_weight: 1,
  layer_place_min_zoom: 10,
  gps_batch_interval_ms: 5000,
  gps_max_accuracy_meters: 100,
  gps_max_speed_ms: 80,
  gps_high_accuracy: true,
  screenshot_width: 1280,
  screenshot_height: 720,
  screenshot_style: 'dark',
  unit_marker_pulse: true,
  call_marker_pulse: true,
  marker_font_size: 9,
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

    res.json({ mapbox_access_token: row?.config_value || '' });
  } catch (error: any) {
    console.error('Get mapbox config error:', error);
    res.status(500).json({ error: 'Failed to get mapbox config', code: 'MAPBOX_CONFIG_GET_ERROR' });
  }
});

export default router;
