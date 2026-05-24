// ============================================================
// Case Management — Workers (Hono) Port
// CRUD, status, approval, solvability, notes, archive,
// junction tables (calls, incidents, persons, vehicles,
// properties, evidence, warrants, citations), stats,
// evidence summary, timeline, completeness, CSV export.
// Skips: auditLog, broadcast, auto-cascade helpers,
// ensureCaseTables (D1 cannot CREATE TABLE at runtime).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';
import { localNow, localToday } from '../worker-middleware/timeUtils';

export function mountCasesRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // === GET /stats ===
  api.get('/stats', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const statusCounts = await db.prepare(`
        SELECT status, COUNT(*) as count FROM cases WHERE archived_at IS NULL GROUP BY status
      `).all() as any[];
      const typeCounts = await db.prepare(`
        SELECT case_type, COUNT(*) as count FROM cases WHERE archived_at IS NULL GROUP BY case_type
      `).all() as any[];
      const avgSolvability = await db.prepare(`
        SELECT ROUND(AVG(solvability_score), 1) as avg FROM cases WHERE archived_at IS NULL AND status NOT LIKE 'closed_%'
      `).get() as any;

      c.header('Cache-Control', 'private, max-age=60');
      return c.json({
        data: {
          by_status: Object.fromEntries(statusCounts.map(r => [r.status, r.count])),
          by_type: Object.fromEntries(typeCounts.map(r => [r.case_type, r.count])),
          total: statusCounts.reduce((a: number, b: any) => a + b.count, 0),
          avg_solvability: avgSolvability?.avg || 0,
        },
      });
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'STATS_ERROR' }, 500);
    }
  });

  // === GET / — List cases ===
  api.get('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { status, case_type, priority, investigator, search, page = '1', limit = '100000' } = q;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100000, Math.max(1, parseInt(limit, 10) || 100000));
      const offset = (pageNum - 1) * limitNum;

      let where = 'WHERE c.archived_at IS NULL';
      const params: any[] = [];

      if (status) { where += ' AND c.status = ?'; params.push(status); }
      if (case_type) { where += ' AND c.case_type = ?'; params.push(case_type); }
      if (priority) { where += ' AND c.priority = ?'; params.push(priority); }
      if (investigator) { where += ' AND c.lead_investigator_id = ?'; params.push(investigator); }
      if (search) {
        where += ' AND (c.case_number LIKE ? OR c.title LIKE ? OR c.summary LIKE ?)';
        const s = `%${search}%`;
        params.push(s, s, s);
      }

      const total = (await db.prepare(`SELECT COUNT(*) as count FROM cases c ${where}`).get(...params) as any).count;
      const rows = await db.prepare(`
        SELECT c.*, u.full_name as lead_investigator_name
        FROM cases c LEFT JOIN users u ON c.lead_investigator_id = u.id
        ${where}
        ORDER BY
          CASE c.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
          c.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, limitNum, offset);

      return c.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
    } catch (error: any) {
      return c.json({ error: 'Failed to retrieve cases', code: 'LIST_CASES_ERROR' }, 500);
    }
  });

  // === GET /:id — Single case ===
  api.get('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
      const row = await db.prepare(`
        SELECT c.*, u.full_name as lead_investigator_name
        FROM cases c LEFT JOIN users u ON c.lead_investigator_id = u.id
        WHERE c.id = ?
      `).get(id);
      if (!row) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);
      return c.json({ data: row });
    } catch (error: any) {
      return c.json({ error: 'Failed to retrieve case', code: 'GET_CASE_ERROR' }, 500);
    }
  });

  // === POST / — Create case ===
  api.post('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const user = c.get('user');
      const body = await c.req.json();
      const { title, case_type = 'general', priority: requestedPriority, summary, lead_investigator_id,
        linked_call_id, linked_persons, linked_incidents, linked_evidence } = body;

      if (!title || (typeof title === 'string' && title.trim().length === 0))
        return c.json({ error: 'Title is required', code: 'MISSING_TITLE' }, 400);
      if (typeof title === 'string' && title.length > 500)
        return c.json({ error: 'Title must be 500 characters or less', code: 'TITLE_TOO_LONG' }, 400);

      let priority = requestedPriority || 'normal';
      if (!requestedPriority && case_type) {
        const HIGH_SEVERITY_TYPES = ['homicide', 'sexual_assault', 'use_of_force', 'death', 'assault', 'kidnapping'];
        const ELEVATED_TYPES = ['burglary', 'robbery', 'narcotics', 'arson', 'domestic', 'missing_person'];
        const LOW_TYPES = ['admin', 'civil', 'property', 'other'];
        if (HIGH_SEVERITY_TYPES.includes(case_type)) priority = 'critical';
        else if (ELEVATED_TYPES.includes(case_type)) priority = 'high';
        else if (LOW_TYPES.includes(case_type)) priority = 'low';
        else priority = 'normal';
      }

      // Generate case number: CASE-YYYY-nnnn
      const year = new Date().getFullYear();
      const count = (await db.prepare("SELECT COUNT(*) as c FROM cases WHERE case_number LIKE 'CASE-' || ? || '-%'").get(String(year)) as any)?.c || 0;
      const case_number = `CASE-${year}-${String(count + 1).padStart(4, '0')}`;

      const personsArr: number[] = Array.isArray(linked_persons) ? linked_persons.map((n: any) => Number(n)).filter(Number.isFinite) : [];
      const incidentsArr: number[] = Array.isArray(linked_incidents) ? linked_incidents.map((n: any) => Number(n)).filter(Number.isFinite) : [];
      const evidenceArr: number[] = Array.isArray(linked_evidence) ? linked_evidence.map((n: any) => Number(n)).filter(Number.isFinite) : [];

      const result = await db.prepare(`
        INSERT INTO cases (case_number, title, case_type, status, priority, lead_investigator_id,
          summary, linked_calls, linked_persons, linked_incidents, linked_evidence,
          created_by, created_at, updated_at, opened_date)
        VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(case_number, title, case_type, priority, lead_investigator_id || null, summary || null,
        linked_call_id ? JSON.stringify([linked_call_id]) : '[]',
        JSON.stringify(personsArr), JSON.stringify(incidentsArr), JSON.stringify(evidenceArr),
        user.userId, now, now, localToday());

      const newId = result.meta.last_row_id || 1;

      if (linked_call_id) {
        await db.prepare('UPDATE calls_for_service SET case_id = ?, case_number = ? WHERE id = ?').run(newId, case_number, linked_call_id);
      }

      // Mirror-write junction tables
      if (personsArr.length > 0) {
        for (const pid of personsArr) {
          await db.prepare('INSERT OR IGNORE INTO case_person_links (case_id, person_id) VALUES (?, ?)').run(newId, pid);
        }
      }
      if (incidentsArr.length > 0) {
        for (const iid of incidentsArr) {
          await db.prepare('INSERT OR IGNORE INTO case_incident_links (case_id, incident_id) VALUES (?, ?)').run(newId, iid);
        }
      }
      if (evidenceArr.length > 0) {
        for (const eid of evidenceArr) {
          await db.prepare('INSERT OR IGNORE INTO case_evidence_links (case_id, evidence_id) VALUES (?, ?)').run(newId, eid);
        }
      }

      return c.json({ data: { id: newId, case_number } }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to create case', code: 'CREATE_CASE_ERROR' }, 500);
    }
  });

  // === PUT /:id — Update case ===
  api.put('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_CASE_ID' }, 400);
      const now = localNow();
      const existing = await db.prepare('SELECT * FROM cases WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Case not found', code: 'CASE_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const fields = ['title', 'case_type', 'priority', 'summary', 'narrative', 'disposition',
        'disposition_date', 'due_date', 'lead_investigator_id', 'assigned_officers',
        'solvability_score', 'solvability_factors', 'linked_incidents', 'linked_citations',
        'linked_evidence', 'linked_persons', 'linked_field_interviews', 'linked_calls'];
      const updates: string[] = ['updated_at = ?'];
      const params: any[] = [now];

      for (const f of fields) {
        if (body[f] !== undefined) {
          updates.push(`${f} = ?`);
          params.push(typeof body[f] === 'object' ? JSON.stringify(body[f]) : body[f]);
        }
      }

      params.push(id);
      await db.prepare(`UPDATE cases SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      const hasPersons = Array.isArray(body.linked_persons);
      const hasIncidents = Array.isArray(body.linked_incidents);
      const hasEvidence = Array.isArray(body.linked_evidence);
      const personsArr: number[] = hasPersons ? body.linked_persons.map((n: any) => Number(n)).filter(Number.isFinite) : [];
      const incidentsArr: number[] = hasIncidents ? body.linked_incidents.map((n: any) => Number(n)).filter(Number.isFinite) : [];
      const evidenceArr: number[] = hasEvidence ? body.linked_evidence.map((n: any) => Number(n)).filter(Number.isFinite) : [];

      if (hasPersons) {
        await db.prepare('DELETE FROM case_person_links WHERE case_id = ?').run(id);
        for (const pid of personsArr) await db.prepare('INSERT OR IGNORE INTO case_person_links (case_id, person_id) VALUES (?, ?)').run(id, pid);
      }
      if (hasIncidents) {
        await db.prepare('DELETE FROM case_incident_links WHERE case_id = ?').run(id);
        for (const iid of incidentsArr) await db.prepare('INSERT OR IGNORE INTO case_incident_links (case_id, incident_id) VALUES (?, ?)').run(id, iid);
      }
      if (hasEvidence) {
        await db.prepare('DELETE FROM case_evidence_links WHERE case_id = ?').run(id);
        for (const eid of evidenceArr) await db.prepare('INSERT OR IGNORE INTO case_evidence_links (case_id, evidence_id) VALUES (?, ?)').run(id, eid);
      }

      return c.json({ data: { id } });
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'UPDATE_ERROR' }, 500);
    }
  });

  // === PUT /:id/submit-review ===
  api.put('/:id/submit-review', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const reviewId = paramNum(c.req.param('id'));
      if (isNaN(reviewId)) return c.json({ error: 'Invalid case ID', code: 'INVALID_CASE_ID' }, 400);
      const existing = await db.prepare('SELECT * FROM cases WHERE id = ?').get(reviewId) as any;
      if (!existing) return c.json({ error: 'Case not found', code: 'CASE_NOT_FOUND' }, 404);

      await db.prepare(`UPDATE cases SET approval_status = 'pending_review', updated_at = ? WHERE id = ?`).run(now, reviewId);
      return c.json({ data: { id: reviewId, approval_status: 'pending_review' } });
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'SUBMIT_REVIEW_ERROR' }, 500);
    }
  });

  // === PUT /:id/approve ===
  api.put('/:id/approve', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const user = c.get('user');
      const body = await c.req.json();
      const { action, return_reason } = body;

      if (!['admin', 'manager', 'supervisor'].includes(user.role)) {
        return c.json({ error: 'Only supervisors can approve cases', code: 'ONLY_SUPERVISORS_CAN_APPROVE' }, 403);
      }

      const approveId = paramNum(c.req.param('id'));
      if (isNaN(approveId)) return c.json({ error: 'Invalid case ID', code: 'INVALID_CASE_ID' }, 400);
      const existing = await db.prepare('SELECT * FROM cases WHERE id = ?').get(approveId) as any;
      if (!existing) return c.json({ error: 'Case not found', code: 'CASE_NOT_FOUND' }, 404);

      if (action === 'approve') {
        await db.prepare(`UPDATE cases SET approval_status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`)
          .run(user.userId, now, now, approveId);
      } else if (action === 'return') {
        await db.prepare(`UPDATE cases SET approval_status = 'returned', return_reason = ?, updated_at = ? WHERE id = ?`)
          .run(return_reason || '', now, approveId);
      } else {
        return c.json({ error: 'Invalid action. Use "approve" or "return"', code: 'INVALID_ACTION_USE_APPROVE' }, 400);
      }

      return c.json({ data: { id: approveId, approval_status: action === 'approve' ? 'approved' : 'returned' } });
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'APPROVAL_ERROR' }, 500);
    }
  });

  // === PUT /:id/status ===
  api.put('/:id/status', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const body = await c.req.json();
      const { status } = body;
      const validStatuses = ['open', 'assigned', 'active', 'suspended', 'under_review', 'closed_cleared', 'closed_unfounded', 'closed_exception'];
      if (!validStatuses.includes(status)) return c.json({ error: 'Invalid status', code: 'INVALID_STATUS' }, 400);

      const statusId = paramNum(c.req.param('id'));
      if (isNaN(statusId)) return c.json({ error: 'Invalid case ID', code: 'INVALID_CASE_ID' }, 400);
      const existing = await db.prepare('SELECT * FROM cases WHERE id = ?').get(statusId) as any;
      if (!existing) return c.json({ error: 'Case not found', code: 'CASE_NOT_FOUND' }, 404);

      const updates: any = { status, updated_at: now };
      if (status.startsWith('closed_')) updates.closed_date = localToday();
      if (status === 'assigned' && !existing.assigned_at) updates.assigned_at = now;

      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      await db.prepare(`UPDATE cases SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), statusId);

      return c.json({ data: { id: statusId, status } });
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'STATUS_UPDATE_ERROR' }, 500);
    }
  });

  // === DELETE /:id ===
  api.delete('/:id', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const delId = paramNum(c.req.param('id'));
      if (isNaN(delId)) return c.json({ error: 'Invalid case ID', code: 'INVALID_CASE_ID' }, 400);
      const existing = await db.prepare('SELECT * FROM cases WHERE id = ?').get(delId) as any;
      if (!existing) return c.json({ error: 'Case not found', code: 'CASE_NOT_FOUND' }, 404);

      await db.prepare('DELETE FROM case_notes WHERE case_id = ?').run(delId);
      await db.prepare('DELETE FROM case_persons WHERE case_id = ?').run(delId);
      try { await db.prepare('DELETE FROM case_calls WHERE case_id = ?').run(delId); } catch { /* table may not exist */ }
      try { await db.prepare('DELETE FROM case_incidents WHERE case_id = ?').run(delId); } catch { /* table may not exist */ }
      try { await db.prepare('DELETE FROM case_vehicles WHERE case_id = ?').run(delId); } catch { /* table may not exist */ }
      try { await db.prepare('DELETE FROM case_properties WHERE case_id = ?').run(delId); } catch { /* table may not exist */ }
      try { await db.prepare('DELETE FROM case_evidence WHERE case_id = ?').run(delId); } catch { /* table may not exist */ }
      try { await db.prepare('DELETE FROM case_warrants WHERE case_id = ?').run(delId); } catch { /* table may not exist */ }
      try { await db.prepare('DELETE FROM case_citations WHERE case_id = ?').run(delId); } catch { /* table may not exist */ }
      await db.prepare('DELETE FROM cases WHERE id = ?').run(delId);

      return c.json({ success: true, message: `Case ${existing.case_number} deleted` });
    } catch (error: any) {
      return c.json({ error: 'Failed to delete case', code: 'DELETE_CASE_ERROR' }, 500);
    }
  });

  // === POST /:id/notes ===
  api.post('/:id/notes', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const user = c.get('user');
      const notesCaseId = paramNum(c.req.param('id'));
      if (isNaN(notesCaseId)) return c.json({ error: 'Invalid case ID', code: 'INVALID_CASE_ID' }, 400);

      const body = await c.req.json();
      const { content, note_type = 'general' } = body;
      if (!content || (typeof content === 'string' && content.trim().length === 0))
        return c.json({ error: 'Content is required', code: 'MISSING_CONTENT' }, 400);
      if (typeof content === 'string' && content.length > 50000)
        return c.json({ error: 'Content must be 50000 characters or less', code: 'CONTENT_TOO_LONG' }, 400);

      const userRow = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(user.userId) as any;
      const result = await db.prepare(`
        INSERT INTO case_notes (case_id, author_id, author_name, note_type, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(notesCaseId, user.userId, userRow?.full_name || '', note_type, content, now);

      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, notesCaseId);
      return c.json({ data: { id: result.meta.last_row_id } }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to create case note', code: 'CREATE_CASE_NOTE_ERROR' }, 500);
    }
  });

  // === GET /:id/notes ===
  api.get('/:id/notes', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const notes = await db.prepare(`
        SELECT * FROM case_notes WHERE case_id = ? ORDER BY is_pinned DESC, created_at DESC LIMIT 500
      `).all(c.req.param('id'));
      c.header('Cache-Control', 'private, max-age=30');
      return c.json({ data: notes });
    } catch (error: any) {
      return c.json({ error: 'Failed to retrieve case notes', code: 'GET_NOTES_ERROR' }, 500);
    }
  });

  // === POST /:id/calculate-solvability ===
  api.post('/:id/calculate-solvability', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const solvId = paramNum(c.req.param('id'));
      if (isNaN(solvId)) return c.json({ error: 'Invalid case ID', code: 'INVALID_CASE_ID' }, 400);

      const body = await c.req.json();
      const { factors } = body;
      if (factors && typeof factors !== 'object') return c.json({ error: 'factors must be an object', code: 'INVALID_FACTORS' }, 400);

      const weights: Record<string, number> = {
        witness_available: 15, physical_evidence: 20, suspect_named: 25,
        suspect_described: 10, suspect_vehicle: 10, video_available: 10,
        traceable_property: 5, significant_modus: 5,
      };
      let score = 0;
      for (const [key, val] of Object.entries(factors || {})) {
        if (val && weights[key]) score += weights[key];
      }

      await db.prepare('UPDATE cases SET solvability_score = ?, solvability_factors = ?, updated_at = ? WHERE id = ?')
        .run(score, JSON.stringify(factors), now, solvId);

      return c.json({ data: { score, factors } });
    } catch (error: any) {
      return c.json({ error: 'Failed to calculate solvability score', code: 'SOLVABILITY_ERROR' }, 500);
    }
  });

  // === GET /:id/timeline ===
  api.get('/:id/timeline', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const caseRow = await db.prepare('SELECT * FROM cases WHERE id = ?').get(c.req.param('id')) as any;
      if (!caseRow) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);

      const events: any[] = [];
      events.push({ type: 'case_created', date: caseRow.created_at, title: 'Case Opened', description: `${caseRow.case_number} created` });
      if (caseRow.assigned_at) events.push({ type: 'assigned', date: caseRow.assigned_at, title: 'Investigator Assigned' });
      if (caseRow.approved_at) events.push({ type: 'approved', date: caseRow.approved_at, title: 'Case Approved' });
      if (caseRow.closed_date) events.push({ type: 'closed', date: caseRow.closed_date, title: `Case Closed (${caseRow.status})` });

      try {
        const notes = await db.prepare('SELECT id, note_type, content, author_name, created_at FROM case_notes WHERE case_id = ? ORDER BY created_at ASC LIMIT 100').all(c.req.param('id')) as any[];
        for (const n of notes) { events.push({ type: 'note', date: n.created_at, title: `Note (${n.note_type})`, description: n.content?.substring(0, 100), author: n.author_name }); }
      } catch { /* case_notes may not exist */ }

      events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      return c.json({ data: events });
    } catch (error: any) {
      return c.json({ error: 'Failed to get timeline', code: 'TIMELINE_ERROR' }, 500);
    }
  });

  // === GET /:id/evidence-summary ===
  api.get('/:id/evidence-summary', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const caseRow = await db.prepare('SELECT id, linked_evidence FROM cases WHERE id = ?').get(c.req.param('id')) as any;
      if (!caseRow) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);

      let evidenceIds: number[] = [];
      try { evidenceIds = JSON.parse(caseRow.linked_evidence || '[]'); } catch { evidenceIds = []; }
      let evidenceItems: any[] = [];
      if (evidenceIds.length > 0) {
        const placeholders = evidenceIds.map(() => '?').join(',');
        try {
          evidenceItems = await db.prepare(`SELECT id, evidence_number, type, description, status, location, chain_of_custody FROM evidence WHERE id IN (${placeholders})`).all(...evidenceIds) as any[];
        } catch { /* evidence table may not exist */ }
      }
      const byType: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      for (const e of evidenceItems) {
        byType[e.type || 'unknown'] = (byType[e.type || 'unknown'] || 0) + 1;
        byStatus[e.status || 'unknown'] = (byStatus[e.status || 'unknown'] || 0) + 1;
      }
      return c.json({ data: { total_evidence: evidenceItems.length, items: evidenceItems, by_type: byType, by_status: byStatus } });
    } catch (error: any) {
      return c.json({ error: 'Failed to get evidence summary', code: 'EVIDENCE_SUMMARY_ERROR' }, 500);
    }
  });

  // === GET /:id/persons ===
  api.get('/:id/persons', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const caseRow = await db.prepare('SELECT id FROM cases WHERE id = ?').get(c.req.param('id'));
      if (!caseRow) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);

      const persons = await db.prepare(`
        SELECT cp.*, p.first_name, p.last_name, p.dob, p.photo_url, p.flags, u.full_name as added_by_name
        FROM case_persons cp LEFT JOIN persons p ON cp.person_id = p.id LEFT JOIN users u ON cp.added_by = u.id
        WHERE cp.case_id = ? ORDER BY CASE cp.role WHEN 'suspect' THEN 0 WHEN 'victim' THEN 1 WHEN 'witness' THEN 2 ELSE 3 END, cp.created_at DESC
      `).all(c.req.param('id'));
      const roleCounts: Record<string, number> = {};
      for (const p of persons as any[]) { roleCounts[p.role] = (roleCounts[p.role] || 0) + 1; }
      return c.json({ data: { persons, role_counts: roleCounts } });
    } catch (error: any) {
      return c.json({ error: 'Failed to get case persons', code: 'GET_CASE_PERSONS_ERROR' }, 500);
    }
  });

  // === POST /:id/persons ===
  api.post('/:id/persons', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const caseRow = await db.prepare('SELECT id, case_number FROM cases WHERE id = ?').get(c.req.param('id')) as any;
      if (!caseRow) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { person_id, person_name, role, notes } = body;
      const validRoles = ['suspect', 'victim', 'witness', 'involved', 'person_of_interest', 'informant'];
      if (!validRoles.includes(role || '')) return c.json({ error: `role must be one of: ${validRoles.join(', ')}`, code: 'INVALID_ROLE' }, 400);
      if (!person_name?.trim() && !person_id) return c.json({ error: 'person_name or person_id required', code: 'MISSING_PERSON_INFO' }, 400);

      let name = person_name || '';
      if (person_id && !name) { const p = await db.prepare('SELECT first_name, last_name FROM persons WHERE id = ?').get(person_id) as any; if (p) name = `${p.first_name} ${p.last_name}`; }
      const now = localNow();
      const result = await db.prepare('INSERT INTO case_persons (case_id, person_id, person_name, role, notes, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(c.req.param('id'), person_id || null, name, role, notes || null, user.userId, now);
      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, c.req.param('id'));

      return c.json({ data: { id: result.meta.last_row_id } }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to add person to case', code: 'ADD_CASE_PERSON_ERROR' }, 500);
    }
  });

  // === PUT /:id/persons/:personEntryId ===
  api.put('/:id/persons/:personEntryId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const entry = await db.prepare('SELECT * FROM case_persons WHERE id = ? AND case_id = ?').get(c.req.param('personEntryId'), c.req.param('id')) as any;
      if (!entry) return c.json({ error: 'Person entry not found', code: 'PERSON_ENTRY_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { role, notes } = body;
      const now = localNow();
      const updates: string[] = [];
      const params: any[] = [];
      if (role !== undefined) { updates.push('role = ?'); params.push(role); }
      if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
      if (updates.length > 0) { params.push(c.req.param('personEntryId')); await db.prepare(`UPDATE case_persons SET ${updates.join(', ')} WHERE id = ?`).run(...params); }
      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, c.req.param('id'));
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to update person entry', code: 'UPDATE_CASE_PERSON_ERROR' }, 500);
    }
  });

  // === DELETE /:id/persons/:personEntryId ===
  api.delete('/:id/persons/:personEntryId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const entry = await db.prepare('SELECT * FROM case_persons WHERE id = ? AND case_id = ?').get(c.req.param('personEntryId'), c.req.param('id')) as any;
      if (!entry) return c.json({ error: 'Person entry not found', code: 'PERSON_ENTRY_NOT_FOUND' }, 404);
      await db.prepare('DELETE FROM case_persons WHERE id = ?').run(c.req.param('personEntryId'));
      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(localNow(), c.req.param('id'));
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to remove person', code: 'DELETE_CASE_PERSON_ERROR' }, 500);
    }
  });

  // === GET /export/csv ===
  api.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { status, case_type, date_from, date_to } = q;
      let where = 'WHERE c.archived_at IS NULL';
      const params: any[] = [];
      if (status) { where += ' AND c.status = ?'; params.push(status); }
      if (case_type) { where += ' AND c.case_type = ?'; params.push(case_type); }
      if (date_from) { where += ' AND c.created_at >= ?'; params.push(date_from); }
      if (date_to) { where += ' AND c.created_at <= ?'; params.push(date_to); }
      const rows = await db.prepare(`SELECT c.case_number, c.title, c.case_type, c.status, c.priority, c.solvability_score, u.full_name as investigator, c.opened_date, c.closed_date, c.disposition, c.created_at FROM cases c LEFT JOIN users u ON c.lead_investigator_id = u.id ${where} ORDER BY c.created_at DESC LIMIT 10000`).all(...params) as any[];

      const headers = ['Case #', 'Title', 'Type', 'Status', 'Priority', 'Solvability', 'Investigator', 'Opened', 'Closed', 'Disposition', 'Created'];
      const csvRows = rows.map((r: any) => [r.case_number, (r.title || '').replace(/"/g, '""'), r.case_type, r.status, r.priority, r.solvability_score, r.investigator, r.opened_date, r.closed_date, (r.disposition || '').replace(/"/g, '""'), r.created_at]);
      const csv = [headers.join(','), ...csvRows.map((r: any[]) => r.map(v => `"${v || ''}"`).join(','))].join('\n');

      c.header('Content-Type', 'text/csv');
      c.header('Content-Disposition', `attachment; filename="cases_export_${new Date().toISOString().slice(0, 10)}.csv"`);
      return c.body(csv);
    } catch (error: any) {
      return c.json({ error: 'Failed to export cases', code: 'EXPORT_CASES_ERROR' }, 500);
    }
  });

  // === GET /:id/completeness ===
  api.get('/:id/completeness', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const caseRow = await db.prepare('SELECT * FROM cases WHERE id = ?').get(c.req.param('id')) as any;
      if (!caseRow) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);
      const requiredFields = ['title', 'case_type', 'status', 'priority'];
      const recommendedFields = ['summary', 'narrative', 'lead_investigator_id', 'solvability_score', 'disposition', 'linked_evidence', 'linked_persons'];
      const filledRequired = requiredFields.filter(f => caseRow[f] != null && String(caseRow[f]).trim() !== '').length;
      const filledRecommended = recommendedFields.filter(f => caseRow[f] != null && String(caseRow[f]).trim() !== '' && caseRow[f] !== '[]').length;
      const score = Math.round(((filledRequired / requiredFields.length) * 50 + (filledRecommended / recommendedFields.length) * 50));
      return c.json({ data: { case_id: caseRow.id, score, grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D', missing_required: requiredFields.filter(f => !caseRow[f] || String(caseRow[f]).trim() === ''), missing_recommended: recommendedFields.filter(f => !caseRow[f] || String(caseRow[f]).trim() === '' || caseRow[f] === '[]') } });
    } catch (error: any) {
      return c.json({ error: 'Failed to get completeness', code: 'CASE_COMPLETENESS_ERROR' }, 500);
    }
  });

  // === POST /:id/archive ===
  api.post('/:id/archive', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const caseRow = await db.prepare('SELECT * FROM cases WHERE id = ?').get(c.req.param('id')) as any;
      if (!caseRow) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);
      if (caseRow.archived_at) return c.json({ error: 'Case already archived', code: 'ALREADY_ARCHIVED' }, 400);
      await db.prepare('UPDATE cases SET archived_at = ?, updated_at = ? WHERE id = ?').run(now, now, c.req.param('id'));
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to archive case', code: 'ARCHIVE_CASE_ERROR' }, 500);
    }
  });

  // === GET /:id/full — Aggregate endpoint ===
  api.get('/:id/full', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const caseId = c.req.param('id');
      const caseRow = await db.prepare(`
        SELECT c.*, u.full_name as lead_investigator_name
        FROM cases c LEFT JOIN users u ON c.lead_investigator_id = u.id
        WHERE c.id = ?
      `).get(caseId) as any;
      if (!caseRow) return c.json({ error: 'Case not found' }, 404);

      const calls = await db.prepare(`SELECT cc.id as link_id, cfs.* FROM case_calls cc JOIN calls_for_service cfs ON cc.call_id = cfs.id WHERE cc.case_id = ? ORDER BY cfs.created_at DESC`).all(caseId);
      const incidents = await db.prepare(`SELECT ci.id as link_id, i.* FROM case_incidents ci JOIN incidents i ON ci.incident_id = i.id WHERE ci.case_id = ? ORDER BY i.created_at DESC`).all(caseId);
      const persons = await db.prepare(`SELECT cp.*, p.first_name, p.last_name, p.dob, p.phone, p.address FROM case_persons cp LEFT JOIN persons p ON cp.person_id = p.id WHERE cp.case_id = ? ORDER BY cp.created_at DESC`).all(caseId);
      const vehicles = await db.prepare(`SELECT cv.id as link_id, cv.role, v.* FROM case_vehicles cv JOIN vehicles_records v ON cv.vehicle_id = v.id WHERE cv.case_id = ? ORDER BY cv.created_at DESC`).all(caseId);
      const properties = await db.prepare(`SELECT cpr.id as link_id, cpr.role, p.* FROM case_properties cpr JOIN properties p ON cpr.property_id = p.id WHERE cpr.case_id = ? ORDER BY cpr.created_at DESC`).all(caseId);
      const evidence = await db.prepare(`SELECT ce.id as link_id, e.* FROM case_evidence ce JOIN evidence e ON ce.evidence_id = e.id WHERE ce.case_id = ? ORDER BY e.created_at DESC`).all(caseId);
      const warrants = await db.prepare(`SELECT cw.id as link_id, w.*, sp.first_name || ' ' || sp.last_name as subject_name FROM case_warrants cw JOIN warrants w ON cw.warrant_id = w.id LEFT JOIN persons sp ON w.subject_person_id = sp.id WHERE cw.case_id = ? ORDER BY w.created_at DESC`).all(caseId);
      const citations = await db.prepare(`SELECT cc2.id as link_id, ct.* FROM case_citations cc2 JOIN citations ct ON cc2.citation_id = ct.id WHERE cc2.case_id = ? ORDER BY ct.created_at DESC`).all(caseId);
      const notes = await db.prepare(`SELECT cn.*, u.full_name as author_name FROM case_notes cn LEFT JOIN users u ON cn.author_id = u.id WHERE cn.case_id = ? ORDER BY cn.created_at DESC`).all(caseId);

      return c.json({
        ...caseRow,
        calls, incidents, persons, vehicles, properties,
        evidence, warrants, citations, notes,
        counts: {
          calls: calls.length, incidents: incidents.length,
          persons: persons.length, vehicles: vehicles.length,
          properties: properties.length, evidence: evidence.length,
          warrants: warrants.length, citations: citations.length,
          notes: notes.length,
        },
      });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // === Junction table routes: Calls ===
  api.get('/:id/calls', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT cc.id as link_id, cc.created_at as linked_at,
          c.id, c.call_number, c.incident_type, c.status, c.priority,
          c.location_address, c.created_at, c.disposition,
          u.full_name as added_by_name
        FROM case_calls cc JOIN calls_for_service c ON cc.call_id = c.id LEFT JOIN users u ON cc.added_by = u.id
        WHERE cc.case_id = ? ORDER BY c.created_at DESC
      `).all(c.req.param('id'));
      return c.json(rows);
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  api.post('/:id/calls', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const body = await c.req.json();
      const { call_id } = body;
      if (!call_id) return c.json({ error: 'call_id required' }, 400);
      const now = localNow();
      await db.prepare('INSERT OR IGNORE INTO case_calls (case_id, call_id, added_by, created_at) VALUES (?, ?, ?, ?)').run(c.req.param('id'), call_id, user.userId, now);
      const caseRow = await db.prepare('SELECT case_number FROM cases WHERE id = ?').get(c.req.param('id')) as any;
      if (caseRow) {
        await db.prepare('UPDATE calls_for_service SET case_id = ?, case_number = ?, updated_at = ? WHERE id = ?').run(c.req.param('id'), caseRow.case_number, now, call_id);
      }
      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, c.req.param('id'));
      return c.json({ success: true });
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  api.delete('/:id/calls/:linkId', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      await db.prepare('DELETE FROM case_calls WHERE id = ? AND case_id = ?').run(c.req.param('linkId'), c.req.param('id'));
      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(localNow(), c.req.param('id'));
      return c.json({ success: true });
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  // === Junction table routes: Incidents ===
  api.get('/:id/incidents', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT ci.id as link_id, ci.created_at as linked_at,
          i.id, i.incident_number, i.incident_type, i.status, i.priority,
          i.location_address, i.narrative, i.created_at,
          u.full_name as added_by_name
        FROM case_incidents ci JOIN incidents i ON ci.incident_id = i.id LEFT JOIN users u ON ci.added_by = u.id
        WHERE ci.case_id = ? ORDER BY i.created_at DESC
      `).all(c.req.param('id'));
      return c.json(rows);
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  api.post('/:id/incidents', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const body = await c.req.json();
      const { incident_id } = body;
      if (!incident_id) return c.json({ error: 'incident_id required' }, 400);
      const now = localNow();
      await db.prepare('INSERT OR IGNORE INTO case_incidents (case_id, incident_id, added_by, created_at) VALUES (?, ?, ?, ?)').run(c.req.param('id'), incident_id, user.userId, now);
      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, c.req.param('id'));
      return c.json({ success: true });
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  api.delete('/:id/incidents/:linkId', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      await db.prepare('DELETE FROM case_incidents WHERE id = ? AND case_id = ?').run(c.req.param('linkId'), c.req.param('id'));
      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(localNow(), c.req.param('id'));
      return c.json({ success: true });
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  // === Junction table routes: Vehicles ===
  api.get('/:id/vehicles', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT cv.id as link_id, cv.role, cv.notes, cv.created_at as linked_at,
          v.id, v.plate_number, v.state, v.vin, v.year, v.make, v.model, v.color, v.owner_person_id,
          u.full_name as added_by_name
        FROM case_vehicles cv JOIN vehicles_records v ON cv.vehicle_id = v.id LEFT JOIN users u ON cv.added_by = u.id
        WHERE cv.case_id = ? ORDER BY cv.created_at DESC
      `).all(c.req.param('id'));
      return c.json(rows);
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  api.post('/:id/vehicles', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const body = await c.req.json();
      const { vehicle_id, role, notes } = body;
      if (!vehicle_id) return c.json({ error: 'vehicle_id required' }, 400);
      const now = localNow();
      await db.prepare('INSERT OR IGNORE INTO case_vehicles (case_id, vehicle_id, role, notes, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(c.req.param('id'), vehicle_id, role || 'involved', notes || null, user.userId, now);
      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, c.req.param('id'));
      return c.json({ success: true });
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  api.delete('/:id/vehicles/:linkId', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      await db.prepare('DELETE FROM case_vehicles WHERE id = ? AND case_id = ?').run(c.req.param('linkId'), c.req.param('id'));
      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(localNow(), c.req.param('id'));
      return c.json({ success: true });
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  // === Junction table routes: Properties ===
  api.get('/:id/properties', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT cpr.id as link_id, cpr.role, cpr.created_at as linked_at,
          p.id, p.name, p.address, p.city, p.state, p.zip, p.client_id,
          u.full_name as added_by_name
        FROM case_properties cpr JOIN properties p ON cpr.property_id = p.id LEFT JOIN users u ON cpr.added_by = u.id
        WHERE cpr.case_id = ? ORDER BY cpr.created_at DESC
      `).all(c.req.param('id'));
      return c.json(rows);
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  api.post('/:id/properties', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const body = await c.req.json();
      const { property_id, role } = body;
      if (!property_id) return c.json({ error: 'property_id required' }, 400);
      const now = localNow();
      await db.prepare('INSERT OR IGNORE INTO case_properties (case_id, property_id, role, added_by, created_at) VALUES (?, ?, ?, ?, ?)').run(c.req.param('id'), property_id, role || 'scene', user.userId, now);
      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, c.req.param('id'));
      return c.json({ success: true });
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  api.delete('/:id/properties/:linkId', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      await db.prepare('DELETE FROM case_properties WHERE id = ? AND case_id = ?').run(c.req.param('linkId'), c.req.param('id'));
      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(localNow(), c.req.param('id'));
      return c.json({ success: true });
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  // === Junction table routes: Evidence ===
  api.get('/:id/evidence', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT ce.id as link_id, ce.created_at as linked_at,
          e.id, e.evidence_number, e.description, e.evidence_type, e.status,
          e.collected_by, e.location_found,
          u.full_name as added_by_name
        FROM case_evidence ce JOIN evidence e ON ce.evidence_id = e.id LEFT JOIN users u ON ce.added_by = u.id
        WHERE ce.case_id = ? ORDER BY e.created_at DESC
      `).all(c.req.param('id'));
      return c.json(rows);
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  api.post('/:id/evidence', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const body = await c.req.json();
      const { evidence_id } = body;
      if (!evidence_id) return c.json({ error: 'evidence_id required' }, 400);
      const now = localNow();
      await db.prepare('INSERT OR IGNORE INTO case_evidence (case_id, evidence_id, added_by, created_at) VALUES (?, ?, ?, ?)').run(c.req.param('id'), evidence_id, user.userId, now);
      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, c.req.param('id'));
      return c.json({ success: true });
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  api.delete('/:id/evidence/:linkId', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      await db.prepare('DELETE FROM case_evidence WHERE id = ? AND case_id = ?').run(c.req.param('linkId'), c.req.param('id'));
      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(localNow(), c.req.param('id'));
      return c.json({ success: true });
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  // === Junction table routes: Warrants ===
  api.get('/:id/warrants', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT cw.id as link_id, cw.created_at as linked_at,
          w.id, w.warrant_number, w.type, w.status,
          w.charge_description, w.offense_level,
          sp.first_name || ' ' || sp.last_name as subject_name,
          u.full_name as added_by_name
        FROM case_warrants cw JOIN warrants w ON cw.warrant_id = w.id
        LEFT JOIN persons sp ON w.subject_person_id = sp.id
        LEFT JOIN users u ON cw.added_by = u.id
        WHERE cw.case_id = ? ORDER BY w.created_at DESC
      `).all(c.req.param('id'));
      return c.json(rows);
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  api.post('/:id/warrants', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const body = await c.req.json();
      const { warrant_id } = body;
      if (!warrant_id) return c.json({ error: 'warrant_id required' }, 400);
      const now = localNow();
      await db.prepare('INSERT OR IGNORE INTO case_warrants (case_id, warrant_id, added_by, created_at) VALUES (?, ?, ?, ?)').run(c.req.param('id'), warrant_id, user.userId, now);
      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, c.req.param('id'));
      return c.json({ success: true });
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  api.delete('/:id/warrants/:linkId', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      await db.prepare('DELETE FROM case_warrants WHERE id = ? AND case_id = ?').run(c.req.param('linkId'), c.req.param('id'));
      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(localNow(), c.req.param('id'));
      return c.json({ success: true });
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  // === Junction table routes: Citations ===
  api.get('/:id/citations', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT cc2.id as link_id, cc2.created_at as linked_at,
          ct.id, ct.citation_number, ct.type, ct.status, ct.person_name,
          ct.violation_description, ct.violation_date,
          u.full_name as added_by_name
        FROM case_citations cc2 JOIN citations ct ON cc2.citation_id = ct.id LEFT JOIN users u ON cc2.added_by = u.id
        WHERE cc2.case_id = ? ORDER BY ct.created_at DESC
      `).all(c.req.param('id'));
      return c.json(rows);
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  api.post('/:id/citations', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const body = await c.req.json();
      const { citation_id } = body;
      if (!citation_id) return c.json({ error: 'citation_id required' }, 400);
      const now = localNow();
      await db.prepare('INSERT OR IGNORE INTO case_citations (case_id, citation_id, added_by, created_at) VALUES (?, ?, ?, ?)').run(c.req.param('id'), citation_id, user.userId, now);
      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, c.req.param('id'));
      return c.json({ success: true });
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  api.delete('/:id/citations/:linkId', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      await db.prepare('DELETE FROM case_citations WHERE id = ? AND case_id = ?').run(c.req.param('linkId'), c.req.param('id'));
      await db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(localNow(), c.req.param('id'));
      return c.json({ success: true });
    } catch (e: any) { return c.json({ error: e.message }, 500); }
  });

  app.route('/api/cases', api);
}
