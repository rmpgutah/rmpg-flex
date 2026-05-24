// Warrants routes for the CF Worker. Initially minimal — surfaces the
// warrant-watch run history that the legacy server's /warrants page
// + dashboard widget consume. The CRUD warrant routes (list, create,
// archive, etc.) stay on the legacy server until the full warrants
// subsystem is migrated.

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';
import { runUtahWarrantSmokePoll } from '../utils/utahWarrantPoller';

const warrants = new Hono<Env>();

// GET /warrants/watch/runs?limit=N — recent warrant watch runs
// Used by:
//   - client/src/pages/DashboardPage.tsx (widget — limit=1)
//   - client/src/pages/WarrantsPage.tsx Sources tab (limit=20)
// Returns { data: WatchRun[] } shape to match legacy server.
warrants.get('/watch/runs', async (c) => {
  try {
    const db = getDb(c.env);
    const limitRaw = c.req.query('limit');
    const limit = Math.min(Math.max(parseInt(limitRaw || '20', 10) || 20, 1), 100);
    const rows = await query<Record<string, unknown>>(
      db,
      'SELECT * FROM warrant_watch_runs ORDER BY started_at DESC LIMIT ?',
      limit,
    );
    return c.json({ data: rows });
  } catch (err) {
    // Tables may not yet exist on a fresh D1 — return empty rather than 500
    // so the dashboard widget shows "—" instead of error noise.
    return c.json({ data: [] });
  }
});

// POST /warrants/watch/scan — manually trigger a smoke poll
// Mirrors legacy POST /api/warrants/watch/scan. Returns immediately;
// dashboard polls /watch/runs to see completion.
warrants.post('/watch/scan', async (c) => {
  try {
    const db = getDb(c.env);
    const result = await runUtahWarrantSmokePoll(db);
    return c.json({ success: true, run: result });
  } catch (err) {
    return c.json(
      { success: false, error: err instanceof Error ? err.message : 'Scan failed' },
      500,
    );
  }
});

// GET /warrants/utah/sync-status — what the legacy server exposes here.
// Minimal shape: latest run + total run count. Frontend tolerates missing
// keys via optional chaining (verified in WarrantsPage.tsx).
warrants.get('/utah/sync-status', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db,
      'SELECT * FROM warrant_watch_runs ORDER BY started_at DESC LIMIT 1',
    );
    const latest = rows[0] ?? null;
    return c.json({
      lastSync: latest ? latest.completed_at ?? latest.started_at : null,
      lastStatus: latest ? latest.status : null,
      lastPersonsChecked: latest ? latest.persons_checked : 0,
      lastNewWarrants: latest ? latest.new_warrants_found : 0,
    });
  } catch (err) {
    return c.json({ lastSync: null, lastStatus: null, lastPersonsChecked: 0, lastNewWarrants: 0 });
  }
});

export default warrants;
