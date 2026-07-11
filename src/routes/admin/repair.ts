import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb } from '../../utils/db';
import { log } from '../../utils/logger';
import { rebuildFtsTable, repairAllFtsTables } from '../../utils/repairFts';

const repair = new Hono<Env>();

repair.post('/database/repair-fts', async (c) => {
  const userId = c.get('userId') as number | undefined;
  const user = c.get('user') as any;
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    return c.json({ error: 'Admin or manager role required' }, 403);
  }

  try {
    const db = getDb(c.env);
    const body: { table?: string } = await c.req.json<{ table?: string }>().catch(() => ({} as { table?: string }));
    let result: { ok: string[]; failed: string[] };

    if (body.table) {
      const ok = await rebuildFtsTable(db, body.table);
      result = ok ? { ok: [body.table], failed: [] } : { ok: [], failed: [body.table] };
    } else {
      result = await repairAllFtsTables(db);
    }

    log.info('[admin/repair] FTS repair completed', { userId, table: body.table || 'all', ...result });
    return c.json({ success: true, ...result });
  } catch (err) {
    log.error('[admin/repair] FTS repair failed', {}, err);
    return c.json({ error: 'Repair failed', detail: (err as Error).message }, 500);
  }
});

export default repair;
