// Warrants routes for the CF Worker. Initially minimal — surfaces the
// warrant-watch run history that the legacy server's /warrants page
// + dashboard widget consume. The CRUD warrant routes (list, create,
// archive, etc.) stay on the legacy server until the full warrants
// subsystem is migrated.

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';
import { runUtahWarrantScan } from '../utils/utahWarrantPoller';

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
    const result = await runUtahWarrantScan(db);
    return c.json({ success: true, run: result });
  } catch (err) {
    return c.json(
      { success: false, error: err instanceof Error ? err.message : 'Scan failed' },
      500,
    );
  }
});

// GET /warrants/utah — list scraped Utah warrants (the new utah_warrants
// table populated by runUtahWarrantScan in src/utils/utahWarrantPoller.ts).
// Query params:
//   active=1|0   filter by is_active (default 1 = currently-active only)
//   person_id=N  filter by local persons.id
//   limit=N      default 100, capped at 500
// Returns flat array; client paginates with `offset` (deferred to v2 when
// total roster makes that needed).
warrants.get('/utah', async (c) => {
  try {
    const db = getDb(c.env);
    const active = c.req.query('active') ?? '1';
    const personIdRaw = c.req.query('person_id');
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100', 10) || 100, 1), 500);

    const filters: string[] = [];
    const params: unknown[] = [];
    if (active === '1' || active === '0') {
      filters.push('is_active = ?');
      params.push(Number(active));
    }
    if (personIdRaw) {
      const pid = parseInt(personIdRaw, 10);
      if (Number.isFinite(pid)) {
        filters.push('person_id = ?');
        params.push(pid);
      }
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT id, utah_person_id, utah_warrant_id,
              first_name, middle_name, last_name, age, city,
              issue_date, court_name, case_id, charges,
              person_id, first_seen_at, last_seen_at, is_active
         FROM utah_warrants
         ${where}
         ORDER BY last_seen_at DESC, last_name, first_name
         LIMIT ?`,
      ...params, limit,
    );
    return c.json({ data: rows });
  } catch (err) {
    // Pre-migration: table doesn't exist on a fresh D1. Return empty so
    // the WarrantsPage Utah tab degrades gracefully instead of 500-spamming
    // the dashboard.
    return c.json({ data: [] });
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
