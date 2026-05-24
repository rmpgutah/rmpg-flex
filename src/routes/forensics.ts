// ============================================================
// RMPG Flex — Forensics (Cloudflare Worker)
// ============================================================
// Lab case management with chain-of-custody. Phase 1 RMS.
//
// Migration: 0029_forensics.sql (4 tables: forensic_cases +
// forensic_exhibits + forensic_analyses + forensic_activity_log).
//
// MVP scope — 19 endpoints. Deferred to follow-up PRs:
//   - Hash sets (anti-evidence-tampering verification) — ~3 tables + 4
//     endpoints; whole subsystem worth its own focused review
//   - Reports + templates (/templates/report, /generate-report,
//     /analysis-templates, /apply-template) — reporting layer
//   - Operational management (/queue/priority, /queue/reorder,
//     /capacity/planning, /turnaround-times, /metrics/backlog) —
//     planning/metrics layer
//   - Cross-links (/:caseId/links) — junction table to other RMS
//     entities; deferred per the same pattern as cases.ts junctions
//   - QC workflow (/qc-check, /qc-history) — quality control layer
//   - /:caseId/hashes integrity-verification endpoint
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const forensics = new Hono<Env>();

// ── Allowed-value sets (mirror migration CHECK constraints) ──
const CASE_TYPES = new Set([
  'general', 'homicide', 'sexual_assault', 'narcotics', 'arson', 'fraud',
  'burglary', 'robbery', 'digital', 'traffic', 'cold_case', 'other',
]);
const CASE_STATUSES = new Set([
  'received', 'in_progress', 'analysis_complete', 'report_drafted',
  'reviewed', 'released', 'cancelled',
]);
const PRIORITIES = new Set(['routine', 'normal', 'rush', 'urgent']);
const EXHIBIT_TYPES = new Set([
  'biological', 'chemical', 'digital', 'document', 'drug', 'explosive',
  'fingerprint', 'firearm', 'trace', 'clothing', 'dna_sample', 'tool_mark',
  'glass', 'paint', 'fiber', 'soil', 'impression', 'other',
]);
const DISPOSITIONS = new Set([
  'in_lab', 'returned', 'destroyed', 'transferred', 'in_storage',
]);
const ANALYSIS_TYPES = new Set([
  'dna', 'fingerprint', 'drug_analysis', 'toxicology', 'ballistics',
  'digital_forensics', 'document_exam', 'trace_evidence', 'serology',
  'arson_analysis', 'tool_mark', 'glass_analysis', 'paint_analysis',
  'fiber_analysis', 'blood_spatter', 'gunshot_residue', 'other',
]);
const ANALYSIS_STATUSES = new Set([
  'pending', 'in_progress', 'completed', 'inconclusive', 'cancelled',
]);

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '""';
  return `"${String(v).replace(/"/g, '""')}"`;
}

function parseJsonCol<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

/** Lab number: LAB-YY-NNNN. Same concurrency caveat as the other
 *  number generators (FI, CIT, CASE) — patrol/lab cadence is low
 *  enough that the scan-then-insert race doesn't bite in practice. */
async function generateLabNumber(db: ReturnType<typeof getDb>): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `LAB-${yy}-`;
  const last = await queryFirst<{ lab_number: string }>(
    db,
    `SELECT lab_number FROM forensic_cases WHERE lab_number LIKE ? ORDER BY id DESC LIMIT 1`,
    `${prefix}%`,
  );
  let nextNum = 1;
  if (last?.lab_number) {
    const m = last.lab_number.match(/^LAB-\d{2}-(\d+)$/);
    if (m) nextNum = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

/** Append to forensic_activity_log. Best-effort — failures are
 *  logged but don't block the underlying mutation. */
async function logActivity(
  db: ReturnType<typeof getDb>,
  caseId: number,
  action: string,
  details: string | null,
  userId: number,
  userName: string,
  exhibitId: number | null = null,
): Promise<void> {
  try {
    await execute(
      db,
      `INSERT INTO forensic_activity_log
         (forensic_case_id, exhibit_id, action, details, performed_by, performed_by_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      caseId, exhibitId, action, details, userId, userName,
    );
  } catch (err) {
    console.error('[forensics] activity log insert failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════
// CASES
// ═══════════════════════════════════════════════════════════════

// GET /stats — must come before GET /:id
forensics.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const total = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM forensic_cases'))?.count ?? 0;
    const open = (await queryFirst<{ count: number }>(
      db, `SELECT COUNT(*) as count FROM forensic_cases WHERE status NOT IN ('released','cancelled')`,
    ))?.count ?? 0;
    const byStatus = await query<Record<string, unknown>>(
      db, `SELECT status, COUNT(*) as count FROM forensic_cases GROUP BY status ORDER BY count DESC`,
    );
    const byPriority = await query<Record<string, unknown>>(
      db, `SELECT priority, COUNT(*) as count FROM forensic_cases GROUP BY priority ORDER BY count DESC`,
    );
    const byType = await query<Record<string, unknown>>(
      db, `SELECT case_type, COUNT(*) as count FROM forensic_cases GROUP BY case_type ORDER BY count DESC LIMIT 12`,
    );
    return c.json({ total, open, byStatus, byPriority, byType });
  } catch (err) {
    return c.json({ error: 'Failed to get forensics stats', code: 'STATS_ERROR' }, 500);
  }
});

// GET / — list with filters
forensics.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q('status')) { conditions.push('status = ?'); params.push(q('status')); }
    if (q('priority')) { conditions.push('priority = ?'); params.push(q('priority')); }
    if (q('case_type')) { conditions.push('case_type = ?'); params.push(q('case_type')); }
    if (q('examiner_id')) { conditions.push('lead_examiner_id = ?'); params.push(q('examiner_id')); }
    const search = q('search');
    if (search) {
      conditions.push('(lab_number LIKE ? OR title LIKE ? OR description LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const pageNum = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(10000, Math.max(1, parseInt(q('per_page') || '100', 10) || 100));
    const offset = (pageNum - 1) * perPage;

    const countRow = await queryFirst<{ total: number }>(
      db, `SELECT COUNT(*) as total FROM forensic_cases ${where}`, ...params,
    );
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT fc.*, u.full_name as lead_examiner_name
       FROM forensic_cases fc
       LEFT JOIN users u ON fc.lead_examiner_id = u.id
       ${where}
       ORDER BY fc.received_date DESC, fc.id DESC
       LIMIT ? OFFSET ?`,
      ...params, perPage, offset,
    );
    const total = countRow?.total ?? 0;
    return c.json({
      data: rows,
      pagination: { page: pageNum, per_page: perPage, total, totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0 },
    });
  } catch (err) {
    return c.json({ error: 'Failed to list forensics cases', code: 'LIST_ERROR' }, 500);
  }
});

// GET /:id — single case (must come AFTER /stats since both are
// at the route root — Hono matches static before parametric)
forensics.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const row = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT fc.*, u.full_name as lead_examiner_name
       FROM forensic_cases fc
       LEFT JOIN users u ON fc.lead_examiner_id = u.id
       WHERE fc.id = ?`,
      id,
    );
    if (!row) return c.json({ error: 'Forensics case not found', code: 'NOT_FOUND' }, 404);
    return c.json({ data: row });
  } catch (err) {
    return c.json({ error: 'Failed to get forensics case', code: 'GET_ERROR' }, 500);
  }
});

// POST / — create case
forensics.post('/', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();

    if (typeof b.title !== 'string' || !b.title.trim()) {
      return c.json({ error: 'title required', code: 'TITLE_REQUIRED' }, 400);
    }
    const caseType = typeof b.case_type === 'string' && CASE_TYPES.has(b.case_type) ? b.case_type : 'general';
    const status = typeof b.status === 'string' && CASE_STATUSES.has(b.status) ? b.status : 'received';
    const priority = typeof b.priority === 'string' && PRIORITIES.has(b.priority) ? b.priority : 'normal';

    const labNumber = await generateLabNumber(db);

    const result = await execute(
      db,
      `INSERT INTO forensic_cases (
         lab_number, case_type, status, priority, title, description,
         requesting_agency, requesting_officer, lead_examiner_id,
         linked_incident_id, linked_case_id, linked_incident_number, linked_case_number,
         received_date, due_date, notes, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime')), ?, ?, ?)`,
      labNumber, caseType, status, priority, b.title.trim(), b.description ?? null,
      b.requesting_agency ?? 'RMPG', b.requesting_officer ?? null, b.lead_examiner_id ?? null,
      b.linked_incident_id ?? null, b.linked_case_id ?? null,
      b.linked_incident_number ?? null, b.linked_case_number ?? null,
      b.received_date ?? null, b.due_date ?? null, b.notes ?? null, userId,
    );
    const newId = Number(result.meta.last_row_id);

    const user = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', userId);
    await logActivity(db, newId, 'case_created', `Lab number ${labNumber}`, userId, user?.full_name ?? '');

    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM forensic_cases WHERE id = ?', newId);
    return c.json({ data: created, lab_number: labNumber }, 201);
  } catch (err) {
    return c.json({
      error: 'Failed to create forensics case', code: 'CREATE_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// PUT /:id — partial update
const CASE_UPDATABLE = new Set([
  'case_type', 'status', 'priority', 'title', 'description',
  'requesting_agency', 'requesting_officer', 'lead_examiner_id',
  'linked_incident_id', 'linked_case_id', 'linked_incident_number',
  'linked_case_number', 'due_date', 'completed_date', 'released_date', 'notes',
]);

forensics.put('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const existing = await queryFirst<{ id: number; status: string }>(
      db, 'SELECT id, status FROM forensic_cases WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'Forensics case not found', code: 'NOT_FOUND' }, 404);

    const b = await c.req.json<Record<string, unknown>>();
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) {
      if (!CASE_UPDATABLE.has(k)) continue;
      if (k === 'case_type' && (typeof v !== 'string' || !CASE_TYPES.has(v))) continue;
      if (k === 'status' && (typeof v !== 'string' || !CASE_STATUSES.has(v))) continue;
      if (k === 'priority' && (typeof v !== 'string' || !PRIORITIES.has(v))) continue;
      sets.push(`${k} = ?`);
      vals.push(v ?? null);
    }

    // Auto-set completed_date when transitioning to a terminal status
    if (
      (b.status === 'reviewed' || b.status === 'released') &&
      existing.status !== 'reviewed' && existing.status !== 'released'
    ) {
      sets.push(`completed_date = COALESCE(completed_date, date('now'))`);
    }

    if (sets.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS' }, 400);
    sets.push(`updated_at = datetime('now','localtime')`);
    vals.push(id);

    await execute(db, `UPDATE forensic_cases SET ${sets.join(', ')} WHERE id = ?`, ...vals);

    const userId = c.get('userId') as number;
    const user = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', userId);
    await logActivity(db, id, 'case_updated', `Fields: ${Object.keys(b).filter((k) => CASE_UPDATABLE.has(k)).join(', ')}`, userId, user?.full_name ?? '');

    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM forensic_cases WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    return c.json({ error: 'Failed to update forensics case', code: 'UPDATE_ERROR' }, 500);
  }
});

// DELETE /:id — admin only (forensics data is chain-of-custody-critical)
forensics.delete('/:id', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const existing = await queryFirst<{ id: number; lab_number: string }>(
      db, 'SELECT id, lab_number FROM forensic_cases WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'Forensics case not found', code: 'NOT_FOUND' }, 404);
    // CASCADE removes exhibits + analyses + activity log automatically.
    // Explicit DELETE here as defense-in-depth (D1 FK enforcement is
    // per-connection PRAGMA).
    await execute(db, 'DELETE FROM forensic_activity_log WHERE forensic_case_id = ?', id);
    await execute(db, 'DELETE FROM forensic_analyses WHERE forensic_case_id = ?', id);
    await execute(db, 'DELETE FROM forensic_exhibits WHERE forensic_case_id = ?', id);
    await execute(db, 'DELETE FROM forensic_cases WHERE id = ?', id);
    return c.json({ success: true, deleted_lab_number: existing.lab_number });
  } catch (err) {
    return c.json({ error: 'Failed to delete forensics case', code: 'DELETE_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// EXHIBITS — with chain-of-custody JSON column
// ═══════════════════════════════════════════════════════════════

forensics.get('/:caseId/exhibits', async (c) => {
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('caseId'), 10);
    if (isNaN(caseId)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM forensic_exhibits WHERE forensic_case_id = ? ORDER BY exhibit_number, id`,
      caseId,
    );
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to list exhibits', code: 'EXHIBITS_LIST_ERROR' }, 500);
  }
});

forensics.post('/:caseId/exhibits', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('caseId'), 10);
    if (isNaN(caseId)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();

    if (typeof b.description !== 'string' || !b.description.trim()) {
      return c.json({ error: 'description required', code: 'DESCRIPTION_REQUIRED' }, 400);
    }
    const exhibitType = typeof b.exhibit_type === 'string' && EXHIBIT_TYPES.has(b.exhibit_type) ? b.exhibit_type : 'other';
    const disposition = typeof b.disposition === 'string' && DISPOSITIONS.has(b.disposition) ? b.disposition : 'in_lab';

    // Auto-assign exhibit_number per-case if absent (E-001, E-002, ...)
    let exhibitNumber = typeof b.exhibit_number === 'string' && b.exhibit_number.trim()
      ? b.exhibit_number
      : null;
    if (!exhibitNumber) {
      const lastRow = await queryFirst<{ exhibit_number: string }>(
        db,
        `SELECT exhibit_number FROM forensic_exhibits
         WHERE forensic_case_id = ? AND exhibit_number LIKE 'E-%'
         ORDER BY id DESC LIMIT 1`,
        caseId,
      );
      let nextNum = 1;
      if (lastRow?.exhibit_number) {
        const m = lastRow.exhibit_number.match(/^E-(\d+)$/);
        if (m) nextNum = parseInt(m[1], 10) + 1;
      }
      exhibitNumber = `E-${String(nextNum).padStart(3, '0')}`;
    }

    // Seed chain-of-custody with the intake entry
    const user = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', userId);
    const initialCustody = [{
      at: new Date().toISOString(),
      from: null,
      to: user?.full_name ?? `user-${userId}`,
      reason: 'intake',
      by_id: userId,
    }];

    const result = await execute(
      db,
      `INSERT INTO forensic_exhibits (
         forensic_case_id, exhibit_number, exhibit_type, description,
         quantity, condition_received, storage_location, storage_temp,
         collected_by, collected_date, collection_method,
         hash_md5, hash_sha256, chain_of_custody, disposition, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      caseId, exhibitNumber, exhibitType, b.description.trim(),
      b.quantity ?? 1, b.condition_received ?? null,
      b.storage_location ?? null, b.storage_temp ?? null,
      b.collected_by ?? null, b.collected_date ?? null, b.collection_method ?? null,
      b.hash_md5 ?? null, b.hash_sha256 ?? null,
      JSON.stringify(initialCustody), disposition, b.notes ?? null,
    );
    const newId = Number(result.meta.last_row_id);

    await logActivity(db, caseId, 'exhibit_added', `${exhibitNumber}: ${b.description}`, userId, user?.full_name ?? '', newId);

    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM forensic_exhibits WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    return c.json({
      error: 'Failed to add exhibit', code: 'EXHIBIT_POST_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

const EXHIBIT_UPDATABLE = new Set([
  'exhibit_type', 'description', 'quantity', 'condition_received',
  'storage_location', 'storage_temp', 'collected_by', 'collected_date',
  'collection_method', 'hash_md5', 'hash_sha256', 'disposition',
  'disposition_date', 'disposition_notes', 'notes',
]);

forensics.put('/:caseId/exhibits/:exhibitId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('caseId'), 10);
    const exhibitId = parseInt(c.req.param('exhibitId'), 10);
    if (isNaN(caseId) || isNaN(exhibitId)) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);

    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?', exhibitId, caseId,
    );
    if (!existing) return c.json({ error: 'Exhibit not found', code: 'NOT_FOUND' }, 404);

    const b = await c.req.json<Record<string, unknown>>();
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) {
      if (!EXHIBIT_UPDATABLE.has(k)) continue;
      if (k === 'exhibit_type' && (typeof v !== 'string' || !EXHIBIT_TYPES.has(v))) continue;
      if (k === 'disposition' && (typeof v !== 'string' || !DISPOSITIONS.has(v))) continue;
      sets.push(`${k} = ?`);
      vals.push(v ?? null);
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS' }, 400);
    sets.push(`updated_at = datetime('now','localtime')`);
    vals.push(exhibitId);

    await execute(db, `UPDATE forensic_exhibits SET ${sets.join(', ')} WHERE id = ?`, ...vals);

    const userId = c.get('userId') as number;
    const user = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', userId);
    await logActivity(db, caseId, 'exhibit_updated', `Updated fields on exhibit ${exhibitId}`, userId, user?.full_name ?? '', exhibitId);

    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM forensic_exhibits WHERE id = ?', exhibitId);
    return c.json({ data: updated });
  } catch (err) {
    return c.json({ error: 'Failed to update exhibit', code: 'EXHIBIT_PUT_ERROR' }, 500);
  }
});

forensics.delete('/:caseId/exhibits/:exhibitId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('caseId'), 10);
    const exhibitId = parseInt(c.req.param('exhibitId'), 10);
    if (isNaN(caseId) || isNaN(exhibitId)) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
    const result = await execute(
      db, 'DELETE FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?', exhibitId, caseId,
    );
    if (result.meta.changes === 0) return c.json({ error: 'Exhibit not found', code: 'NOT_FOUND' }, 404);
    const userId = c.get('userId') as number;
    const user = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', userId);
    await logActivity(db, caseId, 'exhibit_deleted', `Exhibit ${exhibitId} removed`, userId, user?.full_name ?? '');
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to delete exhibit', code: 'EXHIBIT_DELETE_ERROR' }, 500);
  }
});

// POST /:caseId/exhibits/:exhibitId/custody — chain-of-custody transfer
// Appends to the chain_of_custody JSON array on the exhibit.
forensics.post('/:caseId/exhibits/:exhibitId/custody', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('caseId'), 10);
    const exhibitId = parseInt(c.req.param('exhibitId'), 10);
    if (isNaN(caseId) || isNaN(exhibitId)) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
    const userId = c.get('userId') as number;
    const { to_name, reason, notes } = await c.req.json<{
      to_name?: string; reason?: string; notes?: string;
    }>();
    if (!to_name) return c.json({ error: 'to_name required', code: 'TO_NAME_REQUIRED' }, 400);

    const exhibit = await queryFirst<{ chain_of_custody: string | null }>(
      db,
      'SELECT chain_of_custody FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?',
      exhibitId, caseId,
    );
    if (!exhibit) return c.json({ error: 'Exhibit not found', code: 'NOT_FOUND' }, 404);

    const chain = parseJsonCol<Array<Record<string, unknown>>>(exhibit.chain_of_custody, []);
    const fromName = chain.length > 0 ? (chain[chain.length - 1] as any).to : null;
    const user = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', userId);
    chain.push({
      at: new Date().toISOString(),
      from: fromName,
      to: to_name,
      reason: reason ?? 'transfer',
      notes: notes ?? '',
      by_id: userId,
      by_name: user?.full_name ?? '',
    });

    await execute(
      db,
      `UPDATE forensic_exhibits SET chain_of_custody = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
      JSON.stringify(chain), exhibitId,
    );

    await logActivity(db, caseId, 'custody_transferred',
      `${fromName ?? '—'} → ${to_name}${reason ? ` (${reason})` : ''}`,
      userId, user?.full_name ?? '', exhibitId);

    return c.json({ data: { exhibit_id: exhibitId, chain_length: chain.length, latest: chain[chain.length - 1] } }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to record custody transfer', code: 'CUSTODY_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// ANALYSES
// ═══════════════════════════════════════════════════════════════

forensics.get('/:caseId/analyses', async (c) => {
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('caseId'), 10);
    if (isNaN(caseId)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT fa.*, u.full_name as examiner_name, fe.exhibit_number
       FROM forensic_analyses fa
       LEFT JOIN users u ON fa.examiner_id = u.id
       LEFT JOIN forensic_exhibits fe ON fa.exhibit_id = fe.id
       WHERE fa.forensic_case_id = ?
       ORDER BY fa.created_at DESC`,
      caseId,
    );
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to list analyses', code: 'ANALYSES_LIST_ERROR' }, 500);
  }
});

forensics.post('/:caseId/analyses', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('caseId'), 10);
    if (isNaN(caseId)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();

    if (typeof b.analysis_type !== 'string' || !ANALYSIS_TYPES.has(b.analysis_type)) {
      return c.json({ error: 'analysis_type required and must be a valid type', code: 'ANALYSIS_TYPE_REQUIRED' }, 400);
    }
    const status = typeof b.status === 'string' && ANALYSIS_STATUSES.has(b.status) ? b.status : 'pending';

    const result = await execute(
      db,
      `INSERT INTO forensic_analyses (
         forensic_case_id, exhibit_id, analysis_type, methodology, equipment_used,
         examiner_id, status, started_at, completed_at,
         results, conclusion, limitations, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      caseId, b.exhibit_id ?? null, b.analysis_type,
      b.methodology ?? null, b.equipment_used ?? null,
      b.examiner_id ?? userId, status,
      b.started_at ?? null, b.completed_at ?? null,
      b.results ?? null, b.conclusion ?? null, b.limitations ?? null, b.notes ?? null,
    );
    const newId = Number(result.meta.last_row_id);

    const user = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', userId);
    await logActivity(db, caseId, 'analysis_added', `${b.analysis_type} analysis (status=${status})`, userId, user?.full_name ?? '');

    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM forensic_analyses WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to add analysis', code: 'ANALYSIS_POST_ERROR' }, 500);
  }
});

const ANALYSIS_UPDATABLE = new Set([
  'exhibit_id', 'methodology', 'equipment_used', 'examiner_id',
  'status', 'started_at', 'completed_at',
  'results', 'conclusion', 'limitations', 'notes',
]);

forensics.put('/:caseId/analyses/:analysisId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('caseId'), 10);
    const analysisId = parseInt(c.req.param('analysisId'), 10);
    if (isNaN(caseId) || isNaN(analysisId)) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);

    const existing = await queryFirst<{ id: number; status: string }>(
      db, 'SELECT id, status FROM forensic_analyses WHERE id = ? AND forensic_case_id = ?', analysisId, caseId,
    );
    if (!existing) return c.json({ error: 'Analysis not found', code: 'NOT_FOUND' }, 404);

    const b = await c.req.json<Record<string, unknown>>();
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) {
      if (!ANALYSIS_UPDATABLE.has(k)) continue;
      if (k === 'status' && (typeof v !== 'string' || !ANALYSIS_STATUSES.has(v))) continue;
      sets.push(`${k} = ?`);
      vals.push(v ?? null);
    }

    // Auto-set completed_at on completion
    if (
      (b.status === 'completed' || b.status === 'inconclusive') &&
      existing.status !== 'completed' && existing.status !== 'inconclusive'
    ) {
      sets.push(`completed_at = COALESCE(completed_at, datetime('now','localtime'))`);
    }

    if (sets.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS' }, 400);
    sets.push(`updated_at = datetime('now','localtime')`);
    vals.push(analysisId);

    await execute(db, `UPDATE forensic_analyses SET ${sets.join(', ')} WHERE id = ?`, ...vals);

    const userId = c.get('userId') as number;
    const user = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', userId);
    await logActivity(db, caseId, 'analysis_updated', `Analysis ${analysisId} (${Object.keys(b).filter((k) => ANALYSIS_UPDATABLE.has(k)).join(', ')})`, userId, user?.full_name ?? '');

    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM forensic_analyses WHERE id = ?', analysisId);
    return c.json({ data: updated });
  } catch (err) {
    return c.json({ error: 'Failed to update analysis', code: 'ANALYSIS_PUT_ERROR' }, 500);
  }
});

forensics.delete('/:caseId/analyses/:analysisId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('caseId'), 10);
    const analysisId = parseInt(c.req.param('analysisId'), 10);
    if (isNaN(caseId) || isNaN(analysisId)) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
    const result = await execute(
      db, 'DELETE FROM forensic_analyses WHERE id = ? AND forensic_case_id = ?', analysisId, caseId,
    );
    if (result.meta.changes === 0) return c.json({ error: 'Analysis not found', code: 'NOT_FOUND' }, 404);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to delete analysis', code: 'ANALYSIS_DELETE_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// ACTIVITY / AUDIT
// ═══════════════════════════════════════════════════════════════

forensics.get('/:caseId/activity', async (c) => {
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('caseId'), 10);
    if (isNaN(caseId)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') || '100', 10) || 100));
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT fal.*, u.full_name as performed_by_full_name
       FROM forensic_activity_log fal
       LEFT JOIN users u ON fal.performed_by = u.id
       WHERE fal.forensic_case_id = ?
       ORDER BY fal.performed_at DESC, fal.id DESC
       LIMIT ?`,
      caseId, limit,
    );
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to get activity log', code: 'ACTIVITY_GET_ERROR' }, 500);
  }
});

// GET /:caseId/exhibits/:exhibitId/custody-audit — combined view:
// chain_of_custody JSON + activity log entries scoped to that exhibit.
forensics.get('/:caseId/exhibits/:exhibitId/custody-audit', async (c) => {
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('caseId'), 10);
    const exhibitId = parseInt(c.req.param('exhibitId'), 10);
    if (isNaN(caseId) || isNaN(exhibitId)) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);

    const exhibit = await queryFirst<{ chain_of_custody: string | null }>(
      db,
      'SELECT chain_of_custody FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?',
      exhibitId, caseId,
    );
    if (!exhibit) return c.json({ error: 'Exhibit not found', code: 'NOT_FOUND' }, 404);

    const chain = parseJsonCol<unknown[]>(exhibit.chain_of_custody, []);
    const activity = await query<Record<string, unknown>>(
      db,
      `SELECT fal.*, u.full_name as performed_by_full_name
       FROM forensic_activity_log fal
       LEFT JOIN users u ON fal.performed_by = u.id
       WHERE fal.forensic_case_id = ? AND fal.exhibit_id = ?
       ORDER BY fal.performed_at DESC`,
      caseId, exhibitId,
    );
    return c.json({ data: { exhibit_id: exhibitId, chain_of_custody: chain, activity } });
  } catch (err) {
    return c.json({ error: 'Failed to get custody audit', code: 'CUSTODY_AUDIT_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════

forensics.get('/export/csv', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const dateFrom = c.req.query('date_from');
    const dateTo = c.req.query('date_to');
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    if (dateFrom) { where.push('fc.received_date >= ?'); params.push(dateFrom); }
    if (dateTo) { where.push('fc.received_date <= ?'); params.push(dateTo); }

    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT fc.lab_number, fc.case_type, fc.status, fc.priority, fc.title,
              fc.requesting_agency, fc.requesting_officer,
              u.full_name as lead_examiner, fc.linked_incident_number, fc.linked_case_number,
              fc.received_date, fc.due_date, fc.completed_date, fc.released_date,
              (SELECT COUNT(*) FROM forensic_exhibits WHERE forensic_case_id = fc.id) as exhibit_count,
              (SELECT COUNT(*) FROM forensic_analyses WHERE forensic_case_id = fc.id) as analysis_count
       FROM forensic_cases fc
       LEFT JOIN users u ON fc.lead_examiner_id = u.id
       WHERE ${where.join(' AND ')}
       ORDER BY fc.received_date DESC LIMIT 10000`,
      ...params,
    );

    const headers = [
      { key: 'lab_number', label: 'Lab #' },
      { key: 'case_type', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'priority', label: 'Priority' },
      { key: 'title', label: 'Title' },
      { key: 'requesting_agency', label: 'Agency' },
      { key: 'requesting_officer', label: 'Officer' },
      { key: 'lead_examiner', label: 'Examiner' },
      { key: 'linked_incident_number', label: 'Incident #' },
      { key: 'linked_case_number', label: 'Case #' },
      { key: 'received_date', label: 'Received' },
      { key: 'due_date', label: 'Due' },
      { key: 'completed_date', label: 'Completed' },
      { key: 'released_date', label: 'Released' },
      { key: 'exhibit_count', label: 'Exhibits' },
      { key: 'analysis_count', label: 'Analyses' },
    ];
    const head = headers.map((h) => csvEscape(h.label)).join(',');
    const body = rows.map((r) => headers.map((h) => csvEscape(r[h.key])).join(',')).join('\n');
    const csv = `${head}\n${body}\n`;
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="forensics_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    return c.json({ error: 'Failed to export forensics cases', code: 'EXPORT_ERROR' }, 500);
  }
});

export default forensics;
