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

// GET /api/tesseract-training/documents?page=1
tesseractTraining.get('/documents', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const db = getDb(c.env);
  const page = clampIntParam(c.req.query('page'), 1, 1, 100000);
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  const rows = await query<DocRow & { already_in_corpus: number }>(
    db,
    `SELECT d.id, d.file_name, d.file_type, d.doc_type, d.created_at,
            CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END AS already_in_corpus
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
  const inCorpus = await queryFirst<{ id: number }>(
    db,
    `SELECT id FROM tesseract_training_corpus WHERE serve_intake_document_id = ?`,
    id,
  );
  return c.json({ ...doc, already_in_corpus: !!inCorpus });
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

// POST /api/tesseract-training/documents/:id/submit
// Body: { ground_truth_text: string }
tesseractTraining.post('/documents/:id/submit', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  const existing = await queryFirst<{ id: number }>(
    getDb(c.env),
    `SELECT id FROM tesseract_training_corpus WHERE serve_intake_document_id = ?`,
    id,
  );
  if (existing) {
    return c.json({ error: 'Document already in training corpus', code: 'ALREADY_SUBMITTED' }, 409);
  }

  let body: { ground_truth_text?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const groundTruthText = (body.ground_truth_text ?? '').trim();
  if (!groundTruthText) {
    return c.json({ error: 'ground_truth_text is required' }, 400);
  }

  const db = getDb(c.env);
  const doc = await queryFirst<{ r2_key: string; file_type: string }>(
    db,
    'SELECT r2_key, file_type FROM serve_intake_documents WHERE id = ?',
    id,
  );
  if (!doc?.r2_key) return c.json({ error: 'Not found' }, 404);

  // Fetch the same image bytes the /image route serves (decrypt-then-legacy-
  // fallback), so the corpus copy matches exactly what a reviewer looked at.
  const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, doc.r2_key);
  let imageBytes: Uint8Array | ArrayBuffer;
  if (decrypted) {
    imageBytes = decrypted.bytes;
  } else {
    const legacy = await c.env.UPLOADS.get(doc.r2_key);
    if (!legacy) return c.json({ error: 'Source file missing in R2' }, 404);
    imageBytes = await legacy.arrayBuffer();
  }

  const ext = (doc.file_type || '').includes('png') ? '.png'
    : (doc.file_type || '').includes('jpeg') ? '.jpg'
    : '.bin';

  // TESSERACT_TRAINING writes are plain (unencrypted) — matching the
  // existing convention already shipped in
  // scripts/upload-tesseract-training-pair.ts, which writes via
  // `wrangler r2 object put` with no client-side encryption. Not changed
  // here; see this plan's Global Constraints.
  try {
    await c.env.TESSERACT_TRAINING.put(`training-corpus/${id}/image${ext}`, imageBytes, {
      httpMetadata: { contentType: doc.file_type || 'application/octet-stream' },
    });
    await c.env.TESSERACT_TRAINING.put(`training-corpus/${id}/ground-truth.txt`, groundTruthText, {
      httpMetadata: { contentType: 'text/plain' },
    });
  } catch (err) {
    return c.json({
      error: 'Failed to write training pair to R2',
      code: 'R2_WRITE_FAILED',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }

  // D1 insert happens ONLY after both R2 writes succeed (see Global
  // Constraints — never record "this exists" before storage actually has it).
  await execute(
    db,
    `INSERT INTO tesseract_training_corpus (serve_intake_document_id, added_by) VALUES (?, ?)`,
    id, user.id,
  );

  return c.json({ success: true, document_id: id });
});

export default tesseractTraining;
