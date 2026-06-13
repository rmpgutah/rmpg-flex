// ============================================================
// RMPG Flex — Cases (Cloudflare Worker)
// ============================================================
// Investigative case management. Phase 1 RMS.
//
// Migration: 0028_cases.sql (cases + case_notes + case_person_links).
//
// Scope:
//   Core CRUD + workflow + notes + solvability (calc + live read) +
//   export, plus the full entity-junction set the detail view links:
//   persons (case_person_links) and calls/incidents/vehicles/properties/
//   evidence/warrants/citations (case_<type> tables via the generic loop
//   below). GET /:id/full aggregates every junction for the detail tabs.
//
// Junction reads/writes share a table: link-POST and GET /:id/full both
// hit the same case_<type> table so an attached record shows immediately.
//
// Both legacy JSON columns AND junction tables stay populated for
// backward-compat: writes to /:id mirror the cases.linked_persons
// JSON column to case_person_links and vice versa.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const cases = new Hono<Env>();

// ── 2-letter case_type codes (mirrors legacy caseNumbers.ts) ──
const CASE_TYPE_CODES: Record<string, string> = {
  general: 'GN', criminal: 'CR', traffic: 'TR', medical: 'MD',
  security: 'SE', disorder: 'DS', service: 'SV', fire: 'FR',
  admin: 'AD', civil: 'CV', use_of_force: 'UF', property: 'PR',
  missing_person: 'MP', narcotics: 'NR', fraud: 'FD', juvenile: 'JV',
  domestic: 'DM', accident: 'AC', death: 'DT', theft: 'TH',
  assault: 'AS', burglary: 'BG', other: 'OT',
};
function getCaseTypeCode(t: string): string { return CASE_TYPE_CODES[t] || 'GN'; }

// ── Helpers ─────────────────────────────────────────────────

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '""';
  const s = typeof v === 'string' ? v : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/** Case number format: YY-######-XX (e.g. 26-000042-CR).
 *  Sequence is GLOBAL per year, not per type — type code is just
 *  a visual disambiguator. The regex match preserves the legacy
 *  shape exactly so existing case numbers don't conflict.
 */
async function generateCaseNumber(db: ReturnType<typeof getDb>, caseType: string): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const typeCode = getCaseTypeCode(caseType);
  const prefix = `${yy}-`;
  const last = await queryFirst<{ case_number: string }>(
    db,
    `SELECT case_number FROM cases WHERE case_number LIKE ? ORDER BY id DESC LIMIT 1`,
    `${prefix}%`,
  );
  let nextNum = 1;
  if (last?.case_number) {
    const m = last.case_number.match(/\d{2}-(\d{6})-[A-Z]{2}/);
    if (m) nextNum = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(nextNum).padStart(6, '0')}-${typeCode}`;
}

/** Auto-priority from case_type. Override allowed via request body. */
const HIGH_SEVERITY = new Set(['homicide', 'sexual_assault', 'use_of_force', 'death', 'assault', 'kidnapping']);
const ELEVATED = new Set(['burglary', 'robbery', 'narcotics', 'arson', 'domestic', 'missing_person']);
const LOW = new Set(['admin', 'civil', 'property', 'other']);
function autoPriority(caseType: string): string {
  if (HIGH_SEVERITY.has(caseType)) return 'critical';
  if (ELEVATED.has(caseType)) return 'high';
  if (LOW.has(caseType)) return 'low';
  return 'normal';
}

// ── GET /stats — must come before GET /:id ─────────────────
cases.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const total = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM cases'))?.count ?? 0;
    const open = (await queryFirst<{ count: number }>(
      db, `SELECT COUNT(*) as count FROM cases WHERE status NOT LIKE 'closed%' AND archived_at IS NULL`,
    ))?.count ?? 0;
    const byStatus = await query<Record<string, unknown>>(
      db, `SELECT status, COUNT(*) as count FROM cases WHERE archived_at IS NULL GROUP BY status ORDER BY count DESC`,
    );
    const byPriority = await query<Record<string, unknown>>(
      db, `SELECT priority, COUNT(*) as count FROM cases WHERE archived_at IS NULL GROUP BY priority ORDER BY count DESC`,
    );
    const last7 = (await queryFirst<{ count: number }>(
      db, `SELECT COUNT(*) as count FROM cases WHERE opened_date >= date('now', '-7 days')`,
    ))?.count ?? 0;
    const last30 = (await queryFirst<{ count: number }>(
      db, `SELECT COUNT(*) as count FROM cases WHERE opened_date >= date('now', '-30 days')`,
    ))?.count ?? 0;
    // CaseManagementPage reads res.data.by_status.{open,active,...} (an object
    // map) and res.data.avg_solvability. Provide the map + a {data} wrapper
    // while keeping the arrays + top-level keys for any other consumer.
    const byStatusMap: Record<string, number> = {};
    for (const r of byStatus) byStatusMap[String((r as any).status)] = Number((r as any).count) || 0;
    const byPriorityMap: Record<string, number> = {};
    for (const r of byPriority) byPriorityMap[String((r as any).priority)] = Number((r as any).count) || 0;
    const payload = {
      total, open,
      by_status: byStatusMap, by_priority: byPriorityMap,
      byStatus, byPriority, last7, last30,
      avg_solvability: null as number | null, // no solvability score column yet
    };
    return c.json({ data: payload, ...payload });
  } catch (err) {
    return c.json({ error: 'Failed to get case stats', code: 'STATS_ERROR' }, 500);
  }
});

// ── GET / — paginated list with filters ─────────────────────
cases.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];

    // All conditions are c.-qualified: the list query LEFT JOINs users,
    // which shares column names with cases (status, archived_at, …) —
    // unqualified refs threw "ambiguous column name" and 500'd the list.
    if (q('status')) { conditions.push('c.status = ?'); params.push(q('status')); }
    if (q('priority')) { conditions.push('c.priority = ?'); params.push(q('priority')); }
    if (q('case_type')) { conditions.push('c.case_type = ?'); params.push(q('case_type')); }
    if (q('lead_investigator_id')) { conditions.push('c.lead_investigator_id = ?'); params.push(q('lead_investigator_id')); }
    if (q('archived') === 'true') conditions.push('c.archived_at IS NOT NULL');
    else conditions.push('c.archived_at IS NULL');
    const search = q('search');
    if (search) {
      conditions.push('(c.case_number LIKE ? OR c.title LIKE ? OR c.summary LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const pageNum = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(10000, Math.max(1, parseInt(q('per_page') || '100', 10) || 100));
    const offset = (pageNum - 1) * perPage;

    const countRow = await queryFirst<{ total: number }>(
      db, `SELECT COUNT(*) as total FROM cases c ${where}`, ...params,
    );
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT c.*, u.full_name as lead_investigator_name
       FROM cases c
       LEFT JOIN users u ON c.lead_investigator_id = u.id
       ${where}
       ORDER BY c.opened_date DESC, c.id DESC
       LIMIT ? OFFSET ?`,
      ...params, perPage, offset,
    );
    const total = countRow?.total ?? 0;
    return c.json({
      data: rows,
      pagination: { page: pageNum, per_page: perPage, total, totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0 },
    });
  } catch (err) {
    return c.json({ error: 'Failed to list cases', code: 'LIST_ERROR' }, 500);
  }
});

// ── POST / — create case ────────────────────────────────────
cases.post('/', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const b = await c.req.json<{
      title?: string; case_type?: string; priority?: string;
      summary?: string; lead_investigator_id?: number;
      linked_call_id?: number; linked_persons?: number[];
      linked_incidents?: number[]; linked_evidence?: number[];
    }>();

    if (typeof b.title !== 'string' || !b.title.trim()) {
      return c.json({ error: 'Title is required', code: 'MISSING_TITLE' }, 400);
    }
    if (b.title.length > 500) return c.json({ error: 'Title must be ≤ 500 chars', code: 'TITLE_TOO_LONG' }, 400);

    const caseType = b.case_type ?? 'general';
    const priority = b.priority ?? autoPriority(caseType);
    const caseNumber = await generateCaseNumber(db, caseType);

    // Normalize link arrays
    const personsArr = Array.isArray(b.linked_persons) ? b.linked_persons.map(Number).filter(Number.isFinite) : [];
    const incidentsArr = Array.isArray(b.linked_incidents) ? b.linked_incidents.map(Number).filter(Number.isFinite) : [];
    const evidenceArr = Array.isArray(b.linked_evidence) ? b.linked_evidence.map(Number).filter(Number.isFinite) : [];

    const result = await execute(
      db,
      `INSERT INTO cases (
         case_number, title, case_type, status, priority, lead_investigator_id,
         summary, linked_calls, linked_persons, linked_incidents, linked_evidence,
         created_by, opened_date
       ) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, date('now'))`,
      caseNumber, b.title.trim(), caseType, priority, b.lead_investigator_id ?? null,
      b.summary?.trim() ?? null,
      b.linked_call_id ? JSON.stringify([b.linked_call_id]) : '[]',
      JSON.stringify(personsArr),
      JSON.stringify(incidentsArr),
      JSON.stringify(evidenceArr),
      userId,
    );
    const newId = Number(result.meta.last_row_id);

    // Backfill the calls_for_service row's case_id if a call was attached
    if (b.linked_call_id) {
      try {
        await execute(
          db,
          'UPDATE calls_for_service SET case_id = ?, case_number = ? WHERE id = ?',
          newId, caseNumber, b.linked_call_id,
        );
      } catch { /* calls_for_service may not have case_id/case_number cols on every D1 — non-fatal */ }
    }

    // Mirror-write persons to junction table. Other junctions deferred.
    for (const pid of personsArr) {
      try {
        await execute(
          db, 'INSERT OR IGNORE INTO case_person_links (case_id, person_id) VALUES (?, ?)', newId, pid,
        );
      } catch { /* table may not exist yet — non-fatal */ }
    }

    return c.json({ data: { id: newId, case_number: caseNumber } }, 201);
  } catch (err) {
    return c.json({
      error: 'Failed to create case', code: 'CREATE_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ── GET /:id ────────────────────────────────────────────────
cases.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const row = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT c.*, u.full_name as lead_investigator_name, cu.full_name as created_by_name
       FROM cases c
       LEFT JOIN users u ON c.lead_investigator_id = u.id
       LEFT JOIN users cu ON c.created_by = cu.id
       WHERE c.id = ?`,
      id,
    );
    if (!row) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);
    return c.json({ data: row });
  } catch (err) {
    return c.json({ error: 'Failed to get case', code: 'GET_ERROR' }, 500);
  }
});

// ── PUT /:id — partial update ───────────────────────────────
const UPDATABLE = new Set([
  'title', 'case_type', 'priority', 'summary', 'narrative', 'disposition',
  'disposition_date', 'due_date', 'deadline', 'sla_hours',
  'lead_investigator_id', 'assigned_officers',
  'solvability_score', 'solvability_factors',
  'linked_incidents', 'linked_citations', 'linked_evidence', 'linked_persons',
  'linked_field_interviews', 'linked_calls',
  'court_case_number', 'court_id', 'plaintiff_person_id', 'defendant_person_id',
  'attorney_person_id', 'signed_filed_date', 'response_deadline_days',
  'amount_demanded', 'cause_of_action',
]);

cases.put('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const user = c.get('user');

    const existing = await queryFirst<{ id: number; status: string | null }>(
      db, 'SELECT id, status FROM cases WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);

    const b = await c.req.json<Record<string, unknown>>();
    const sets: string[] = [];
    const vals: unknown[] = [];

    for (const [k, v] of Object.entries(b)) {
      if (!UPDATABLE.has(k)) continue;
      sets.push(`${k} = ?`);
      // Arrays/objects serialize to JSON to match the *_TEXT columns
      vals.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : (v ?? null));
    }

    // God Mode — admin can change case_number even after close
    if (user?.role === 'admin' && typeof b.case_number === 'string') {
      sets.push('case_number = ?');
      vals.push(b.case_number);
    }

    if (sets.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS' }, 400);
    sets.push(`updated_at = datetime('now')`);
    vals.push(id);

    await execute(db, `UPDATE cases SET ${sets.join(', ')} WHERE id = ?`, ...vals);

    // Mirror-write persons junction when linked_persons array provided
    if (Array.isArray(b.linked_persons)) {
      const personsArr = (b.linked_persons as unknown[]).map(Number).filter(Number.isFinite);
      try {
        await execute(db, 'DELETE FROM case_person_links WHERE case_id = ?', id);
        for (const pid of personsArr) {
          await execute(
            db, 'INSERT OR IGNORE INTO case_person_links (case_id, person_id) VALUES (?, ?)', id, pid,
          );
        }
      } catch { /* table may not exist — non-fatal */ }
    }

    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM cases WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    return c.json({ error: 'Failed to update case', code: 'UPDATE_ERROR' }, 500);
  }
});

// ── Workflow: submit-review / approve / status / archive ────

cases.put('/:id/submit-review', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const existing = await queryFirst<{ id: number; status: string }>(db, 'SELECT id, status FROM cases WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);
    if (existing.status !== 'open') {
      return c.json({ error: `Cannot submit case in status: ${existing.status}`, code: 'INVALID_STATUS_TRANSITION' }, 400);
    }
    await execute(db, `UPDATE cases SET status = 'under_review', updated_at = datetime('now') WHERE id = ?`, id);
    return c.json({ data: { id, status: 'under_review' } });
  } catch (err) {
    return c.json({ error: 'Failed to submit case for review', code: 'SUBMIT_REVIEW_ERROR' }, 500);
  }
});

cases.put('/:id/approve', async (c) => {
  // Approval is a supervisory action — restrict to supervisor+
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const existing = await queryFirst<{ id: number; status: string }>(db, 'SELECT id, status FROM cases WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);
    if (existing.status !== 'under_review') {
      return c.json({ error: `Cannot approve case in status: ${existing.status}`, code: 'INVALID_STATUS_TRANSITION' }, 400);
    }
    await execute(db, `UPDATE cases SET status = 'approved', updated_at = datetime('now') WHERE id = ?`, id);
    return c.json({ data: { id, status: 'approved' } });
  } catch (err) {
    return c.json({ error: 'Failed to approve case', code: 'APPROVE_ERROR' }, 500);
  }
});

cases.put('/:id/status', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const { status, disposition } = await c.req.json<{ status?: string; disposition?: string }>();
    if (typeof status !== 'string') return c.json({ error: 'status required', code: 'STATUS_REQUIRED' }, 400);

    const sets = ['status = ?', `updated_at = datetime('now')`];
    const vals: unknown[] = [status];
    if (typeof disposition === 'string') {
      sets.push('disposition = ?', `disposition_date = date('now')`);
      vals.push(disposition);
    }
    if (status.startsWith('closed')) {
      sets.push(`closed_date = datetime('now')`);
    }
    vals.push(id);

    const result = await execute(db, `UPDATE cases SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    if (result.meta.changes === 0) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);
    return c.json({ data: { id, status, disposition } });
  } catch (err) {
    return c.json({ error: 'Failed to update case status', code: 'STATUS_UPDATE_ERROR' }, 500);
  }
});

cases.post('/:id/archive', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const result = await execute(
      db, `UPDATE cases SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, id,
    );
    if (result.meta.changes === 0) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);
    return c.json({ data: { id, archived: true } });
  } catch (err) {
    return c.json({ error: 'Failed to archive case', code: 'ARCHIVE_ERROR' }, 500);
  }
});

cases.delete('/:id', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM cases WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);
    // CASCADE deletes case_notes + case_person_links via FK
    await execute(db, 'DELETE FROM case_notes WHERE case_id = ?', id);
    await execute(db, 'DELETE FROM case_person_links WHERE case_id = ?', id);
    await execute(db, 'DELETE FROM cases WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to delete case', code: 'DELETE_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// NOTES — case_notes child table
// ═══════════════════════════════════════════════════════════════

cases.get('/:id/notes', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    // Order: pinned first, then newest first
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT n.*, u.full_name as author_full_name, u.badge_number as author_badge
       FROM case_notes n
       LEFT JOIN users u ON n.author_id = u.id
       WHERE n.case_id = ?
       ORDER BY n.is_pinned DESC, n.created_at DESC, n.id DESC`,
      id,
    );
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to get case notes', code: 'NOTES_GET_ERROR' }, 500);
  }
});

cases.post('/:id/notes', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const userId = c.get('userId') as number;

    const { content, note_type, is_pinned } = await c.req.json<{
      content?: string; note_type?: string; is_pinned?: boolean;
    }>();
    if (typeof content !== 'string' || !content.trim()) {
      return c.json({ error: 'content required', code: 'CONTENT_REQUIRED' }, 400);
    }

    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM cases WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);

    const author = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', userId);
    const result = await execute(
      db,
      `INSERT INTO case_notes (case_id, author_id, author_name, note_type, content, is_pinned)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id, userId, author?.full_name ?? '', note_type ?? 'general', content.trim(), is_pinned ? 1 : 0,
    );
    const note = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM case_notes WHERE id = ?', Number(result.meta.last_row_id),
    );
    return c.json({ data: note }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to add note', code: 'NOTE_POST_ERROR' }, 500);
  }
});

// ── Solvability scoring ─────────────────────────────────────
// Manual-calculator factor weights. These keys + weights MUST stay in
// lock-step with the client's SOLVABILITY_FACTORS array
// (client/src/pages/CaseManagementPage.tsx) — the UI sends these exact
// keys and renders a live preview using the same weights, so any drift
// makes the stored score disagree with what the investigator saw.
// Weights sum to 100 at full marks. Tune deliberately on both sides.
const SOLVABILITY_FACTORS: Record<string, number> = {
  witness_available: 15,
  physical_evidence: 20,
  suspect_named: 25,
  suspect_described: 10,
  suspect_vehicle: 10,
  video_available: 10,
  traceable_property: 5,
  significant_modus: 5,
};

// ── POST /:id/calculate-solvability ─────────────────────────
// Persists a manual solvability assessment. The flat factor map is stored
// verbatim on cases.solvability_factors so the client can re-hydrate its
// checkboxes; the rolled-up score lands on cases.solvability_score.
cases.post('/:id/calculate-solvability', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM cases WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);

    // The client posts { factors: { witness_available: true, ... } }; older
    // callers posted the flat map directly — accept either shape.
    const body = await c.req.json<Record<string, any>>().catch(() => ({} as Record<string, any>));
    const factors: Record<string, boolean> =
      body && typeof body.factors === 'object' && body.factors ? body.factors : body;

    let score = 0;
    const breakdown: Record<string, number> = {};
    for (const [key, weight] of Object.entries(SOLVABILITY_FACTORS)) {
      if (factors[key]) {
        score += weight;
        breakdown[key] = weight;
      }
    }
    score = Math.max(0, Math.min(100, score));

    await execute(
      db,
      `UPDATE cases SET solvability_score = ?, solvability_factors = ?, updated_at = datetime('now') WHERE id = ?`,
      // Store the FLAT factor map — the detail view reads it straight back
      // into its checkbox state (CaseManagementPage line ~477).
      score, JSON.stringify(factors), id,
    );
    return c.json({ data: { id, score, breakdown } });
  } catch (err) {
    return c.json({ error: 'Failed to calculate solvability', code: 'SOLVABILITY_ERROR' }, 500);
  }
});

// ── GET /:id/solvability — live read-only analysis ──────────
// Powers the "Server Analysis" card. Independent of the manual calculator:
// it tallies the case's actual linked records and blends in any stored
// (investigator-calculated) score, never dropping below the live floor so
// freshly-attached evidence is always reflected.
cases.get('/:id/solvability', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const caseRow = await queryFirst<{ id: number; solvability_score: number | null; solvability_factors: string | null }>(
      db, 'SELECT id, solvability_score, solvability_factors FROM cases WHERE id = ?', id,
    );
    if (!caseRow) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);

    // Per-tally helper — a missing/drifted junction table yields 0, never 500.
    const tally = async (sql: string): Promise<number> => {
      try { return (await queryFirst<{ n: number }>(db, sql, id))?.n ?? 0; } catch { return 0; }
    };
    const evidence_count = await tally('SELECT COUNT(*) n FROM case_evidence WHERE case_id = ?');
    const witness_count = await tally(
      `SELECT COUNT(*) n FROM case_person_links WHERE case_id = ? AND lower(COALESCE(relationship,'')) LIKE '%witness%'`,
    );
    const suspectLinks = await tally(
      `SELECT COUNT(*) n FROM case_person_links WHERE case_id = ?
         AND lower(COALESCE(relationship,'')) IN ('suspect','arrestee','offender','defendant')`,
    );
    const vehicle_count = await tally('SELECT COUNT(*) n FROM case_vehicles WHERE case_id = ?');
    const person_count = await tally('SELECT COUNT(*) n FROM case_person_links WHERE case_id = ?');

    // Stored manual factors can also assert a suspect (named / in custody).
    let storedFactors: Record<string, boolean> = {};
    try { if (caseRow.solvability_factors) storedFactors = JSON.parse(caseRow.solvability_factors); } catch { /* ignore */ }
    const suspect_identified = suspectLinks > 0 || !!storedFactors.suspect_named || !!storedFactors.suspect_in_custody;

    // Live-derived estimate from real linked records.
    const factors: string[] = [];
    let derived = 0;
    if (suspect_identified) { derived += 30; factors.push('Suspect identified'); }
    if (evidence_count > 0) { derived += Math.min(evidence_count, 4) * 10; factors.push(`${evidence_count} evidence item${evidence_count === 1 ? '' : 's'} on file`); }
    if (witness_count > 0) { derived += Math.min(witness_count, 3) * 8; factors.push(`${witness_count} witness${witness_count === 1 ? '' : 'es'} available`); }
    if (vehicle_count > 0) { derived += 10; factors.push(`${vehicle_count} vehicle${vehicle_count === 1 ? '' : 's'} linked`); }
    if (person_count > 0 && !suspect_identified) { derived += 5; factors.push(`${person_count} person${person_count === 1 ? '' : 's'} of interest`); }
    derived = Math.max(0, Math.min(100, derived));

    const stored = typeof caseRow.solvability_score === 'number' ? caseRow.solvability_score : 0;
    if (stored > derived) factors.unshift('Investigator-calculated assessment');
    const score = Math.max(derived, Math.min(100, stored));
    if (factors.length === 0) factors.push('No solvability factors recorded yet');

    const rating = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
    return c.json({ score, rating, factors, evidence_count, witness_count, suspect_identified });
  } catch (err) {
    return c.json({ error: 'Failed to analyze solvability', code: 'SOLVABILITY_GET_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// PERSONS JUNCTION — case_person_links
// ═══════════════════════════════════════════════════════════════

cases.get('/:id/persons', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT cpl.id as link_id, cpl.relationship, cpl.created_at,
              p.id, p.first_name, p.last_name, p.dob AS date_of_birth, p.phone, p.address
       FROM case_person_links cpl
       JOIN persons p ON cpl.person_id = p.id
       WHERE cpl.case_id = ?
       ORDER BY cpl.created_at DESC`,
      id,
    );
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to get case persons', code: 'PERSONS_GET_ERROR' }, 500);
  }
});

cases.post('/:id/persons', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const { person_id, relationship } = await c.req.json<{ person_id?: number; relationship?: string }>();
    if (!person_id) return c.json({ error: 'person_id required', code: 'PERSON_ID_REQUIRED' }, 400);

    const person = await queryFirst<{ id: number }>(db, 'SELECT id FROM persons WHERE id = ?', person_id);
    if (!person) return c.json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }, 404);

    const result = await execute(
      db,
      `INSERT OR IGNORE INTO case_person_links (case_id, person_id, relationship) VALUES (?, ?, ?)`,
      id, person_id, relationship ?? 'linked',
    );

    // If INSERT OR IGNORE no-op'd, fetch the existing row instead of returning a stub
    const link = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT cpl.*, p.first_name, p.last_name FROM case_person_links cpl
       JOIN persons p ON cpl.person_id = p.id
       WHERE cpl.case_id = ? AND cpl.person_id = ?`,
      id, person_id,
    );
    return c.json({ data: link }, result.meta.changes > 0 ? 201 : 200);
  } catch (err) {
    return c.json({ error: 'Failed to attach person', code: 'PERSON_POST_ERROR' }, 500);
  }
});

cases.put('/:id/persons/:personEntryId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('id'), 10);
    const linkId = parseInt(c.req.param('personEntryId'), 10);
    if (isNaN(caseId) || isNaN(linkId)) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
    const { relationship } = await c.req.json<{ relationship?: string }>();
    if (typeof relationship !== 'string') return c.json({ error: 'relationship required', code: 'RELATIONSHIP_REQUIRED' }, 400);
    const result = await execute(
      db,
      'UPDATE case_person_links SET relationship = ? WHERE id = ? AND case_id = ?',
      relationship, linkId, caseId,
    );
    if (result.meta.changes === 0) return c.json({ error: 'Link not found', code: 'NOT_FOUND' }, 404);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to update person link', code: 'PERSON_PUT_ERROR' }, 500);
  }
});

cases.delete('/:id/persons/:personEntryId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('id'), 10);
    const ref = parseInt(c.req.param('personEntryId'), 10);
    if (isNaN(caseId) || isNaN(ref)) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
    // The detail view passes the person's id (from /full); accept the link
    // PK as a fallback for any older caller.
    let result = await execute(db, 'DELETE FROM case_person_links WHERE person_id = ? AND case_id = ?', ref, caseId);
    if (result.meta.changes === 0) {
      result = await execute(db, 'DELETE FROM case_person_links WHERE id = ? AND case_id = ?', ref, caseId);
    }
    if (result.meta.changes === 0) return c.json({ error: 'Link not found', code: 'NOT_FOUND' }, 404);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to remove person link', code: 'PERSON_DELETE_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// GENERIC ENTITY JUNCTIONS — link/unlink record types to a case
// ═══════════════════════════════════════════════════════════════
// The case-detail EntityLinkManager links 8 record types. Each maps to a
// legacy case_<type> junction table that GET /:id/full ALREADY reads from,
// so writes and reads stay on the same table and a linked record shows up
// immediately. `persons` is intentionally absent: its dedicated handlers
// above own case_person_links (which create/PUT also mirror) and a static
// route out-prioritises these `:entityType` params in Hono's router.
//
// Table/column names below come from this hardcoded allow-list, never from
// the request, so interpolating them into SQL is safe.
const CASE_JUNCTIONS: Record<string, { table: string; fk: string; entity: string }> = {
  calls:      { table: 'case_calls',      fk: 'call_id',     entity: 'calls_for_service' },
  incidents:  { table: 'case_incidents',  fk: 'incident_id', entity: 'incidents' },
  vehicles:   { table: 'case_vehicles',   fk: 'vehicle_id',  entity: 'vehicles_records' },
  properties: { table: 'case_properties', fk: 'property_id', entity: 'properties' },
  evidence:   { table: 'case_evidence',   fk: 'evidence_id', entity: 'evidence' },
  warrants:   { table: 'case_warrants',   fk: 'warrant_id',  entity: 'warrants' },
  citations:  { table: 'case_citations',  fk: 'citation_id', entity: 'citations' },
};

// The client posts { <singular>_id: N } (e.g. { evidence_id: 5 }). Accept the
// canonical fk first, then any *_id, then a bare id/entity_id, for resilience.
function extractEntityId(body: Record<string, unknown>, fk: string): number | null {
  const toId = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  if (body[fk] != null) { const n = toId(body[fk]); if (n) return n; }
  for (const [k, v] of Object.entries(body)) {
    if (k !== 'case_id' && k.endsWith('_id')) { const n = toId(v); if (n) return n; }
  }
  return toId(body.id) ?? toId(body.entity_id);
}

// Register an explicit static link/unlink pair per entity type. Using
// concrete paths (`/:id/evidence`, `/:id/evidence/:entityId`) instead of a
// `/:id/:entityType` param keeps every route static and unambiguous — no
// reliance on router static-vs-param precedence against /:id/notes etc.
for (const [type, cfg] of Object.entries(CASE_JUNCTIONS)) {
  // POST /:id/<type> — attach a record to a case
  cases.post(`/:id/${type}`, async (c) => {
    const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    try {
      const db = getDb(c.env);
      const caseId = parseInt(c.req.param('id'), 10);
      if (isNaN(caseId)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
      const exists = await queryFirst<{ id: number }>(db, 'SELECT id FROM cases WHERE id = ?', caseId);
      if (!exists) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);

      const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
      const entityId = extractEntityId(body, cfg.fk);
      if (!entityId) return c.json({ error: `${cfg.fk} is required`, code: 'ENTITY_ID_REQUIRED' }, 400);

      // Best-effort existence check — never block the link if the target table drifts.
      try {
        const target = await queryFirst<{ id: number }>(db, `SELECT id FROM ${cfg.entity} WHERE id = ?`, entityId);
        if (!target) return c.json({ error: `${type.replace(/s$/, '')} not found`, code: 'ENTITY_NOT_FOUND' }, 404);
      } catch { /* target table unavailable — allow the link */ }

      const userId = c.get('userId') as number | undefined;
      const res = await execute(
        db,
        `INSERT OR IGNORE INTO ${cfg.table} (case_id, ${cfg.fk}, added_by) VALUES (?, ?, ?)`,
        caseId, entityId, userId ?? null,
      );
      return c.json({ success: true, linked: res.meta.changes > 0 }, res.meta.changes > 0 ? 201 : 200);
    } catch (err) {
      return c.json({ error: 'Failed to link record', code: 'LINK_ERROR', detail: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // DELETE /:id/<type>/:entityId — detach a record from a case
  cases.delete(`/:id/${type}/:entityId`, async (c) => {
    const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
    if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
    try {
      const db = getDb(c.env);
      const caseId = parseInt(c.req.param('id'), 10);
      const entityId = parseInt(c.req.param('entityId'), 10);
      if (isNaN(caseId) || isNaN(entityId)) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
      // The client unlinks by the entity's own id; tolerate the junction PK too.
      let res = await execute(db, `DELETE FROM ${cfg.table} WHERE case_id = ? AND ${cfg.fk} = ?`, caseId, entityId);
      if (res.meta.changes === 0) {
        res = await execute(db, `DELETE FROM ${cfg.table} WHERE case_id = ? AND id = ?`, caseId, entityId);
      }
      if (res.meta.changes === 0) return c.json({ error: 'Link not found', code: 'NOT_FOUND' }, 404);
      return c.json({ success: true });
    } catch (err) {
      return c.json({ error: 'Failed to unlink record', code: 'UNLINK_ERROR', detail: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
}

// ── GET /export/csv — supervisor+ only ──────────────────────
cases.get('/export/csv', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const dateFrom = c.req.query('date_from');
    const dateTo = c.req.query('date_to');
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    if (dateFrom) { where.push('opened_date >= ?'); params.push(dateFrom); }
    if (dateTo) { where.push('opened_date <= ?'); params.push(dateTo); }

    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT c.case_number, c.title, c.case_type, c.status, c.priority,
              u.full_name as lead_investigator, c.summary, c.opened_date,
              c.due_date, c.closed_date, c.disposition, c.solvability_score
       FROM cases c
       LEFT JOIN users u ON c.lead_investigator_id = u.id
       WHERE ${where.join(' AND ')}
       ORDER BY c.opened_date DESC LIMIT 10000`,
      ...params,
    );

    const headers = [
      { key: 'case_number', label: 'Case #' },
      { key: 'title', label: 'Title' },
      { key: 'case_type', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'priority', label: 'Priority' },
      { key: 'lead_investigator', label: 'Lead Investigator' },
      { key: 'summary', label: 'Summary' },
      { key: 'opened_date', label: 'Opened' },
      { key: 'due_date', label: 'Due' },
      { key: 'closed_date', label: 'Closed' },
      { key: 'disposition', label: 'Disposition' },
      { key: 'solvability_score', label: 'Solvability' },
    ];
    const head = headers.map((h) => csvEscape(h.label)).join(',');
    const body = rows.map((r) => headers.map((h) => csvEscape(r[h.key])).join(',')).join('\n');
    const csv = `${head}\n${body}\n`;
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="cases_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    return c.json({ error: 'Failed to export cases', code: 'EXPORT_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /:id/full — aggregated case + all sub-tab data
// ═══════════════════════════════════════════════════════════════
// Ported from the legacy `rmpg-flex` Worker (legacy/server-vps/src/routes/
// cases.ts lines 877-918) with two fixes:
//   1. Each junction SELECT is wrapped in its own try/catch so a single
//      failing table doesn't tank the whole response — the legacy handler
//      ran 9 queries inline and any one throw nuked all tabs.
//   2. The calls SELECT uses an explicit narrow column list instead of
//      `cfs.*` because calls_for_service is at D1's 100-column cap and
//      `SELECT cc.id, cfs.*` (101 cols) errors with SQLITE_ERROR 7500
//      "too many columns in result set". The projected columns are
//      everything the case detail Calls tab actually renders
//      (CaseManagementPage.tsx lines 921-928) plus call_id for the
//      sub-tab unlink action.
//
// NOTE: /api/cases/* is NOT currently routed to the rewrite by the proxy
// (proxy/index.ts deliberately leaves incidents/citations/cases/court on
// legacy), so this cap-safe handler is dormant until a proxy route lands.
// Keep it ready for that cutover — do not assume it serves prod today.
cases.get('/:id/full', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);

    const caseRow = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT c.*, u.full_name as lead_investigator_name
       FROM cases c
       LEFT JOIN users u ON c.lead_investigator_id = u.id
       WHERE c.id = ?`,
      id,
    );
    if (!caseRow) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);

    // Each junction query in its own try/catch — a missing table or a
    // legacy schema drift on any one of these returns [] for that tab
    // instead of 500'ing the whole endpoint.
    const safeQuery = async <T>(sql: string, ...params: unknown[]): Promise<T[]> => {
      try {
        return await query<T>(db, sql, ...params);
      } catch (err) {
        console.error(`[cases/:id/full] sub-query failed:`, (err as Error)?.message);
        return [];
      }
    };

    // Narrow projection on calls_for_service — stays under D1's 100-col
    // result-set cap. Add columns here ONLY if the case detail Calls
    // tab needs them; project cfs.* and you'll re-introduce the cap bug.
    const calls = await safeQuery<Record<string, unknown>>(
      // location_address is the real column; aliased to `location` so the
      // case detail Calls tab (CaseManagementPage.tsx line 926) finds it.
      `SELECT cc.id as link_id, cfs.id, cfs.call_number, cfs.incident_type,
              cfs.priority, cfs.status, cfs.location_address as location,
              cfs.created_at
       FROM case_calls cc
       JOIN calls_for_service cfs ON cc.call_id = cfs.id
       WHERE cc.case_id = ?
       ORDER BY cfs.created_at DESC`,
      id,
    );
    const incidents = await safeQuery<Record<string, unknown>>(
      `SELECT ci.id as link_id, i.*
       FROM case_incidents ci
       JOIN incidents i ON ci.incident_id = i.id
       WHERE ci.case_id = ?
       ORDER BY i.created_at DESC`,
      id,
    );
    // Read from case_person_links — the table create/PUT/link-POST all
    // write to. `id` is the person's id (the detail view unlinks by it);
    // link_id keeps the junction PK; relationship surfaces as `role`.
    const persons = await safeQuery<Record<string, unknown>>(
      `SELECT cpl.id AS link_id, cpl.relationship AS role,
              p.id, p.first_name, p.last_name, p.dob AS date_of_birth, p.phone, p.address
       FROM case_person_links cpl
       JOIN persons p ON cpl.person_id = p.id
       WHERE cpl.case_id = ?
       ORDER BY cpl.created_at DESC`,
      id,
    );
    const vehicles = await safeQuery<Record<string, unknown>>(
      `SELECT cv.id as link_id, cv.role, v.*
       FROM case_vehicles cv
       JOIN vehicles_records v ON cv.vehicle_id = v.id
       WHERE cv.case_id = ?
       ORDER BY cv.created_at DESC`,
      id,
    );
    const properties = await safeQuery<Record<string, unknown>>(
      `SELECT cpr.id as link_id, cpr.role, p.*
       FROM case_properties cpr
       JOIN properties p ON cpr.property_id = p.id
       WHERE cpr.case_id = ?
       ORDER BY cpr.created_at DESC`,
      id,
    );
    const evidence = await safeQuery<Record<string, unknown>>(
      `SELECT ce.id as link_id, e.*
       FROM case_evidence ce
       JOIN evidence e ON ce.evidence_id = e.id
       WHERE ce.case_id = ?
       ORDER BY e.created_at DESC`,
      id,
    );
    const warrants = await safeQuery<Record<string, unknown>>(
      `SELECT cw.id as link_id, w.*,
              sp.first_name || ' ' || sp.last_name as subject_name
       FROM case_warrants cw
       JOIN warrants w ON cw.warrant_id = w.id
       LEFT JOIN persons sp ON w.subject_person_id = sp.id
       WHERE cw.case_id = ?
       ORDER BY w.created_at DESC`,
      id,
    );
    const citations = await safeQuery<Record<string, unknown>>(
      `SELECT cc2.id as link_id, ct.*
       FROM case_citations cc2
       JOIN citations ct ON cc2.citation_id = ct.id
       WHERE cc2.case_id = ?
       ORDER BY ct.created_at DESC`,
      id,
    );
    const notes = await safeQuery<Record<string, unknown>>(
      `SELECT cn.*, u.full_name as author_name
       FROM case_notes cn
       LEFT JOIN users u ON cn.author_id = u.id
       WHERE cn.case_id = ?
       ORDER BY cn.is_pinned DESC, cn.created_at DESC`,
      id,
    );

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
  } catch (err) {
    return c.json({
      error: 'Failed to get full case', code: 'FULL_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

export default cases;
