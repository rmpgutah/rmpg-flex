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
import type { Context } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { tryRepairAndRetry } from '../utils/repairFts';
import { isValidTaskStatus, isValidTaskPriority, completedAtFor } from '../utils/caseTasks';
import { evaluateCompleteness } from '../utils/caseCompleteness';
import { pickTemplate } from '../utils/caseTaskTemplates';
import { broadcastAll } from './ws';
import { recordAudit } from '../utils/auditLog';

import { dbErrorResponse } from '../utils/dbErrors';
import { containsAnyClause } from '../utils/searchText';
import { log } from '../utils/logger';
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

// ── Activity logging — best-effort audit trail (v2 Phase 1) ──
// Records a case mutation into case_activity. Deliberately swallows its
// own errors: an audit-log failure (e.g. table drift) must never break
// the operation it was recording. `action` is a stable machine key
// (formatActivity on the client maps it to a label/icon); `detail` is an
// action-specific JSON blob.
async function logCaseActivity(
  c: Context<Env>,
  caseId: number,
  action: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id?: number; full_name?: string; username?: string } | undefined;
    const actorId = (c.get('userId') as number | undefined) ?? user?.id ?? null;
    const actorName = user?.full_name || user?.username || null;
    await execute(
      db,
      `INSERT INTO case_activity (case_id, action, actor_id, actor_name, detail) VALUES (?, ?, ?, ?, ?)`,
      caseId, action, actorId, actorName, detail ? JSON.stringify(detail) : null,
    );
    // Realtime (v3 Phase 4): every case mutation logs activity, so this is the
    // single seam to notify other devices on the 'records' channel. Best-effort
    // and same-isolate only (matches the existing useLiveSync('records')).
    try { broadcastAll('data_changed', { module: 'records', entity: 'cases', case_id: caseId }); } catch { /* ignore */ }
  } catch (auditErr) {
    log.warn('[cases] logCaseActivity failed (non-fatal)', { caseId, action, err: auditErr instanceof Error ? auditErr.message : String(auditErr) });
  }
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

    // ── v2: clearance, SLA/overdue, aging, by-investigator, avg solvability ──
    const closed = (await queryFirst<{ count: number }>(
      db, `SELECT COUNT(*) as count FROM cases WHERE status LIKE 'closed%'`,
    ))?.count ?? 0;
    // Overdue: past explicit due_date, or elapsed opened_date + sla_hours
    // (mirrors the client computeSlaStatus). Still-open, non-archived only.
    const OVERDUE_SQL = `status NOT LIKE 'closed%' AND archived_at IS NULL AND (
        (due_date IS NOT NULL AND date(due_date) < date('now')) OR
        (due_date IS NULL AND sla_hours IS NOT NULL AND sla_hours > 0
          AND datetime(opened_date, '+' || sla_hours || ' hours') < datetime('now')))`;
    const overdue = (await queryFirst<{ count: number }>(
      db, `SELECT COUNT(*) as count FROM cases WHERE ${OVERDUE_SQL}`,
    ))?.count ?? 0;
    const aging = await queryFirst<Record<string, number>>(
      db,
      `SELECT
         SUM(CASE WHEN julianday('now') - julianday(opened_date) <= 7 THEN 1 ELSE 0 END) AS d0_7,
         SUM(CASE WHEN julianday('now') - julianday(opened_date) > 7  AND julianday('now') - julianday(opened_date) <= 30 THEN 1 ELSE 0 END) AS d8_30,
         SUM(CASE WHEN julianday('now') - julianday(opened_date) > 30 AND julianday('now') - julianday(opened_date) <= 90 THEN 1 ELSE 0 END) AS d31_90,
         SUM(CASE WHEN julianday('now') - julianday(opened_date) > 90 THEN 1 ELSE 0 END) AS d90p
       FROM cases WHERE status NOT LIKE 'closed%' AND archived_at IS NULL`,
    );
    const byInvestigator = await query<Record<string, unknown>>(
      db,
      `SELECT COALESCE(u.full_name, 'Unassigned') AS investigator, COUNT(*) AS count,
              SUM(CASE WHEN
                (c.due_date IS NOT NULL AND date(c.due_date) < date('now')) OR
                (c.due_date IS NULL AND c.sla_hours IS NOT NULL AND c.sla_hours > 0
                  AND datetime(c.opened_date, '+' || c.sla_hours || ' hours') < datetime('now'))
              THEN 1 ELSE 0 END) AS overdue
       FROM cases c LEFT JOIN users u ON c.lead_investigator_id = u.id
       WHERE c.archived_at IS NULL AND c.status NOT LIKE 'closed%'
       GROUP BY c.lead_investigator_id ORDER BY count DESC LIMIT 12`,
    );
    const avgSolv = (await queryFirst<{ avg: number | null }>(
      db, `SELECT AVG(solvability_score) as avg FROM cases
           WHERE solvability_score IS NOT NULL AND solvability_score > 0 AND archived_at IS NULL`,
    ))?.avg;

    // CaseManagementPage reads res.data.by_status.{open,active,...} (an object
    // map) and res.data.avg_solvability. Provide the map + a {data} wrapper
    // while keeping the arrays + top-level keys for any other consumer.
    const byStatusMap: Record<string, number> = {};
    for (const r of byStatus) byStatusMap[String((r as any).status)] = Number((r as any).count) || 0;
    const byPriorityMap: Record<string, number> = {};
    for (const r of byPriority) byPriorityMap[String((r as any).priority)] = Number((r as any).count) || 0;
    const payload = {
      total, open, closed, overdue,
      clearance_rate: total > 0 ? Math.round((closed / total) * 100) : 0,
      by_status: byStatusMap, by_priority: byPriorityMap,
      byStatus, byPriority, last7, last30,
      aging: {
        d0_7: Number(aging?.d0_7) || 0, d8_30: Number(aging?.d8_30) || 0,
        d31_90: Number(aging?.d31_90) || 0, d90p: Number(aging?.d90p) || 0,
      },
      by_investigator: byInvestigator,
      avg_solvability: avgSolv != null ? Math.round(avgSolv) : 0,
    };
    return c.json({ data: payload, ...payload });
  } catch (err) {
    log.error('GET /stats failed', { src: 'src/routes/cases.ts' }, err);
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
      // instr(), not LIKE — D1 caps LIKE patterns at 50 chars (searchText.ts).
      const _m = containsAnyClause(['c.case_number', 'c.title', 'c.summary']);
      conditions.push(_m.sql);
      params.push(..._m.binds(search));
    }
    // SLA attention queue — past due_date or elapsed sla_hours (mirrors the
    // /stats overdue tally and the client computeSlaStatus).
    if (q('overdue') === 'true') {
      conditions.push(`c.status NOT LIKE 'closed%'`);
      conditions.push(`(
        (c.due_date IS NOT NULL AND date(c.due_date) < date('now')) OR
        (c.due_date IS NULL AND c.sla_hours IS NOT NULL AND c.sla_hours > 0
          AND datetime(c.opened_date, '+' || c.sla_hours || ' hours') < datetime('now'))
      )`);
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
    log.error('GET / failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to list cases', code: 'LIST_ERROR' }, 500);
  }
});

// ── POST / — create case ────────────────────────────────────
cases.post('/', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = (c.get('userId') as number | undefined) ?? null;
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
    const title = b.title.trim();

    const caseType = b.case_type ?? 'general';
    const priority = b.priority ?? autoPriority(caseType);
    const caseNumber = await generateCaseNumber(db, caseType);

    // Normalize link arrays
    const personsArr = Array.isArray(b.linked_persons) ? b.linked_persons.map(Number).filter(Number.isFinite) : [];
    const incidentsArr = Array.isArray(b.linked_incidents) ? b.linked_incidents.map(Number).filter(Number.isFinite) : [];
    const evidenceArr = Array.isArray(b.linked_evidence) ? b.linked_evidence.map(Number).filter(Number.isFinite) : [];

    // Wrapped in tryRepairAndRetry: the cases_ai trigger writes into
    // cases_fts's shadow tables on every insert — self-heal a corrupted FTS
    // index and retry once instead of failing the whole case creation.
    const result = await tryRepairAndRetry(db, () => execute(
      db,
      `INSERT INTO cases (
         case_number, title, case_type, status, priority, lead_investigator_id,
         summary, linked_calls, linked_persons, linked_incidents, linked_evidence,
         created_by, opened_date
       ) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, date('now'))`,
      caseNumber, title, caseType, priority, b.lead_investigator_id ?? null,
      b.summary?.trim() ?? null,
      b.linked_call_id ? JSON.stringify([b.linked_call_id]) : '[]',
      JSON.stringify(personsArr),
      JSON.stringify(incidentsArr),
      JSON.stringify(evidenceArr),
      userId,
    ), 'cases_fts');
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

    await logCaseActivity(c, newId, 'case.created', { case_number: caseNumber, title: b.title.trim() });
    return c.json({ data: { id: newId, case_number: caseNumber } }, 201);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to create case', 'CREATE_ERROR');
  }
});

// ── POST /bulk — bulk status / assign / archive (v3 Phase 3) ──
// Static 'bulk' prefix; registered before /:id. Supervisor+ only.
cases.post('/bulk', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const { ids, action, value } = await c.req.json<{ ids?: number[]; action?: string; value?: unknown }>()
      .catch(() => ({} as Record<string, never>));
    const cleanIds = Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite).slice(0, 200) : [];
    if (cleanIds.length === 0) return c.json({ error: 'ids required', code: 'IDS_REQUIRED' }, 400);
    if (!['status', 'assign', 'archive'].includes(String(action))) {
      return c.json({ error: 'action must be status|assign|archive', code: 'BAD_ACTION' }, 400);
    }

    let assigneeName: string | null = null;
    if (action === 'assign' && value) {
      const u = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', Number(value));
      assigneeName = u?.full_name ?? null;
    }

    let updated = 0;
    for (const id of cleanIds) {
      try {
        if (action === 'status') {
          const closedClause = String(value).startsWith('closed') ? `, closed_date = datetime('now')` : '';
          await execute(db, `UPDATE cases SET status = ?, updated_at = datetime('now')${closedClause} WHERE id = ?`, value, id);
          await logCaseActivity(c, id, 'status.changed', { to: value, bulk: true });
        } else if (action === 'assign') {
          await execute(db, `UPDATE cases SET lead_investigator_id = ?, updated_at = datetime('now') WHERE id = ?`, value ? Number(value) : null, id);
          await logCaseActivity(c, id, 'case.updated', { fields: ['lead_investigator_id'], bulk: true, assignee_name: assigneeName });
        } else {
          await execute(db, `UPDATE cases SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, id);
          await logCaseActivity(c, id, 'case.archived', { bulk: true });
        }
        updated++;
      } catch { /* per-id best-effort */ }
    }
    return c.json({ success: true, updated });
  } catch (err) {
    return dbErrorResponse(c, err, 'Bulk action failed', 'BULK_ERROR');
  }
});

// ── GET /:id ────────────────────────────────────────────────
cases.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
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
    log.error('GET /:id failed', { src: 'src/routes/cases.ts' }, err);
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
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
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

    // Wrapped in tryRepairAndRetry: the cases_au trigger writes into
    // cases_fts's shadow tables on every update — self-heal a corrupted FTS
    // index and retry once instead of failing the update outright.
    await tryRepairAndRetry(db, () => execute(db, `UPDATE cases SET ${sets.join(', ')} WHERE id = ?`, ...vals), 'cases_fts');

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
    await logCaseActivity(c, id, 'case.updated', { fields: Object.keys(b).filter((k) => UPDATABLE.has(k)) });
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /:id failed', { src: 'src/routes/cases.ts' }, err);
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
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const existing = await queryFirst<{ id: number; status: string }>(db, 'SELECT id, status FROM cases WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);
    // Allow submission from any non-terminal open-work status (previously only 'open').
    const SUBMITTABLE = new Set(['open', 'assigned', 'active', 'suspended', 'returned']);
    if (!SUBMITTABLE.has(existing.status)) {
      return c.json({ error: `Cannot submit case in status: ${existing.status}`, code: 'INVALID_STATUS_TRANSITION' }, 400);
    }
    await execute(
      db,
      `UPDATE cases SET status = 'under_review', approval_status = 'pending_review', updated_at = datetime('now') WHERE id = ?`,
      id,
    );
    await logCaseActivity(c, id, 'review.submitted', { from: existing.status, to: 'under_review' });
    return c.json({ data: { id, status: 'under_review', approval_status: 'pending_review' } });
  } catch (err) {
    log.error('PUT /:id/submit-review failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to submit case for review', code: 'SUBMIT_REVIEW_ERROR' }, 500);
  }
});

cases.put('/:id/approve', async (c) => {
  // Approval / return is a supervisory action — restrict to supervisor+
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const existing = await queryFirst<{ id: number; status: string }>(db, 'SELECT id, status FROM cases WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);
    if (existing.status !== 'under_review') {
      return c.json({ error: `Cannot approve/return case in status: ${existing.status}`, code: 'INVALID_STATUS_TRANSITION' }, 400);
    }

    const body = await c.req.json<{ action?: string; return_reason?: string }>().catch(() => ({} as Record<string, never>));
    const action = body.action === 'return' ? 'return' : 'approve';

    if (action === 'return') {
      const reason = typeof body.return_reason === 'string' ? body.return_reason.trim() : '';
      if (!reason) return c.json({ error: 'return_reason is required', code: 'RETURN_REASON_REQUIRED' }, 400);
      await execute(
        db,
        `UPDATE cases SET status = 'returned', approval_status = 'returned',
                          return_reason = ?, updated_at = datetime('now') WHERE id = ?`,
        reason, id,
      );
      await logCaseActivity(c, id, 'review.returned', { from: 'under_review', to: 'returned', return_reason: reason });
      return c.json({ data: { id, status: 'returned', approval_status: 'returned', return_reason: reason } });
    }

    const userId = c.get('userId') as number | undefined;
    await execute(
      db,
      `UPDATE cases SET status = 'approved', approval_status = 'approved',
                        approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      userId ?? null, id,
    );
    await logCaseActivity(c, id, 'review.approved', { from: 'under_review', to: 'approved' });
    return c.json({ data: { id, status: 'approved', approval_status: 'approved' } });
  } catch (err) {
    log.error('PUT /:id/approve failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to approve case', code: 'APPROVE_ERROR' }, 500);
  }
});

cases.put('/:id/status', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
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
    await logCaseActivity(c, id, 'status.changed', { to: status, ...(disposition ? { disposition } : {}) });
    return c.json({ data: { id, status, disposition } });
  } catch (err) {
    log.error('PUT /:id/status failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to update case status', code: 'STATUS_UPDATE_ERROR' }, 500);
  }
});

cases.post('/:id/archive', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const result = await execute(
      db, `UPDATE cases SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, id,
    );
    if (result.meta.changes === 0) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);
    await logCaseActivity(c, id, 'case.archived');
    return c.json({ data: { id, archived: true } });
  } catch (err) {
    log.error('POST /:id/archive failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to archive case', code: 'ARCHIVE_ERROR' }, 500);
  }
});

cases.delete('/:id', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    // Pull identifying fields BEFORE destruction — audit 2026-06-21
    // caught that case deletion (cascading case_notes + case_person_links)
    // wrote zero audit_log entries while case-task delete at line 1316
    // logs via logCaseActivity. The first thing a prosecutor will ask
    // is "who deleted this case?" — record the answer.
    const existing = await queryFirst<{ id: number; case_number: string | null; case_type: string | null; status: string | null }>(
      db, 'SELECT id, case_number, case_type, status FROM cases WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);
    // CASCADE deletes case_notes + case_person_links via FK
    await execute(db, 'DELETE FROM case_notes WHERE case_id = ?', id);
    await execute(db, 'DELETE FROM case_person_links WHERE case_id = ?', id);
    await execute(db, 'DELETE FROM cases WHERE id = ?', id);
    try {
      await recordAudit(c, {
        action: 'case_deleted',
        entityType: 'case',
        entityId: id,
        details: `Deleted case ${existing.case_number ?? id} (${existing.case_type ?? 'unknown_type'}, status=${existing.status ?? 'unknown'})`,
      });
    } catch { /* best-effort */ }
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /:id failed', { src: 'src/routes/cases.ts' }, err);
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
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
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
    log.error('GET /:id/notes failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to get case notes', code: 'NOTES_GET_ERROR' }, 500);
  }
});

cases.post('/:id/notes', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
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
    await logCaseActivity(c, id, 'note.added', { note_type: note_type ?? 'general' });
    return c.json({ data: note }, 201);
  } catch (err) {
    log.error('POST /:id/notes failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to add note', code: 'NOTE_POST_ERROR' }, 500);
  }
});

// ── PUT /:id/notes/:noteId — edit content + toggle pin ──────
cases.put('/:id/notes/:noteId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('id'), 10);
    const noteId = parseInt(c.req.param('noteId'), 10);
    if (!Number.isFinite(caseId) || caseId < 1 || !Number.isFinite(noteId) || noteId < 1) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
    const userId = c.get('userId') as number | undefined;
    const user = c.get('user');

    const note = await queryFirst<{ id: number; author_id: number; case_id: number; is_pinned: number }>(
      db, 'SELECT id, author_id, case_id, is_pinned FROM case_notes WHERE id = ? AND case_id = ?', noteId, caseId,
    );
    if (!note) return c.json({ error: 'Note not found', code: 'NOT_FOUND' }, 404);

    const body = await c.req.json<{ content?: string; is_pinned?: boolean }>().catch(() => ({} as Record<string, never>));
    const sets: string[] = [];
    const vals: unknown[] = [];

    // Only the author (or admin/supervisor) may edit the note body.
    if (typeof body.content === 'string') {
      const isAuthor = note.author_id === userId;
      const isPrivileged = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor';
      if (!isAuthor && !isPrivileged) {
        return c.json({ error: 'Only the author can edit note content', code: 'FORBIDDEN' }, 403);
      }
      if (!body.content.trim()) return c.json({ error: 'Content cannot be empty', code: 'CONTENT_REQUIRED' }, 400);
      sets.push('content = ?');
      vals.push(body.content.trim());
    }

    // Any case team member may toggle the pin.
    if (typeof body.is_pinned === 'boolean') {
      sets.push('is_pinned = ?');
      vals.push(body.is_pinned ? 1 : 0);
    }

    if (sets.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS' }, 400);
    sets.push(`updated_at = datetime('now')`);
    vals.push(noteId, caseId);
    await execute(db, `UPDATE case_notes SET ${sets.join(', ')} WHERE id = ? AND case_id = ?`, ...vals);

    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM case_notes WHERE id = ?', noteId);
    await logCaseActivity(c, caseId, 'note.updated', { note_id: noteId, pinned: body.is_pinned });
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /:id/notes/:noteId failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to update note', code: 'NOTE_PUT_ERROR' }, 500);
  }
});

// ── DELETE /:id/notes/:noteId — author or admin/supervisor ───
cases.delete('/:id/notes/:noteId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('id'), 10);
    const noteId = parseInt(c.req.param('noteId'), 10);
    if (!Number.isFinite(caseId) || caseId < 1 || !Number.isFinite(noteId) || noteId < 1) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
    const userId = c.get('userId') as number | undefined;
    const user = c.get('user');

    const note = await queryFirst<{ id: number; author_id: number }>(
      db, 'SELECT id, author_id FROM case_notes WHERE id = ? AND case_id = ?', noteId, caseId,
    );
    if (!note) return c.json({ error: 'Note not found', code: 'NOT_FOUND' }, 404);

    const isAuthor = note.author_id === userId;
    const isPrivileged = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor';
    if (!isAuthor && !isPrivileged) {
      return c.json({ error: 'Only the author or supervisor can delete notes', code: 'FORBIDDEN' }, 403);
    }

    await execute(db, 'DELETE FROM case_notes WHERE id = ? AND case_id = ?', noteId, caseId);
    await logCaseActivity(c, caseId, 'note.deleted', { note_id: noteId });
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /:id/notes/:noteId failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to delete note', code: 'NOTE_DELETE_ERROR' }, 500);
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
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
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
    await logCaseActivity(c, id, 'solvability.calculated', { score });
    return c.json({ data: { id, score, breakdown } });
  } catch (err) {
    log.error('POST /:id/calculate-solvability failed', { src: 'src/routes/cases.ts' }, err);
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
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
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
    log.error('GET /:id/solvability failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to analyze solvability', code: 'SOLVABILITY_GET_ERROR' }, 500);
  }
});

// ── GET /:id/completeness — investigative readiness (v3 Phase 1) ──
cases.get('/:id/completeness', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const row = await queryFirst<{ case_type: string | null; lead_investigator_id: number | null; narrative: string | null; summary: string | null; solvability_score: number | null }>(
      db, 'SELECT case_type, lead_investigator_id, narrative, summary, solvability_score FROM cases WHERE id = ?', id,
    );
    if (!row) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);
    const tally = async (sql: string): Promise<number> => {
      try { return (await queryFirst<{ n: number }>(db, sql, id))?.n ?? 0; } catch { return 0; }
    };
    const persons = await tally('SELECT COUNT(*) n FROM case_person_links WHERE case_id = ?');
    const evidence = await tally('SELECT COUNT(*) n FROM case_evidence WHERE case_id = ?');
    const vehicles = await tally('SELECT COUNT(*) n FROM case_vehicles WHERE case_id = ?');
    const incidents = await tally('SELECT COUNT(*) n FROM case_incidents WHERE case_id = ?');
    const calls = await tally('SELECT COUNT(*) n FROM case_calls WHERE case_id = ?');
    const tasks_total = await tally('SELECT COUNT(*) n FROM case_tasks WHERE case_id = ?');
    const tasks_open = await tally("SELECT COUNT(*) n FROM case_tasks WHERE case_id = ? AND status NOT IN ('done','canceled')");
    const suspectLinks = await tally(
      `SELECT COUNT(*) n FROM case_person_links WHERE case_id = ?
         AND lower(COALESCE(relationship,'')) IN ('suspect','arrestee','offender','defendant')`,
    );
    // Count uploaded attachments (photos, PDFs, reports) as evidence signal.
    const attachments = await tally(
      `SELECT COUNT(*) n FROM attachments WHERE entity_type = 'case' AND entity_id = ?`,
    );
    const result = evaluateCompleteness(row.case_type, {
      lead_investigator_id: row.lead_investigator_id, narrative: row.narrative, summary: row.summary,
      solvability_score: row.solvability_score, persons, evidence, vehicles, incidents, calls,
      tasks_total, tasks_open, suspect_identified: suspectLinks > 0, attachments,
    });
    return c.json(result);
  } catch (err) {
    log.error('GET /:id/completeness failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to evaluate completeness', code: 'COMPLETENESS_ERROR' }, 500);
  }
});

// ── GET /:id/activity — audit / activity trail (v2 Phase 1) ──
cases.get('/:id/activity', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const limit = Math.min(parseInt(c.req.query('limit') || '200', 10) || 200, 500);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT id, action, actor_id, actor_name, detail, created_at
       FROM case_activity WHERE case_id = ?
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT ?`,
      id, limit,
    );
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /:id/activity failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to get case activity', code: 'ACTIVITY_GET_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// PERSONS JUNCTION — case_person_links
// ═══════════════════════════════════════════════════════════════

cases.get('/:id/persons', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
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
    log.error('GET /:id/persons failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to get case persons', code: 'PERSONS_GET_ERROR' }, 500);
  }
});

cases.post('/:id/persons', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
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
    if (result.meta.changes > 0) await logCaseActivity(c, id, 'link.added', { entity: 'persons', entity_id: person_id });
    return c.json({ data: link }, result.meta.changes > 0 ? 201 : 200);
  } catch (err) {
    log.error('POST /:id/persons failed', { src: 'src/routes/cases.ts' }, err);
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
    if (!Number.isFinite(caseId) || caseId < 1 || !Number.isFinite(linkId) || linkId < 1) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
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
    log.error('PUT /:id/persons/:personEntryId failed', { src: 'src/routes/cases.ts' }, err);
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
    if (!Number.isFinite(caseId) || caseId < 1 || !Number.isFinite(ref) || ref < 1) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
    // The detail view passes the person's id (from /full); accept the link
    // PK as a fallback for any older caller.
    let result = await execute(db, 'DELETE FROM case_person_links WHERE person_id = ? AND case_id = ?', ref, caseId);
    if (result.meta.changes === 0) {
      result = await execute(db, 'DELETE FROM case_person_links WHERE id = ? AND case_id = ?', ref, caseId);
    }
    if (result.meta.changes === 0) return c.json({ error: 'Link not found', code: 'NOT_FOUND' }, 404);
    await logCaseActivity(c, caseId, 'link.removed', { entity: 'persons', entity_id: ref });
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /:id/persons/:personEntryId failed', { src: 'src/routes/cases.ts' }, err);
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
      if (!Number.isFinite(caseId) || caseId < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
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
      if (res.meta.changes > 0) await logCaseActivity(c, caseId, 'link.added', { entity: type, entity_id: entityId });
      return c.json({ success: true, linked: res.meta.changes > 0 }, res.meta.changes > 0 ? 201 : 200);
    } catch (err) {
      return dbErrorResponse(c, err, 'Failed to link record', 'LINK_ERROR');
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
      if (!Number.isFinite(caseId) || caseId < 1 || !Number.isFinite(entityId) || entityId < 1) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
      // The client unlinks by the entity's own id; tolerate the junction PK too.
      let res = await execute(db, `DELETE FROM ${cfg.table} WHERE case_id = ? AND ${cfg.fk} = ?`, caseId, entityId);
      if (res.meta.changes === 0) {
        res = await execute(db, `DELETE FROM ${cfg.table} WHERE case_id = ? AND id = ?`, caseId, entityId);
      }
      if (res.meta.changes === 0) return c.json({ error: 'Link not found', code: 'NOT_FOUND' }, 404);
      await logCaseActivity(c, caseId, 'link.removed', { entity: type, entity_id: entityId });
      return c.json({ success: true });
    } catch (err) {
      return dbErrorResponse(c, err, 'Failed to unlink record', 'UNLINK_ERROR');
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// INVESTIGATIVE TASKS / LEADS — case_tasks (v2 Phase 2)
// ═══════════════════════════════════════════════════════════════

// GET /tasks/mine — cross-case tasks assigned to the current user.
// Static first segment 'tasks' does not collide with /:id/tasks (2nd
// segment differs) or /:id (arity differs); Hono prioritises static.
cases.get('/tasks/mine', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    if (!userId) return c.json({ data: [] });
    const status = c.req.query('status');
    const overdue = c.req.query('overdue') === 'true';
    const where: string[] = ['t.assignee_id = ?'];
    const params: unknown[] = [userId];
    if (status && isValidTaskStatus(status)) { where.push('t.status = ?'); params.push(status); }
    else { where.push("t.status NOT IN ('done','canceled')"); } // default: active only
    if (overdue) {
      where.push("t.due_date IS NOT NULL AND date(t.due_date) < date('now') AND t.status NOT IN ('done','canceled')");
    }
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT t.*, c.case_number, c.title AS case_title, c.status AS case_status
       FROM case_tasks t JOIN cases c ON t.case_id = c.id
       WHERE ${where.join(' AND ')}
       ORDER BY (t.due_date IS NULL) ASC, date(t.due_date) ASC, t.created_at DESC`,
      ...params,
    );
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /tasks/mine failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to get assigned tasks', code: 'TASKS_MINE_ERROR' }, 500);
  }
});

// GET /:id/tasks — all tasks for a case (active first, then by priority/due)
cases.get('/:id/tasks', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM case_tasks WHERE case_id = ?
       ORDER BY (status IN ('done','canceled')) ASC,
                CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END ASC,
                (due_date IS NULL) ASC, date(due_date) ASC, created_at DESC`,
      id,
    );
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /:id/tasks failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to get case tasks', code: 'TASKS_GET_ERROR' }, 500);
  }
});

// POST /:id/tasks — create a task/lead
cases.post('/:id/tasks', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const exists = await queryFirst<{ id: number }>(db, 'SELECT id FROM cases WHERE id = ?', id);
    if (!exists) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);

    const b = await c.req.json<{ title?: string; description?: string; priority?: string; assignee_id?: number; due_date?: string }>()
      .catch(() => ({} as Record<string, never>));
    const title = String(b.title || '').trim();
    if (!title) return c.json({ error: 'Title is required', code: 'TASK_TITLE_REQUIRED' }, 400);
    const priority = isValidTaskPriority(b.priority) ? b.priority : 'normal';

    let assigneeName: string | null = null;
    if (b.assignee_id) {
      const u = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', b.assignee_id);
      assigneeName = u?.full_name ?? null;
    }
    const userId = c.get('userId') as number | undefined;
    const res = await execute(
      db,
      `INSERT INTO case_tasks (case_id, title, description, status, priority, assignee_id, assignee_name, due_date, created_by, updated_at)
       VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, datetime('now'))`,
      id, title, b.description ?? null, priority, b.assignee_id ?? null, assigneeName, b.due_date ?? null, userId ?? null,
    );
    const taskId = Number(res.meta.last_row_id);
    await logCaseActivity(c, id, 'task.created', { task_id: taskId, title });
    const task = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM case_tasks WHERE id = ?', taskId);
    return c.json({ data: task }, 201);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to create task', 'TASK_CREATE_ERROR');
  }
});

// POST /:id/tasks/apply-template — seed the case-type's standard leads
// (skips titles already present, so it's safe to re-apply).
cases.post('/:id/tasks/apply-template', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const row = await queryFirst<{ case_type: string | null }>(db, 'SELECT case_type FROM cases WHERE id = ?', id);
    if (!row) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);

    const existing = await query<{ title: string }>(db, 'SELECT title FROM case_tasks WHERE case_id = ?', id);
    const have = new Set(existing.map((t) => t.title.trim().toLowerCase()));
    const userId = c.get('userId') as number | undefined;
    let added = 0;
    for (const item of pickTemplate(row.case_type)) {
      if (have.has(item.title.trim().toLowerCase())) continue;
      await execute(
        db,
        `INSERT INTO case_tasks (case_id, title, status, priority, created_by, updated_at)
         VALUES (?, ?, 'open', ?, ?, datetime('now'))`,
        id, item.title, item.priority, userId ?? null,
      );
      added++;
    }
    if (added > 0) await logCaseActivity(c, id, 'task.created', { template: true, added });
    return c.json({ success: true, added });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to apply task template', 'TASK_TEMPLATE_ERROR');
  }
});

// PUT /:id/tasks/:taskId — update fields / status
cases.put('/:id/tasks/:taskId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const taskId = parseInt(c.req.param('taskId'), 10);
    if (!Number.isFinite(id) || id < 1 || !Number.isFinite(taskId) || taskId < 1) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
    const existing = await queryFirst<{ id: number; status: string; completed_at: string | null; title: string }>(
      db, 'SELECT id, status, completed_at, title FROM case_tasks WHERE id = ? AND case_id = ?', taskId, id,
    );
    if (!existing) return c.json({ error: 'Task not found', code: 'NOT_FOUND' }, 404);

    const b = await c.req.json<Record<string, any>>().catch(() => ({} as Record<string, any>));
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (typeof b.title === 'string' && b.title.trim()) { sets.push('title = ?'); vals.push(b.title.trim()); }
    if ('description' in b) { sets.push('description = ?'); vals.push(b.description ?? null); }
    if (isValidTaskPriority(b.priority)) { sets.push('priority = ?'); vals.push(b.priority); }
    if ('due_date' in b) { sets.push('due_date = ?'); vals.push(b.due_date ?? null); }
    if ('assignee_id' in b) {
      let assigneeName: string | null = null;
      if (b.assignee_id) {
        const u = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', b.assignee_id);
        assigneeName = u?.full_name ?? null;
      }
      sets.push('assignee_id = ?', 'assignee_name = ?');
      vals.push(b.assignee_id ?? null, assigneeName);
    }
    const statusChanged = isValidTaskStatus(b.status) && b.status !== existing.status;
    if (isValidTaskStatus(b.status)) {
      sets.push('status = ?'); vals.push(b.status);
      sets.push('completed_at = ?'); vals.push(completedAtFor(b.status, new Date().toISOString(), existing.completed_at));
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS' }, 400);
    sets.push(`updated_at = datetime('now')`);
    vals.push(taskId, id);
    await execute(db, `UPDATE case_tasks SET ${sets.join(', ')} WHERE id = ? AND case_id = ?`, ...vals);

    const action = statusChanged && b.status === 'done' ? 'task.completed' : 'task.updated';
    await logCaseActivity(c, id, action, { task_id: taskId, title: existing.title });
    const task = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM case_tasks WHERE id = ?', taskId);
    return c.json({ data: task });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to update task', 'TASK_UPDATE_ERROR');
  }
});

// DELETE /:id/tasks/:taskId
cases.delete('/:id/tasks/:taskId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const taskId = parseInt(c.req.param('taskId'), 10);
    if (!Number.isFinite(id) || id < 1 || !Number.isFinite(taskId) || taskId < 1) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
    const existing = await queryFirst<{ title: string }>(db, 'SELECT title FROM case_tasks WHERE id = ? AND case_id = ?', taskId, id);
    const res = await execute(db, 'DELETE FROM case_tasks WHERE id = ? AND case_id = ?', taskId, id);
    if (res.meta.changes === 0) return c.json({ error: 'Task not found', code: 'NOT_FOUND' }, 404);
    await logCaseActivity(c, id, 'task.deleted', { task_id: taskId, title: existing?.title });
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /:id/tasks/:taskId failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to delete task', code: 'TASK_DELETE_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// CASE-TO-CASE LINKS — case_links (v2 Phase 4)
// ═══════════════════════════════════════════════════════════════
// One row per link; the relationship is visible from either side via the
// UNION in GET and the bidirectional match in DELETE.

cases.get('/:id/related', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const rows = await query<Record<string, unknown>>(
      db,
      // Explicit aliases: SQLite rejects ORDER BY on an unaliased column in a
      // compound (UNION) select.
      `SELECT cl.id AS link_id, cl.link_type, cl.created_at AS linked_at,
              rc.id AS id, rc.case_number, rc.title, rc.status, rc.priority
       FROM case_links cl JOIN cases rc ON rc.id = cl.related_case_id
       WHERE cl.case_id = ?
       UNION
       SELECT cl.id AS link_id, cl.link_type, cl.created_at AS linked_at,
              rc.id AS id, rc.case_number, rc.title, rc.status, rc.priority
       FROM case_links cl JOIN cases rc ON rc.id = cl.case_id
       WHERE cl.related_case_id = ?
       ORDER BY linked_at DESC`,
      id, id,
    );
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /:id/related failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to get related cases', code: 'RELATED_GET_ERROR' }, 500);
  }
});

cases.post('/:id/related', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const { related_case_id, link_type } = await c.req.json<{ related_case_id?: number; link_type?: string }>()
      .catch(() => ({} as Record<string, never>));
    const relId = Number(related_case_id);
    if (!Number.isFinite(relId) || relId <= 0) return c.json({ error: 'related_case_id required', code: 'RELATED_ID_REQUIRED' }, 400);
    if (relId === id) return c.json({ error: 'A case cannot be linked to itself', code: 'SELF_LINK' }, 400);

    const rel = await queryFirst<{ id: number; case_number: string }>(db, 'SELECT id, case_number FROM cases WHERE id = ?', relId);
    if (!rel) return c.json({ error: 'Related case not found', code: 'RELATED_NOT_FOUND' }, 404);

    // Reject if already linked in either direction.
    const dup = await queryFirst<{ id: number }>(
      db,
      `SELECT id FROM case_links WHERE (case_id = ? AND related_case_id = ?) OR (case_id = ? AND related_case_id = ?)`,
      id, relId, relId, id,
    );
    if (dup) return c.json({ data: { id: dup.id }, linked: false });

    const type = ['related', 'series', 'parent', 'child'].includes(String(link_type)) ? String(link_type) : 'related';
    const userId = c.get('userId') as number | undefined;
    const res = await execute(
      db,
      `INSERT INTO case_links (case_id, related_case_id, link_type, created_by) VALUES (?, ?, ?, ?)`,
      id, relId, type, userId ?? null,
    );
    await logCaseActivity(c, id, 'case.linked', { related_case_id: relId, related_case_number: rel.case_number, link_type: type });
    return c.json({ data: { id: Number(res.meta.last_row_id) }, linked: true }, 201);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to link case', 'CASE_LINK_ERROR');
  }
});

cases.delete('/:id/related/:relatedId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const relId = parseInt(c.req.param('relatedId'), 10);
    if (!Number.isFinite(id) || id < 1 || !Number.isFinite(relId) || relId < 1) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
    const res = await execute(
      db,
      `DELETE FROM case_links WHERE (case_id = ? AND related_case_id = ?) OR (case_id = ? AND related_case_id = ?)`,
      id, relId, relId, id,
    );
    if (res.meta.changes === 0) return c.json({ error: 'Link not found', code: 'NOT_FOUND' }, 404);
    await logCaseActivity(c, id, 'case.unlinked', { related_case_id: relId });
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /:id/related/:relatedId failed', { src: 'src/routes/cases.ts' }, err);
    return c.json({ error: 'Failed to unlink case', code: 'CASE_UNLINK_ERROR' }, 500);
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
    log.error('GET /export/csv failed', { src: 'src/routes/cases.ts' }, err);
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
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);

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
      `SELECT cp.*, p.first_name, p.last_name, p.dob AS date_of_birth, p.phone, p.address
       FROM case_persons cp
       LEFT JOIN persons p ON cp.person_id = p.id
       WHERE cp.case_id = ?
       ORDER BY cp.created_at DESC`,
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
    const related = await safeQuery<Record<string, unknown>>(
      `SELECT cl.link_type, rc.id, rc.case_number, rc.title, rc.status
       FROM case_links cl JOIN cases rc ON rc.id = cl.related_case_id WHERE cl.case_id = ?
       UNION
       SELECT cl.link_type, rc.id, rc.case_number, rc.title, rc.status
       FROM case_links cl JOIN cases rc ON rc.id = cl.case_id WHERE cl.related_case_id = ?`,
      id, id,
    );
    // Attachment count for the case — drives the completeness check and tab badge.
    const attachmentCount = await (async () => {
      try {
        const r = await queryFirst<{ n: number }>(
          db, `SELECT COUNT(*) n FROM attachments WHERE entity_type = 'case' AND entity_id = ?`, id,
        );
        return r?.n ?? 0;
      } catch { return 0; }
    })();

    return c.json({
      ...caseRow,
      calls, incidents, persons, vehicles, properties,
      evidence, warrants, citations, notes, related,
      counts: {
        calls: calls.length, incidents: incidents.length,
        persons: persons.length, vehicles: vehicles.length,
        properties: properties.length, evidence: evidence.length,
        warrants: warrants.length, citations: citations.length,
        notes: notes.length, related: related.length,
        attachments: attachmentCount,
      },
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to get full case', 'FULL_ERROR');
  }
});

export default cases;
