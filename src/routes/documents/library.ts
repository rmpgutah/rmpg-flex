// ============================================================
// RMPG Flex — Documents Library (Cloudflare Worker)
// ============================================================
// Authored, formatted, reopenable documents (Phase 2 of the
// dispatch-notes work). DISTINCT from /api/documents (file
// folders) and /api/company-documents (policy docs). Mounted at
// /api/docs. Body is Phase-1 markdown-marker text.
//
// Tables (migration 0104): documents, document_revisions,
// document_links. Lifecycle: draft -> finalized (locked) ->
// reopen -> draft. Every save snapshots a revision row.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { requireRole } from '../../middleware/auth';
import { containsAnyClause } from '../../utils/searchText';

const lib = new Hono<Env>();

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];
const ADMIN_ROLES = ['admin', 'manager'];

type Actor = { id: number; username: string; role: string; full_name?: string };
const actorOf = (c: any): Actor | undefined => c.get('user') as Actor | undefined;

function canModify(doc: { owner_username: string | null }, actor?: Actor): boolean {
  if (!actor) return false;
  if (ADMIN_ROLES.includes(actor.role)) return true;
  return !!doc.owner_username && doc.owner_username === actor.username;
}

async function logActivity(c: any, action: string, id: number, details: unknown) {
  try {
    await execute(getDb(c.env),
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES (?, ?, 'documents', ?, ?, ?)`,
      (c.get('userId') as number | undefined) ?? null, action, id,
      typeof details === 'string' ? details : JSON.stringify(details ?? ''),
      c.req.header('CF-Connecting-IP') || 'unknown');
  } catch { /* audit best-effort */ }
}

const linksFor = (c: any, docId: number) => query(getDb(c.env),
  `SELECT id, document_id, target_type, target_id, linked_by, linked_at
   FROM document_links WHERE document_id = ? ORDER BY linked_at`, docId);

// Parse a positive-integer path param; returns null if invalid (→ 400 by caller).
const intParam = (v: string | undefined): number | null => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// All routes require an operational role (officers included — they author narratives).
lib.use('*', requireRole(...READ_ROLES));

// ── List ──────────────────────────────────────────────────────
lib.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const actor = actorOf(c);
    const sp = new URL(c.req.url).searchParams;
    const q = sp.get('q');
    const status = sp.get('status');
    const mine = sp.get('mine');
    const targetType = sp.get('target_type');
    const targetId = sp.get('target_id');
    const limit = Math.min(parseInt(sp.get('limit') || '100', 10) || 100, 500);
    const offset = parseInt(sp.get('offset') || '0', 10) || 0;

    const where: string[] = ['d.deleted_at IS NULL'];
    const whereParams: unknown[] = [];
    if (q) { const _m = containsAnyClause(['d.title']); where.push(_m.sql); whereParams.push(..._m.binds(q)); }
    if (status) {
      if (status !== 'draft' && status !== 'finalized') {
        return c.json({ error: 'status must be draft|finalized', code: 'DOC_BAD_STATUS' }, 400);
      }
      where.push('d.status = ?'); whereParams.push(status);
    }
    if (mine === 'true' && actor?.username) { where.push('d.owner_username = ?'); whereParams.push(actor.username); }

    const joinParams: unknown[] = [];
    let join = '';
    if ((targetType === 'call' || targetType === 'incident') && targetId) {
      join = 'JOIN document_links dl ON dl.document_id = d.id AND dl.target_type = ? AND dl.target_id = ?';
      joinParams.push(targetType, Number(targetId));
    }

    const rows = await query(db,
      `SELECT d.id, d.title, d.status, d.body_format, d.owner_id, d.owner_username,
              d.revision, d.created_at, d.updated_at, d.finalized_at, d.finalized_by
       FROM documents d ${join}
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(d.updated_at, d.created_at) DESC
       LIMIT ? OFFSET ?`,
      ...joinParams, ...whereParams, limit, offset);
    return c.json({ data: rows });
  } catch (err) {
    console.error('List documents error:', err);
    return c.json({ error: 'Failed to list documents', code: 'DOC_LIST_ERROR' }, 500);
  }
});

// ── Create ────────────────────────────────────────────────────
lib.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const actor = actorOf(c);
    const body = await c.req.json().catch(() => ({} as any));
    const title = String(body.title || '').trim();
    if (!title) return c.json({ error: 'Title is required', code: 'DOC_TITLE_REQUIRED' }, 400);
    const text = typeof body.body === 'string' ? body.body : '';

    const res = await execute(db,
      `INSERT INTO documents (title, body, body_format, status, owner_id, owner_username, revision, updated_at)
       VALUES (?, ?, 'markdown', 'draft', ?, ?, 1, datetime('now'))`,
      title, text, actor?.id ?? null, actor?.username ?? null);
    const id = Number(res.meta.last_row_id);

    await execute(db,
      `INSERT INTO document_revisions (document_id, revision_number, title, body, body_format, saved_by, saved_by_username, change_note)
       VALUES (?, 1, ?, ?, 'markdown', ?, ?, ?)`,
      id, title, text, actor?.id ?? null, actor?.username ?? null, body.change_note ?? 'created');

    if (Array.isArray(body.links)) {
      for (const l of body.links) {
        if (l && (l.target_type === 'call' || l.target_type === 'incident') && l.target_id != null) {
          await execute(db,
            `INSERT OR IGNORE INTO document_links (document_id, target_type, target_id, linked_by)
             VALUES (?, ?, ?, ?)`,
            id, l.target_type, Number(l.target_id), actor?.id ?? null);
        }
      }
    }
    await logActivity(c, 'CREATE', id, { title });
    const doc = await queryFirst(db, 'SELECT * FROM documents WHERE id = ?', id);
    const links = await linksFor(c, id);
    return c.json({ success: true, data: { ...(doc as object), links } });
  } catch (err) {
    console.error('Create document error:', err);
    return c.json({ error: 'Failed to create document', code: 'DOC_CREATE_ERROR' }, 500);
  }
});

// ── Revision detail (register BEFORE /:id so static segments win) ──
lib.get('/:id/revisions/:rev', async (c) => {
  const db = getDb(c.env);
  const id = intParam(c.req.param('id'));
  if (id == null) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
  const rev = intParam(c.req.param('rev'));
  if (rev == null) return c.json({ error: 'Invalid rev', code: 'INVALID_REV' }, 400);
  const row = await queryFirst(db,
    'SELECT * FROM document_revisions WHERE document_id = ? AND revision_number = ?', id, rev);
  if (!row) return c.json({ error: 'Revision not found', code: 'DOC_REV_NOT_FOUND' }, 404);
  return c.json({ data: row });
});

lib.get('/:id/revisions', async (c) => {
  const db = getDb(c.env);
  const id = intParam(c.req.param('id'));
  if (id == null) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
  const rows = await query(db,
    `SELECT id, revision_number, title, saved_by, saved_by_username, saved_at, change_note
     FROM document_revisions WHERE document_id = ? ORDER BY revision_number DESC`, id);
  return c.json({ data: rows });
});

lib.post('/:id/revisions/:rev/restore', async (c) => {
  try {
    const db = getDb(c.env);
    const actor = actorOf(c);
    const id = intParam(c.req.param('id'));
    if (id == null) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const rev = intParam(c.req.param('rev'));
    if (rev == null) return c.json({ error: 'Invalid rev', code: 'INVALID_REV' }, 400);
    const doc = await queryFirst<any>(db, 'SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', id);
    if (!doc) return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404);
    if (!canModify(doc, actor)) return c.json({ error: 'Forbidden', code: 'DOC_FORBIDDEN' }, 403);
    if (doc.status === 'finalized') return c.json({ error: 'Document is finalized; reopen to edit', code: 'DOC_FINALIZED' }, 409);
    const old = await queryFirst<any>(db, 'SELECT * FROM document_revisions WHERE document_id = ? AND revision_number = ?', id, rev);
    if (!old) return c.json({ error: 'Revision not found', code: 'DOC_REV_NOT_FOUND' }, 404);
    const nextRev = (doc.revision || 1) + 1;
    await execute(db,
      `UPDATE documents SET title = ?, body = ?, revision = ?, updated_at = datetime('now') WHERE id = ?`,
      old.title, old.body, nextRev, id);
    await execute(db,
      `INSERT INTO document_revisions (document_id, revision_number, title, body, body_format, saved_by, saved_by_username, change_note)
       VALUES (?, ?, ?, ?, 'markdown', ?, ?, ?)`,
      id, nextRev, old.title, old.body, actor?.id ?? null, actor?.username ?? null, `restored from r${rev}`);
    await logActivity(c, 'RESTORE', id, { from: rev, to: nextRev });
    const updated = await queryFirst(db, 'SELECT * FROM documents WHERE id = ?', id);
    const links = await linksFor(c, id);
    return c.json({ success: true, data: { ...(updated as object), links } });
  } catch (err) {
    console.error('Restore revision error:', err);
    return c.json({ error: 'Failed to restore revision', code: 'DOC_RESTORE_ERROR' }, 500);
  }
});

// ── Finalize / Reopen ─────────────────────────────────────────
lib.post('/:id/finalize', async (c) => {
  const db = getDb(c.env);
  const actor = actorOf(c);
  const id = intParam(c.req.param('id'));
  if (id == null) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
  const doc = await queryFirst<any>(db, 'SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', id);
  if (!doc) return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404);
  if (!canModify(doc, actor)) return c.json({ error: 'Forbidden', code: 'DOC_FORBIDDEN' }, 403);
  if (doc.status !== 'finalized') {
    await execute(db,
      `UPDATE documents SET status = 'finalized', finalized_at = datetime('now'), finalized_by = ? WHERE id = ?`,
      actor?.username ?? null, id);
    await logActivity(c, 'FINALIZE', id, {});
  }
  const updated = await queryFirst(db, 'SELECT * FROM documents WHERE id = ?', id);
  const links = await linksFor(c, id);
  return c.json({ success: true, data: { ...(updated as object), links } });
});

lib.post('/:id/reopen', async (c) => {
  const db = getDb(c.env);
  const actor = actorOf(c);
  const id = intParam(c.req.param('id'));
  if (id == null) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
  const doc = await queryFirst<any>(db, 'SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', id);
  if (!doc) return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404);
  if (!canModify(doc, actor)) return c.json({ error: 'Forbidden', code: 'DOC_FORBIDDEN' }, 403);
  if (doc.status === 'finalized') {
    await execute(db,
      `UPDATE documents SET status = 'draft', reopened_at = datetime('now'), reopened_by = ? WHERE id = ?`,
      actor?.username ?? null, id);
    await logActivity(c, 'REOPEN', id, {});
  }
  const updated = await queryFirst(db, 'SELECT * FROM documents WHERE id = ?', id);
  const links = await linksFor(c, id);
  return c.json({ success: true, data: { ...(updated as object), links } });
});

// ── Links ─────────────────────────────────────────────────────
// Collaborative metadata: any operational role may link (see DELETE note below).
lib.post('/:id/links', async (c) => {
  const db = getDb(c.env);
  const actor = actorOf(c);
  const id = intParam(c.req.param('id'));
  if (id == null) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
  const body = await c.req.json().catch(() => ({} as any));
  if (body.target_type !== 'call' && body.target_type !== 'incident') {
    return c.json({ error: 'target_type must be call|incident', code: 'DOC_BAD_TARGET' }, 400);
  }
  if (body.target_id == null) return c.json({ error: 'target_id required', code: 'DOC_BAD_TARGET' }, 400);
  const doc = await queryFirst<any>(db, 'SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL', id);
  if (!doc) return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404);
  await execute(db,
    `INSERT OR IGNORE INTO document_links (document_id, target_type, target_id, linked_by) VALUES (?, ?, ?, ?)`,
    id, body.target_type, Number(body.target_id), actor?.id ?? null);
  await logActivity(c, 'LINK', id, { target_type: body.target_type, target_id: Number(body.target_id) });
  return c.json({ success: true, data: await linksFor(c, id) });
});

// Link management (add/remove) is intentionally available to any operational
// role (gated by the router-level requireRole), NOT owner-gated via canModify:
// attaching/detaching a document to a call is collaborative metadata and must
// remain possible even when the document is finalized (linking != editing content).
lib.delete('/:id/links/:linkId', async (c) => {
  const db = getDb(c.env);
  const id = intParam(c.req.param('id'));
  if (id == null) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
  const linkId = intParam(c.req.param('linkId'));
  if (linkId == null) return c.json({ error: 'Invalid linkId', code: 'INVALID_LINK_ID' }, 400);
  const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM document_links WHERE id = ? AND document_id = ?', linkId, id);
  if (!existing) return c.json({ error: 'Link not found', code: 'DOC_LINK_NOT_FOUND' }, 404);
  await execute(db, 'DELETE FROM document_links WHERE id = ? AND document_id = ?', linkId, id);
  await logActivity(c, 'UNLINK', id, { linkId });
  return c.json({ success: true, data: await linksFor(c, id) });
});

// ── Get one ───────────────────────────────────────────────────
lib.get('/:id', async (c) => {
  const db = getDb(c.env);
  const id = intParam(c.req.param('id'));
  if (id == null) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
  const doc = await queryFirst(db, 'SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', id);
  if (!doc) return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404);
  const links = await linksFor(c, id);
  return c.json({ data: { ...(doc as object), links } });
});

// ── Save ──────────────────────────────────────────────────────
lib.put('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const actor = actorOf(c);
    const id = intParam(c.req.param('id'));
    if (id == null) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const doc = await queryFirst<any>(db, 'SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', id);
    if (!doc) return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404);
    if (!canModify(doc, actor)) return c.json({ error: 'Forbidden', code: 'DOC_FORBIDDEN' }, 403);
    if (doc.status === 'finalized') return c.json({ error: 'Document is finalized; reopen to edit', code: 'DOC_FINALIZED' }, 409);

    const body = await c.req.json().catch(() => ({} as any));
    const nextTitle = body.title !== undefined ? String(body.title).trim() : doc.title;
    if (!nextTitle) return c.json({ error: 'Title is required', code: 'DOC_TITLE_REQUIRED' }, 400);
    const nextBody = body.body !== undefined ? String(body.body) : doc.body;
    const nextRev = (doc.revision || 1) + 1;

    await execute(db,
      `UPDATE documents SET title = ?, body = ?, revision = ?, updated_at = datetime('now') WHERE id = ?`,
      nextTitle, nextBody, nextRev, id);
    await execute(db,
      `INSERT INTO document_revisions (document_id, revision_number, title, body, body_format, saved_by, saved_by_username, change_note)
       VALUES (?, ?, ?, ?, 'markdown', ?, ?, ?)`,
      id, nextRev, nextTitle, nextBody, actor?.id ?? null, actor?.username ?? null, body.change_note ?? null);
    await logActivity(c, 'UPDATE', id, { revision: nextRev });
    const updated = await queryFirst(db, 'SELECT * FROM documents WHERE id = ?', id);
    const links = await linksFor(c, id);
    return c.json({ success: true, data: { ...(updated as object), links } });
  } catch (err) {
    console.error('Save document error:', err);
    return c.json({ error: 'Failed to save document', code: 'DOC_SAVE_ERROR' }, 500);
  }
});

// ── Soft-delete (admin/manager only) ──────────────────────────
lib.delete('/:id', async (c) => {
  const db = getDb(c.env);
  const actor = actorOf(c);
  if (!actor || !ADMIN_ROLES.includes(actor.role)) return c.json({ error: 'Forbidden', code: 'DOC_FORBIDDEN' }, 403);
  const id = intParam(c.req.param('id'));
  if (id == null) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
  const doc = await queryFirst<any>(db, 'SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL', id);
  if (!doc) return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404);
  await execute(db, `UPDATE documents SET deleted_at = datetime('now') WHERE id = ?`, id);
  await logActivity(c, 'DELETE', id, {});
  return c.json({ success: true });
});

export default lib;
