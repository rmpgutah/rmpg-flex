import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow } from '../worker-middleware/d1Helpers';
import { auditLog } from '../worker-middleware/auditLogger';

export function mountSystemConfigRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/admin/config/:category - Get config items by category
  api.get('/config/:category', async (c) => {
    const db = new D1Db(c.env.DB);
    const category = c.req.param('category');
    try {
      const items = await db.prepare(`
        SELECT * FROM system_config
        WHERE category = ? AND is_active = 1
        ORDER BY sort_order ASC
        LIMIT 1000
      `).all(category);
      return c.json(items);
    } catch (error: any) {
      return c.json({ error: 'Failed to get config', code: 'GET_CONFIG_ERROR' }, 500);
    }
  });

  // GET /api/admin/config - Get all active config
  api.get('/config', async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const items = await db.prepare(`
        SELECT * FROM system_config
        WHERE is_active = 1
        ORDER BY category, sort_order ASC
        LIMIT 1000
      `).all();

      const grouped: Record<string, any[]> = {};
      for (const item of items as any[]) {
        if (!grouped[item.category]) grouped[item.category] = [];
        grouped[item.category].push(item);
      }

      return c.json(grouped);
    } catch (error: any) {
      return c.json({ error: 'Failed to get all config', code: 'GET_ALL_CONFIG_ERROR' }, 500);
    }
  });

  // POST /api/admin/config - Add config item (admin/manager only)
  api.post('/config', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const body = await c.req.json();
    const { config_key, config_value, category } = body;

    if (!config_key || !config_value || !category) {
      return c.json({ error: 'config_key, config_value, and category are required', code: 'CONFIGKEY_CONFIGVALUE_AND_CATEGORY' }, 400);
    }
    if (typeof config_key !== 'string' || config_key.length > 200) {
      return c.json({ error: 'config_key must be a string of 200 characters or less', code: 'INVALID_CONFIG_KEY' }, 400);
    }
    if (typeof category !== 'string' || category.length > 100) {
      return c.json({ error: 'category must be a string of 100 characters or less', code: 'INVALID_CATEGORY' }, 400);
    }
    if (typeof config_value === 'string' && config_value.length > 10000) {
      return c.json({ error: 'config_value must be 10000 characters or less', code: 'CONFIG_VALUE_TOO_LONG' }, 400);
    }

    try {
      const maxOrder = await db.prepare(
        'SELECT MAX(sort_order) as max_order FROM system_config WHERE category = ?'
      ).get(category) as any;
      const sortOrder = (maxOrder?.max_order ?? -1) + 1;

      const now = localNow();

      const result = await db.prepare(`
        INSERT INTO system_config (config_key, config_value, category, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(config_key, config_value, category, sortOrder, now, now);

      const itemId = Number(result.meta.last_row_id);
      const item = await db.prepare('SELECT * FROM system_config WHERE id = ?').get(itemId);

      await auditLog(db, c, 'config_created', 'system_config', itemId, `Added config: ${config_key} = ${config_value}`);

      return c.json(item, 201);
    } catch (error: any) {
      if (error.message?.includes('UNIQUE constraint')) {
        return c.json({ error: 'This configuration value already exists', code: 'THIS_CONFIGURATION_VALUE_ALREADY' }, 409);
      }
      return c.json({ error: 'Failed to create config', code: 'CREATE_CONFIG_ERROR' }, 500);
    }
  });

  // PUT /api/admin/config/:id - Update config item
  api.put('/config/:id', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const id = paramNum(c.req.param('id'));
    const body = await c.req.json();

    try {
      const item = await db.prepare('SELECT * FROM system_config WHERE id = ?').get(id) as any;
      if (!item) {
        return c.json({ error: 'Config item not found', code: 'CONFIG_ITEM_NOT_FOUND' }, 404);
      }

      const now = localNow();
      const cfgFields = ['config_value', 'sort_order', 'is_active'];
      const cfgBodyKeys = Object.keys(body);
      const cfgSet: string[] = [];
      const cfgVals: any[] = [];
      for (const f of cfgFields) {
        if (cfgBodyKeys.includes(f)) {
          cfgSet.push(`${f} = ?`);
          const v = body[f];
          cfgVals.push(v === '' ? null : v ?? null);
        }
      }
      if (cfgSet.length > 0) {
        cfgSet.push(`updated_at = ?`);
        cfgVals.push(now, item.id);
        await db.prepare(`UPDATE system_config SET ${cfgSet.join(', ')} WHERE id = ?`).run(...cfgVals);
      }

      await auditLog(db, c, 'config_updated', 'system_config', item.id, `Updated config: ${item.config_key}`);

      const updated = await db.prepare('SELECT * FROM system_config WHERE id = ?').get(item.id);
      return c.json(updated);
    } catch (error: any) {
      return c.json({ error: 'Failed to update config', code: 'UPDATE_CONFIG_ERROR' }, 500);
    }
  });

  // DELETE /api/admin/config/:id - Soft-delete config item
  api.delete('/config/:id', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const id = paramNum(c.req.param('id'));

    try {
      const item = await db.prepare('SELECT * FROM system_config WHERE id = ?').get(id) as any;
      if (!item) {
        return c.json({ error: 'Config item not found', code: 'CONFIG_ITEM_NOT_FOUND' }, 404);
      }

      const now = localNow();
      await db.prepare('UPDATE system_config SET is_active = 0, updated_at = ? WHERE id = ?').run(now, item.id);

      await auditLog(db, c, 'config_deleted', 'system_config', item.id, `Removed config: ${item.config_key} = ${item.config_value}`);

      return c.json({ message: 'Config item removed' });
    } catch (error: any) {
      return c.json({ error: 'Failed to delete config', code: 'DELETE_CONFIG_ERROR' }, 500);
    }
  });

  // GET /api/admin/config-history
  api.get('/config-history', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const { category, config_key, limit: qLimit = '50' } = q;
    const limitNum = Math.min(100000, Math.max(1, (parseInt(qLimit as string, 10)) || 100000));

    try {
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

      const history = await db.prepare(`
        SELECT al.id, al.user_id, al.action, al.details, al.created_at,
          u.full_name as user_name
        FROM activity_log al
        LEFT JOIN users u ON al.user_id = u.id
        WHERE al.entity_type = 'system_config' ${where ? 'AND ' + where.replace('WHERE', '') : ''}
        ORDER BY al.created_at DESC
        LIMIT ?
      `).all(...params, limitNum);

      return c.json({ data: history });
    } catch (error: any) {
      return c.json({ error: 'Failed to get config history', code: 'CONFIG_HISTORY_ERROR' }, 500);
    }
  });

  // GET /api/admin/config-export
  api.get('/config-export', requireRole('admin'), async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const q = c.req.query();
    const { category } = q;

    try {
      let where = 'WHERE is_active = 1';
      const params: any[] = [];
      if (category) {
        where += ' AND category = ?';
        params.push(category);
      }

      const items = await db.prepare(`
        SELECT id, config_key, config_value, category, sort_order, is_active, created_at, updated_at
        FROM system_config ${where}
        ORDER BY category, sort_order
      `).all(...params);

      const exportData = {
        exported_at: localNow(),
        exported_by: '',
        version: '1.0',
        item_count: items.length,
        items,
      };

      return c.json(exportData);
    } catch (error: any) {
      return c.json({ error: 'Failed to export config', code: 'CONFIG_EXPORT_ERROR' }, 500);
    }
  });

  // POST /api/admin/config-import
  api.post('/config-import', requireRole('admin'), async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const body = await c.req.json();
    const { items, mode = 'merge' } = body;

    if (!items || !Array.isArray(items)) {
      return c.json({ error: 'items array is required', code: 'ITEMS_REQUIRED' }, 400);
    }

    try {
      const now = localNow();
      let imported = 0;
      let skipped = 0;
      let updated = 0;

      for (const item of items) {
        if (!item.config_key || !item.category) { skipped++; continue; }

        const existing = await db.prepare(
          'SELECT id FROM system_config WHERE config_key = ? AND category = ?'
        ).get(item.config_key, item.category) as any;

        if (existing) {
          if (mode === 'merge' || mode === 'overwrite') {
            await db.prepare(`
              UPDATE system_config SET config_value = ?, sort_order = ?, updated_at = ?
              WHERE config_key = ? AND category = ?
            `).run(item.config_value, item.sort_order || 0, now, item.config_key, item.category);
            updated++;
          } else {
            skipped++;
          }
        } else {
          await db.prepare(`
            INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
          `).run(item.config_key, item.config_value, item.category, item.sort_order || 0, now, now);
          imported++;
        }
      }

      await auditLog(db, c, 'config_imported', 'system_config', 0, `Imported config: ${imported} new, ${updated} updated, ${skipped} skipped`);

      return c.json({ imported, updated, skipped, total: items.length });
    } catch (error: any) {
      return c.json({ error: 'Failed to import config', code: 'CONFIG_IMPORT_ERROR' }, 500);
    }
  });

  // GET /api/admin/config-categories
  api.get('/config-categories', async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const categories = await db.prepare(`
        SELECT category, COUNT(*) as item_count,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count,
          MAX(updated_at) as last_updated
        FROM system_config
        GROUP BY category
        ORDER BY category
      `).all();

      return c.json({ data: categories });
    } catch (error: any) {
      return c.json({ error: 'Failed to get config categories', code: 'CONFIG_CATEGORIES_ERROR' }, 500);
    }
  });

  // GET /api/admin/config-diff
  api.get('/config-diff', requireRole('admin'), async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const { category } = q;
    if (!category) { return c.json({ error: 'category required', code: 'CATEGORY_REQUIRED' }, 400); }

    try {
      const current = await db.prepare(`
        SELECT config_key, config_value FROM system_config
        WHERE category = ? AND is_active = 1 ORDER BY config_key
      `).all(category) as any[];

      const inactive = await db.prepare(`
        SELECT config_key, config_value FROM system_config
        WHERE category = ? AND is_active = 0 ORDER BY config_key
      `).all(category) as any[];

      const currentMap = new Map(current.map((c: any) => [c.config_key, c.config_value]));
      const inactiveMap = new Map(inactive.map((c: any) => [c.config_key, c.config_value]));

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

      return c.json({ category, diff, current_count: current.length, inactive_count: inactive.length });
    } catch (error: any) {
      return c.json({ error: 'Failed to get config diff', code: 'CONFIG_DIFF_ERROR' }, 500);
    }
  });

  app.route('/api/admin', api);
}
