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
    `).all(String(req.params.category));

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
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'config_created', 'system_config', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Added config: ${config_key} = ${config_value}`, req.ip || 'unknown');

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
router.put('/config/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
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
router.delete('/config/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
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
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'config_deleted', 'system_config', ?, ?, ?)
    `).run(req.user!.userId, item.id, `Removed config: ${item.config_key} = ${item.config_value}`, req.ip || 'unknown');

    res.json({ message: 'Config item removed' });
  } catch (error: any) {
    console.error('Delete config error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
