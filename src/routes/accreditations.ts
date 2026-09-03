// ============================================================
// Officer accreditations/certifications — /api/accreditations
// ============================================================
// Backs client/src/pages/AccreditationsPage.tsx, which was fully built
// against this exact contract but had no matching server route — every
// call 404'd. Deliberately separate from the Training module's
// officer_certifications/certification_types tables (src/routes/training.ts)
// — see migrations/0190_accreditations.sql for why.
//
// GET  /                       ?status=&officer_id=&expiring_within_days= → Accreditation[]
// POST /                       create
// POST /check-reminders        notify officers with soon-expiring, not-yet-reminded
//                               accreditations → { sent }
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, execute } from '../utils/db';
import { dbErrorResponse } from '../utils/dbErrors';
import { log } from '../utils/logger';

const accreditations = new Hono<Env>();

const SELECT_BASE = `
  SELECT a.*, u.full_name AS officer_name, u.badge_number AS badge_number
  FROM accreditations a
  LEFT JOIN users u ON u.id = a.officer_id`;

accreditations.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const status = c.req.query('status');
    const officerId = c.req.query('officer_id');
    const expiringWithinDays = c.req.query('expiring_within_days');

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (status) { clauses.push('a.status = ?'); params.push(status); }
    if (officerId) { clauses.push('a.officer_id = ?'); params.push(officerId); }
    if (expiringWithinDays) {
      const days = Number(expiringWithinDays);
      if (Number.isFinite(days)) {
        clauses.push(`a.expiration_date IS NOT NULL AND a.expiration_date <= date('now', '+' || ? || ' days')`);
        params.push(days);
      }
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const rows = await query(db, `${SELECT_BASE}${where} ORDER BY a.expiration_date ASC, a.id DESC`, ...params);
    return c.json(rows || []);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to fetch accreditations');
  }
});

accreditations.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{
      officer_id?: number; type?: string; issuing_body?: string;
      certificate_number?: string; issued_date?: string; expiration_date?: string;
      status?: string; notes?: string;
    }>().catch(() => ({} as any));

    if (!body.officer_id || !body.type || !body.issuing_body) {
      return c.json({ error: 'officer_id, type, and issuing_body are required' }, 400);
    }

    const result = await execute(db,
      `INSERT INTO accreditations
         (officer_id, type, issuing_body, certificate_number, issued_date, expiration_date, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      body.officer_id, body.type, body.issuing_body,
      body.certificate_number || null, body.issued_date || null, body.expiration_date || null,
      body.status || 'active', body.notes || null,
    );
    return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to create accreditation');
  }
});

accreditations.put('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const body = await c.req.json<{
      type?: string; issuing_body?: string; certificate_number?: string;
      issued_date?: string; expiration_date?: string; status?: string; notes?: string;
    }>().catch(() => ({} as any));
    if (!body || Object.keys(body).length === 0) return c.json({ error: 'Request body required' }, 400);

    await execute(db,
      `UPDATE accreditations SET
         type = COALESCE(?, type),
         issuing_body = COALESCE(?, issuing_body),
         certificate_number = ?,
         issued_date = ?,
         expiration_date = ?,
         status = COALESCE(?, status),
         notes = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
      body.type || null, body.issuing_body || null,
      body.certificate_number ?? null, body.issued_date ?? null, body.expiration_date ?? null,
      body.status || null, body.notes ?? null, id,
    );
    return c.json({ success: true });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to update accreditation');
  }
});

accreditations.delete('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const result = await execute(db, 'DELETE FROM accreditations WHERE id = ?', id);
    if (!result.meta.changes) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to delete accreditation');
  }
});

// POST /check-reminders — the "Check Reminders" toolbar button. Notifies the
// officer (in-app, via the shared `notifications` table — same pattern as
// caseTaskNudges.ts / serveNudgeSweep.ts) for each active accreditation
// expiring within 60 days that hasn't been reminded yet, then bumps
// reminders_sent so re-clicking the button doesn't spam the same officer.
accreditations.post('/check-reminders', async (c) => {
  try {
    const db = getDb(c.env);
    const expiring = await query<{ id: number; officer_id: number; type: string; expiration_date: string }>(
      db,
      `SELECT id, officer_id, type, expiration_date FROM accreditations
       WHERE status = 'active' AND reminders_sent = 0
         AND expiration_date IS NOT NULL
         AND expiration_date <= date('now', '+60 days')`,
    );

    let sent = 0;
    for (const a of expiring) {
      try {
        await execute(db,
          `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
           VALUES ('accreditation_expiring', 'normal', ?, ?, 'accreditation', ?, ?, 0, datetime('now'))`,
          'Accreditation expiring soon',
          `Your ${a.type} certification expires on ${a.expiration_date}. Renew it to stay in compliance.`,
          a.id, a.officer_id,
        );
        await execute(db, `UPDATE accreditations SET reminders_sent = reminders_sent + 1 WHERE id = ?`, a.id);
        sent++;
      } catch (err) {
        log.error('accreditation reminder failed', { accreditation_id: a.id }, err);
      }
    }
    return c.json({ sent });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to check reminders');
  }
});

export default accreditations;
