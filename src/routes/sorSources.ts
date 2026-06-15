import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { runIcrimewatchScan } from '../utils/sorSources/icrimewatch';

const sorSources = new Hono<Env>();
const SCAN_ROLES = ['admin', 'manager', 'supervisor'] as const;
const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;

// POST /api/sor-sources/icrimewatch/scan?mode=incremental|full  (fire-and-forget)
sorSources.post('/icrimewatch/scan', requireRole(...SCAN_ROLES), async (c) => {
  if (!c.env.FIRECRAWL_API_KEY) {
    return c.json({ success: false, error: 'FIRECRAWL_API_KEY not configured', code: 'NO_KEY' }, 503);
  }
  const mode = (c.req.query('mode') === 'full' ? 'full' : 'incremental') as 'full' | 'incremental';
  c.executionCtx.waitUntil(
    runIcrimewatchScan(c.env, { mode })
      .then((r) => console.log(`[icw] scan ${JSON.stringify(r)}`))
      .catch((err) => console.error('[icw] scan failed:', err)));
  return c.json({ success: true, started: true, mode, message: 'SOR scan started; poll /runs.' }, 202);
});

// GET /api/sor-sources/runs — recent SOR run log (shared utah_sor_runs table)
sorSources.get('/runs', requireRole(...READ_ROLES), async (c) => {
  try {
    const rows = await query<Record<string, unknown>>(getDb(c.env),
      'SELECT * FROM utah_sor_runs ORDER BY id DESC LIMIT 20');
    return c.json({ data: rows });
  } catch { return c.json({ data: [] }); }
});

export default sorSources;
