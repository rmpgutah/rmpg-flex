import { Hono } from 'hono';
import type { Env } from '../types';

const stubs = new Hono<Env>();

// User preferences
stubs.get('/preferences', (c) => c.json({ theme: 'dark', sidebar_width: 240, notifications_enabled: true, map_default_zoom: 13, map_center_lat: 40.76, map_center_lng: -111.89 }));
stubs.put('/preferences', async (c) => c.json({ success: true }));

// Notifications
stubs.get('/unread-count', (c) => c.json({ count: 0 }));
stubs.get('/', (c) => c.json([]));

// Reports
stubs.get('/dashboard', (c) => c.json({ active_calls: 0, available_units: 0, today_calls: 0, clearance_rate: 0 }));
stubs.get('/patrol-coverage', (c) => c.json({ coverage: [] }));
stubs.get('/clearance-rate', (c) => c.json({ rate: 0 }));
stubs.get('/overdue-reports', (c) => c.json({ count: 0 }));
stubs.get('/shift-comparison', (c) => c.json({ shifts: [] }));
stubs.get('/officer-activity', (c) => c.json([]));
stubs.get('/upcoming-court', (c) => c.json([]));
stubs.get('/evidence-pending', (c) => c.json({ count: 0 }));
// /response-times moved to src/routes/reports.ts (still returns [] until
// dispatch status-timestamp math is ported). Kept here too would cause a
// double-registration warning under the /api/reports mount.

// Communication
stubs.get('/activity-feed', (c) => c.json([]));
stubs.get('/bolos/active', (c) => c.json([]));

// GET /api/comms/bolos/check?address=&subject=&vehicle= — active-BOLO match.
// Powers BoloAlertBanner on the New Call / dispatch-edit forms. Ported from
// the legacy comms router (was never carried into the rewrite, so it 404'd —
// the banner silently never fired). Keyword-matches the caller's free text
// against active BOLO descriptions. Defensive: any failure returns an empty
// match set rather than 500, so a transient DB error can't break call entry.
stubs.get('/bolos/check', async (c) => {
  try {
    const address = c.req.query('address') || '';
    const subject = c.req.query('subject') || '';
    const vehicle = c.req.query('vehicle') || '';
    if (!address && !subject && !vehicle) return c.json({ matches: [], count: 0 });

    // 3+ char keywords, capped at 5 per field to bound the query size.
    const keywords = (text: string) =>
      text.toUpperCase().split(/[\s,;]+/).filter((w) => w.length >= 3).slice(0, 5);

    const matchClauses: string[] = [];
    const params: unknown[] = [];

    for (const kw of keywords(subject)) {
      matchClauses.push('(UPPER(subject_description) LIKE ? OR UPPER(description) LIKE ?)');
      params.push(`%${kw}%`, `%${kw}%`);
    }
    for (const kw of keywords(vehicle)) {
      matchClauses.push('(UPPER(vehicle_description) LIKE ? OR UPPER(description) LIKE ?)');
      params.push(`%${kw}%`, `%${kw}%`);
    }
    if (address && address.length >= 3) {
      matchClauses.push('UPPER(description) LIKE ?');
      params.push(`%${address.toUpperCase()}%`);
    }
    if (matchClauses.length === 0) return c.json({ matches: [], count: 0 });

    const sql = `
      SELECT id, bolo_number, type, title, description,
             subject_description, vehicle_description, priority,
             created_at, expires_at
      FROM bolos
      WHERE status = 'active' AND (${matchClauses.join(' OR ')})
      ORDER BY priority ASC, created_at DESC
      LIMIT 10`;
    const rows = await c.env.DB.prepare(sql).bind(...params).all();
    const matches = rows.results || [];
    return c.json({ matches, count: matches.length });
  } catch (err) {
    console.error('GET /comms/bolos/check failed:', err);
    return c.json({ matches: [], count: 0 });
  }
});

// Warrants
stubs.get('/', (c) => c.json([]));
stubs.get('/scrapers', (c) => c.json({ scrapers: [], last_run: null }));
stubs.get('/scrapers/health', (c) => c.json({ status: 'ok' }));

// Weather
stubs.get('/', (c) => c.json({ temperature: 72, conditions: 'Clear', icon: 'clear-day' }));

// Email
stubs.get('/unread-count', (c) => c.json({ count: 0 }));

// Integrations
stubs.get('/google-maps/client-key', (c) => c.json({}));

// Dispatch stubs
stubs.get('/stats', (c) => c.json({ total_calls: 0, active_calls: 0, units_online: 0 }));
stubs.get('/shift-handoff', (c) => c.json({ handoff: null }));

export default stubs;
