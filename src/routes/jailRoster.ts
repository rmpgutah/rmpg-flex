// ============================================================
// Jail Roster API — admin/ops surface for the county roster scraper.
// Ported from legacy/server-vps/src/routes/jailRoster.ts. Scraped bookings land
// in arrest_records and are read through the existing /api/arrests endpoints;
// this router only manages the scraper (status, config, manual sync, breakers).
// Mounted at /api/jail-roster.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb } from '../utils/db';
import { requireRole } from '../middleware/auth';
import {
  ensureJailRosterSchema, getStatus, getStatistics, getCountyConfigs,
  scrapeCounty, resetCountyErrors, updateCountyConfig,
  enrichSaltLakeDetails, countPendingSaltLakeDetails,
} from '../utils/jailRoster/scraper';

const jailRoster = new Hono<Env>();

const validCounty = (s: string | undefined) => !!s && /^[a-zA-Z_-]{2,50}$/.test(s);

// GET / and /status — per-county status + circuit-breaker state (all authed).
async function statusHandler(c: any) {
  try {
    const db = getDb(c.env);
    await ensureJailRosterSchema(db);
    return c.json(await getStatus(db));
  } catch (err) {
    console.error('jail-roster status failed:', err);
    return c.json({ error: 'Failed to get scraper status' }, 500);
  }
}
jailRoster.get('/', statusHandler);
jailRoster.get('/status', statusHandler);
jailRoster.get('/counties', statusHandler);

// GET /statistics — aggregate counts + recent sync history.
jailRoster.get('/statistics', async (c) => {
  try {
    const db = getDb(c.env);
    await ensureJailRosterSchema(db);
    return c.json(await getStatistics(db));
  } catch (err) {
    console.error('jail-roster statistics failed:', err);
    return c.json({ error: 'Failed to get statistics' }, 500);
  }
});

// GET /config — full county configs (admin).
jailRoster.get('/config', requireRole('admin'), async (c) => {
  try {
    const db = getDb(c.env);
    await ensureJailRosterSchema(db);
    return c.json({ configs: await getCountyConfigs(db) });
  } catch (err) {
    console.error('jail-roster config failed:', err);
    return c.json({ error: 'Failed to get config' }, 500);
  }
});

// PUT /config/:county — enable/disable + scrape interval (admin).
jailRoster.put('/config/:county', requireRole('admin'), async (c) => {
  try {
    const county = c.req.param('county');
    if (!validCounty(county)) return c.json({ error: 'Invalid county identifier' }, 400);
    const body = await c.req.json<{ enabled?: boolean; scrape_interval_minutes?: number }>().catch(() => ({} as { enabled?: boolean; scrape_interval_minutes?: number }));
    const updates: { enabled?: boolean; scrape_interval_minutes?: number } = {};
    if (body.enabled !== undefined) updates.enabled = !!body.enabled;
    if (body.scrape_interval_minutes !== undefined) {
      const n = parseInt(String(body.scrape_interval_minutes), 10);
      if (!Number.isFinite(n) || n < 15 || n > 1440) return c.json({ error: 'Interval must be 15–1440 minutes' }, 400);
      updates.scrape_interval_minutes = n;
    }
    const db = getDb(c.env);
    await ensureJailRosterSchema(db);
    const ok = await updateCountyConfig(db, county!, updates);
    if (!ok) return c.json({ error: 'County not found or no changes' }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.error('jail-roster config update failed:', err);
    return c.json({ error: 'Failed to update config' }, 500);
  }
});

// POST /sync/:county — trigger a manual scrape now (supervisor+).
jailRoster.post('/sync/:county', requireRole('admin', 'manager', 'supervisor'), async (c) => {
  try {
    const county = c.req.param('county');
    if (!validCounty(county)) return c.json({ error: 'Invalid county identifier' }, 400);
    const db = getDb(c.env);
    await ensureJailRosterSchema(db);
    const result = await scrapeCounty(db, county!);
    return c.json(result, result.success ? 200 : 502);
  } catch (err) {
    console.error('jail-roster sync failed:', err);
    return c.json({ error: 'Sync failed' }, 500);
  }
});

// POST /enrich/:county — fetch full profile documents for a batch of scraped
// inmates now (booking date, charges, bond). Salt Lake only today; the
// per-minute cron also drains this automatically. (supervisor+)
jailRoster.post('/enrich/:county', requireRole('admin', 'manager', 'supervisor'), async (c) => {
  try {
    const county = c.req.param('county');
    if (!validCounty(county)) return c.json({ error: 'Invalid county identifier' }, 400);
    if (county !== 'salt_lake') return c.json({ error: 'Detail enrichment is only available for salt_lake' }, 400);
    const db = getDb(c.env);
    await ensureJailRosterSchema(db);
    const result = await enrichSaltLakeDetails(db);
    return c.json({ success: true, ...result });
  } catch (err) {
    console.error('jail-roster enrich failed:', err);
    return c.json({ error: 'Enrichment failed' }, 500);
  }
});

// GET /pending-details/:county — how many scraped rows still need a profile fetch.
jailRoster.get('/pending-details/:county', async (c) => {
  try {
    const county = c.req.param('county');
    if (!validCounty(county)) return c.json({ error: 'Invalid county identifier' }, 400);
    const db = getDb(c.env);
    await ensureJailRosterSchema(db);
    return c.json({ county, pending: county === 'salt_lake' ? await countPendingSaltLakeDetails(db) : 0 });
  } catch (err) {
    console.error('jail-roster pending-details failed:', err);
    return c.json({ error: 'Failed to count pending details' }, 500);
  }
});

// POST /reset-errors/:county — clear consecutive errors + circuit breaker (admin).
jailRoster.post('/reset-errors/:county', requireRole('admin'), async (c) => {
  try {
    const county = c.req.param('county');
    if (!validCounty(county)) return c.json({ error: 'Invalid county identifier' }, 400);
    const db = getDb(c.env);
    await ensureJailRosterSchema(db);
    const ok = await resetCountyErrors(db, county!);
    if (!ok) return c.json({ error: 'County not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.error('jail-roster reset failed:', err);
    return c.json({ error: 'Reset failed' }, 500);
  }
});

export default jailRoster;
