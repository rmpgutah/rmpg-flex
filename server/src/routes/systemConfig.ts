import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateParamId, quoteIdent } from '../middleware/sanitize';
import { localNow } from '../utils/timeUtils';

// Allowed categories — reject unknown values to prevent enumeration
const ALLOWED_CATEGORIES = new Set([
  'incident_types', 'priorities', 'statuses', 'dispositions', 'unit_types',
  'beats', 'zones', 'sections', 'signal_codes', 'ten_codes', 'radio_channels',
  'tow_companies', 'hospitals', 'agencies', 'evidence_types', 'property_types',
  'vehicle_colors', 'vehicle_makes', 'pso_service_types', 'general',
]);

// Truncate config values in audit log entries to prevent log injection / info disclosure
function redactForLog(value: string, maxLen = 100): string {
  if (!value) return '(empty)';
  const safe = value.replace(/[\r\n\t]/g, ' ').slice(0, maxLen);
  return safe.length < value.length ? safe + '...' : safe;
}

const router = Router();

router.use(authenticateToken);

// GET /api/admin/config/:category - Get config items by category
router.get('/config/:category', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const category = String(req.params.category);
    // Validate category against whitelist to prevent enumeration of arbitrary values
    if (!ALLOWED_CATEGORIES.has(category)) {
      res.status(400).json({ error: 'Invalid category' });
      return;
    }
    const db = getDb();
    const items = db.prepare(`
      SELECT * FROM system_config
      WHERE category = ? AND is_active = 1
      ORDER BY sort_order ASC
    `).all(category);

    res.json(items);
  } catch (error: any) {
    console.error('Get config error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/config - Get all active config
router.get('/config', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const items = db.prepare(`
      SELECT * FROM system_config
      WHERE is_active = 1
      ORDER BY category, sort_order ASC
    `).all();

    // Group by category
    const grouped: Record<string, any[]> = {};
    for (const item of items as any[]) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }

    res.json(grouped);
  } catch (error: any) {
    console.error('Get all config error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/config - Add config item (admin/manager only)
router.post('/config', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { config_key, config_value, category } = req.body;

    if (!config_key || !config_value || !category) {
      res.status(400).json({ error: 'config_key, config_value, and category are required' });
      return;
    }

    // Get next sort order for this category
    const maxOrder = db.prepare(
      'SELECT MAX(sort_order) as max_order FROM system_config WHERE category = ?'
    ).get(category) as any;
    const sortOrder = (maxOrder?.max_order ?? -1) + 1;

    const now = localNow();

    const result = db.prepare(`
      INSERT INTO system_config (config_key, config_value, category, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(config_key, config_value, category, sortOrder, now, now);

    const item = db.prepare('SELECT * FROM system_config WHERE id = ?').get(result.lastInsertRowid);
    if (!item) { res.status(500).json({ error: 'Failed to retrieve created config' }); return; }

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'config_created', 'system_config', ?, ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Added config: ${redactForLog(config_key)} = ${redactForLog(String(config_value))}`, req.ip || 'unknown', localNow());

    res.status(201).json(item);
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      res.status(409).json({ error: 'This configuration value already exists' });
      return;
    }
    console.error('Create config error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/config/:id - Update config item
router.put('/config/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const item = db.prepare('SELECT * FROM system_config WHERE id = ?').get(req.params.id) as any;
    if (!item) {
      res.status(404).json({ error: 'Config item not found' });
      return;
    }

    const now = localNow();
    // Whitelist of updatable columns — quoteIdent adds defense-in-depth SQL identifier quoting
    const cfgFields = ['config_value', 'sort_order', 'is_active'] as const;
    const cfgBodyKeys = Object.keys(req.body);
    const cfgSet: string[] = [];
    const cfgVals: any[] = [];
    for (const f of cfgFields) {
      if (cfgBodyKeys.includes(f)) {
        cfgSet.push(`${quoteIdent(f)} = ?`);
        const v = req.body[f];
        cfgVals.push(v === '' ? null : v ?? null);
      }
    }
    if (cfgSet.length > 0) {
      cfgSet.push(`${quoteIdent('updated_at')} = ?`);
      cfgVals.push(now, item.id);
      db.prepare(`UPDATE system_config SET ${cfgSet.join(', ')} WHERE id = ?`).run(...cfgVals);
    }

    const updated = db.prepare('SELECT * FROM system_config WHERE id = ?').get(item.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update config error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/config/:id - Soft-delete config item (set is_active = 0)
router.delete('/config/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const item = db.prepare('SELECT * FROM system_config WHERE id = ?').get(req.params.id) as any;
    if (!item) {
      res.status(404).json({ error: 'Config item not found' });
      return;
    }

    const now = localNow();
    db.prepare('UPDATE system_config SET is_active = 0, updated_at = ? WHERE id = ?').run(now, item.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'config_deleted', 'system_config', ?, ?, ?, ?)
    `).run(req.user!.userId, item.id, `Removed config: ${redactForLog(item.config_key)} = ${redactForLog(String(item.config_value))}`, req.ip || 'unknown', now);

    res.json({ message: 'Config item removed' });
  } catch (error: any) {
    console.error('Delete config error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
