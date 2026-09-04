// ============================================================
// RMPG Flex — Generic form-draft persistence ("filler" autosave)
// ============================================================
// D1-backed replacement for the old localStorage-only autosave
// (client/src/utils/formAutoSave.ts). One row per (user, formId,
// entityId) in-progress edit — cross-device, survives reloads, and
// is only deleted after the caller confirms the real record saved.
//
//   GET    /:formId/:entityId?   -> {data: {...} | null}
//   PUT    /:formId/:entityId?   body: {data: {...}}  -> upsert
//   DELETE /:formId/:entityId?   -> clear draft after successful save
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, queryFirst, execute } from '../utils/db';

const formDrafts = new Hono<Env>();

const DEFAULT_ENTITY = 'new';

async function ensureTable(db: ReturnType<typeof getDb>) {
  await execute(db, `CREATE TABLE IF NOT EXISTS form_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    form_id TEXT NOT NULL,
    entity_id TEXT NOT NULL DEFAULT 'new',
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_form_drafts_unique ON form_drafts(user_id, form_id, entity_id)`);
}

formDrafts.get('/:formId/:entityId?', async (c) => {
  const db = getDb(c.env);
  await ensureTable(db);
  const userId = c.get('userId') as number | undefined;
  const formId = c.req.param('formId');
  const entityId = c.req.param('entityId') || DEFAULT_ENTITY;

  const row = await queryFirst<{ data: string; updated_at: string }>(
    db,
    'SELECT data, updated_at FROM form_drafts WHERE user_id = ? AND form_id = ? AND entity_id = ?',
    userId, formId, entityId
  );

  if (!row) return c.json({ data: null });
  try {
    return c.json({ data: JSON.parse(row.data), updatedAt: row.updated_at });
  } catch {
    return c.json({ data: null });
  }
});

formDrafts.put('/:formId/:entityId?', async (c) => {
  const db = getDb(c.env);
  await ensureTable(db);
  const userId = c.get('userId') as number | undefined;
  const formId = c.req.param('formId');
  const entityId = c.req.param('entityId') || DEFAULT_ENTITY;
  const body = await c.req.json().catch(() => ({}));

  if (body.data === undefined) {
    return c.json({ error: 'data is required' }, 400);
  }

  const json = JSON.stringify(body.data);
  await execute(
    db,
    `INSERT INTO form_drafts (user_id, form_id, entity_id, data, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, form_id, entity_id)
     DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
    userId, formId, entityId, json
  );

  return c.json({ success: true });
});

// Only call this after the real record has been confirmed saved —
// callers must not clear the draft speculatively before the save
// response comes back, or a failed save silently loses the entry.
formDrafts.delete('/:formId/:entityId?', async (c) => {
  const db = getDb(c.env);
  await ensureTable(db);
  const userId = c.get('userId') as number | undefined;
  const formId = c.req.param('formId');
  const entityId = c.req.param('entityId') || DEFAULT_ENTITY;

  await execute(
    db,
    'DELETE FROM form_drafts WHERE user_id = ? AND form_id = ? AND entity_id = ?',
    userId, formId, entityId
  );

  return c.json({ success: true });
});

export default formDrafts;
