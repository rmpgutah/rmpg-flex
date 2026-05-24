// ============================================================
// RMPG Flex — Cases (Cloudflare Worker)
// ============================================================
// Investigative case management. Phase 1 RMS.
//
// Migration: 0028_cases.sql (cases + case_notes + case_person_links).
//
// Scope (this PR — 18 endpoints):
//   Core CRUD + workflow + notes + persons junction + export.
//
// Deferred to follow-up PR (case-junctions):
//   - GET/POST/DELETE × 6 junction tables (incidents, evidence,
//     vehicles, properties, warrants, citations, calls) — 18 endpoints
//   - GET /:id/timeline, /:id/evidence-summary, /:id/full,
//     /:id/completeness — aggregations dependent on junctions
//   - POST /migrate-json-to-junctions — admin one-time backfill
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
    return c.json({ total, open, byStatus, byPriority, last7, last30 });
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

    if (q('status')) { conditions.push('status = ?'); params.push(q('status')); }
    if (q('priority')) { conditions.push('priority = ?'); params.push(q('priority')); }
    if (q('case_type')) { conditions.push('case_type = ?'); params.push(q('case_type')); }
    if (q('lead_investigator_id')) { conditions.push('lead_investigator_id = ?'); params.push(q('lead_investigator_id')); }
    if (q('archived') === 'true') conditions.push('archived_at IS NOT NULL');
    else conditions.push('archived_at IS NULL');
    const search = q('search');
    if (search) {
      conditions.push('(case_number LIKE ? OR title LIKE ? OR summary LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const pageNum = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(10000, Math.max(1, parseInt(q('per_page') || '100', 10) || 100));
    const offset = (pageNum - 1) * perPage;

    const countRow = await queryFirst<{ total: number }>(
      db, `SELECT COUNT(*) as total FROM cases ${where}`, ...params,
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

// ── POST /:id/calculate-solvability ─────────────────────────
// Solvability scoring — sum of weighted factor contributions stored
// as a JSON object on cases.solvability_factors, with the rolled-up
// score on cases.solvability_score. Factor weights mirror legacy
// (~ Spillman-derived heuristic — see SOLVABILITY_FACTORS map below).
const SOLVABILITY_FACTORS: Record<string, number> = {
  has_witness: 20,
  has_suspect_description: 15,
  has_suspect_name: 25,
  has_vehicle_info: 15,
  has_physical_evidence: 20,
  has_video: 25,
  has_fingerprints: 30,
  has_dna: 35,
  victim_can_identify: 20,
  suspect_in_custody: 50,
  // Negative-impact factors deduct from the score
  multi_jurisdiction: -10,
  cold_case: -15,
};

cases.post('/:id/calculate-solvability', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM cases WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);

    const factors = await c.req.json<Record<string, boolean>>();
    let score = 0;
    const breakdown: Record<string, number> = {};
    for (const [key, weight] of Object.entries(SOLVABILITY_FACTORS)) {
      if (factors[key]) {
        score += weight;
        breakdown[key] = weight;
      }
    }
    // Clamp 0..100
    score = Math.max(0, Math.min(100, score));

    await execute(
      db,
      `UPDATE cases SET solvability_score = ?, solvability_factors = ?, updated_at = datetime('now') WHERE id = ?`,
      score, JSON.stringify({ factors, breakdown, calculated_at: new Date().toISOString() }), id,
    );
    return c.json({ data: { id, score, breakdown } });
  } catch (err) {
    return c.json({ error: 'Failed to calculate solvability', code: 'SOLVABILITY_ERROR' }, 500);
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
              p.id, p.first_name, p.last_name, p.dob, p.phone, p.address
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
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('id'), 10);
    const linkId = parseInt(c.req.param('personEntryId'), 10);
    if (isNaN(caseId) || isNaN(linkId)) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
    const result = await execute(
      db, 'DELETE FROM case_person_links WHERE id = ? AND case_id = ?', linkId, caseId,
    );
    if (result.meta.changes === 0) return c.json({ error: 'Link not found', code: 'NOT_FOUND' }, 404);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to remove person link', code: 'PERSON_DELETE_ERROR' }, 500);
  }
});

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

export default cases;
