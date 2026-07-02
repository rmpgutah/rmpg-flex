// ============================================================
// RMPG Flex — Shift Briefings (/api/shift-briefings)
// ============================================================
// Backend for client/src/pages/ShiftBriefingsPage.tsx, which shipped
// calling these endpoints before they existed (every call 404'd).
// Table: shift_briefings (migration 0165). The /generate endpoint
// assembles a live briefing from bolos, calls, warrants, premise
// alerts, arrests and on-duty units — the same sources the dispatch
// shift-handoff briefing reads.
// ============================================================
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const sb = new Hono<Env>();

// GET / — recent briefings (client Briefing[] shape)
sb.get('/', async (c) => {
  const db = getDb(c.env);
  const rows = await query<Record<string, any>>(db, `
    SELECT b.id, b.briefing_number, b.title, b.shift_type, b.created_at, b.content,
           b.acknowledged_by, COALESCE(u.full_name, 'System') AS created_by
    FROM shift_briefings b LEFT JOIN users u ON u.id = b.created_by
    ORDER BY b.id DESC LIMIT 50`);
  const totalOfficers = await queryFirst<{ n: number }>(db,
    "SELECT COUNT(*) AS n FROM users WHERE role IN ('officer','supervisor','manager') AND COALESCE(status,'active') = 'active'");
  return c.json(rows.map((r) => {
    let acks: unknown[] = [];
    try { acks = JSON.parse(r.acknowledged_by || '[]'); } catch { /* ignore */ }
    return {
      id: r.id,
      briefing_number: r.briefing_number ?? `BR-${String(r.id).padStart(4, '0')}`,
      title: r.title, shift_type: r.shift_type, created_at: r.created_at,
      created_by: r.created_by, content: r.content,
      acknowledged_count: Array.isArray(acks) ? acks.length : 0,
      total_officers: totalOfficers?.n ?? 0,
    };
  }));
});

// POST / — save a briefing (manual or generated)
sb.post('/', async (c) => {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user) return c.json({ error: 'Unauthenticated' }, 401);
  const b = await c.req.json<any>().catch(() => ({}));
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  const content = typeof b.content === 'string' ? b.content : '';
  if (!title || !content) return c.json({ error: 'title and content required' }, 400);
  const shiftType = ['day', 'swing', 'night'].includes(b.shift_type) ? b.shift_type : 'day';
  const r = await execute(getDb(c.env), `
    INSERT INTO shift_briefings (briefing_number, title, shift_type, content, created_by)
    VALUES (NULL, ?, ?, ?, ?)`, title, shiftType, content, user.id);
  await execute(getDb(c.env),
    "UPDATE shift_briefings SET briefing_number = 'BR-' || printf('%04d', id) WHERE id = ?", r.meta.last_row_id);
  return c.json({ success: true, id: r.meta.last_row_id }, 201);
});

// POST /:id/acknowledge — officer acks a briefing
sb.post('/:id/acknowledge', async (c) => {
  const user = c.get('user') as { id: number } | undefined;
  if (!user) return c.json({ error: 'Unauthenticated' }, 401);
  const id = parseInt(c.req.param('id'), 10);
  const row = await queryFirst<{ acknowledged_by: string }>(getDb(c.env),
    'SELECT acknowledged_by FROM shift_briefings WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  let acks: number[] = [];
  try { acks = JSON.parse(row.acknowledged_by || '[]'); } catch { /* ignore */ }
  if (!acks.includes(user.id)) acks.push(user.id);
  await execute(getDb(c.env), 'UPDATE shift_briefings SET acknowledged_by = ? WHERE id = ?', JSON.stringify(acks), id);
  return c.json({ success: true, acknowledged_count: acks.length });
});

// GET /generate — assemble a live GeneratedBriefing from operational data
sb.get('/generate', async (c) => {
  const db = getDb(c.env);
  const [bulletins, calls, warrants, premises, arrests, units] = await Promise.all([
    query<Record<string, any>>(db, `
      SELECT id, title, priority FROM bolos
      WHERE status = 'active' AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY id DESC LIMIT 10`),
    query<Record<string, any>>(db, `
      SELECT call_number, incident_type, priority, created_at AS time FROM calls_for_service
      WHERE status NOT IN ('closed','cleared','cancelled') AND created_at >= datetime('now','-24 hours')
      ORDER BY priority, id DESC LIMIT 10`),
    query<Record<string, any>>(db, `
      SELECT warrant_number, COALESCE(subject_name, subject_first_name || ' ' || subject_last_name) AS subject,
             COALESCE(offense_description, offense, '') AS charges
      FROM warrants WHERE status = 'active' AND COALESCE(priority,'') IN ('high','urgent','critical')
      ORDER BY id DESC LIMIT 10`),
    query<Record<string, any>>(db, `
      SELECT COALESCE(address,'') AS address, COALESCE(alert_type, type, 'alert') AS alert_type,
             COALESCE(notes, description, '') AS notes
      FROM premise_alerts WHERE COALESCE(status,'active') = 'active' ORDER BY id DESC LIMIT 10`).catch(() => []),
    query<Record<string, any>>(db, `
      SELECT COALESCE(subject_name, name, '') AS name, COALESCE(charges,'') AS charges,
             created_at AS arrest_time
      FROM arrest_records WHERE created_at >= datetime('now','-48 hours') ORDER BY id DESC LIMIT 10`).catch(() => []),
    query<Record<string, any>>(db, `
      SELECT u.call_sign AS unit_id, COALESCE(usr.full_name,'') AS officer_name, u.status
      FROM units u LEFT JOIN users usr ON usr.id = u.officer_id
      WHERE u.status NOT IN ('off_duty','offline') ORDER BY u.call_sign LIMIT 25`),
  ]);
  return c.json({
    active_bulletins: bulletins,
    critical_calls: calls,
    high_priority_warrants: warrants,
    premise_alerts: premises,
    recent_arrests: arrests,
    units_on_duty: units,
  });
});

// GET /officer-safety/alerts — SafetyAlert[] from premise alerts + weapons calls
sb.get('/officer-safety/alerts', async (c) => {
  const db = getDb(c.env);
  const premises = await query<Record<string, any>>(db, `
    SELECT id, COALESCE(address,'') AS location, COALESCE(notes, description, alert_type, '') AS description,
           created_at FROM premise_alerts
    WHERE COALESCE(status,'active') = 'active' ORDER BY id DESC LIMIT 15`).catch(() => [] as Record<string, any>[]);
  const weapons = await query<Record<string, any>>(db, `
    SELECT id, COALESCE(location_address,'') AS location,
           COALESCE(incident_type,'') || ' — ' || COALESCE(call_number,'') AS description, created_at
    FROM calls_for_service
    WHERE created_at >= datetime('now','-24 hours')
      AND (LOWER(COALESCE(incident_type,'')) LIKE '%weapon%' OR LOWER(COALESCE(incident_type,'')) LIKE '%shots%'
           OR LOWER(COALESCE(incident_type,'')) LIKE '%gun%' OR LOWER(COALESCE(incident_type,'')) LIKE '%armed%')
    ORDER BY id DESC LIMIT 15`);
  const alerts = [
    ...premises.map((p) => ({ id: p.id, type: 'premise' as const, location: p.location, description: p.description, severity: 'medium' as const, created_at: p.created_at })),
    ...weapons.map((w) => ({ id: 100000 + w.id, type: 'weapons_call' as const, location: w.location, description: w.description, severity: 'high' as const, created_at: w.created_at })),
  ];
  return c.json(alerts);
});

export default sb;
