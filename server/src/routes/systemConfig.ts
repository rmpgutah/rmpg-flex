import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';

const router = Router();

router.use(authenticateToken);

// GET /api/admin/config/:category - Get config items by category
router.get('/config/:category', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const items = db.prepare(`
      SELECT * FROM system_config
      WHERE category = ? AND is_active = 1
      ORDER BY sort_order ASC
    
      LIMIT 1000
    `).all(String(req.params.category));

    res.json(items);
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Get config error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Get config error:', error);
    res.status(500).json({ error: 'Failed to get config', code: 'GET_CONFIG_ERROR' });
>>>>>>> origin/main
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
    
      LIMIT 1000
    `).all();

    // Group by category
    const grouped: Record<string, any[]> = {};
    for (const item of items as any[]) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }

    res.json(grouped);
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Get all config error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Get all config error:', error);
    res.status(500).json({ error: 'Failed to get all config', code: 'GET_ALL_CONFIG_ERROR' });
>>>>>>> origin/main
  }
});

// POST /api/admin/config - Add config item (admin/manager only)
router.post('/config', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { config_key, config_value, category } = req.body;

    if (!config_key || !config_value || !category) {
      res.status(400).json({ error: 'config_key, config_value, and category are required', code: 'CONFIGKEY_CONFIGVALUE_AND_CATEGORY' });
      return;
    }
    if (typeof config_key !== 'string' || config_key.length > 200) {
      res.status(400).json({ error: 'config_key must be a string of 200 characters or less', code: 'INVALID_CONFIG_KEY' });
      return;
    }
    if (typeof category !== 'string' || category.length > 100) {
      res.status(400).json({ error: 'category must be a string of 100 characters or less', code: 'INVALID_CATEGORY' });
      return;
    }
    if (typeof config_value === 'string' && config_value.length > 10000) {
      res.status(400).json({ error: 'config_value must be 10000 characters or less', code: 'CONFIG_VALUE_TOO_LONG' });
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

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'config_created', 'system_config', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Added config: ${config_key} = ${config_value}`, req.ip || 'unknown');

    res.status(201).json(item);
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      res.status(409).json({ error: 'This configuration value already exists', code: 'THIS_CONFIGURATION_VALUE_ALREADY' });
      return;
    }
<<<<<<< HEAD
    console.error('Create config error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Create config error:', error);
    res.status(500).json({ error: 'Failed to create config', code: 'CREATE_CONFIG_ERROR' });
>>>>>>> origin/main
  }
});

// PUT /api/admin/config/:id - Update config item
router.put('/config/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const item = db.prepare('SELECT * FROM system_config WHERE id = ?').get(req.params.id) as any;
    if (!item) {
      res.status(404).json({ error: 'Config item not found', code: 'CONFIG_ITEM_NOT_FOUND' });
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
      cfgVals.push(now, item.id);
      db.prepare(`UPDATE system_config SET ${cfgSet.join(', ')} WHERE id = ?`).run(...cfgVals);
    }

    // Audit log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'config_updated', 'system_config', ?, ?, ?)
    `).run(req.user!.userId, item.id, `Updated config: ${item.config_key}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM system_config WHERE id = ?').get(item.id);
    res.json(updated);
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Update config error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Update config error:', error);
    res.status(500).json({ error: 'Failed to update config', code: 'UPDATE_CONFIG_ERROR' });
>>>>>>> origin/main
  }
});

// DELETE /api/admin/config/:id - Soft-delete config item (set is_active = 0)
router.delete('/config/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const item = db.prepare('SELECT * FROM system_config WHERE id = ?').get(req.params.id) as any;
    if (!item) {
      res.status(404).json({ error: 'Config item not found', code: 'CONFIG_ITEM_NOT_FOUND' });
      return;
    }

    const now = localNow();
    db.prepare('UPDATE system_config SET is_active = 0, updated_at = ? WHERE id = ?').run(now, item.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'config_deleted', 'system_config', ?, ?, ?)
    `).run(req.user!.userId, item.id, `Removed config: ${item.config_key} = ${item.config_value}`, req.ip || 'unknown');

    res.json({ message: 'Config item removed' });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Delete config error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Delete config error:', error);
    res.status(500).json({ error: 'Failed to delete config', code: 'DELETE_CONFIG_ERROR' });
  }
});

// ══════════════════════════════════════════════════════════════════
// SYSTEM CONFIG UPGRADES
// ══════════════════════════════════════════════════════════════════

// ── Upgrade 36: Config versioning / history ─────────────────────
router.get('/config-history', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { category, config_key, limit: qLimit = '50' } = req.query;
    const limitNum = Math.min(500, parseInt(qLimit as string, 10) || 50);

    let where = '';
    const params: any[] = [];

    if (category) {
      where += (where ? ' AND' : ' WHERE') + ' al.details LIKE ?';
      params.push(`%${category}%`);
    }
    if (config_key) {
      where += (where ? ' AND' : ' WHERE') + ' al.details LIKE ?';
      params.push(`%${config_key}%`);
    }

    // Pull config changes from activity_log
    const history = db.prepare(`
      SELECT al.id, al.user_id, al.action, al.details, al.created_at,
        u.full_name as user_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = 'system_config' ${where ? 'AND ' + where.replace('WHERE', '') : ''}
      ORDER BY al.created_at DESC
      LIMIT ?
    `).all(...params, limitNum);

    res.json({ data: history });
  } catch (error: any) {
    console.error('Config history error:', error);
    res.status(500).json({ error: 'Failed to get config history', code: 'CONFIG_HISTORY_ERROR' });
  }
});

// ── Upgrade 37: Config export (download all config as JSON) ─────
router.get('/config-export', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { category } = req.query;

    let where = 'WHERE is_active = 1';
    const params: any[] = [];
    if (category) {
      where += ' AND category = ?';
      params.push(category);
    }

    const items = db.prepare(`
      SELECT id, config_key, config_value, category, sort_order, is_active, created_at, updated_at
      FROM system_config ${where}
      ORDER BY category, sort_order
    `).all(...params);

    const exportData = {
      exported_at: localNow(),
      exported_by: req.user!.fullName,
      version: '1.0',
      item_count: items.length,
      items,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="system-config-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(exportData);
  } catch (error: any) {
    console.error('Config export error:', error);
    res.status(500).json({ error: 'Failed to export config', code: 'CONFIG_EXPORT_ERROR' });
  }
});

// ── Upgrade 38: Config import (restore from JSON) ───────────────
router.post('/config-import', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { items, mode = 'merge' } = req.body;

    if (!items || !Array.isArray(items)) {
      res.status(400).json({ error: 'items array is required', code: 'ITEMS_REQUIRED' });
      return;
    }

    const now = localNow();
    let imported = 0;
    let skipped = 0;
    let updated = 0;

    const tx = db.transaction(() => {
      for (const item of items) {
        if (!item.config_key || !item.category) { skipped++; continue; }

        const existing = db.prepare(
          'SELECT id FROM system_config WHERE config_key = ? AND category = ?'
        ).get(item.config_key, item.category) as any;

        if (existing) {
          if (mode === 'merge' || mode === 'overwrite') {
            db.prepare(`
              UPDATE system_config SET config_value = ?, sort_order = ?, updated_at = ?
              WHERE config_key = ? AND category = ?
            `).run(item.config_value, item.sort_order || 0, now, item.config_key, item.category);
            updated++;
          } else {
            skipped++;
          }
        } else {
          db.prepare(`
            INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
          `).run(item.config_key, item.config_value, item.category, item.sort_order || 0, now, now);
          imported++;
        }
      }
    });
    tx();

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'config_imported', 'system_config', 0, ?, ?)
    `).run(req.user!.userId, `Imported config: ${imported} new, ${updated} updated, ${skipped} skipped`, req.ip || 'unknown');

    res.json({ imported, updated, skipped, total: items.length });
  } catch (error: any) {
    console.error('Config import error:', error);
    res.status(500).json({ error: 'Failed to import config', code: 'CONFIG_IMPORT_ERROR' });
  }
});

// ── Upgrade 39: Config categories list ──────────────────────────
router.get('/config-categories', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const categories = db.prepare(`
      SELECT category, COUNT(*) as item_count,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count,
        MAX(updated_at) as last_updated
      FROM system_config
      GROUP BY category
      ORDER BY category
    `).all();

    res.json({ data: categories });
  } catch (error: any) {
    console.error('Config categories error:', error);
    res.status(500).json({ error: 'Failed to get config categories', code: 'CONFIG_CATEGORIES_ERROR' });
  }
});

// ── Upgrade 40: Config diff (compare two versions) ──────────────
router.get('/config-diff', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { category } = req.query;
    if (!category) { res.status(400).json({ error: 'category required', code: 'CATEGORY_REQUIRED' }); return; }

    // Current active config
    const current = db.prepare(`
      SELECT config_key, config_value FROM system_config
      WHERE category = ? AND is_active = 1 ORDER BY config_key
    `).all(category) as any[];

    // Inactive/deleted config for same category
    const inactive = db.prepare(`
      SELECT config_key, config_value FROM system_config
      WHERE category = ? AND is_active = 0 ORDER BY config_key
    `).all(category) as any[];

    const currentMap = new Map(current.map(c => [c.config_key, c.config_value]));
    const inactiveMap = new Map(inactive.map(c => [c.config_key, c.config_value]));

    const diff: any[] = [];
    for (const [key, value] of currentMap) {
      if (inactiveMap.has(key)) {
        if (inactiveMap.get(key) !== value) {
          diff.push({ key, status: 'changed', current: value, previous: inactiveMap.get(key) });
        }
      } else {
        diff.push({ key, status: 'added', current: value });
      }
    }
    for (const [key, value] of inactiveMap) {
      if (!currentMap.has(key)) {
        diff.push({ key, status: 'removed', previous: value });
      }
    }

    res.json({ category, diff, current_count: current.length, inactive_count: inactive.length });
  } catch (error: any) {
    console.error('Config diff error:', error);
    res.status(500).json({ error: 'Failed to get config diff', code: 'CONFIG_DIFF_ERROR' });
>>>>>>> origin/main
  }
});

export default router;
