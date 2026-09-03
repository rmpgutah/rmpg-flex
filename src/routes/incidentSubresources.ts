// ============================================================
// RMPG Flex — Incident Sub-Resources (Hono / lean API)
// Spillman-Flex NIBRS attachments that hang off an incident:
//   GET/POST            /api/incidents/:id/offenses
//   DELETE              /api/incidents/:id/offenses/:oid
//   GET/POST            /api/incidents/:id/officers      (POST upserts)
//   DELETE              /api/incidents/:id/officers/:oid
//   GET/POST            /api/incidents/:id/links
//   DELETE              /api/incidents/:id/links/:lid
//   GET/POST            /api/incidents/:id/supplements
//   GET/PUT/DELETE      /api/incidents/:id/supplements/:sid
//
// Why a separate router (not folded into incidents.ts): these were the
// endpoints the IncidentsPage NIBRS panels called that legacy either
// 404'd (officers) or 500'd against a MINIMAL live schema (offenses
// lacked ucr_code/nibrs_code/counts/...; links omitted the NOT-NULL
// added_by). Migration 0064 widened the three tables; these handlers
// read/write the widened columns. The numeric `{\\d+}` id constraints
// keep /:id/supplements/:sid from shadowing the dv/pursuit string
// suffixes served by incidentSupplements.ts (registered separately).
// ============================================================
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { log } from '../utils/logger';

const incidentSub = new Hono<Env>();

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];
const WRITE_ROLES = ['admin', 'manager', 'supervisor', 'officer'];
const DELETE_ROLES = ['admin', 'manager', 'supervisor'];

// Resolve + validate the parent incident id. Returns the parsed id or a
// JSON error Response the caller should return verbatim.
async function requireIncident(c: any): Promise<{ id: number } | { err: Response }> {
  const id = parseInt(c.req.param('id') || '', 10);
  if (!Number.isFinite(id) || id <= 0) return { err: c.json({ error: 'Invalid incident id', code: 'INVALID_ID' }, 400) };
  const row = await queryFirst(getDb(c.env), 'SELECT id FROM incidents WHERE id = ?', id);
  if (!row) return { err: c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404) };
  return { id };
}

// ────────────────────────────────────────────────────────────
// Offenses
// ────────────────────────────────────────────────────────────
incidentSub.get('/:id{\\d+}/offenses', requireRole(...READ_ROLES), async (c) => {
  try {
    const inc = await requireIncident(c);
    if ('err' in inc) return inc.err;
    const rows = await query(getDb(c.env),
      'SELECT * FROM incident_offenses WHERE incident_id = ? ORDER BY id ASC', inc.id);
    return c.json(rows);
  } catch (err) {
    log.error('[incidentSub] offenses list', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to list offenses', code: 'OFFENSE_LIST_ERR' }, 500);
  }
});

incidentSub.post('/:id{\\d+}/offenses', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const inc = await requireIncident(c);
    if ('err' in inc) return inc.err;
    const userId = (c.get('userId') as number | undefined) ?? null;
    const body = await c.req.json<Record<string, any>>().catch(() => ({} as Record<string, any>));
    const offense_code = String(body.offense_code ?? '').trim();
    const description = String(body.description ?? '').trim();
    if (!offense_code || !description) {
      return c.json({ error: 'offense_code and description are required', code: 'OFFENSE_MISSING_FIELDS' }, 400);
    }
    const counts = Number.isFinite(Number(body.counts)) ? Math.max(1, Math.trunc(Number(body.counts))) : 1;
    const result = await execute(getDb(c.env), `
      INSERT INTO incident_offenses
        (incident_id, offense_code, description, offense_level, ucr_code, nibrs_code,
         attempted_completed, counts, weapon_force, notes, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      inc.id, offense_code, description,
      body.offense_level ?? 'other', body.ucr_code ?? null, body.nibrs_code ?? null,
      body.attempted_completed ?? 'completed', counts, body.weapon_force ?? null,
      body.notes ?? null, userId);
    const created = await queryFirst(getDb(c.env), 'SELECT * FROM incident_offenses WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) {
    log.error('[incidentSub] offense create', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to add offense', code: 'OFFENSE_CREATE_ERR' }, 500);
  }
});

incidentSub.delete('/:id{\\d+}/offenses/:oid{\\d+}', requireRole(...DELETE_ROLES), async (c) => {
  try {
    const incidentId = parseInt(c.req.param('id') || '', 10);
    const oid = parseInt(c.req.param('oid') || '', 10);
    const existing = await queryFirst(getDb(c.env), 'SELECT id FROM incident_offenses WHERE id = ? AND incident_id = ?', oid, incidentId);
    if (!existing) return c.json({ error: 'Offense not found', code: 'OFFENSE_NOT_FOUND' }, 404);
    await execute(getDb(c.env), 'DELETE FROM incident_offenses WHERE id = ?', oid);
    return c.json({ success: true });
  } catch (err) {
    log.error('[incidentSub] offense delete', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to delete offense', code: 'OFFENSE_DELETE_ERR' }, 500);
  }
});

// ────────────────────────────────────────────────────────────
// Responding officers (POST upserts on (incident_id, officer_id))
// ────────────────────────────────────────────────────────────
incidentSub.get('/:id{\\d+}/officers', requireRole(...READ_ROLES), async (c) => {
  try {
    const inc = await requireIncident(c);
    if ('err' in inc) return inc.err;
    const rows = await query(getDb(c.env), `
      SELECT io.*,
             COALESCE(NULLIF(u.first_name, ''), u.full_name) AS first_name,
             COALESCE(u.last_name, '') AS last_name,
             u.full_name, u.badge_number, u.rank
      FROM incident_officers io
      LEFT JOIN users u ON u.id = io.officer_id
      WHERE io.incident_id = ? ORDER BY io.id ASC`, inc.id);
    return c.json(rows);
  } catch (err) {
    log.error('[incidentSub] officers list', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to list officers', code: 'OFFICER_LIST_ERR' }, 500);
  }
});

incidentSub.post('/:id{\\d+}/officers', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const inc = await requireIncident(c);
    if ('err' in inc) return inc.err;
    const body = await c.req.json<Record<string, any>>().catch(() => ({} as Record<string, any>));
    const officerId = parseInt(String(body.officer_id ?? ''), 10);
    if (!Number.isFinite(officerId) || officerId <= 0) {
      return c.json({ error: 'officer_id is required', code: 'OFFICER_ID_REQUIRED' }, 400);
    }
    const db = getDb(c.env);
    const existing: any = await queryFirst(db, 'SELECT id FROM incident_officers WHERE incident_id = ? AND officer_id = ?', inc.id, officerId);
    if (existing) {
      await execute(db, `
        UPDATE incident_officers SET role = ?, arrived_at = ?, departed_at = ?, action_taken = ?, notes = ?
        WHERE id = ?`,
        body.role ?? 'responding', body.arrived_at ?? null, body.departed_at ?? null,
        body.action_taken ?? null, body.notes ?? null, existing.id);
      const updated = await queryFirst(db, 'SELECT * FROM incident_officers WHERE id = ?', existing.id);
      return c.json({ ...(updated as object), updated_existing: true });
    }
    const result = await execute(db, `
      INSERT INTO incident_officers (incident_id, officer_id, role, arrived_at, departed_at, action_taken, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      inc.id, officerId, body.role ?? 'responding', body.arrived_at ?? null,
      body.departed_at ?? null, body.action_taken ?? null, body.notes ?? null);
    const created = await queryFirst(db, 'SELECT * FROM incident_officers WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) {
    log.error('[incidentSub] officer upsert', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to add officer', code: 'OFFICER_CREATE_ERR' }, 500);
  }
});

incidentSub.delete('/:id{\\d+}/officers/:oid{\\d+}', requireRole(...DELETE_ROLES), async (c) => {
  try {
    const incidentId = parseInt(c.req.param('id') || '', 10);
    const oid = parseInt(c.req.param('oid') || '', 10);
    const existing = await queryFirst(getDb(c.env), 'SELECT id FROM incident_officers WHERE id = ? AND incident_id = ?', oid, incidentId);
    if (!existing) return c.json({ error: 'Officer not found', code: 'OFFICER_NOT_FOUND' }, 404);
    await execute(getDb(c.env), 'DELETE FROM incident_officers WHERE id = ?', oid);
    return c.json({ success: true });
  } catch (err) {
    log.error('[incidentSub] officer delete', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to delete officer', code: 'OFFICER_DELETE_ERR' }, 500);
  }
});

// ────────────────────────────────────────────────────────────
// Cross-reference links
// ────────────────────────────────────────────────────────────
const LINK_TYPES = new Set(['incident', 'call', 'case', 'warrant', 'citation', 'arrest', 'field_interview']);

// Per-type number lookup so the client renders a human reference (e.g.
// "24-RMP-00012") instead of a bare row id. Wrapped in try/catch by the
// caller; a missing table/row leaves detail null and the UI falls back
// to "#<linked_id>".
async function linkDetail(db: any, linkedType: string, linkedId: number): Promise<Record<string, unknown> | null> {
  try {
    switch (linkedType) {
      case 'incident':
        return await queryFirst(db, 'SELECT incident_number, incident_type, status FROM incidents WHERE id = ?', linkedId);
      case 'call':
        return await queryFirst(db, 'SELECT call_number FROM calls_for_service WHERE id = ?', linkedId);
      case 'case':
        return await queryFirst(db, 'SELECT case_number, status FROM cases WHERE id = ?', linkedId);
      case 'warrant':
        return await queryFirst(db, 'SELECT warrant_number, status FROM warrants WHERE id = ?', linkedId);
      case 'citation':
        return await queryFirst(db, 'SELECT citation_number FROM citations WHERE id = ?', linkedId);
      case 'arrest':
        return await queryFirst(db, 'SELECT booking_number FROM arrest_records WHERE id = ?', linkedId);
      default:
        return null;
    }
  } catch { return null; }
}

incidentSub.get('/:id{\\d+}/links', requireRole(...READ_ROLES), async (c) => {
  try {
    const inc = await requireIncident(c);
    if ('err' in inc) return inc.err;
    const db = getDb(c.env);
    const rows = await query<any>(db, 'SELECT * FROM incident_links WHERE incident_id = ? ORDER BY id ASC', inc.id);
    const enriched = await Promise.all(rows.map(async (r) => ({
      ...r, detail: await linkDetail(db, r.linked_type, r.linked_id),
    })));
    return c.json(enriched);
  } catch (err) {
    log.error('[incidentSub] links list', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to list links', code: 'LINK_LIST_ERR' }, 500);
  }
});

incidentSub.post('/:id{\\d+}/links', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const inc = await requireIncident(c);
    if ('err' in inc) return inc.err;
    const userId = (c.get('userId') as number | undefined) ?? null;
    const body = await c.req.json<Record<string, any>>().catch(() => ({} as Record<string, any>));
    const linkedType = String(body.linked_type ?? '').trim();
    const linkedId = parseInt(String(body.linked_id ?? ''), 10);
    if (!LINK_TYPES.has(linkedType)) {
      return c.json({ error: 'linked_type must be one of: ' + [...LINK_TYPES].join(', '), code: 'LINK_BAD_TYPE' }, 400);
    }
    if (!Number.isFinite(linkedId) || linkedId <= 0) {
      return c.json({ error: 'linked_id is required', code: 'LINK_ID_REQUIRED' }, 400);
    }
    const db = getDb(c.env);
    // Guard the UNIQUE(incident_id, linked_type, linked_id) constraint with a
    // friendly 409 instead of a raw D1 constraint error.
    const dup = await queryFirst(db, 'SELECT id FROM incident_links WHERE incident_id = ? AND linked_type = ? AND linked_id = ?', inc.id, linkedType, linkedId);
    if (dup) return c.json({ error: 'That record is already linked', code: 'LINK_DUPLICATE' }, 409);
    const result = await execute(db, `
      INSERT INTO incident_links (incident_id, linked_type, linked_id, link_reason, added_by)
      VALUES (?, ?, ?, ?, ?)`,
      inc.id, linkedType, linkedId, body.link_reason ?? null, userId);
    const created = await queryFirst(db, 'SELECT * FROM incident_links WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) {
    log.error('[incidentSub] link create', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to link record', code: 'LINK_CREATE_ERR' }, 500);
  }
});

incidentSub.delete('/:id{\\d+}/links/:lid{\\d+}', requireRole(...DELETE_ROLES), async (c) => {
  try {
    const incidentId = parseInt(c.req.param('id') || '', 10);
    const lid = parseInt(c.req.param('lid') || '', 10);
    const existing = await queryFirst(getDb(c.env), 'SELECT id FROM incident_links WHERE id = ? AND incident_id = ?', lid, incidentId);
    if (!existing) return c.json({ error: 'Link not found', code: 'LINK_NOT_FOUND' }, 404);
    await execute(getDb(c.env), 'DELETE FROM incident_links WHERE id = ?', lid);
    return c.json({ success: true });
  } catch (err) {
    log.error('[incidentSub] link delete', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to delete link', code: 'LINK_DELETE_ERR' }, 500);
  }
});

// ────────────────────────────────────────────────────────────
// Supplemental reports (free-form, status workflow)
// Stored in supplemental_reports; client `narrative` ↔ column `content`.
// ────────────────────────────────────────────────────────────
const SUPPLEMENT_STATUSES = new Set(['draft', 'submitted', 'approved', 'returned']);

function mapSupplement(row: any): any {
  if (!row) return row;
  // Surface `content` as `narrative` for the client without dropping the
  // raw column (PDF/legacy readers may still want `content`).
  return { ...row, narrative: row.content ?? '' };
}

incidentSub.get('/:id{\\d+}/supplements', requireRole(...READ_ROLES), async (c) => {
  try {
    const inc = await requireIncident(c);
    if ('err' in inc) return inc.err;
    const rows = await query<any>(getDb(c.env), `
      SELECT sr.*, u.full_name AS author_name
      FROM supplemental_reports sr
      LEFT JOIN users u ON u.id = sr.author_id
      WHERE sr.incident_id = ? ORDER BY sr.created_at DESC, sr.id DESC`, inc.id);
    return c.json(rows.map(mapSupplement));
  } catch (err) {
    log.error('[incidentSub] supplements list', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to list supplements', code: 'SUPPLEMENT_LIST_ERR' }, 500);
  }
});

incidentSub.post('/:id{\\d+}/supplements', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const inc = await requireIncident(c);
    if ('err' in inc) return inc.err;
    const userId = (c.get('userId') as number | undefined) ?? null;
    const body = await c.req.json<Record<string, any>>().catch(() => ({} as Record<string, any>));
    const narrative = String(body.narrative ?? body.content ?? '').trim();
    if (!narrative) return c.json({ error: 'narrative is required', code: 'SUPPLEMENT_NARRATIVE_REQUIRED' }, 400);
    const db = getDb(c.env);
    const result = await execute(db, `
      INSERT INTO supplemental_reports (incident_id, author_id, report_type, subject, content, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'draft', datetime('now'), datetime('now'))`,
      inc.id, userId, body.report_type ?? 'supplemental', body.subject ?? null, narrative);
    const newId = Number(result.meta.last_row_id);
    // Derive a stable report number from the row id (YY-SUP-NNNNN).
    const year = new Date().getFullYear().toString().slice(-2);
    const reportNumber = `${year}-SUP-${String(newId).padStart(5, '0')}`;
    await execute(db, 'UPDATE supplemental_reports SET report_number = ? WHERE id = ?', reportNumber, newId);
    const created = await queryFirst(db, `
      SELECT sr.*, u.full_name AS author_name FROM supplemental_reports sr
      LEFT JOIN users u ON u.id = sr.author_id WHERE sr.id = ?`, newId);
    return c.json(mapSupplement(created), 201);
  } catch (err) {
    log.error('[incidentSub] supplement create', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to create supplement', code: 'SUPPLEMENT_CREATE_ERR' }, 500);
  }
});

incidentSub.get('/:id{\\d+}/supplements/:sid{\\d+}', requireRole(...READ_ROLES), async (c) => {
  try {
    const incidentId = parseInt(c.req.param('id') || '', 10);
    const sid = parseInt(c.req.param('sid') || '', 10);
    const row = await queryFirst(getDb(c.env), `
      SELECT sr.*, u.full_name AS author_name FROM supplemental_reports sr
      LEFT JOIN users u ON u.id = sr.author_id WHERE sr.id = ? AND sr.incident_id = ?`, sid, incidentId);
    if (!row) return c.json({ error: 'Supplement not found', code: 'SUPPLEMENT_NOT_FOUND' }, 404);
    return c.json(mapSupplement(row));
  } catch (err) {
    log.error('[incidentSub] supplement get', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to fetch supplement', code: 'SUPPLEMENT_FETCH_ERR' }, 500);
  }
});

incidentSub.put('/:id{\\d+}/supplements/:sid{\\d+}', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const incidentId = parseInt(c.req.param('id') || '', 10);
    const sid = parseInt(c.req.param('sid') || '', 10);
    const db = getDb(c.env);
    const existing: any = await queryFirst(db, 'SELECT id FROM supplemental_reports WHERE id = ? AND incident_id = ?', sid, incidentId);
    if (!existing) return c.json({ error: 'Supplement not found', code: 'SUPPLEMENT_NOT_FOUND' }, 404);
    const body = await c.req.json<Record<string, any>>().catch(() => ({} as Record<string, any>));
    const sets: string[] = []; const vals: unknown[] = [];
    if ('report_type' in body) { sets.push('report_type = ?'); vals.push(body.report_type); }
    if ('subject' in body) { sets.push('subject = ?'); vals.push(body.subject ?? null); }
    if ('narrative' in body || 'content' in body) { sets.push('content = ?'); vals.push(String(body.narrative ?? body.content ?? '')); }
    if ('status' in body) {
      if (!SUPPLEMENT_STATUSES.has(String(body.status))) {
        return c.json({ error: 'Invalid status', code: 'SUPPLEMENT_BAD_STATUS' }, 400);
      }
      // The approval transitions are a supervisory decision — an officer (in
      // WRITE_ROLES) must not be able to sign off their own supplement by
      // PUTting status:'approved'/'returned'. Reserve those for supervisor+.
      const APPROVAL_STATUSES = new Set(['approved', 'returned']);
      if (APPROVAL_STATUSES.has(String(body.status))) {
        const actor = c.get('user') as { role?: string } | undefined;
        if (!actor?.role || !['admin', 'manager', 'supervisor'].includes(actor.role)) {
          return c.json({ error: 'Only a supervisor may approve or return a supplement', code: 'SUPPLEMENT_APPROVAL_FORBIDDEN' }, 403);
        }
      }
      sets.push('status = ?'); vals.push(body.status);
    }
    if (sets.length === 0) {
      const cur = await queryFirst(db, 'SELECT * FROM supplemental_reports WHERE id = ?', sid);
      return c.json(mapSupplement(cur));
    }
    await execute(db, `UPDATE supplemental_reports SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...vals, sid);
    const updated = await queryFirst(db, `
      SELECT sr.*, u.full_name AS author_name FROM supplemental_reports sr
      LEFT JOIN users u ON u.id = sr.author_id WHERE sr.id = ?`, sid);
    return c.json(mapSupplement(updated));
  } catch (err) {
    log.error('[incidentSub] supplement update', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to update supplement', code: 'SUPPLEMENT_UPDATE_ERR' }, 500);
  }
});

incidentSub.delete('/:id{\\d+}/supplements/:sid{\\d+}', requireRole(...DELETE_ROLES), async (c) => {
  try {
    const incidentId = parseInt(c.req.param('id') || '', 10);
    const sid = parseInt(c.req.param('sid') || '', 10);
    const existing = await queryFirst(getDb(c.env), 'SELECT id FROM supplemental_reports WHERE id = ? AND incident_id = ?', sid, incidentId);
    if (!existing) return c.json({ error: 'Supplement not found', code: 'SUPPLEMENT_NOT_FOUND' }, 404);
    await execute(getDb(c.env), 'DELETE FROM supplemental_reports WHERE id = ?', sid);
    return c.json({ success: true });
  } catch (err) {
    log.error('[incidentSub] supplement delete', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to delete supplement', code: 'SUPPLEMENT_DELETE_ERR' }, 500);
  }
});

export default incidentSub;
