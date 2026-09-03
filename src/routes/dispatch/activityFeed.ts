// ── Dispatch activity feed ─────────────────────────────────────
// GET /api/dispatch/activity?since=ISO&limit=50
// Returns recent dispatch events in reverse chronological order:
// unit status changes, new calls, call assignments, priority changes,
// panic alerts. Sources from audit_log WHERE entity_type IN ('call','unit','panic').
// Polled by the dispatch board every 10 s for the right sidebar.

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query } from '../../utils/db';
import { requireRole } from '../../middleware/auth';
import { log } from '../../utils/logger';

const activity = new Hono<Env>();

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;

// ── GET /dispatch/activity ──────────────────────────────────────
// Query params:
//   since=ISO_TIMESTAMP  — only return events after this point (optional)
//   limit=50             — max events to return (1–200, default 50)
activity.get('/', requireRole(...READ_ROLES), async (c) => {
  const sinceParam = c.req.query('since');
  const limitParam = c.req.query('limit');
  const limit = Math.min(200, Math.max(1, parseInt(limitParam || '50', 10) || 50));

  // If since is not provided, default to last 24 h so the initial
  // load has a reasonable backfill window.
  let since: string;
  if (sinceParam) {
    // Accept ISO 8601 — convert to sqlite-compatible datetime string
    const d = new Date(sinceParam);
    if (!Number.isFinite(d.getTime())) {
      return c.json({ error: 'Invalid since timestamp' }, 400);
    }
    // sqlite datetime() comparison needs "YYYY-MM-DD HH:MM:SS" format
    since = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  } else {
    since = "datetime('now', '-24 hours')"; // will be handled as a literal below
  }

  try {
    const db = getDb(c.env);

    let rows: Array<{
      id: number;
      action: string | null;
      entity_type: string;
      entity_id: number | null;
      details: string | null;
      user_id: number | null;
      created_at: string;
      // joined from users
      user_name: string | null;
    }>;

    // Two variants: when since is a literal sqlite expression vs. a bound param
    if (sinceParam) {
      rows = await query<{
        id: number; action: string | null; entity_type: string; entity_id: number | null;
        details: string | null; user_id: number | null; created_at: string; user_name: string | null;
      }>(
        db,
        `SELECT al.id, al.action, al.entity_type, al.entity_id,
                al.details, al.user_id, al.created_at,
                u.full_name AS user_name
         FROM audit_log al
         LEFT JOIN users u ON u.id = al.user_id
         WHERE al.entity_type IN ('call', 'unit', 'panic')
           AND al.created_at > ?
         ORDER BY al.created_at DESC
         LIMIT ?`,
        since, limit,
      );
    } else {
      rows = await query<{
        id: number; action: string | null; entity_type: string; entity_id: number | null;
        details: string | null; user_id: number | null; created_at: string; user_name: string | null;
      }>(
        db,
        `SELECT al.id, al.action, al.entity_type, al.entity_id,
                al.details, al.user_id, al.created_at,
                u.full_name AS user_name
         FROM audit_log al
         LEFT JOIN users u ON u.id = al.user_id
         WHERE al.entity_type IN ('call', 'unit', 'panic')
           AND al.created_at > datetime('now', '-24 hours')
         ORDER BY al.created_at DESC
         LIMIT ?`,
        limit,
      );
    }

    // Parse JSON details for richer event payload
    const events = rows.map((r) => {
      let parsedDetails: Record<string, unknown> | null = null;
      if (r.details) {
        try { parsedDetails = JSON.parse(r.details); } catch { /* ignore */ }
      }
      return {
        id: r.id,
        action: r.action,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        details: parsedDetails,
        user_id: r.user_id,
        user_name: r.user_name ?? null,
        created_at: r.created_at,
      };
    });

    return c.json({
      events,
      count: events.length,
      since: sinceParam ?? null,
    });
  } catch (err) {
    log.error('[activityFeed] GET /activity failed', { since, limit }, err);
    return c.json({ error: 'Activity feed unavailable' }, 500);
  }
});

export default activity;
