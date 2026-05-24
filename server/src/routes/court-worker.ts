// Court routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';
import { localNow, localToday } from '../worker-middleware/timeUtils';
import { auditLog } from '../worker-middleware/auditLogger';

export function mountCourtRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  async function nextEventNumber(db: D1Db): Promise<string> {
    const yr = new Date().getFullYear();
    const prefix = `CT-${yr}-`;
    const last = await db.prepare("SELECT event_number FROM court_events WHERE event_number LIKE ? ORDER BY id DESC LIMIT 1").get(`${prefix}%`) as { event_number: string } | undefined;
    const parsed = last ? parseInt(last.event_number.replace(prefix, ''), 10) : 0;
    const seq = isNaN(parsed) ? 1 : parsed + 1;
    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  // GET /events
  api.get('/events', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const { status, event_type, date_from, date_to, officer_id, search, page = '1', limit = '100000' } = q;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100000, Math.max(1, parseInt(limit, 10) || 100000));
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { where += ' AND e.status = ?'; params.push(status); }
    if (event_type) { where += ' AND e.event_type = ?'; params.push(event_type); }
    if (date_from) { where += ' AND e.event_date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND e.event_date <= ?'; params.push(date_to); }
    if (officer_id) { where += " AND e.officers_required LIKE ?"; params.push(`%${officer_id}%`); }
    if (search) {
      where += ' AND (e.event_number LIKE ? OR e.defendant_name LIKE ? OR e.court_case_number LIKE ? OR e.court_name LIKE ?)';
      const s = `%${search}%`; params.push(s, s, s, s);
    }

    const countRow = await db.prepare(`SELECT COUNT(*) as count FROM court_events e ${where}`).get(...params) as any;
    const rows = await db.prepare(`
      SELECT e.*, p.first_name || ' ' || p.last_name as defendant_full_name
      FROM court_events e
      LEFT JOIN persons p ON e.defendant_person_id = p.id
      ${where}
      ORDER BY e.event_date ASC, e.event_time ASC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    c.header('Cache-Control', 'private, max-age=30');
    return c.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total: countRow.count, totalPages: Math.ceil(countRow.count / limitNum) } });
  });

  // GET /events/upcoming
  api.get('/events/upcoming', async (c) => {
    const db = new D1Db(c.env.DB);
    const today = localToday();
    const user = c.get('user');
    const userId = user.userId;
    const rows = await db.prepare(`
      SELECT * FROM court_events
      WHERE event_date >= ? AND status = 'scheduled'
      AND (officers_required LIKE ? OR created_by = ?)
      ORDER BY event_date ASC, event_time ASC LIMIT 30
    `).all(today, `%${userId}%`, userId);
    return c.json({ data: rows });
  });

  // GET /calendar
  api.get('/calendar', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const y = parseInt(q.year || '', 10) || new Date().getFullYear();
    const m = parseInt(q.month || '', 10) || (new Date().getMonth() + 1);
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = `${y}-${String(m).padStart(2, '0')}-31`;

    const rows = await db.prepare('SELECT id, event_number, event_type, status, event_date, event_time, defendant_name, court_name FROM court_events WHERE event_date >= ? AND event_date <= ? ORDER BY event_date ASC, event_time ASC LIMIT 1000').all(startDate, endDate) as any[];

    const calendar: Record<string, any[]> = {};
    for (const row of rows) {
      if (!calendar[row.event_date]) calendar[row.event_date] = [];
      calendar[row.event_date].push(row);
    }

    return c.json({ data: calendar });
  });

  // GET /events/:id
  api.get('/events/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid event ID', code: 'INVALID_EVENT_ID' }, 400);
    const row = await db.prepare("SELECT e.*, p.first_name || ' ' || p.last_name as defendant_full_name FROM court_events e LEFT JOIN persons p ON e.defendant_person_id = p.id WHERE e.id = ?").get(id);
    if (!row) return c.json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' }, 404);
    return c.json({ data: row });
  });

  // POST /events
  api.post('/events', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const { event_type, event_date, event_time, court_name, courtroom, judge_name,
      court_case_number, citation_id, incident_id, case_id,
      defendant_person_id, defendant_name, defendant_dob, prosecutor, defense_attorney,
      officers_required, notes } = body;
    if (!event_type || !event_date) return c.json({ error: 'Event type and date required', code: 'MISSING_FIELDS' }, 400);

    if (typeof event_date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(event_date))
      return c.json({ error: 'event_date must be in YYYY-MM-DD format', code: 'INVALID_DATE_FORMAT' }, 400);

    const user = c.get('user');
    const event_number = await nextEventNumber(db);
    const result = await db.prepare(`
      INSERT INTO court_events (event_number, event_type, status, event_date, event_time,
        court_name, courtroom, judge_name, court_case_number,
        citation_id, incident_id, case_id, defendant_person_id, defendant_name, defendant_dob,
        prosecutor, defense_attorney, officers_required, notes,
        created_by, created_at, updated_at)
      VALUES (?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event_number, event_type, event_date, event_time || null,
      court_name || null, courtroom || null, judge_name || null, court_case_number || null,
      citation_id || null, incident_id || null, case_id || null,
      defendant_person_id || null, defendant_name || null, defendant_dob || null,
      prosecutor || null, defense_attorney || null,
      JSON.stringify(officers_required || []), notes || null,
      user.userId, now, now);

    // createNotification skipped in worker

    return c.json({ data: { id: result.meta.last_row_id, event_number } }, 201);
  });

  // PUT /events/:id
  api.put('/events/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const id = paramNum(c.req.param('id'));
    const user = c.get('user');

    // God Mode: admin can reschedule past court dates — audit when this happens.
    if (user?.role === 'admin' && body.event_date) {
      const existing = await db.prepare('SELECT event_date FROM court_events WHERE id = ?').get(id) as any;
      if (existing?.event_date && existing.event_date < localToday() && body.event_date !== existing.event_date) {
        await auditLog(db, c, 'ADMIN_OVERRIDE', 'court_event', id, `Admin God Mode: rescheduling past court date (${existing.event_date} → ${body.event_date})`);
      }
    }

    const fields = ['event_type', 'status', 'event_date', 'event_time', 'court_name', 'courtroom',
      'judge_name', 'court_case_number', 'citation_id', 'incident_id', 'case_id',
      'defendant_person_id', 'defendant_name', 'defendant_dob', 'prosecutor', 'defense_attorney', 'notes'];
    const updates: string[] = ['updated_at = ?'];
    const params: any[] = [now];
    for (const f of fields) {
      if (body[f] !== undefined) { updates.push(`${f} = ?`); params.push(body[f]); }
    }
    if (body.officers_required !== undefined) {
      updates.push('officers_required = ?');
      params.push(JSON.stringify(body.officers_required));
    }
    params.push(id);
    await db.prepare(`UPDATE court_events SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // createNotification skipped in worker

    return c.json({ data: { id } });
  });

  // PUT /events/:id/outcome
  api.put('/events/:id/outcome', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid event ID', code: 'INVALID_EVENT_ID' }, 400);

    // Fetch full row so we can audit both "fresh outcome" and "admin overriding completed outcome".
    const existing = await db.prepare('SELECT id, outcome, status FROM court_events WHERE id = ?').get(id) as any;
    if (!existing) return c.json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' }, 404);

    const now = localNow();
    const body = await c.req.json();
    const { outcome, sentence, fine_amount, notes } = body;
    if (!outcome) return c.json({ error: 'Outcome is required', code: 'OUTCOME_IS_REQUIRED' }, 400);

    if (fine_amount !== undefined && fine_amount !== null) {
      const fineNum = parseFloat(fine_amount);
      if (isNaN(fineNum) || fineNum < 0) return c.json({ error: 'fine_amount must be a non-negative number', code: 'FINEAMOUNT_MUST_BE_A' }, 400);
    }

    // God Mode: admin can change court outcomes on already-completed events — audit when this happens.
    const user = c.get('user');
    if (user?.role === 'admin' && existing.status === 'completed' && existing.outcome && existing.outcome !== outcome) {
      await auditLog(db, c, 'ADMIN_OVERRIDE', 'court_event', id, `Admin God Mode: changing court outcome from "${existing.outcome}" to "${outcome}"`);
    }

    await db.prepare("UPDATE court_events SET outcome = ?, sentence = ?, fine_amount = ?, notes = ?, status = 'completed', updated_at = ? WHERE id = ?")
      .run(outcome, sentence || null, fine_amount || null, notes || null, now, id);

    return c.json({ data: { id, outcome } });
  });

  // DELETE /events/:id
  api.delete('/events/:id', requireRole('admin'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid event ID', code: 'INVALID_EVENT_ID' }, 400);

    const existing = await db.prepare('SELECT * FROM court_events WHERE id = ?').get(id) as any;
    if (!existing) return c.json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' }, 404);

    // Audit BEFORE delete so the record's metadata is captured even if delete fails partway.
    await auditLog(db, c, 'ADMIN_OVERRIDE', 'court_event', id, `Admin God Mode: deleting court event ${existing.event_number} (status=${existing.status})`);
    await db.prepare('DELETE FROM court_events WHERE id = ?').run(id);
    return c.json({ success: true, message: `Court event ${existing.event_number} deleted` });
  });

  // POST /events/from-citation
  api.post('/events/from-citation', async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json();
    const { citation_id } = body;
    if (!citation_id) return c.json({ error: 'citation_id is required', code: 'CITATIONID_IS_REQUIRED' }, 400);

    const citation = await db.prepare('SELECT * FROM citations WHERE id = ?').get(citation_id) as any;
    if (!citation) return c.json({ error: 'Citation not found', code: 'CITATION_NOT_FOUND' }, 404);

    const now = localNow();
    const user = c.get('user');
    const event_number = await nextEventNumber(db);

    const result = await db.prepare(`
      INSERT INTO court_events (event_number, event_type, status, event_date, event_time,
        court_name, court_case_number, citation_id,
        defendant_name, notes, created_by, created_at, updated_at)
      VALUES (?, 'arraignment', 'scheduled', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event_number, citation.court_date || localToday(), citation.court_name || null,
      citation.citation_number || null, citation_id, citation.person_name || null,
      `Auto-created from citation ${citation.citation_number}`, user.userId, now, now);

    return c.json({ data: { id: result.meta.last_row_id, event_number } }, 201);
  });

  // GET /events/:id/conflicts
  api.get('/events/:id/conflicts', async (c) => {
    const db = new D1Db(c.env.DB);
    const evt = await db.prepare('SELECT * FROM court_events WHERE id = ?').get(paramNum(c.req.param('id'))) as any;
    if (!evt) return c.json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' }, 404);

    let officers: any[] = [];
    try { officers = JSON.parse(evt.officers_required || '[]'); } catch { officers = []; }
    const conflicts: any[] = [];
    for (const officerId of officers) {
      const shift = await db.prepare("SELECT s.* FROM schedules s WHERE s.officer_id = ? AND s.shift_date = ? AND s.status != 'cancelled'").get(officerId, evt.event_date) as any;
      if (shift) {
        const userRow = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(officerId) as any;
        conflicts.push({ officer_id: officerId, officer_name: userRow?.full_name || 'Unknown', conflict_type: 'shift', details: `Shift scheduled: ${shift.start_time || ''} - ${shift.end_time || ''}` });
      }
      const otherCourt = await db.prepare("SELECT * FROM court_events WHERE id != ? AND event_date = ? AND status = 'scheduled' AND officers_required LIKE ? LIMIT 1000").all(evt.id, evt.event_date, `%${officerId}%`) as any[];
      if (otherCourt.length > 0) {
        const userRow = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(officerId) as any;
        for (const oc of otherCourt) {
          conflicts.push({ officer_id: officerId, officer_name: userRow?.full_name || 'Unknown', conflict_type: 'court', details: `Also assigned to ${oc.event_number} at ${oc.event_time || 'TBD'}` });
        }
      }
    }
    return c.json({ data: conflicts });
  });

  // POST /events/:id/continuance
  api.post('/events/:id/continuance', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const { reason, new_date, new_time } = body;
    if (!reason) return c.json({ error: 'Continuance reason is required', code: 'CONTINUANCE_REASON_IS_REQUIRED' }, 400);

    const evt = await db.prepare('SELECT * FROM court_events WHERE id = ?').get(paramNum(c.req.param('id'))) as any;
    if (!evt) return c.json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' }, 404);

    const user = c.get('user');
    const log = JSON.parse(evt.continuance_log || '[]');
    log.push({ date: now, reason, old_date: evt.event_date, old_time: evt.event_time, new_date: new_date || null, new_time: new_time || null, requested_by: user.userId });

    const updates: any = { continuance_count: (evt.continuance_count || 0) + 1, continuance_log: JSON.stringify(log), status: 'continued', updated_at: now };
    if (new_date) { updates.event_date = new_date; updates.status = 'scheduled'; }
    if (new_time) updates.event_time = new_time;

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.prepare(`UPDATE court_events SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), evt.id);

    return c.json({ data: { id: evt.id, continuance_count: updates.continuance_count } });
  });

  // PUT /events/:id/confirm
  api.put('/events/:id/confirm', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const evt = await db.prepare('SELECT * FROM court_events WHERE id = ?').get(paramNum(c.req.param('id'))) as any;
    if (!evt) return c.json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' }, 404);

    const user = c.get('user');
    const confirmations = JSON.parse(evt.officer_confirmations || '{}');
    confirmations[String(user.userId)] = { confirmed: true, at: now };
    await db.prepare('UPDATE court_events SET officer_confirmations = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(confirmations), now, evt.id);

    return c.json({ data: { confirmations } });
  });

  // PUT /events/:id/bail
  api.put('/events/:id/bail', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const { bail_amount, bond_status, surety_info } = body;
    await db.prepare('UPDATE court_events SET bail_amount = ?, bond_status = ?, surety_info = ?, updated_at = ? WHERE id = ?')
      .run(bail_amount ?? null, bond_status ?? null, surety_info ?? null, now, paramNum(c.req.param('id')));
    return c.json({ data: { id: paramNum(c.req.param('id')) } });
  });

  // POST /events/:id/documents
  api.post('/events/:id/documents', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const { file_url, file_name, doc_type } = body;
    if (!file_url || !file_name) return c.json({ error: 'file_url and file_name required', code: 'FILEURL_AND_FILENAME_REQUIRED' }, 400);

    const evt = await db.prepare('SELECT * FROM court_events WHERE id = ?').get(paramNum(c.req.param('id'))) as any;
    if (!evt) return c.json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' }, 404);

    const user = c.get('user');
    const docs = JSON.parse(evt.documents || '[]');
    docs.push({ file_url, file_name, doc_type: doc_type || 'other', uploaded_by: user.userId, uploaded_at: now });
    await db.prepare('UPDATE court_events SET documents = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(docs), now, evt.id);

    return c.json({ data: { documents: docs } });
  });

  // PUT /events/:id/judge-notes
  api.put('/events/:id/judge-notes', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    await db.prepare('UPDATE court_events SET judge_notes = ?, updated_at = ? WHERE id = ?')
      .run(body.judge_notes ?? null, now, paramNum(c.req.param('id')));
    return c.json({ data: { id: paramNum(c.req.param('id')) } });
  });

  // GET /statistics
  api.get('/statistics', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const months = parseInt(q.period || '12', 10) || 12;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const byOutcome = await db.prepare('SELECT outcome, COUNT(*) as count FROM court_events WHERE outcome IS NOT NULL AND event_date >= ? GROUP BY outcome ORDER BY count DESC').all(cutoffStr);
    const byType = await db.prepare('SELECT event_type, COUNT(*) as count FROM court_events WHERE event_date >= ? GROUP BY event_type ORDER BY count DESC').all(cutoffStr);
    const byMonth = await db.prepare("SELECT strftime('%Y-%m', event_date) as month, outcome, COUNT(*) as count FROM court_events WHERE outcome IS NOT NULL AND event_date >= ? GROUP BY month, outcome ORDER BY month ASC").all(cutoffStr);
    const totals = await db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled, SUM(continuance_count) as total_continuances, AVG(fine_amount) as avg_fine FROM court_events WHERE event_date >= ?").get(cutoffStr);

    return c.json({ data: { byOutcome, byType, byMonth, totals } });
  });

  // POST /events/generate-reminders — skipped (createNotification not available in workers)

  // PUT /events/:id/prosecutor
  api.put('/events/:id/prosecutor', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const { prosecutor_name, prosecutor_phone, prosecutor_email } = body;

    const evt = await db.prepare('SELECT id FROM court_events WHERE id = ?').get(paramNum(c.req.param('id')));
    if (!evt) return c.json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' }, 404);

    const prosecutorInfo = JSON.stringify({ name: prosecutor_name || '', phone: prosecutor_phone || '', email: prosecutor_email || '' });
    await db.prepare('UPDATE court_events SET prosecutor = ?, updated_at = ? WHERE id = ?').run(prosecutorInfo, now, paramNum(c.req.param('id')));
    return c.json({ data: { id: paramNum(c.req.param('id')), prosecutor: JSON.parse(prosecutorInfo) } });
  });

  // PUT /events/:id/fees
  api.put('/events/:id/fees', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const { filing_fee, service_fee, other_fees, fee_notes } = body;
    const evt = await db.prepare('SELECT * FROM court_events WHERE id = ?').get(paramNum(c.req.param('id'))) as any;
    if (!evt) return c.json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' }, 404);

    const fees = JSON.parse(evt.court_fees || '{}');
    if (filing_fee !== undefined) fees.filing_fee = parseFloat(filing_fee) || 0;
    if (service_fee !== undefined) fees.service_fee = parseFloat(service_fee) || 0;
    if (other_fees !== undefined) fees.other_fees = parseFloat(other_fees) || 0;
    if (fee_notes !== undefined) fees.fee_notes = fee_notes;
    fees.total = (fees.filing_fee || 0) + (fees.service_fee || 0) + (fees.other_fees || 0);
    fees.updated_at = now;

    await db.prepare('UPDATE court_events SET court_fees = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(fees), now, evt.id);
    return c.json({ data: { id: evt.id, fees } });
  });

  // GET /events/:id/witnesses
  api.get('/events/:id/witnesses', async (c) => {
    const db = new D1Db(c.env.DB);
    const evt = await db.prepare('SELECT witnesses FROM court_events WHERE id = ?').get(paramNum(c.req.param('id'))) as any;
    if (!evt) return c.json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' }, 404);
    return c.json({ data: JSON.parse(evt.witnesses || '[]') });
  });

  // PUT /events/:id/witnesses
  api.put('/events/:id/witnesses', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const { witnesses } = body;

    const evt = await db.prepare('SELECT id FROM court_events WHERE id = ?').get(paramNum(c.req.param('id')));
    if (!evt) return c.json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' }, 404);
    if (!Array.isArray(witnesses)) return c.json({ error: 'witnesses must be an array', code: 'WITNESSES_MUST_BE_AN' }, 400);

    const sanitized = witnesses.slice(0, 50).map((w: any) => ({
      name: String(w.name || '').slice(0, 200), phone: String(w.phone || '').slice(0, 30),
      email: String(w.email || '').slice(0, 200), role: String(w.role || 'witness').slice(0, 50),
      contact_status: String(w.contact_status || 'pending').slice(0, 30), notes: String(w.notes || '').slice(0, 500),
    }));

    await db.prepare('UPDATE court_events SET witnesses = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(sanitized), now, paramNum(c.req.param('id')));
    return c.json({ data: sanitized });
  });

  // POST /events/:id/clone
  api.post('/events/:id/clone', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const { new_date, new_time, notes_prefix } = body;
    if (!new_date) return c.json({ error: 'new_date is required for cloning', code: 'NEWDATE_IS_REQUIRED_FOR' }, 400);

    const evt = await db.prepare('SELECT * FROM court_events WHERE id = ?').get(paramNum(c.req.param('id'))) as any;
    if (!evt) return c.json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' }, 404);

    const user = c.get('user');
    const event_number = await nextEventNumber(db);
    const cloneNotes = `${notes_prefix || 'Continued from'} ${evt.event_number}. ${evt.notes || ''}`.trim();

    const result = await db.prepare(`
      INSERT INTO court_events (event_number, event_type, status, event_date, event_time,
        court_name, courtroom, judge_name, court_case_number,
        citation_id, incident_id, case_id, defendant_person_id, defendant_name, defendant_dob,
        prosecutor, defense_attorney, officers_required, notes,
        created_by, created_at, updated_at)
      VALUES (?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event_number, evt.event_type, new_date, new_time || evt.event_time,
      evt.court_name, evt.courtroom, evt.judge_name, evt.court_case_number,
      evt.citation_id, evt.incident_id, evt.case_id,
      evt.defendant_person_id, evt.defendant_name, evt.defendant_dob || null,
      evt.prosecutor, evt.defense_attorney, evt.officers_required,
      cloneNotes, user.userId, now, now);

    await db.prepare("UPDATE court_events SET status = 'continued', updated_at = ? WHERE id = ? AND status = 'scheduled'").run(now, evt.id);

    return c.json({ data: { id: result.meta.last_row_id, event_number, cloned_from: evt.event_number } }, 201);
  });

  // POST /events/generate-7day-reminders — skipped (createNotification not available in workers)

  // PUT /events/:id/verdict
  api.put('/events/:id/verdict', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid event ID', code: 'INVALID_EVENT_ID' }, 400);

    const existing = await db.prepare('SELECT * FROM court_events WHERE id = ?').get(id) as any;
    if (!existing) return c.json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' }, 404);

    const body = await c.req.json();
    const { verdict, verdict_date, sentence_type, sentence_details, probation_length,
      jail_time, fine_amount, restitution_amount, community_service_hours,
      appeal_deadline } = body;

    const validVerdicts = ['guilty', 'not_guilty', 'dismissed', 'nolle_prosequi', 'plea_deal',
      'deferred_adjudication', 'mistrial', 'acquitted', 'no_contest'];
    if (!verdict || !validVerdicts.includes(verdict))
      return c.json({ error: 'Valid verdict required', code: 'INVALID_VERDICT' }, 400);

    const now = localNow();
    const user = c.get('user');
    const verdictData = JSON.stringify({
      verdict, verdict_date: verdict_date || localToday(),
      sentence_type: sentence_type || null, sentence_details: sentence_details || null,
      probation_length: probation_length || null, jail_time: jail_time || null,
      fine_amount: fine_amount || null, restitution_amount: restitution_amount || null,
      community_service_hours: community_service_hours || null, appeal_deadline: appeal_deadline || null,
      recorded_by: user.userId, recorded_at: now,
    });

    await db.prepare("UPDATE court_events SET outcome = ?, sentence = ?, fine_amount = ?, verdict_data = ?, status = 'completed', updated_at = ? WHERE id = ?")
      .run(verdict, sentence_details || sentence_type || null, fine_amount || null, verdictData, now, id);

    return c.json({ data: { id, verdict, status: 'completed' } });
  });

  // POST /subpoenas
  api.post('/subpoenas', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const { officer_id, court_event_id, court_case_number, court_name,
      hearing_date, hearing_time, served_date, served_method, notes } = body;
    if (!officer_id || !hearing_date) return c.json({ error: 'officer_id and hearing_date required', code: 'MISSING_SUBPOENA_FIELDS' }, 400);

    const user = c.get('user');
    const event_number = await nextEventNumber(db);
    const servedNote = (served_date || served_method) ? `[Served: ${served_date || 'date n/a'}${served_method ? ` via ${served_method}` : ''}]` : '';
    const combinedNotes = [servedNote, notes].filter(Boolean).join(' ').trim() || null;

    const result = await db.prepare(`
      INSERT INTO court_events (event_number, event_type, status, event_date, event_time,
        court_name, court_case_number, officers_required,
        notes, created_by, created_at, updated_at)
      VALUES (?, 'subpoena', 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event_number, hearing_date, hearing_time || null,
      court_name || null, court_case_number || null,
      JSON.stringify([officer_id]),
      combinedNotes, user.userId, now, now);

    // createNotification skipped in worker

    return c.json({ data: { id: result.meta.last_row_id, event_number } }, 201);
  });

  // GET /subpoenas/officer/:officerId
  api.get('/subpoenas/officer/:officerId', async (c) => {
    const db = new D1Db(c.env.DB);
    const officerId = paramNum(c.req.param('officerId'));
    if (isNaN(officerId)) return c.json({ error: 'Invalid officer ID', code: 'INVALID_OFFICER_ID' }, 400);

    const rows = await db.prepare(`
      SELECT e.*, u.full_name as officer_name
      FROM court_events e
      LEFT JOIN users u ON ? = u.id
      WHERE e.event_type = 'subpoena' AND e.officers_required LIKE ?
        AND e.status IN ('scheduled', 'continued')
      ORDER BY e.event_date ASC LIMIT 100
    `).all(officerId, `%${officerId}%`);

    return c.json({ data: rows });
  });

  // GET /compliance-rate
  api.get('/compliance-rate', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const months = parseInt(q.months || '12', 10);
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const officerCompliance = await db.prepare(`
      SELECT u.id as officer_id, u.full_name as officer_name,
        COUNT(DISTINCT e.id) as total_events,
        SUM(CASE WHEN json_extract(e.officer_confirmations, '$.' || u.id || '.confirmed') = 1 THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM users u
      CROSS JOIN court_events e
      WHERE e.event_date >= ? AND e.officers_required LIKE '%' || u.id || '%'
      GROUP BY u.id HAVING total_events > 0
      ORDER BY total_events DESC
    `).all(cutoffStr) as any[];

    const overall = await db.prepare("SELECT COUNT(*) as total_events, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status = 'missed' OR status = 'no_show' THEN 1 ELSE 0 END) as missed, SUM(CASE WHEN status = 'continued' THEN 1 ELSE 0 END) as continued, SUM(continuance_count) as total_continuances FROM court_events WHERE event_date >= ?").get(cutoffStr) as any;

    const complianceRate = overall.total_events > 0 ? Math.round((overall.completed / overall.total_events) * 100) : 0;

    return c.json({
      data: {
        overall: { ...overall, compliance_rate: complianceRate },
        by_officer: officerCompliance.map((o: any) => ({ ...o, compliance_rate: o.total_events > 0 ? Math.round((o.confirmed / o.total_events) * 100) : 0 })),
        period_months: months,
      },
    });
  });

  // GET /events/:id/linked-records
  api.get('/events/:id/linked-records', async (c) => {
    const db = new D1Db(c.env.DB);
    const evt = await db.prepare('SELECT * FROM court_events WHERE id = ?').get(paramNum(c.req.param('id'))) as any;
    if (!evt) return c.json({ error: 'Court event not found', code: 'COURT_EVENT_NOT_FOUND' }, 404);

    const links: any = { citation: null, incident: null, case_record: null, arrests: [], related_events: [] };

    if (evt.citation_id) {
      links.citation = await db.prepare('SELECT id, citation_number, violation, person_name, status FROM citations WHERE id = ?').get(evt.citation_id);
    }
    if (evt.incident_id) {
      links.incident = await db.prepare('SELECT id, incident_number, incident_type, status FROM incidents WHERE id = ?').get(evt.incident_id);
    }
    if (evt.case_id) {
      links.case_record = await db.prepare('SELECT id, case_number, case_type, status FROM cases WHERE id = ?').get(evt.case_id);
    }
    if (evt.defendant_name) {
      links.arrests = await db.prepare('SELECT id, full_name, booking_date, charges, status FROM arrest_records WHERE full_name LIKE ? OR last_name LIKE ? LIMIT 10').all(`%${evt.defendant_name}%`, `%${evt.defendant_name}%`);
    }
    if (evt.court_case_number) {
      links.related_events = await db.prepare('SELECT id, event_number, event_type, event_date, status, outcome FROM court_events WHERE court_case_number = ? AND id != ? ORDER BY event_date ASC LIMIT 20').all(evt.court_case_number, evt.id);
    }

    return c.json({ data: links });
  });

  app.route('/api/court', api);
}
