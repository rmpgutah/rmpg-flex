// Jail Roster routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';

export function mountJailRosterRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // Stub: scraper functions not available in Workers runtime
  async function getJailRosterStatus(): Promise<any> {
    return { counties: [], recent_syncs: [] };
  }
  async function getJailRosterStatistics(): Promise<any> {
    return { counties: [] };
  }
  async function scrapeCountyManual(_county: string): Promise<any> {
    return { success: false, message: 'Scraping not available in Workers runtime' };
  }
  async function resetCountyErrors(_county: string): Promise<boolean> {
    return false;
  }
  async function updateCountyConfig(_county: string, _updates: any): Promise<boolean> {
    return false;
  }
  function getAvailableParsers(): string[] {
    return [];
  }

  api.get('/status', async (c) => {
    try {
      const status = await getJailRosterStatus();
      return c.json(status);
    } catch {
      return c.json({ error: 'Failed to get scraper status', code: 'FAILED_TO_GET_SCRAPER' }, 500);
    }
  });

  api.get('/counties', async (c) => {
    try {
      const status = await getJailRosterStatus();
      const parsers = getAvailableParsers();
      const counties = status.counties.map((c: any) => ({
        county: c.county, display_name: c.display_name, roster_url: c.roster_url, roster_type: c.roster_type,
        enabled: !!c.enabled, has_parser: parsers.includes(c.county), scrape_interval_minutes: c.scrape_interval_minutes,
        last_scrape_at: c.last_scrape_at, consecutive_errors: c.consecutive_errors, circuit_broken: c.circuit_broken,
        is_scheduled: c.is_scheduled, last_sync: c.last_sync,
      }));
      return c.json({ counties, available_parsers: parsers });
    } catch {
      return c.json({ error: 'Failed to list counties', code: 'FAILED_TO_LIST_COUNTIES' }, 500);
    }
  });

  api.get('/config', requireRole('admin'), async (c) => {
    try {
      const status = await getJailRosterStatus();
      return c.json({ configs: status.counties });
    } catch {
      return c.json({ error: 'Failed to get scraper config', code: 'FAILED_TO_GET_SCRAPER' }, 500);
    }
  });

  api.put('/config/:county', requireRole('admin'), async (c) => {
    try {
      const county = c.req.param('county');
      if (!county || county.trim().length < 2 || !/^[a-zA-Z_-]+$/.test(county) || county.length > 50) {
        return c.json({ error: 'Invalid county identifier (letters, hyphens, underscores only, 2-50 chars)', code: 'INVALID_COUNTY_IDENTIFIER_LETTERS' }, 400);
      }
      const body = await c.req.json();
      const { enabled, scrape_interval_minutes } = body;
      const updates: { enabled?: boolean; scrape_interval_minutes?: number } = {};
      if (enabled !== undefined) updates.enabled = !!enabled;
      if (scrape_interval_minutes !== undefined) {
        const interval = parseInt(scrape_interval_minutes, 10);
        if (isNaN(interval) || interval < 15 || interval > 120) return c.json({ error: 'Interval must be between 15 and 120 minutes', code: 'INTERVAL_MUST_BE_BETWEEN' }, 400);
        updates.scrape_interval_minutes = interval;
      }
      const success = await updateCountyConfig(county, updates);
      if (!success) return c.json({ error: 'County not found', code: 'COUNTY_NOT_FOUND' }, 404);
      return c.json({ success: true, message: 'Config updated' });
    } catch {
      return c.json({ error: 'Failed to update config', code: 'FAILED_TO_UPDATE_CONFIG' }, 500);
    }
  });

  api.post('/sync/:county', requireRole('admin', 'manager'), async (c) => {
    try {
      const county = c.req.param('county');
      if (!county || !/^[a-zA-Z_-]+$/.test(county) || county.length < 2 || county.length > 50) {
        return c.json({ error: 'Invalid county identifier', code: 'INVALID_COUNTY_IDENTIFIER' }, 400);
      }
      const result = await scrapeCountyManual(county);
      return c.json(result);
    } catch {
      return c.json({ error: 'Failed to trigger sync', code: 'FAILED_TO_TRIGGER_SYNC' }, 500);
    }
  });

  api.post('/reset-errors/:county', requireRole('admin'), async (c) => {
    try {
      const county = c.req.param('county');
      if (!county || !/^[a-zA-Z_-]+$/.test(county) || county.length < 2 || county.length > 50) {
        return c.json({ error: 'Invalid county identifier', code: 'INVALID_COUNTY_IDENTIFIER' }, 400);
      }
      const success = await resetCountyErrors(county);
      if (!success) return c.json({ error: 'County not found', code: 'COUNTY_NOT_FOUND' }, 404);
      return c.json({ success: true, message: 'Error counter reset' });
    } catch {
      return c.json({ error: 'Failed to reset errors', code: 'FAILED_TO_RESET_ERRORS' }, 500);
    }
  });

  api.get('/statistics', async (c) => {
    try {
      const stats = await getJailRosterStatistics();
      return c.json(stats);
    } catch {
      return c.json({ error: 'Failed to get statistics', code: 'FAILED_TO_GET_STATISTICS' }, 500);
    }
  });

  api.get('/sync-log', requireRole('admin'), async (c) => {
    try {
      const status = await getJailRosterStatus();
      return c.json({ sync_log: status.recent_syncs });
    } catch {
      return c.json({ error: 'Failed to get sync log', code: 'FAILED_TO_GET_SYNC' }, 500);
    }
  });

  api.delete('/record/:id', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) return c.json({ error: 'Invalid record ID', code: 'INVALID_RECORD_ID' }, 400);
      const result = await db.prepare('DELETE FROM arrest_records WHERE id = ?').run(id);
      if (result.meta.changes === 0) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Delete failed', code: 'DELETE_RECORD_FAILED' }, 500);
    }
  });

  app.route('/api/jail-roster', api);
}
