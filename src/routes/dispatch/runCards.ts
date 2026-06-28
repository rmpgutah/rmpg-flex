// Dispatch run cards — canned templates that pre-fill priority,
// unit count, roles, and operational flags for a given incident_type.
// Spillman parity. Schema lives in migrations/0014_dispatch_run_cards.sql.

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';

const runCards = new Hono<Env>();

interface CardRow extends Record<string, unknown> {
  id: number;
  required_roles: string;
  auto_flags: string;
  recommended_codes: string;
}

function shape(row: CardRow | undefined | null): unknown {
  if (!row) return null;
  const safeParse = <T,>(s: string, fb: T): T => { try { return JSON.parse(s) as T; } catch { return fb; } };
  return {
    ...row,
    required_roles: safeParse<string[]>(row.required_roles ?? '[]', []),
    auto_flags: safeParse<Record<string, unknown>>(row.auto_flags ?? '{}', {}),
    recommended_codes: safeParse<string[]>(row.recommended_codes ?? '[]', []),
  };
}

// GET /dispatch/run-cards — active cards only by default
runCards.get('/run-cards', async (c) => {
  const db = getDb(c.env);
  const includeInactive = c.req.query('all') === 'true';
  const where = includeInactive ? '1=1' : 'active = 1';
  const rows = await query<CardRow>(db, `SELECT * FROM dispatch_run_cards WHERE ${where} ORDER BY incident_type LIMIT 500`);
  return c.json(rows.map(shape));
});

// GET /dispatch/run-cards/:incidentType — lookup by incident_type for
// the call-create flow. Returns null if no card matches, so callers
// can branch without 404 noise.
runCards.get('/run-cards/by-type/:incidentType', async (c) => {
  const db = getDb(c.env);
  const row = await queryFirst<CardRow>(
    db, 'SELECT * FROM dispatch_run_cards WHERE incident_type = ? AND active = 1',
    c.req.param('incidentType'),
  );
  return c.json(shape(row));
});

runCards.post('/run-cards', async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json<Record<string, unknown>>();
  if (!body.incident_type || !body.display_name) {
    return c.json({ error: 'incident_type and display_name required' }, 400);
  }
  const stringify = (v: unknown, fb: string) => (typeof v === 'string' ? v : JSON.stringify(v ?? JSON.parse(fb)));
  const result = await execute(
    db,
    `INSERT INTO dispatch_run_cards
     (incident_type, display_name, default_priority, required_units, backup_units,
      required_roles, auto_flags, recommended_codes,
      officer_safety_alert, silent_response_default, ems_requested, fire_requested, notes, active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    body.incident_type, body.display_name, body.default_priority ?? 'P3',
    body.required_units ?? 1, body.backup_units ?? 0,
    stringify(body.required_roles, '[]'),
    stringify(body.auto_flags, '{}'),
    stringify(body.recommended_codes, '[]'),
    body.officer_safety_alert ? 1 : 0,
    body.silent_response_default ? 1 : 0,
    body.ems_requested ? 1 : 0,
    body.fire_requested ? 1 : 0,
    body.notes ?? null,
    body.active === false ? 0 : 1,
  );
  const created = await queryFirst<CardRow>(db, 'SELECT * FROM dispatch_run_cards WHERE id = ?', Number(result.meta.last_row_id));
  return c.json(shape(created), 201);
});

runCards.put('/run-cards/:id', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();
  const allowed = ['display_name', 'default_priority', 'required_units', 'backup_units',
    'required_roles', 'auto_flags', 'recommended_codes',
    'officer_safety_alert', 'silent_response_default', 'ems_requested', 'fire_requested',
    'notes', 'active'];
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of allowed) {
    if (!(k in body)) continue;
    const v = body[k];
    sets.push(`${k} = ?`);
    if (['required_roles', 'auto_flags', 'recommended_codes'].includes(k)) {
      params.push(typeof v === 'string' ? v : JSON.stringify(v));
    } else if (['officer_safety_alert', 'silent_response_default', 'ems_requested', 'fire_requested', 'active'].includes(k)) {
      params.push(v ? 1 : 0);
    } else {
      params.push(v ?? null);
    }
  }
  if (sets.length === 0) return c.json({ error: 'No updatable fields' }, 400);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  await execute(db, `UPDATE dispatch_run_cards SET ${sets.join(', ')} WHERE id = ?`, ...params);
  const updated = await queryFirst<CardRow>(db, 'SELECT * FROM dispatch_run_cards WHERE id = ?', id);
  return c.json(shape(updated));
});

runCards.delete('/run-cards/:id', async (c) => {
  const db = getDb(c.env);
  await execute(c.env.DB ? getDb(c.env) : getDb(c.env), 'DELETE FROM dispatch_run_cards WHERE id = ?', c.req.param('id'));
  return c.json({ message: 'Deleted' });
});

export default runCards;
