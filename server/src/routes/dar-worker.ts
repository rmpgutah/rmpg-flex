import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow, localToday } from '../worker-middleware/d1Helpers';

export function mountDarRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  async function nextDarNumber(db: D1Db): Promise<string> {
    const yr = new Date().getFullYear();
    const prefix = `DAR-${yr}-`;
    const last = await db.prepare(
      "SELECT dar_number FROM daily_activity_reports WHERE dar_number LIKE ? ORDER BY id DESC LIMIT 1"
    ).get(`${prefix}%`) as { dar_number: string } | undefined;
    const parsed = last ? parseInt(last.dar_number.replace(prefix, ''), 10) : 0;
    const seq = isNaN(parsed) ? 1 : parsed + 1;
    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  // ─── GET / ───────────────────────────────────────────────
  api.get('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { status, officer_id, property_id, date_from, date_to, search, page = '1', limit = '100000' } = q;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100000, Math.max(1, (parseInt(limit, 10)) || 100000));
      const offset = (pageNum - 1) * limitNum;

      let where = 'WHERE 1=1';
      const params: any[] = [];
      if (status) { where += ' AND d.status = ?'; params.push(status); }
      if (officer_id) { where += ' AND d.officer_id = ?'; params.push(officer_id); }
      if (property_id) { where += ' AND d.property_id = ?'; params.push(property_id); }
      if (date_from) { where += ' AND d.shift_date >= ?'; params.push(date_from); }
      if (date_to) { where += ' AND d.shift_date <= ?'; params.push(date_to); }
      if (search) {
        where += ' AND (d.dar_number LIKE ? OR d.officer_name LIKE ? OR d.property_name LIKE ? OR d.activities_narrative LIKE ?)';
        const s = `%${search}%`; params.push(s, s, s, s);
      }

      const total = ((await db.prepare(`SELECT COUNT(*) as count FROM daily_activity_reports d ${where}`).get(...params)) as any)?.count || 0;
      const rows = await db.prepare(`
        SELECT d.*, u.full_name as reviewer_name
        FROM daily_activity_reports d
        LEFT JOIN users u ON d.reviewed_by = u.id
        ${where}
        ORDER BY d.shift_date DESC, d.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, limitNum, offset);

      return c.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
    } catch {
      return c.json({ error: 'Failed to retrieve daily activity reports', code: 'LIST_DAR_ERROR' }, 500);
    }
  });

  // ─── GET /:id ────────────────────────────────────────────
  api.get('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) { return c.json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }, 400); }
      const row = await db.prepare('SELECT * FROM daily_activity_reports WHERE id = ?').get(id);
      if (!row) return c.json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' }, 404);
      return c.json({ data: row });
    } catch {
      return c.json({ error: 'Failed to retrieve DAR', code: 'GET_DAR_ERROR' }, 500);
    }
  });

  // ─── POST /auto-populate ────────────────────────────────
  api.post('/auto-populate', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { officer_id, shift_date } = body;
      if (!officer_id || !shift_date) return c.json({ error: 'Officer ID and shift date required', code: 'OFFICER_ID_AND_SHIFT' }, 400);

      const officer = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(officer_id) as any;

      const calls = await db.prepare(`
        SELECT id, call_number, incident_type, created_at, disposition, status
        FROM calls_for_service
        WHERE DATE(created_at) = ? AND (assigned_unit_ids LIKE ? OR dispatcher_id = ?)
        ORDER BY created_at
        LIMIT 1000
      `).all(shift_date, `%${officer_id}%`, officer_id) as any[];

      const incidents = await db.prepare(`
        SELECT id, incident_number, incident_type FROM incidents
        WHERE DATE(created_at) = ? AND officer_id = ?
        LIMIT 1000
      `).all(shift_date, officer_id) as any[];

      const citations = await db.prepare(`
        SELECT id, citation_number, type FROM citations
        WHERE violation_date = ? AND issuing_officer_id = ?
        LIMIT 1000
      `).all(shift_date, officer_id) as any[];

      const patrols = await db.prepare(`
        SELECT ps.id, pc.name as checkpoint, ps.scanned_at, ps.status
        FROM patrol_scans ps
        JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
        WHERE DATE(ps.scanned_at) = ? AND ps.officer_id = ?
        LIMIT 1000
      `).all(shift_date, officer_id) as any[];

      const timeEntry = await db.prepare(`
        SELECT clock_in, clock_out FROM time_entries
        WHERE officer_id = ? AND DATE(clock_in) = ?
        ORDER BY clock_in DESC LIMIT 1
      `).get(officer_id, shift_date) as any;

      const schedule = await db.prepare(`
        SELECT s.start_time, s.end_time, p.name as property_name, p.id as property_id
        FROM schedules s
        LEFT JOIN properties p ON s.property_id = p.id
        WHERE s.officer_id = ? AND s.shift_date = ?
        ORDER BY s.start_time LIMIT 1
      `).get(officer_id, shift_date) as any;

      let fieldInterviews: any[] = [];
      try {
        fieldInterviews = await db.prepare(`
          SELECT id, subject_first_name, subject_last_name, location, reason
          FROM field_interviews
          WHERE DATE(interview_date) = ? AND officer_id = ?
          LIMIT 1000
        `).all(shift_date, officer_id);
      } catch { /* table may not exist */ }

      const narrativeParts: string[] = [];

      if (schedule?.property_name) { narrativeParts.push(`Assigned to ${schedule.property_name}.`); }

      if (timeEntry?.clock_in) {
        const clockIn = new Date(timeEntry.clock_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const clockOut = timeEntry.clock_out
          ? new Date(timeEntry.clock_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
          : 'ongoing';
        narrativeParts.push(`On duty ${clockIn} - ${clockOut}.`);
      }

      if (calls.length > 0) {
        const typeCounts: Record<string, number> = {};
        for (const cc of calls) {
          const t = (cc.incident_type || 'other').replace(/_/g, ' ');
          typeCounts[t] = (typeCounts[t] || 0) + 1;
        }
        const typeList = Object.entries(typeCounts)
          .map(([type, count]) => count > 1 ? `${count} ${type}` : type)
          .join(', ');
        narrativeParts.push(`Responded to ${calls.length} call(s): ${typeList}.`);
      }

      if (incidents.length > 0) {
        const incNums = incidents.map((i: any) => i.incident_number).join(', ');
        narrativeParts.push(`Generated ${incidents.length} incident report(s): ${incNums}.`);
      }

      if (citations.length > 0) { narrativeParts.push(`Issued ${citations.length} citation(s).`); }
      if (fieldInterviews.length > 0) { narrativeParts.push(`Conducted ${fieldInterviews.length} field interview(s).`); }

      if (patrols.length > 0) {
        const onTime = patrols.filter((p: any) => p.status === 'on_time').length;
        narrativeParts.push(`Completed ${patrols.length} patrol check(s) (${onTime} on-time).`);
      }

      if (narrativeParts.length === 0) { narrativeParts.push('No logged activity for this shift.'); }

      const autoNarrative = narrativeParts.join(' ');

      return c.json({
        data: {
          officer_name: officer?.full_name || '',
          shift_start: timeEntry?.clock_in || schedule?.start_time || null,
          shift_end: timeEntry?.clock_out || schedule?.end_time || null,
          property_id: schedule?.property_id || null,
          property_name: schedule?.property_name || null,
          calls_handled: calls.map((cc: any) => ({ call_id: cc.id, number: cc.call_number, type: cc.incident_type, time: cc.created_at, disposition: cc.disposition })),
          incidents_created: incidents.map((i: any) => ({ incident_id: i.id, number: i.incident_number, type: i.incident_type })),
          citations_issued: citations.map((cc: any) => ({ citation_id: cc.id, number: cc.citation_number, type: cc.type })),
          field_interviews: fieldInterviews.map((fi: any) => ({ name: `${fi.subject_first_name} ${fi.subject_last_name}`, location: fi.location, reason: fi.contact_reason })),
          patrols_completed: patrols.map((p: any) => ({ checkpoint: p.checkpoint, time: p.scanned_at, status: p.status })),
          auto_narrative: autoNarrative,
        },
      });
    } catch {
      return c.json({ error: 'Failed to auto-populate DAR data', code: 'AUTO_POPULATE_ERROR' }, 500);
    }
  });

  // ─── POST / ──────────────────────────────────────────────
  api.post('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const body = await c.req.json();
      const { shift_date, officer_id, officer_name, shift_start, shift_end,
        property_id, property_name, post_assignment,
        calls_handled, incidents_created, citations_issued, patrols_completed,
        activities_narrative, notable_events, equipment_issues, safety_concerns, recommendations } = body;
      if (!shift_date) return c.json({ error: 'Shift date is required', code: 'MISSING_SHIFT_DATE' }, 400);

      if (typeof shift_date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(shift_date)) {
        return c.json({ error: 'shift_date must be in YYYY-MM-DD format', code: 'INVALID_DATE_FORMAT' }, 400);
      }

      const user = c.get('user');
      const effectiveOfficerId = officer_id || user?.userId;
      const u = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(effectiveOfficerId) as any;
      const dar_number = await nextDarNumber(db);

      const result = await db.prepare(`
        INSERT INTO daily_activity_reports (dar_number, status, officer_id, officer_name,
          shift_date, shift_start, shift_end, property_id, property_name, post_assignment,
          calls_handled, incidents_created, citations_issued, patrols_completed,
          activities_narrative, notable_events, equipment_issues, safety_concerns, recommendations,
          created_at, updated_at)
        VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(dar_number, effectiveOfficerId, officer_name || u?.full_name || '',
        shift_date, shift_start || null, shift_end || null,
        property_id || null, property_name || null, post_assignment || null,
        JSON.stringify(calls_handled || []), JSON.stringify(incidents_created || []),
        JSON.stringify(citations_issued || []), JSON.stringify(patrols_completed || []),
        activities_narrative || null, notable_events || null, equipment_issues || null,
        safety_concerns || null, recommendations || null, now, now);

      return c.json({ data: { id: result.meta.last_row_id, dar_number } }, 201);
    } catch {
      return c.json({ error: 'Failed to create daily activity report', code: 'CREATE_DAR_ERROR' }, 500);
    }
  });

  // ─── PUT /:id ────────────────────────────────────────────
  api.put('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) { return c.json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }, 400); }
      const existing = await db.prepare('SELECT id FROM daily_activity_reports WHERE id = ?').get(id);
      if (!existing) { return c.json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' }, 404); }
      const now = localNow();
      const body = await c.req.json();
      const fields = ['activities_narrative', 'notable_events', 'equipment_issues',
        'safety_concerns', 'recommendations', 'post_assignment', 'shift_start', 'shift_end'];
      const jsonFields = ['calls_handled', 'incidents_created', 'citations_issued', 'patrols_completed'];

      const updates: string[] = ['updated_at = ?'];
      const params: any[] = [now];
      for (const f of fields) {
        if (body[f] !== undefined) { updates.push(`${f} = ?`); params.push(body[f]); }
      }
      for (const f of jsonFields) {
        if (body[f] !== undefined) { updates.push(`${f} = ?`); params.push(JSON.stringify(body[f])); }
      }
      params.push(id);
      await db.prepare(`UPDATE daily_activity_reports SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      const user = c.get('user');
      if (user?.role === 'admin' && body.dar_number) {
        await db.prepare('UPDATE daily_activity_reports SET dar_number = ? WHERE id = ?').run(body.dar_number, id);
      }

      return c.json({ data: { id } });
    } catch {
      return c.json({ error: 'Failed to update DAR', code: 'UPDATE_DAR_ERROR' }, 500);
    }
  });

  // ─── PUT /:id/submit ────────────────────────────────────
  api.put('/:id/submit', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) { return c.json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }, 400); }
      const existing = await db.prepare('SELECT id, status FROM daily_activity_reports WHERE id = ?').get(id) as any;
      if (!existing) { return c.json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' }, 404); }
      const now = localNow();
      await db.prepare('UPDATE daily_activity_reports SET status = ?, submitted_at = ?, updated_at = ? WHERE id = ?')
        .run('submitted', now, now, id);

      return c.json({ data: { id, status: 'submitted' } });
    } catch {
      return c.json({ error: 'Internal server error', code: 'DAR_SUBMIT_ERROR' }, 500);
    }
  });

  // ─── PUT /:id/approve ───────────────────────────────────
  api.put('/:id/approve', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const user = c.get('user');
      const u = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(user?.userId) as any;
      const body = await c.req.json();

      await db.prepare(`UPDATE daily_activity_reports SET status = 'approved', reviewed_by = ?,
        reviewed_by_name = ?, reviewed_at = ?, review_notes = ?, updated_at = ? WHERE id = ?`)
        .run(user?.userId, u?.full_name || '', now, body?.review_notes || null, now, paramNum(c.req.param('id')));

      return c.json({ data: { id: paramNum(c.req.param('id')), status: 'approved' } });
    } catch {
      return c.json({ error: 'Internal server error', code: 'DAR_APPROVE_ERROR' }, 500);
    }
  });

  // ─── PUT /:id/return ────────────────────────────────────
  api.put('/:id/return', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const user = c.get('user');
      const u = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(user?.userId) as any;
      const body = await c.req.json();
      const { review_notes } = body;
      if (!review_notes) return c.json({ error: 'Review notes required when returning', code: 'MISSING_REVIEW_NOTES' }, 400);

      await db.prepare(`UPDATE daily_activity_reports SET status = 'returned', reviewed_by = ?,
        reviewed_by_name = ?, reviewed_at = ?, review_notes = ?, updated_at = ? WHERE id = ?`)
        .run(user?.userId, u?.full_name || '', now, review_notes, now, paramNum(c.req.param('id')));

      return c.json({ data: { id: paramNum(c.req.param('id')), status: 'returned' } });
    } catch {
      return c.json({ error: 'Internal server error', code: 'DAR_RETURN_ERROR' }, 500);
    }
  });

  // ─── GET /:id/completeness ──────────────────────────────
  api.get('/:id/completeness', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) { return c.json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }, 400); }

      const dar = await db.prepare('SELECT * FROM daily_activity_reports WHERE id = ?').get(id) as any;
      if (!dar) return c.json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' }, 404);

      let score = 0;
      let maxScore = 0;
      const checks: { field: string; filled: boolean; weight: number }[] = [];

      const scoreField = (field: string, value: any, weight: number, minLength = 0) => {
        maxScore += weight;
        const filled = value != null && String(value).trim().length > minLength;
        if (filled) score += weight;
        checks.push({ field, filled, weight });
      };

      scoreField('officer_name', dar.officer_name, 10);
      scoreField('shift_date', dar.shift_date, 10);
      scoreField('shift_start', dar.shift_start, 8);
      scoreField('shift_end', dar.shift_end, 8);
      scoreField('property_name', dar.property_name, 5);
      scoreField('activities_narrative', dar.activities_narrative, 25, 20);
      scoreField('calls_handled', dar.calls_handled, 8, 2);
      scoreField('incidents_created', dar.incidents_created, 8, 2);
      scoreField('patrols_completed', dar.patrols_completed, 5, 2);
      scoreField('notable_events', dar.notable_events, 5, 5);
      scoreField('equipment_issues', dar.equipment_issues, 4);
      scoreField('safety_concerns', dar.safety_concerns, 4);

      const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
      let rating: string;
      if (pct >= 90) rating = 'excellent';
      else if (pct >= 75) rating = 'good';
      else if (pct >= 50) rating = 'fair';
      else rating = 'incomplete';

      return c.json({ dar_id: id, score: pct, rating, max_score: maxScore, earned_score: score, field_checks: checks });
    } catch {
      return c.json({ error: 'Failed to calculate completeness', code: 'DAR_COMPLETENESS_ERROR' }, 500);
    }
  });

  // ─── PUT /:id/review ────────────────────────────────────
  api.put('/:id/review', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) { return c.json({ error: 'Invalid DAR ID', code: 'INVALID_DAR_ID' }, 400); }
      const existing = await db.prepare('SELECT id, status FROM daily_activity_reports WHERE id = ?').get(id) as any;
      if (!existing) { return c.json({ error: 'DAR not found', code: 'DAR_NOT_FOUND' }, 404); }

      const user = c.get('user');
      if (existing.status !== 'submitted' && user?.role !== 'admin') {
        return c.json({ error: 'DAR must be in submitted status to review', code: 'DAR_MUST_BE_SUBMITTED' }, 400);
      }

      const now = localNow();
      const u = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(user?.userId) as any;
      const body = await c.req.json();

      await db.prepare(`UPDATE daily_activity_reports SET status = 'reviewed', reviewed_by = ?,
        reviewed_by_name = ?, reviewed_at = ?, review_notes = ?, updated_at = ? WHERE id = ?`)
        .run(user?.userId, u?.full_name || '', now, body?.review_notes || null, now, id);

      return c.json({ data: { id, status: 'reviewed' } });
    } catch {
      return c.json({ error: 'Internal server error', code: 'DAR_REVIEW_ERROR' }, 500);
    }
  });

  // ─── GET /templates/list ────────────────────────────────
  api.get('/templates/list', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { property_id } = q;

      let rows: any[];
      try {
        if (property_id) {
          rows = await db.prepare(`
            SELECT * FROM dar_templates WHERE property_id = ? OR property_id IS NULL
            ORDER BY is_default DESC, name ASC LIMIT 100
          `).all(property_id);
        } else {
          rows = await db.prepare('SELECT * FROM dar_templates ORDER BY is_default DESC, name ASC LIMIT 100').all();
        }
      } catch {
        rows = [];
      }
      return c.json({ data: rows });
    } catch {
      return c.json({ error: 'Failed to list templates', code: 'LIST_TEMPLATES_ERROR' }, 500);
    }
  });

  // ─── POST /templates ────────────────────────────────────
  api.post('/templates', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const user = c.get('user');
      const body = await c.req.json();
      const { name, property_id, post_assignment, activities_narrative_template,
        notable_events_template, is_default } = body;
      if (!name) return c.json({ error: 'Template name required', code: 'TEMPLATE_NAME_REQUIRED' }, 400);

      try {
        await db.prepare(`CREATE TABLE IF NOT EXISTS dar_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL, property_id INTEGER, post_assignment TEXT,
          activities_narrative_template TEXT, notable_events_template TEXT,
          is_default INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT, updated_at TEXT
        )`);
      } catch { /* may already exist */ }

      const result = await db.prepare(`
        INSERT INTO dar_templates (name, property_id, post_assignment, activities_narrative_template,
          notable_events_template, is_default, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, property_id || null, post_assignment || null,
        activities_narrative_template || null, notable_events_template || null,
        is_default ? 1 : 0, user?.userId, now, now);

      return c.json({ data: { id: result.meta.last_row_id, name } }, 201);
    } catch {
      return c.json({ error: 'Failed to create template', code: 'CREATE_TEMPLATE_ERROR' }, 500);
    }
  });

  // ─── DELETE /templates/:templateId ──────────────────────
  api.delete('/templates/:templateId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const templateId = paramNum(c.req.param('templateId'));
      if (isNaN(templateId)) { return c.json({ error: 'Invalid template ID' }, 400); }
      try { await db.prepare('DELETE FROM dar_templates WHERE id = ?').run(templateId); } catch { /* ok */ }
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Failed to delete template', code: 'DELETE_TEMPLATE_ERROR' }, 500);
    }
  });

  // ─── GET /stats/summary ─────────────────────────────────
  api.get('/stats/summary', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { date_from, date_to } = q;
      const from = date_from || localToday();
      const to = date_to || localToday();

      const statusCounts = await db.prepare(`
        SELECT status, COUNT(*) as count FROM daily_activity_reports
        WHERE shift_date >= ? AND shift_date <= ? GROUP BY status
      `).all(from, to) as any[];

      const totalDars = statusCounts.reduce((s: number, r: any) => s + r.count, 0);
      const statusMap: Record<string, number> = {};
      for (const r of statusCounts) statusMap[r.status] = r.count;

      const withNarrative = await db.prepare(`
        SELECT COUNT(*) as count FROM daily_activity_reports
        WHERE shift_date >= ? AND shift_date <= ?
          AND activities_narrative IS NOT NULL AND LENGTH(activities_narrative) > 20
      `).get(from, to) as { count: number };

      const pendingReview = await db.prepare(`
        SELECT COUNT(*) as count FROM daily_activity_reports
        WHERE status IN ('submitted', 'reviewed') AND shift_date >= ? AND shift_date <= ?
      `).get(from, to) as { count: number };

      const topOfficers = await db.prepare(`
        SELECT officer_name, COUNT(*) as count FROM daily_activity_reports
        WHERE shift_date >= ? AND shift_date <= ?
        GROUP BY officer_id ORDER BY count DESC LIMIT 10
      `).all(from, to) as any[];

      return c.json({
        total: totalDars, by_status: statusMap, pending_review: pendingReview.count,
        with_narrative: withNarrative.count,
        narrative_rate: totalDars > 0 ? Math.round((withNarrative.count / totalDars) * 100) : 0,
        top_officers: topOfficers, period: { from, to },
      });
    } catch {
      return c.json({ error: 'Failed to get DAR stats', code: 'DAR_STATS_ERROR' }, 500);
    }
  });

  app.route('/api/dar', api);
}
