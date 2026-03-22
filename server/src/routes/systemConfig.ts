import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateParamId } from '../middleware/sanitize';
import { localNow } from '../utils/timeUtils';
import { auditLog } from '../utils/auditLogger';
import { sendCsv } from '../utils/csvExport';

const router = Router();

router.use(authenticateToken);

// Allowed config categories — prevents arbitrary table scanning
const ALLOWED_CATEGORIES = new Set([
  'incident_types', 'priorities', 'dispositions', 'unit_statuses', 'call_sources',
  'integrations', 'settings', 'email', 'patrol', 'radio', 'fleet', 'tones',
  'bolo_types', 'warrant_types', 'property_types', 'shift_plans', 'notifications',
]);

// GET /api/admin/config/:category - Get config items by category
router.get('/config/:category', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const category = String(req.params.category);
    if (category.length > 100) {
      res.status(400).json({ error: 'Category name too long' });
      return;
    }
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

    // Validate types and lengths
    if (typeof config_key !== 'string' || config_key.length > 200) {
      res.status(400).json({ error: 'config_key must be a string of 200 characters or less' });
      return;
    }
    if (typeof config_value !== 'string' || config_value.length > 10000) {
      res.status(400).json({ error: 'config_value must be a string of 10000 characters or less' });
      return;
    }
    if (typeof category !== 'string' || category.length > 100) {
      res.status(400).json({ error: 'category must be a string of 100 characters or less' });
      return;
    }
    // Reject config_key containing SQL-risky characters
    if (!/^[\w\-.]+$/.test(config_key)) {
      res.status(400).json({ error: 'config_key contains invalid characters' });
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

    const item = db.prepare('SELECT * FROM system_config WHERE id = ?').get(Number(result.lastInsertRowid));
    if (!item) { res.status(500).json({ error: 'Failed to retrieve created config' }); return; }

    // Log activity
    auditLog(req, 'CREATE', 'system_config', Number(result.lastInsertRowid),
      `Added config: ${config_key} = ${/secret|password|token|key|smtp_pass/i.test(config_key) ? '[REDACTED]' : config_value}`);

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
    const cfgFields = ['config_value', 'sort_order', 'is_active'];
    const cfgBodyKeys = Object.keys(req.body);
    const cfgSet: string[] = [];
    const cfgVals: any[] = [];
    for (const f of cfgFields) {
      if (cfgBodyKeys.includes(f)) {
        cfgSet.push(`${f} = ?`);
        const v = req.body[f];
        cfgVals.push(v === '' ? null : v ?? null);
      }
    }
    if (cfgSet.length > 0) {
      cfgSet.push(`updated_at = ?`);
      cfgVals.push(now);
      cfgVals.push(item.id); // WHERE id = ? must be last parameter
      db.prepare(`UPDATE system_config SET ${cfgSet.join(', ')} WHERE id = ?`).run(...cfgVals);
    }

    auditLog(req, 'UPDATE', 'system_config', item.id, `Updated config: ${item.config_key}`);
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

    auditLog(req, 'DELETE', 'system_config', item.id,
      `Removed config: ${item.config_key} = ${/secret|password|token|key|smtp_pass/i.test(item.config_key) ? '[REDACTED]' : item.config_value}`);

    res.json({ message: 'Config item removed' });
  } catch (error: any) {
    console.error('Delete config error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/admin/config/export/csv — Export system configuration as CSV
// ============================================================
router.get('/config/export/csv', requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM system_config
      WHERE is_active = 1
      ORDER BY category, sort_order ASC
    `).all();

    sendCsv(res, `system_config_export_${localNow().slice(0, 10)}.csv`, [
      { key: 'id', header: 'ID' },
      { key: 'config_key', header: 'Key' },
      { key: 'config_value', header: 'Value' },
      { key: 'category', header: 'Category' },
      { key: 'sort_order', header: 'Sort Order' },
      { key: 'is_active', header: 'Active' },
      { key: 'created_at', header: 'Created At' },
      { key: 'updated_at', header: 'Updated At' },
    ], rows);
  } catch (error: any) {
    console.error('Export config error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
