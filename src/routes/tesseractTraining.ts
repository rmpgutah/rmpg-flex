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
import { getDb, query, queryFirst, execute } from '../utils/db';
import { getDecrypted } from '../utils/encryptedR2';
import { clampIntParam } from '../utils/paginationParams';

const tesseractTraining = new Hono<Env>();

function requireAdminManager(c: any): boolean {
  const user = c.get('user');
  return !!user && ['admin', 'manager'].includes(user.role);
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

  const rows = await query<DocRow & { already_in_corpus: number; approval_status: string | null }>(
    db,
    `SELECT d.id, d.file_name, d.file_type, d.doc_type, d.created_at,
            CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END AS already_in_corpus,
            t.approval_status AS approval_status
       FROM serve_intake_documents d
       LEFT JOIN tesseract_training_corpus t ON t.serve_intake_document_id = d.id
      WHERE d.status = 'extracted'
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?`,
    pageSize, offset,
  );

  return c.json({
    rows: rows.map((r) => ({ ...r, already_in_corpus: !!r.already_in_corpus })),
    page, pageSize,
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
  const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, doc.r2_key);
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

  const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, doc.r2_key);
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

  const ext = (doc.file_type || '').includes('png') ? '.png'
    : (doc.file_type || '').includes('jpeg') ? '.jpg'
    : '.bin';

  try {
    await c.env.TESSERACT_TRAINING.put(`training-corpus/${id}/image${ext}`, imageBytes, {
      httpMetadata: { contentType: doc.file_type || 'application/octet-stream' },
    });
    await c.env.TESSERACT_TRAINING.put(`training-corpus/${id}/ground-truth.txt`, trimmed, {
      httpMetadata: { contentType: 'text/plain' },
    });
  } catch (err) {
    return {
      success: false,
      error: 'Failed to write training pair to R2',
      code: 'R2_WRITE_FAILED',
      status: 500,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  await execute(
    db,
    `INSERT INTO tesseract_training_corpus (serve_intake_document_id, added_by) VALUES (?, ?)`,
    id, userId,
  );
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

  await execute(
    db,
    `UPDATE tesseract_training_corpus SET approval_status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE serve_intake_document_id = ?`,
    user.id, id,
  );
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
  const boxes = await query<BoxRow>(
    db,
    `SELECT id, serve_intake_document_id, x0, y0, x1, y1, corrected_text, created_at
       FROM tesseract_box_annotations WHERE serve_intake_document_id = ? ORDER BY created_at ASC`,
    id,
  );
  return c.json({ boxes });
});

// POST /api/tesseract-training/documents/:id/boxes
// Body: { x0, y0, x1, y1, corrected_text }
tesseractTraining.post('/documents/:id/boxes', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  let body: { x0?: number; y0?: number; x1?: number; y1?: number; corrected_text?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const { x0, y0, x1, y1 } = body;
  const correctedText = (body.corrected_text ?? '').trim();
  if (
    typeof x0 !== 'number' || typeof y0 !== 'number' ||
    typeof x1 !== 'number' || typeof y1 !== 'number' ||
    !correctedText
  ) {
    return c.json({ error: 'x0, y0, x1, y1, and corrected_text are all required' }, 400);
  }

  const db = getDb(c.env);
  const result = await execute(
    db,
    `INSERT INTO tesseract_box_annotations (serve_intake_document_id, x0, y0, x1, y1, corrected_text, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, x0, y0, x1, y1, correctedText, user.id,
  );
  return c.json({ success: true, id: result.meta.last_row_id });
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
  return c.json({ strokes: row ? JSON.parse(row.strokes_json) : null });
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
  return c.json({ success: true });
});

export default tesseractTraining;
