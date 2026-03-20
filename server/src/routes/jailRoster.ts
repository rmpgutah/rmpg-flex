// ============================================================
// Jail Roster Scraper API Routes
// ============================================================
// Admin endpoints for managing the Utah county jail roster
// scraper: view status, enable/disable counties, trigger
// manual syncs, reset circuit breakers, view sync history.
//
// Scraped records are stored in arrest_records and queried
// through the existing /api/arrests/ endpoints — no duplicate
// record endpoints are needed here.
// ============================================================

import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcastAdminUpdate } from '../utils/websocket';
import {
  getJailRosterStatus,
  getJailRosterStatistics,
  scrapeCountyManual,
  resetCountyErrors,
  updateCountyConfig,
  getAvailableParsers,
} from '../utils/jailRosterScraper';

const router = Router();
router.use(authenticateToken);

// ── GET /status ─────────────────────────────────────────────
// Per-county sync status, stats, circuit breaker state
// Available to all authenticated users

router.get('/status', (_req: Request, res: Response) => {
  try {
    const status = getJailRosterStatus();
    res.json(status);
  } catch (err) {
    console.error('[Jail Roster API] Error getting status:', (err as Error).message);
    res.status(500).json({ error: 'Failed to get scraper status' });
  }
});

// ── GET /counties ───────────────────────────────────────────
// List available county parsers with config + status

router.get('/counties', (_req: Request, res: Response) => {
  try {
    const status = getJailRosterStatus();
    const parsers = getAvailableParsers();

    const counties = status.counties.map(c => ({
      county: c.county,
      display_name: c.display_name,
      roster_url: c.roster_url,
      roster_type: c.roster_type,
      enabled: !!c.enabled,
      has_parser: parsers.includes(c.county),
      scrape_interval_minutes: c.scrape_interval_minutes,
      last_scrape_at: c.last_scrape_at,
      consecutive_errors: c.consecutive_errors,
      circuit_broken: c.circuit_broken,
      is_scheduled: c.is_scheduled,
      last_sync: c.last_sync,
    }));

    res.json({ counties, available_parsers: parsers });
  } catch (err) {
    console.error('[Jail Roster API] Error listing counties:', (err as Error).message);
    res.status(500).json({ error: 'Failed to list counties' });
  }
});

// ── GET /config ─────────────────────────────────────────────
// All county configurations (admin only)

router.get('/config', requireRole('admin'), (_req: Request, res: Response) => {
  try {
    const status = getJailRosterStatus();
    res.json({ configs: status.counties });
  } catch (err) {
    console.error('[Jail Roster API] Error getting config:', (err as Error).message);
    res.status(500).json({ error: 'Failed to get scraper config' });
  }
});

// ── PUT /config/:county ─────────────────────────────────────
// Enable/disable county, change scrape interval (admin only)

router.put('/config/:county', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const county = req.params.county as string;
    const { enabled, scrape_interval_minutes } = req.body;

    const updates: { enabled?: boolean; scrape_interval_minutes?: number } = {};
    if (enabled !== undefined) updates.enabled = !!enabled;
    if (scrape_interval_minutes !== undefined) {
      const interval = parseInt(scrape_interval_minutes, 10);
      if (isNaN(interval) || interval < 15 || interval > 120) {
        return res.status(400).json({ error: 'Interval must be between 15 and 120 minutes' });
      }
      updates.scrape_interval_minutes = interval;
    }

    const success = updateCountyConfig(county, updates);
    if (!success) {
      return res.status(404).json({ error: 'County not found' });
    }

    auditLog(req, 'jail_roster_config_updated', 'jail_roster', 0,
      `Jail roster config updated for ${county}: ${JSON.stringify(updates)}`);
    broadcastAdminUpdate({ type: 'jail_roster_config_updated', county });

    res.json({ success: true, message: 'Config updated' });
  } catch (err) {
    console.error('[Jail Roster API] Error updating config:', (err as Error).message);
    res.status(500).json({ error: 'Failed to update config' });
  }
});

// ── POST /sync/:county ──────────────────────────────────────
// Manual trigger scrape for a county (admin + manager)

router.post('/sync/:county', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const county = req.params.county as string;
    const result = await scrapeCountyManual(county);

    auditLog(req, 'jail_roster_sync_triggered', 'jail_roster', 0,
      `Manual sync triggered for ${county}`);
    broadcastAdminUpdate({ type: 'jail_roster_sync_triggered', county });

    res.json(result);
  } catch (err) {
    console.error('[Jail Roster API] Error triggering sync:', (err as Error).message);
    res.status(500).json({ error: 'Failed to trigger sync' });
  }
});

// ── POST /reset-errors/:county ──────────────────────────────
// Reset circuit breaker for a county (admin only)

router.post('/reset-errors/:county', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const county = req.params.county as string;
    const success = resetCountyErrors(county);
    if (!success) {
      return res.status(404).json({ error: 'County not found' });
    }

    auditLog(req, 'jail_roster_errors_reset', 'jail_roster', 0,
      `Circuit breaker reset for ${county}`);

    res.json({ success: true, message: 'Error counter reset' });
  } catch (err) {
    console.error('[Jail Roster API] Error resetting errors:', (err as Error).message);
    res.status(500).json({ error: 'Failed to reset errors' });
  }
});

// ── GET /statistics ──────────────────────────────────────────
// Intake/release statistics per county with daily trends

router.get('/statistics', (_req: Request, res: Response) => {
  try {
    const stats = getJailRosterStatistics();
    res.json(stats);
  } catch (err) {
    console.error('[Jail Roster API] Error getting statistics:', (err as Error).message);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// ── GET /sync-log ───────────────────────────────────────────
// Recent sync history (admin only)

router.get('/sync-log', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const status = getJailRosterStatus();
    res.json({ sync_log: status.recent_syncs });
  } catch (err) {
    console.error('[Jail Roster API] Error getting sync log:', (err as Error).message);
    res.status(500).json({ error: 'Failed to get sync log' });
  }
});

export default router;
