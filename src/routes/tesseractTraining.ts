// ============================================================
// RMPG Flex — Tesseract Training Setup Portal
// ============================================================
// Lets admin/manager users browse existing serve_intake_documents that
// already have real OCR output, correct that text into verified ground
// truth, and submit the pair into the TESSERACT_TRAINING R2 bucket —
// building the labeled corpus a future manual `tesstrain` run needs.
// See docs/superpowers/specs/2026-08-09-tesseract-training-portal-design.md.
//
// Does NOT trigger fine-tuning itself — that stays a manual, local,
// operator-run process (per the design's non-goals).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, columnExists } from '../utils/db';
import { getDecrypted } from '../utils/encryptedR2';
import { clampIntParam } from '../utils/paginationParams';
import { zipSync, strToU8 } from 'fflate';
import { log, logErrorToDb } from '../utils/logger';
import {
  corpusObjectExt,
  isTesstrainRasterKey,
  pageNumberFromRasterKey,
  rasterExtFromKey,
} from '../utils/tesseractTrainingCorpus';

const tesseractTraining = new Hono<Env>();

function requireAdminManager(c: any): boolean {
  const user = c.get('user');
  return !!user && ['admin', 'manager'].includes(user.role);
}

// Hono's `c.executionCtx` getter THROWS (rather than returning undefined) when
// no ExecutionContext was ever set on the request — the case in every plain
// Node/vitest mock app used by this file's tests, as opposed to a real Workers
// runtime where it's always present. logErrorToDb()'s ctx param is optional,
// so this just needs to swallow that specific access failure, not the
// underlying error being logged.
function safeExecutionCtx(c: any): any {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

let boxPageColumnEnsured = false;
async function ensureBoxPageNumberColumn(db: ReturnType<typeof getDb>): Promise<void> {
  if (boxPageColumnEnsured) return;
  if (!(await columnExists(db, 'tesseract_box_annotations', 'page_number'))) {
    try {
      await db.prepare(
        `ALTER TABLE tesseract_box_annotations ADD COLUMN page_number INTEGER NOT NULL DEFAULT 1`,
      ).run();
    } catch {
      // Duplicate column on a racing second isolate — the column is there.
    }
  }
  boxPageColumnEnsured = true;
}

interface DocRow {
  id: number;
  file_name: string;
  file_type: string;
  r2_key: string;
  raw_text: string | null;
  doc_type: string | null;
  created_at: string;
}

interface StatsRow {
  doc_type: string | null;
  eligible: number;
  labeled: number;
  approved: number;
}

// GET /api/tesseract-training/stats
tesseractTraining.get('/stats', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const db = getDb(c.env);
  const byDocType = await query<StatsRow>(
    db,
    `SELECT d.doc_type AS doc_type,
            COUNT(*) AS eligible,
            SUM(CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END) AS labeled,
            SUM(CASE WHEN t.approval_status = 'approved' THEN 1 ELSE 0 END) AS approved
       FROM serve_intake_documents d
       LEFT JOIN tesseract_training_corpus t ON t.serve_intake_document_id = d.id
      WHERE d.status = 'extracted'
      GROUP BY d.doc_type`,
  );
  const totals = byDocType.reduce(
    (acc, r) => ({
      total_eligible: acc.total_eligible + r.eligible,
      total_labeled: acc.total_labeled + r.labeled,
      total_approved: acc.total_approved + r.approved,
    }),
    { total_eligible: 0, total_labeled: 0, total_approved: 0 },
  );
  return c.json({ ...totals, by_doc_type: byDocType });
});

// GET /api/tesseract-training/documents?page=1
tesseractTraining.get('/documents', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const db = getDb(c.env);
  const page = clampIntParam(c.req.query('page'), 1, 1, 100000);
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  const docType = c.req.query('doc_type');
  const labeled = c.req.query('labeled');
  const from = c.req.query('from');
  const to = c.req.query('to');

  const conditions = [`d.status = 'extracted'`];
  const args: unknown[] = [];
  if (docType === 'null') {
    conditions.push('d.doc_type IS NULL');
  } else if (docType) {
    conditions.push('d.doc_type = ?');
    args.push(docType);
  }
  if (labeled === 'true') {
    conditions.push('t.id IS NOT NULL');
  } else if (labeled === 'false') {
    conditions.push('t.id IS NULL');
  }
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    conditions.push('d.created_at >= ?');
    args.push(from);
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    conditions.push('d.created_at <= ?');
    args.push(to);
  }

  const rows = await query<DocRow & { already_in_corpus: number; approval_status: string | null }>(
    db,
    `SELECT d.id, d.file_name, d.file_type, d.doc_type, d.created_at,
            CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END AS already_in_corpus,
            t.approval_status AS approval_status
       FROM serve_intake_documents d
       LEFT JOIN tesseract_training_corpus t ON t.serve_intake_document_id = d.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?`,
    ...args, pageSize, offset,
  );

  return c.json({
    rows: rows.map((r) => ({ ...r, already_in_corpus: !!r.already_in_corpus })),
    page, pageSize,
  });
});

interface TrainingRunRow {
  id: number;
  generated_at: string;
  generated_by: number;
  document_count: number;
}

// GET /api/tesseract-training/documents/runs?page=1
// Registered BEFORE /documents/:id so the static "runs" segment can never be
// swallowed by the :id param matcher.
tesseractTraining.get('/documents/runs', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const db = getDb(c.env);
  const page = clampIntParam(c.req.query('page'), 1, 1, 100000);
  const pageSize = 20;
  const offset = (page - 1) * pageSize;
  const rows = await query<TrainingRunRow>(
    db,
    `SELECT id, generated_at, generated_by, document_count
       FROM tesseract_training_runs
      ORDER BY generated_at DESC
      LIMIT ? OFFSET ?`,
    pageSize, offset,
  );
  return c.json({ rows, page, pageSize });
});

// GET /api/tesseract-training/documents/runs/:id/download
tesseractTraining.get('/documents/runs/:id/download', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const run = await queryFirst<{ r2_key: string }>(
    db,
    `SELECT r2_key FROM tesseract_training_runs WHERE id = ?`,
    id,
  );
  if (!run) return c.json({ error: 'Not found' }, 404);
  const obj = await c.env.TESSERACT_TRAINING.get(run.r2_key);
  if (!obj) {
    // D1 row exists but the R2 object it points at is gone — a real
    // drift/data-integrity condition, not a mere "unknown id" 404. Log it
    // so a vanished training package leaves a trace instead of looking
    // identical to a bad request.
    const traceId = c.get('traceId');
    log.error('[tesseract-training] run R2 object missing', {
      route: 'GET /tesseract-training/documents/runs/:id/download',
      runId: id,
      r2Key: run.r2_key,
      traceId,
    });
    logErrorToDb(c.env.DB, {
      severity: 'error',
      category: 'route',
      message: `tesseract_training_runs row ${id} points at missing R2 object ${run.r2_key}`,
      details: { route: 'GET /tesseract-training/documents/runs/:id/download', runId: id, r2Key: run.r2_key },
      traceId,
      source: 'GET /tesseract-training/documents/runs/:id/download',
      statusCode: 404,
    }, safeExecutionCtx(c));
    return c.json({ error: 'Package missing in R2' }, 404);
  }
  return new Response(obj.body ?? (await obj.arrayBuffer()), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="rmpg-training-${id}.zip"`,
    },
  });
});

// GET /api/tesseract-training/documents/:id
tesseractTraining.get('/documents/:id', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const doc = await queryFirst<DocRow>(
    db,
    `SELECT id, file_name, file_type, r2_key, raw_text, doc_type, created_at
       FROM serve_intake_documents WHERE id = ?`,
    id,
  );
  if (!doc) return c.json({ error: 'Not found' }, 404);
  const corpusRow = await queryFirst<{ id: number; approval_status: string }>(
    db,
    `SELECT id, approval_status FROM tesseract_training_corpus WHERE serve_intake_document_id = ?`,
    id,
  );
  return c.json({ ...doc, already_in_corpus: !!corpusRow, approval_status: corpusRow?.approval_status ?? null });
});

// GET /api/tesseract-training/documents/:id/image
// Same decrypt-then-legacy-fallback pattern as
// src/routes/serveIntake.ts:1387-1424 (GET /documents/:docId/file) — a
// genuine decrypt failure THROWS rather than falling back, since that
// indicates real corruption, not the expected legacy-object case.
tesseractTraining.get('/documents/:id/image', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const doc = await queryFirst<{ r2_key: string; file_type: string; file_name: string }>(
    db,
    'SELECT r2_key, file_type, file_name FROM serve_intake_documents WHERE id = ?',
    id,
  );
  if (!doc?.r2_key) return c.json({ error: 'Not found' }, 404);
  const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env, doc.r2_key);
  if (decrypted) {
    return new Response(decrypted.bytes, {
      headers: {
        'Content-Type': doc.file_type || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${(doc.file_name || 'document').replace(/"/g, '')}"`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  }
  const legacy = await c.env.UPLOADS.get(doc.r2_key);
  if (!legacy) return c.json({ error: 'File missing in R2' }, 404);
  return new Response(legacy.body, {
    headers: {
      'Content-Type': doc.file_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${(doc.file_name || 'document').replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
});

// Shared by the single-submit route below and the bulk-submit route. Writes the
// document's image + ground truth to TESSERACT_TRAINING R2, then inserts the
// D1 row ONLY after both R2 writes succeed (see Global Constraints — never
// record "this exists" before storage actually has it). Returns a discriminated
// result rather than throwing, so bulk-submit can continue past one failure.
async function submitDocumentToCorpus(
  c: any, id: number, userId: number, groundTruthText: string,
): Promise<{ success: true } | { success: false; error: string; code: string; status: number; detail?: string }> {
  const db = getDb(c.env);
  const existing = await queryFirst<{ id: number }>(
    db,
    `SELECT id FROM tesseract_training_corpus WHERE serve_intake_document_id = ?`,
    id,
  );
  if (existing) {
    return { success: false, error: 'Document already in training corpus', code: 'ALREADY_SUBMITTED', status: 409 };
  }

  const trimmed = groundTruthText.trim();
  if (!trimmed) {
    return { success: false, error: 'ground_truth_text is required', code: 'MISSING_TEXT', status: 400 };
  }

  const doc = await queryFirst<{ r2_key: string; file_type: string }>(
    db,
    'SELECT r2_key, file_type FROM serve_intake_documents WHERE id = ?',
    id,
  );
  if (!doc?.r2_key) {
    return { success: false, error: 'Not found', code: 'NOT_FOUND', status: 404 };
  }

  const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env, doc.r2_key);
  let imageBytes: Uint8Array | ArrayBuffer;
  if (decrypted) {
    imageBytes = decrypted.bytes;
  } else {
    const legacy = await c.env.UPLOADS.get(doc.r2_key);
    if (!legacy) {
      return { success: false, error: 'Source file missing in R2', code: 'SOURCE_MISSING', status: 404 };
    }
    imageBytes = await legacy.arrayBuffer();
  }

  const ext = corpusObjectExt(doc.file_type);

  const traceId = c.get('traceId');
  try {
    await c.env.TESSERACT_TRAINING.put(`training-corpus/${id}/image${ext}`, imageBytes, {
      httpMetadata: { contentType: doc.file_type || 'application/octet-stream' },
    });
    await c.env.TESSERACT_TRAINING.put(`training-corpus/${id}/ground-truth.txt`, trimmed, {
      httpMetadata: { contentType: 'text/plain' },
    });
  } catch (err) {
    log.error('[tesseract-training] failed to write training pair to R2', {
      route: 'submitDocumentToCorpus', documentId: id, traceId,
    }, err as Error);
    logErrorToDb(c.env.DB, {
      severity: 'error',
      category: 'route',
      message: err instanceof Error ? err.message : String(err),
      details: { route: 'submitDocumentToCorpus', documentId: id },
      traceId,
      source: 'submitDocumentToCorpus',
      statusCode: 500,
    }, safeExecutionCtx(c));
    return {
      success: false,
      error: 'Failed to write training pair to R2',
      code: 'R2_WRITE_FAILED',
      status: 500,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // The R2 pair above is now written — if this insert fails, that pair is
  // orphaned (exists in storage with no corpus row pointing at it). Log it
  // as an error rather than letting it fail silently, since the caller's
  // only signal otherwise would be a generic thrown exception.
  try {
    await execute(
      db,
      `INSERT INTO tesseract_training_corpus (serve_intake_document_id, added_by) VALUES (?, ?)`,
      id, userId,
    );
  } catch (err) {
    log.error('[tesseract-training] training pair written to R2 but D1 insert failed — orphaned R2 objects', {
      route: 'submitDocumentToCorpus', documentId: id, traceId,
    }, err as Error);
    logErrorToDb(c.env.DB, {
      severity: 'error',
      category: 'route',
      message: err instanceof Error ? err.message : String(err),
      details: { route: 'submitDocumentToCorpus', documentId: id, orphanedR2: true },
      traceId,
      source: 'submitDocumentToCorpus',
      statusCode: 500,
    }, safeExecutionCtx(c));
    return {
      success: false,
      error: 'Training pair saved but failed to record — contact an admin',
      code: 'CORPUS_INSERT_FAILED',
      status: 500,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  return { success: true };
}

// POST /api/tesseract-training/documents/:id/submit
// Body: { ground_truth_text: string }
tesseractTraining.post('/documents/:id/submit', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  let body: { ground_truth_text?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const result = await submitDocumentToCorpus(c, id, user.id, body.ground_truth_text ?? '');
  if (!result.success) {
    return c.json({ error: result.error, code: result.code, detail: result.detail }, result.status as any);
  }
  return c.json({ success: true, document_id: id });
});

// POST /api/tesseract-training/documents/bulk-submit
// Body: { document_ids: number[] } — max 100 per call (D1 bound-parameter cap,
// CLAUDE.md gotcha #20). Each document's EXISTING raw_text is used verbatim as
// ground truth — this is the "already correct, just accept it" path; per-document
// text correction stays the single-submit route's job. One failing document does
// not abort the rest.
tesseractTraining.post('/documents/bulk-submit', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const user = c.get('user');

  let body: { document_ids?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const ids = body.document_ids;
  if (!Array.isArray(ids) || !ids.every((v) => typeof v === 'number')) {
    return c.json({ error: 'document_ids must be an array of numbers' }, 400);
  }
  if (ids.length > 100) {
    return c.json({ error: 'document_ids exceeds the 100-item limit per call', code: 'TOO_MANY_IDS' }, 400);
  }

  const db = getDb(c.env);
  const results: Array<{ id: number; success: boolean; error?: string; detail?: string }> = [];
  for (const id of ids) {
    const doc = await queryFirst<{ raw_text: string | null }>(
      db,
      'SELECT raw_text FROM serve_intake_documents WHERE id = ?',
      id,
    );
    if (!doc) {
      results.push({ id, success: false, error: 'Not found' });
      continue;
    }
    const result = await submitDocumentToCorpus(c, id, user.id, doc.raw_text ?? '');
    results.push(
      result.success
        ? { id, success: true }
        : { id, success: false, error: result.error, detail: result.detail },
    );
  }
  return c.json({ results });
});

// POST /api/tesseract-training/documents/:id/approve
// Single-person approval: any admin/manager, including the original submitter.
// Idempotent — approving an already-approved document is a 200 no-op, not an error.
tesseractTraining.post('/documents/:id/approve', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  const db = getDb(c.env);
  const existing = await queryFirst<{ id: number; approval_status: string }>(
    db,
    `SELECT id, approval_status FROM tesseract_training_corpus WHERE serve_intake_document_id = ?`,
    id,
  );
  if (!existing) {
    return c.json({ error: 'Document is not in the training corpus', code: 'NOT_SUBMITTED' }, 404);
  }
  if (existing.approval_status === 'approved') {
    return c.json({ success: true, already_approved: true });
  }

  try {
    await execute(
      db,
      `UPDATE tesseract_training_corpus SET approval_status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE serve_intake_document_id = ?`,
      user.id, id,
    );
  } catch (err) {
    const traceId = c.get('traceId');
    log.error('[tesseract-training] approve update failed', {
      route: 'POST /tesseract-training/documents/:id/approve', documentId: id, traceId,
    }, err as Error);
    logErrorToDb(c.env.DB, {
      severity: 'error',
      category: 'route',
      message: err instanceof Error ? err.message : String(err),
      details: { route: 'POST /tesseract-training/documents/:id/approve', documentId: id },
      traceId,
      source: 'POST /tesseract-training/documents/:id/approve',
      statusCode: 500,
    }, safeExecutionCtx(c));
    return c.json({ error: 'Failed to approve document', code: 'APPROVE_FAILED' }, 500);
  }
  return c.json({ success: true });
});

interface BoxRow {
  id: number;
  serve_intake_document_id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  corrected_text: string;
  page_number: number;
  created_at: string;
}

// GET /api/tesseract-training/documents/:id/boxes
tesseractTraining.get('/documents/:id/boxes', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  await ensureBoxPageNumberColumn(db);
  const boxes = await query<BoxRow>(
    db,
    `SELECT id, serve_intake_document_id, x0, y0, x1, y1, corrected_text,
            COALESCE(page_number, 1) AS page_number, created_at
       FROM tesseract_box_annotations WHERE serve_intake_document_id = ? ORDER BY created_at ASC`,
    id,
  );
  return c.json({ boxes });
});

// POST /api/tesseract-training/documents/:id/boxes
// Body: { x0, y0, x1, y1, corrected_text, page_number? }
tesseractTraining.post('/documents/:id/boxes', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  let body: { x0?: number; y0?: number; x1?: number; y1?: number; corrected_text?: string; page_number?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const { x0, y0, x1, y1 } = body;
  const correctedText = (body.corrected_text ?? '').trim();
  const pageNumber = Number.isFinite(body.page_number) ? Math.max(1, Math.floor(body.page_number as number)) : 1;
  if (
    typeof x0 !== 'number' || typeof y0 !== 'number' ||
    typeof x1 !== 'number' || typeof y1 !== 'number' ||
    !correctedText
  ) {
    return c.json({ error: 'x0, y0, x1, y1, and corrected_text are all required' }, 400);
  }

  const db = getDb(c.env);
  await ensureBoxPageNumberColumn(db);
  try {
    const result = await execute(
      db,
      `INSERT INTO tesseract_box_annotations (serve_intake_document_id, x0, y0, x1, y1, corrected_text, created_by, page_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, x0, y0, x1, y1, correctedText, user.id, pageNumber,
    );
    return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) {
    const traceId = c.get('traceId');
    log.error('[tesseract-training] box insert failed', {
      route: 'POST /tesseract-training/documents/:id/boxes', documentId: id, traceId,
    }, err as Error);
    logErrorToDb(c.env.DB, {
      severity: 'error',
      category: 'route',
      message: err instanceof Error ? err.message : String(err),
      details: { route: 'POST /tesseract-training/documents/:id/boxes', documentId: id },
      traceId,
      source: 'POST /tesseract-training/documents/:id/boxes',
      statusCode: 500,
    }, safeExecutionCtx(c));
    return c.json({ error: 'Failed to save box annotation', code: 'BOX_INSERT_FAILED' }, 500);
  }
});

// DELETE /api/tesseract-training/documents/:id/boxes/:boxId
tesseractTraining.delete('/documents/:id/boxes/:boxId', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const id = parseInt(c.req.param('id'), 10);
  const boxId = parseInt(c.req.param('boxId'), 10);
  if (isNaN(id) || isNaN(boxId)) return c.json({ error: 'Invalid boxId' }, 400);
  const db = getDb(c.env);
  const result = await execute(
    db,
    `DELETE FROM tesseract_box_annotations WHERE id = ? AND serve_intake_document_id = ?`,
    boxId, id,
  );
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

// GET /api/tesseract-training/documents/:id/notes
tesseractTraining.get('/documents/:id/notes', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const row = await queryFirst<{ strokes_json: string }>(
    db,
    `SELECT strokes_json FROM tesseract_review_annotations WHERE serve_intake_document_id = ?`,
    id,
  );
  let strokes: unknown = null;
  if (row) { try { strokes = JSON.parse(row.strokes_json); } catch { strokes = null; } }
  return c.json({ strokes });
});

// PUT /api/tesseract-training/documents/:id/notes
// Body: { strokes: Array<{ tool: string; points: number[][]; color: string }> }
// Review notes only — NEVER read by any training path (see migration 0233
// header comment). Whole layer replaced on each save.
tesseractTraining.put('/documents/:id/notes', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  let body: { strokes?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  if (!Array.isArray(body.strokes)) {
    return c.json({ error: 'strokes must be an array' }, 400);
  }

  const db = getDb(c.env);
  try {
    await execute(
      db,
      `INSERT INTO tesseract_review_annotations (serve_intake_document_id, strokes_json, updated_by)
       VALUES (?, ?, ?)
       ON CONFLICT(serve_intake_document_id) DO UPDATE SET
         strokes_json = excluded.strokes_json,
         updated_by = excluded.updated_by,
         updated_at = datetime('now')`,
      id, JSON.stringify(body.strokes), user.id,
    );
  } catch (err) {
    const traceId = c.get('traceId');
    log.error('[tesseract-training] notes upsert failed', {
      route: 'PUT /tesseract-training/documents/:id/notes', documentId: id, traceId,
    }, err as Error);
    logErrorToDb(c.env.DB, {
      severity: 'error',
      category: 'route',
      message: err instanceof Error ? err.message : String(err),
      details: { route: 'PUT /tesseract-training/documents/:id/notes', documentId: id },
      traceId,
      source: 'PUT /tesseract-training/documents/:id/notes',
      statusCode: 500,
    }, safeExecutionCtx(c));
    return c.json({ error: 'Failed to save review notes', code: 'NOTES_SAVE_FAILED' }, 500);
  }
  return c.json({ success: true });
});

// POST /api/tesseract-training/documents/:id/raster-pages
// Multipart: one or more `page` files (JPEG/PNG) + matching `page_number` fields.
// Tesstrain cannot train on a PDF binary; the portal rasterizes pages in the
// browser after submit and mirrors them next to ground-truth.txt.
tesseractTraining.post('/documents/:id/raster-pages', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  const db = getDb(c.env);
  const inCorpus = await queryFirst<{ id: number }>(
    db,
    `SELECT id FROM tesseract_training_corpus WHERE serve_intake_document_id = ?`,
    id,
  );
  if (!inCorpus) {
    return c.json({ error: 'Document is not in the training corpus', code: 'NOT_SUBMITTED' }, 404);
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'Expected multipart form data' }, 400);
  }

  const files: File[] = [];
  for (const v of form.getAll('page')) {
    if (typeof v === 'string' || v == null) continue;
    files.push(v as File);
  }
  const numbers = form.getAll('page_number').map((v) => parseInt(String(v), 10));
  if (files.length === 0) {
    return c.json({ error: 'At least one page file is required', code: 'MISSING_PAGES' }, 400);
  }
  if (files.length > 20) {
    return c.json({ error: 'Too many pages in one upload', code: 'TOO_MANY_PAGES' }, 400);
  }

  const written: number[] = [];
  const traceId = c.get('traceId');
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pageNum = Number.isFinite(numbers[i]) && numbers[i] >= 1 ? numbers[i] : i + 1;
      const type = (file.type || '').toLowerCase();
      const ext = type.includes('png') ? 'png' : 'jpg';
      const bytes = new Uint8Array(await file.arrayBuffer());
      const key = `training-corpus/${id}/page-${String(pageNum).padStart(3, '0')}.${ext}`;
      await c.env.TESSERACT_TRAINING.put(key, bytes, {
        httpMetadata: { contentType: file.type || 'image/jpeg' },
      });
      written.push(pageNum);
    }
  } catch (err) {
    log.error('[tesseract-training] raster page write failed', {
      route: 'POST /tesseract-training/documents/:id/raster-pages', documentId: id, traceId,
    }, err as Error);
    logErrorToDb(c.env.DB, {
      severity: 'error',
      category: 'route',
      message: err instanceof Error ? err.message : String(err),
      details: { route: 'POST /tesseract-training/documents/:id/raster-pages', documentId: id },
      traceId,
      source: 'POST /tesseract-training/documents/:id/raster-pages',
      statusCode: 500,
    }, safeExecutionCtx(c));
    return c.json({ error: 'Failed to write raster pages to R2', code: 'R2_WRITE_FAILED' }, 500);
  }
  return c.json({ success: true, pages: written });
});

// POST /api/tesseract-training/documents/runs
// Bundles every approved tesseract_training_corpus document into a
// tesstrain-ready zip (image + ground-truth pairs, exactly the shape
// tesstrain's GROUND_TRUTH_DIR expects) and saves it to R2. Does NOT run
// tesstrain itself — that stays a manual, local, operator-run process.
tesseractTraining.post('/documents/runs', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const user = c.get('user');
  const db = getDb(c.env);

  const approved = await query<{ serve_intake_document_id: number }>(
    db,
    `SELECT serve_intake_document_id FROM tesseract_training_corpus WHERE approval_status = 'approved'`,
  );
  if (approved.length === 0) {
    return c.json({ error: 'No approved documents to package', code: 'NOTHING_TO_TRAIN' }, 400);
  }

  const zipEntries: Record<string, Uint8Array> = {};
  const includedIds: number[] = [];
  for (const { serve_intake_document_id: docId } of approved) {
    const listed = await c.env.TESSERACT_TRAINING.list({ prefix: `training-corpus/${docId}/` });
    const gtKey = listed.objects.find((o: { key: string }) => o.key.endsWith('/ground-truth.txt'))?.key;
    if (!gtKey) continue;
    const gtObj = await c.env.TESSERACT_TRAINING.get(gtKey);
    if (!gtObj) continue;
    const gtBytes = new Uint8Array(await gtObj.arrayBuffer());

    const rasterKeys = listed.objects
      .map((o: { key: string }) => o.key)
      .filter((key: string) => isTesstrainRasterKey(key));
    const pageKeys = rasterKeys.filter((key: string) => pageNumberFromRasterKey(key) != null);
    const imageKey = rasterKeys.find((key: string) => /\/image\.(png|jpe?g|tif|tiff)$/i.test(key));

    const keysToPack = pageKeys.length > 0 ? pageKeys : (imageKey ? [imageKey] : []);
    if (keysToPack.length === 0) continue;

    let packed = 0;
    for (const key of keysToPack) {
      const imgObj = await c.env.TESSERACT_TRAINING.get(key);
      if (!imgObj) continue;
      const ext = rasterExtFromKey(key);
      const pageNum = pageNumberFromRasterKey(key);
      const stem = pageNum != null ? `${docId}_p${pageNum}` : String(docId);
      zipEntries[`rmpg-ground-truth/${stem}.${ext}`] = new Uint8Array(await imgObj.arrayBuffer());
      zipEntries[`rmpg-ground-truth/${stem}.gt.txt`] = gtBytes;
      packed += 1;
    }
    if (packed > 0) includedIds.push(docId);
  }
  if (includedIds.length === 0) {
    return c.json({ error: 'No approved documents to package', code: 'NOTHING_TO_TRAIN' }, 400);
  }

  const generatedAt = new Date().toISOString();
  const readme = `# RMPG Flex — Tesseract Training Package

Generated: ${generatedAt}
Documents included: ${includedIds.length}

## To train

1. Clone tesstrain if you haven't already:
   git clone https://github.com/tesseract-ocr/tesstrain.git
   cd tesstrain

2. Extract this package's rmpg-ground-truth/ folder into tesstrain's data/ directory:
   data/rmpg-ground-truth/

3. Run training (requires the stock \`eng\` traineddata as the starting point):
   make training MODEL_NAME=rmpg START_MODEL=eng TESSDATA=/usr/share/tesseract-ocr/5/tessdata GROUND_TRUTH_DIR=data/rmpg-ground-truth

4. The resulting data/rmpg.traineddata is the fine-tuned model. Upload it to:
   rmpg-flex-tesseract-training/models/latest/tesseract.traineddata
   (this is the R2 key scripts/fetch-tesseract-model.sh looks for on the next deploy)
`;
  zipEntries['README.md'] = strToU8(readme);

  const zipped = zipSync(zipEntries);
  const r2Key = `training-runs/${Date.now()}/package.zip`;

  try {
    await c.env.TESSERACT_TRAINING.put(r2Key, zipped, {
      httpMetadata: { contentType: 'application/zip' },
    });

    const result = await execute(
      db,
      `INSERT INTO tesseract_training_runs (generated_by, document_count, document_ids_json, r2_key) VALUES (?, ?, ?, ?)`,
      user.id, includedIds.length, JSON.stringify(includedIds), r2Key,
    );
    return c.json({ id: result.meta.last_row_id, document_count: includedIds.length });
  } catch (err) {
    const traceId = c.get('traceId');
    log.error('[tesseract-training] training run package build failed', {
      route: 'POST /tesseract-training/documents/runs',
      documentCount: includedIds.length,
      traceId,
    }, err as Error);
    logErrorToDb(c.env.DB, {
      severity: 'error',
      category: 'route',
      message: err instanceof Error ? err.message : String(err),
      details: { route: 'POST /tesseract-training/documents/runs', documentCount: includedIds.length },
      traceId,
      source: 'POST /tesseract-training/documents/runs',
      statusCode: 500,
    }, safeExecutionCtx(c));
    return c.json({ error: 'Failed to save training package', code: 'PACKAGE_BUILD_FAILED' }, 500);
  }
});

export default tesseractTraining;
