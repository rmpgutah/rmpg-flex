// ============================================================
// RMPG Flex — Process Service Intake (Cloudflare Worker)
// ============================================================
// Civil-paper service tracking: subpoenas, summons, evictions, etc.
// Each row in serve_queue is one paper to deliver; serve_attempts is
// the append-only attempt log. Phase 1 RMS port.
//
// Migrations: 0030_serve_intake.sql (queue + attempts + routes + skip_traces),
//             0034_serve_intake_documents.sql (uploaded packet sidecar).
//
// OCR pipeline (replaces the legacy regex parser):
//   PDF  → PDF_TOOLS container (pdftotext, Tesseract fallback)
//        → Workers AI Llama 3.3 70B for structured JSON extraction
//   Image → Workers AI Llama 3.2 Vision (one-pass OCR + extraction)
//   See src/utils/serveIntakeExtract.ts for the schema + prompt.
//
// Endpoints:
//   POST   /scan-document                per-file OCR preview (multipart)
//   POST   /upload                       full packet: R2 + OCR + queue row
//   POST   /intake                       legacy-shape commit (pre-extracted text)
//   GET    /:id/documents                list uploaded files for a queue entry
//   GET    /documents/:docId/file        stream the R2 object inline
//   GET    /stats
//   GET    /                             list queue with filters
//   GET    /:id                          one queue entry + attempts
//   POST   /                             create from structured payload
//   PUT    /:id
//   DELETE /:id                          admin/manager only
//   GET    /:id/attempts
//   POST   /:id/attempts                 log attempt; bumps attempt_count
//   POST   /:id/skip-trace               log address search
//   GET    /routes                       list officer routes
//   POST   /routes
//   GET    /export.csv                   admin/manager export
// ============================================================

import { Hono } from 'hono';
import { getContainer } from '@cloudflare/containers';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import {
  extractFromText,
  extractFromImage,
  extractTextFromPdf,
  fieldsToQueueRow,
  type ExtractionResult,
} from '../utils/serveIntakeExtract';

const si = new Hono<Env>();

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

const PRIORITIES = new Set(['routine', 'normal', 'rush', 'urgent']);
const STATUSES = new Set(['pending', 'assigned', 'in_progress', 'served', 'attempted', 'failed', 'cancelled']);
const ATTEMPT_RESULTS = new Set([
  'served', 'sub_served', 'posted', 'no_answer', 'refused',
  'bad_address', 'moved', 'deceased', 'other',
]);

// ── OCR + upload constants ──────────────────────────────────
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;   // 25 MB per file
const MAX_FILES_PER_UPLOAD = 12;
const PDF_TOOLS_NAME = 'shared';
const INTAKE_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher', 'officer'];

function isPdf(mime: string): boolean { return mime === 'application/pdf'; }
function isImage(mime: string): boolean { return mime.startsWith('image/'); }

async function storeToR2(env: Env['Bindings'], file: File, uploaderId: number | null): Promise<string> {
  const ts = Date.now();
  const safeName = (file.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const key = `serve-intake/${uploaderId ?? 'anon'}/${ts}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
  await env.UPLOADS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
    customMetadata: {
      original_name: file.name || '',
      uploaded_by: String(uploaderId ?? ''),
    },
  });
  return key;
}

// ── POST /scan-document — per-file OCR + extraction preview ──
// Multipart upload from ServeIntakePage's `ocrScanImage` helper. Returns
// the OcrScanResult shape the client renders in its review modal.
// Accepts either an `image` field (used by the in-page handler) or a
// `file` field (used by the bulk upload path). PDF files run through
// the container Tesseract path; images go straight to vision-LLM.
async function scanDocumentHandler(c: any): Promise<Response> {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user || !INTAKE_ROLES.includes(user.role)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  let form: FormData;
  try { form = await c.req.formData(); } catch {
    return c.json({ error: 'Expected multipart/form-data' }, 400);
  }
  const file = (form.get('image') ?? form.get('file') ?? form.get('pdf')) as File | null;
  if (!file || typeof (file as any).arrayBuffer !== 'function') {
    return c.json({ error: 'Missing file (field: image | file | pdf)' }, 400);
  }
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: `File size out of range (0 < n <= ${MAX_UPLOAD_BYTES})` }, 400);
  }

  let extraction: ExtractionResult;
  let pageCount = 0;
  let ocrUsed = false;
  let ocrEngine: string;

  try {
    if (isImage(file.type)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      extraction = await extractFromImage(c.env.AI, bytes);
      ocrEngine = 'workers-ai-vision';
    } else if (isPdf(file.type)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const container = getContainer(c.env.PDF_TOOLS, PDF_TOOLS_NAME);
      const txt = await extractTextFromPdf(container, bytes, file.name || 'doc.pdf');
      pageCount = txt.page_count;
      ocrUsed = txt.ocr_used;
      ocrEngine = ocrUsed ? 'tesseract' : 'pdftotext';
      extraction = await extractFromText(c.env.AI, txt.text);
    } else {
      return c.json({ error: `Unsupported file type: ${file.type}` }, 400);
    }
  } catch (err) {
    return c.json({
      error: 'Extraction failed',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }

  return c.json({
    success: extraction.success,
    documentType: extraction.documentType,
    confidence: extraction.confidence,
    fields: extraction.fields,
    rawText: extraction.rawText,
    allDates: extraction.allDates,
    pageCount,
    ocrUsed,
    ocrEngine,
    model: extraction.model,
    extractionMs: extraction.ms,
    error: extraction.error,
  });
}

si.post('/scan-document', scanDocumentHandler);

// ── POST /upload — full packet: store + OCR + serve_queue row ──
// Accepts multipart with one or more `files[]` entries. For each
// file we (1) write to R2 UPLOADS, (2) extract text via the right
// engine, (3) run LLM field extraction. We then merge fields
// across all uploaded documents (later doc wins for non-empty
// values) and create a single serve_queue row, returning the
// stored document records alongside it.
si.post('/upload', async (c) => {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user || !INTAKE_ROLES.includes(user.role)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  let form: FormData;
  try { form = await c.req.formData(); } catch {
    return c.json({ error: 'Expected multipart/form-data' }, 400);
  }
  // FormData.getAll returns FormDataEntryValue[] which the Workers types
  // model as `string`-only (no File union). Cast through unknown so we
  // can filter for the File-like entries (Workers does deliver File
  // instances at runtime — only the type lib is narrow here).
  const rawEntries = [...form.getAll('files[]'), ...form.getAll('file')] as unknown as Array<File | string>;
  const files: File[] = rawEntries.filter(
    (f): f is File => typeof f === 'object' && f !== null && typeof (f as File).arrayBuffer === 'function' && (f as File).size > 0,
  );
  if (files.length === 0) return c.json({ error: 'No files in request' }, 400);
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return c.json({ error: `Too many files (max ${MAX_FILES_PER_UPLOAD})` }, 400);
  }
  for (const f of files) {
    if (f.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: `${f.name} exceeds ${MAX_UPLOAD_BYTES} bytes` }, 400);
    }
  }

  const db = getDb(c.env);
  const container = getContainer(c.env.PDF_TOOLS, PDF_TOOLS_NAME);
  const documents: any[] = [];
  const mergedFields: Record<string, { value: string; confidence: number }> = {};
  let bestConfidence = 0;
  let bestDocType = 'other';
  const allDates = new Set<string>();

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let extraction: ExtractionResult;
    let pageCount = 0;
    let ocrUsed = false;
    let ocrEngine: string;
    try {
      if (isImage(file.type)) {
        extraction = await extractFromImage(c.env.AI, bytes);
        ocrEngine = 'workers-ai-vision';
      } else if (isPdf(file.type)) {
        const txt = await extractTextFromPdf(container, bytes, file.name || 'doc.pdf');
        pageCount = txt.page_count;
        ocrUsed = txt.ocr_used;
        ocrEngine = ocrUsed ? 'tesseract' : 'pdftotext';
        extraction = await extractFromText(c.env.AI, txt.text);
      } else {
        documents.push({ file_name: file.name, status: 'failed', error: `Unsupported type ${file.type}` });
        continue;
      }
    } catch (err) {
      documents.push({
        file_name: file.name, status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // Persist file to R2 only after we know the extraction succeeded
    // enough to be worth storing. Failed extractions still get an R2
    // copy so the user can re-try with the document later.
    const r2Key = await storeToR2(c.env, file, user.id).catch(() => null);

    const result = await execute(
      db,
      `INSERT INTO serve_intake_documents (
        uploaded_by, file_name, file_type, r2_key, size_bytes, page_count,
        raw_text, ocr_used, ocr_engine, doc_type, fields_json, confidence,
        extraction_model, extraction_ms, status
      ) VALUES (?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?)`,
      user.id, file.name, file.type, r2Key, file.size, pageCount,
      extraction.rawText.slice(0, 200_000),
      ocrUsed ? 1 : 0, ocrEngine,
      extraction.documentType, JSON.stringify(extraction.fields), extraction.confidence,
      extraction.model, extraction.ms,
      extraction.success ? 'extracted' : 'failed',
    );

    documents.push({
      id: result.meta.last_row_id,
      file_name: file.name,
      file_type: file.type,
      r2_key: r2Key,
      page_count: pageCount,
      ocr_used: ocrUsed,
      ocr_engine: ocrEngine,
      doc_type: extraction.documentType,
      confidence: extraction.confidence,
      success: extraction.success,
      model: extraction.model,
      extraction_ms: extraction.ms,
      fields: extraction.fields,
    });

    if (extraction.confidence > bestConfidence) {
      bestConfidence = extraction.confidence;
      bestDocType = extraction.documentType;
    }
    for (const d of extraction.allDates) allDates.add(d);
    // Later-doc-wins merge: keeps the highest-confidence value per field.
    for (const [k, v] of Object.entries(extraction.fields)) {
      const cur = mergedFields[k];
      if (!cur || (v.value && v.confidence > cur.confidence)) {
        mergedFields[k] = v;
      }
    }
  }

  // Create the serve_queue row from merged fields.
  const row = fieldsToQueueRow(mergedFields);
  let queueId: number | null = null;
  if (row.recipient_name || row.recipient_address) {
    const ins = await execute(
      db,
      `INSERT INTO serve_queue (
        recipient_name, recipient_address, recipient_city, recipient_state, recipient_zip,
        document_type, case_number, court_name, jurisdiction,
        client_name, attorney_name, priority, deadline,
        service_instructions, notes, status
      ) VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?)`,
      row.recipient_name, row.recipient_address, row.recipient_city, row.recipient_state, row.recipient_zip,
      row.document_type, row.case_number, row.court_name, row.jurisdiction,
      row.client_name, row.attorney_name, 'normal', row.deadline,
      row.service_instructions, row.notes, 'pending',
    );
    queueId = ins.meta.last_row_id as number;
    // Back-link the document rows to the new queue entry.
    for (const d of documents) {
      if (d.id) await execute(db, 'UPDATE serve_intake_documents SET serve_queue_id = ? WHERE id = ?', queueId, d.id);
    }
  }

  return c.json({
    success: documents.some((d) => d.success),
    serve_queue_id: queueId,
    documents,
    merged: {
      documentType: bestDocType,
      confidence: bestConfidence,
      fields: mergedFields,
      allDates: [...allDates],
      queue_row: row,
    },
  });
});

// ── POST /intake — legacy-shape commit ─────────────────────
// The client's ServeIntakePage.processIntake POSTs already-extracted
// text (the in-browser pdfjs path) here as { documents: [{type,text}] }.
// We run LLM extraction on the concatenated text and create a single
// serve_queue row. Returns the IntakeResult shape the client expects.
si.post('/intake', async (c) => {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user || !INTAKE_ROLES.includes(user.role)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const body = await c.req.json<any>().catch(() => ({}));
  const docs: Array<{ type?: string; text?: string }> = Array.isArray(body.documents) ? body.documents : [];
  if (docs.length === 0) return c.json({ error: 'No documents in request' }, 400);

  const combined = docs.map((d) => `--- ${d.type || 'document'} ---\n${d.text || ''}`).join('\n\n');
  const extraction = await extractFromText(c.env.AI, combined);
  const row = fieldsToQueueRow(extraction.fields);

  let queueId: number | null = null;
  if (row.recipient_name || row.recipient_address) {
    const db = getDb(c.env);
    const ins = await execute(
      db,
      `INSERT INTO serve_queue (
        recipient_name, recipient_address, recipient_city, recipient_state, recipient_zip,
        document_type, case_number, court_name, jurisdiction,
        client_name, attorney_name, priority, deadline,
        service_instructions, notes, status
      ) VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?)`,
      row.recipient_name, row.recipient_address, row.recipient_city, row.recipient_state, row.recipient_zip,
      row.document_type, row.case_number, row.court_name, row.jurisdiction,
      row.client_name, row.attorney_name, 'normal', row.deadline,
      row.service_instructions, row.notes, 'pending',
    );
    queueId = ins.meta.last_row_id as number;
  }

  // Shape mirrors client/src/pages/ServeIntakePage.tsx IntakeResult.
  // person/property/call linking deferred — return nulls so the UI
  // still renders the success card and the operator can drill in.
  const get = (k: string) => (extraction.fields[k]?.value || '').trim();
  return c.json({
    success: extraction.success,
    person_id: null,
    property_id: null,
    call_id: null,
    call_number: null,
    serve_queue_id: queueId,
    latitude: null,
    longitude: null,
    weather: null,
    lighting: null,
    extracted: {
      name: {
        first: get('recipient_first_name'),
        middle: get('recipient_middle_name'),
        last: get('recipient_last_name'),
      },
      dob: get('recipient_dob'),
      address: get('recipient_address'),
      plaintiff: get('plaintiff'),
      court: get('court_name'),
      docs: get('document_type') || get('document_subtype'),
      instructions: get('service_instructions'),
      jobNumber: get('job_number'),
      caseNumber: get('case_number'),
      dueDate: get('service_deadline'),
      attorney: {
        name: get('attorney_name'),
        phone: get('attorney_phone'),
        email: get('attorney_email'),
        bar: get('attorney_bar_number'),
      },
      fee: get('fee_amount'),
      processType: get('process_type'),
      serviceWindows: get('service_windows'),
      deadlineStr: get('service_deadline'),
      serverName: get('server_name'),
    },
    confidence: extraction.confidence,
    documentType: extraction.documentType,
    model: extraction.model,
  });
});

// ── GET /:id/documents — list documents on a queue entry ────
si.get('/:id/documents', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const rows = await query(
    db,
    `SELECT id, file_name, file_type, r2_key, size_bytes, page_count,
            ocr_used, ocr_engine, doc_type, confidence, status,
            extraction_model, extraction_ms, created_at
       FROM serve_intake_documents
      WHERE serve_queue_id = ?
      ORDER BY id DESC`,
    id,
  );
  return c.json(rows);
});

// ── GET /documents/:docId/file — stream the R2 object ───────
si.get('/documents/:docId/file', async (c) => {
  const docId = parseInt(c.req.param('docId'), 10);
  if (isNaN(docId)) return c.json({ error: 'Invalid docId' }, 400);
  const db = getDb(c.env);
  const doc = await queryFirst<{ r2_key: string; file_type: string; file_name: string }>(
    db,
    'SELECT r2_key, file_type, file_name FROM serve_intake_documents WHERE id = ?',
    docId,
  );
  if (!doc?.r2_key) return c.json({ error: 'Not found' }, 404);
  const obj = await c.env.UPLOADS.get(doc.r2_key);
  if (!obj) return c.json({ error: 'File missing in R2' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': doc.file_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${(doc.file_name || 'document').replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
});

// ── GET /stats ──────────────────────────────────────────────
si.get('/stats', async (c) => {
  const db = getDb(c.env);
  const total = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM serve_queue');
  const pending = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM serve_queue WHERE status='pending'");
  const inProgress = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM serve_queue WHERE status IN ('assigned','in_progress','attempted')");
  const served = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM serve_queue WHERE status='served'");
  const overdue = await queryFirst<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM serve_queue WHERE deadline IS NOT NULL AND deadline < datetime('now','localtime') AND status NOT IN ('served','cancelled','failed')",
  );
  return c.json({
    total: total?.n ?? 0,
    pending: pending?.n ?? 0,
    in_progress: inProgress?.n ?? 0,
    served: served?.n ?? 0,
    overdue: overdue?.n ?? 0,
  });
});

// ── GET / — list with filters ───────────────────────────────
si.get('/', async (c) => {
  const db = getDb(c.env);
  const status = c.req.query('status');
  const officerId = c.req.query('officer_id');
  const priority = c.req.query('priority');
  const search = c.req.query('q');
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 500);

  const where: string[] = [];
  const args: any[] = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (officerId) { where.push('officer_id = ?'); args.push(parseInt(officerId, 10)); }
  if (priority) { where.push('priority = ?'); args.push(priority); }
  if (search) {
    where.push('(recipient_name LIKE ? OR case_number LIKE ? OR recipient_address LIKE ?)');
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const sql = `
    SELECT q.*, u.full_name AS officer_name
    FROM serve_queue q
    LEFT JOIN users u ON u.id = q.officer_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY
      CASE q.priority WHEN 'urgent' THEN 1 WHEN 'rush' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
      q.deadline IS NULL, q.deadline ASC, q.id DESC
    LIMIT ?`;
  args.push(limit);
  const rows = await query(db, sql, ...args);
  return c.json(rows);
});

// ── GET /:id ────────────────────────────────────────────────
si.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const row = await queryFirst<any>(
    db,
    `SELECT q.*, u.full_name AS officer_name
     FROM serve_queue q LEFT JOIN users u ON u.id = q.officer_id
     WHERE q.id = ?`,
    id,
  );
  if (!row) return c.json({ error: 'Not found' }, 404);
  const attempts = await query(
    db,
    `SELECT a.*, u.full_name AS officer_name
     FROM serve_attempts a LEFT JOIN users u ON u.id = a.officer_id
     WHERE a.serve_queue_id = ? ORDER BY a.attempt_at DESC`,
    id,
  );
  return c.json({ ...row, attempts });
});

// ── POST / — structured intake (no PDF parsing here) ────────
si.post('/', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<any>().catch(() => ({}));
  const db = getDb(c.env);

  const priority = PRIORITIES.has(body.priority) ? body.priority : 'normal';
  const status = STATUSES.has(body.status) ? body.status : 'pending';

  if (!body.recipient_name && !body.recipient_address) {
    return c.json({ error: 'recipient_name or recipient_address required' }, 400);
  }

  const result = await execute(
    db,
    `INSERT INTO serve_queue (
      call_id, sm_job_id, officer_id, serve_date,
      recipient_name, recipient_person_id, recipient_address, recipient_city,
      recipient_state, recipient_zip, recipient_lat, recipient_lng, property_id,
      document_type, case_number, court_name, jurisdiction,
      client_name, attorney_name, priority, time_window, deadline,
      max_attempts, service_instructions, notes, status
    ) VALUES (?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?)`,
    body.call_id ?? null, body.sm_job_id ?? null, body.officer_id ?? null, body.serve_date ?? null,
    body.recipient_name ?? null, body.recipient_person_id ?? null, body.recipient_address ?? null, body.recipient_city ?? null,
    body.recipient_state ?? null, body.recipient_zip ?? null, body.recipient_lat ?? null, body.recipient_lng ?? null, body.property_id ?? null,
    body.document_type ?? null, body.case_number ?? null, body.court_name ?? null, body.jurisdiction ?? null,
    body.client_name ?? null, body.attorney_name ?? null, priority, body.time_window ?? null, body.deadline ?? null,
    body.max_attempts ?? 3, body.service_instructions ?? null, body.notes ?? null, status,
  );
  return c.json({ success: true, id: result.meta.last_row_id });
});

// ── PUT /:id ────────────────────────────────────────────────
si.put('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  const db = getDb(c.env);

  const allowed = [
    'call_id', 'sm_job_id', 'officer_id', 'serve_date',
    'recipient_name', 'recipient_person_id', 'recipient_address', 'recipient_city',
    'recipient_state', 'recipient_zip', 'recipient_lat', 'recipient_lng', 'property_id',
    'document_type', 'case_number', 'court_name', 'jurisdiction',
    'client_name', 'attorney_name', 'priority', 'time_window', 'deadline',
    'max_attempts', 'service_instructions', 'notes', 'status', 'sort_order',
  ];
  const sets: string[] = [];
  const args: any[] = [];
  for (const k of allowed) {
    if (!(k in body)) continue;
    if (k === 'priority' && body[k] && !PRIORITIES.has(body[k])) continue;
    if (k === 'status' && body[k] && !STATUSES.has(body[k])) continue;
    sets.push(`${k} = ?`);
    args.push(body[k]);
  }
  if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
  sets.push("updated_at = datetime('now','localtime')");
  args.push(id);
  await execute(db, `UPDATE serve_queue SET ${sets.join(', ')} WHERE id = ?`, ...args);
  return c.json({ success: true });
});

// ── DELETE /:id — admin/manager only ────────────────────────
si.delete('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  await execute(db, 'DELETE FROM serve_queue WHERE id = ?', id);
  return c.json({ success: true });
});

// ── GET /:id/attempts ───────────────────────────────────────
si.get('/:id/attempts', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const rows = await query(
    db,
    `SELECT a.*, u.full_name AS officer_name
     FROM serve_attempts a LEFT JOIN users u ON u.id = a.officer_id
     WHERE a.serve_queue_id = ? ORDER BY a.attempt_at DESC`,
    id,
  );
  return c.json(rows);
});

// ── POST /:id/attempts — log + auto-bump counters ───────────
// On 'served' the queue entry promotes to status='served'. On other
// results, attempt_count increments and status flips to 'attempted'
// (or 'failed' once max_attempts is exceeded).
si.post('/:id/attempts', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);

  const queue = await queryFirst<{ attempt_count: number; max_attempts: number; status: string }>(
    db,
    'SELECT attempt_count, max_attempts, status FROM serve_queue WHERE id = ?',
    id,
  );
  if (!queue) return c.json({ error: 'Queue entry not found' }, 404);

  const result = ATTEMPT_RESULTS.has(body.result) ? body.result : 'other';
  const nextNum = (queue.attempt_count || 0) + 1;

  const ins = await execute(
    db,
    `INSERT INTO serve_attempts (
      serve_queue_id, attempt_number, officer_id, result,
      latitude, longitude, notes, attempt_type, photo_ids, signature_data, status
    ) VALUES (?,?,?,?, ?,?,?,?, ?,?,?)`,
    id, nextNum, body.officer_id ?? user?.id ?? null, result,
    body.latitude ?? null, body.longitude ?? null, body.notes ?? null,
    body.attempt_type ?? null,
    JSON.stringify(body.photo_ids ?? []), body.signature_data ?? null,
    result === 'served' ? 'served' : 'attempted',
  );

  let newStatus = queue.status;
  if (result === 'served') newStatus = 'served';
  else if (nextNum >= (queue.max_attempts || 3)) newStatus = 'failed';
  else newStatus = 'attempted';

  await execute(
    db,
    `UPDATE serve_queue SET attempt_count = ?, status = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    nextNum, newStatus, id,
  );

  return c.json({ success: true, id: ins.meta.last_row_id, attempt_number: nextNum, queue_status: newStatus });
});

// ── POST /:id/skip-trace ────────────────────────────────────
si.post('/:id/skip-trace', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);

  const r = await execute(
    db,
    `INSERT INTO serve_skip_traces (
      serve_queue_id, search_type, search_query, results_json, addresses_found_json, searched_by
    ) VALUES (?,?,?,?,?,?)`,
    id, body.search_type ?? 'manual', body.search_query ?? null,
    body.results_json ? JSON.stringify(body.results_json) : null,
    JSON.stringify(body.addresses_found ?? []),
    user?.id ?? null,
  );
  return c.json({ success: true, id: r.meta.last_row_id });
});

// ── GET /routes ─────────────────────────────────────────────
si.get('/routes', async (c) => {
  const db = getDb(c.env);
  const officerId = c.req.query('officer_id');
  const date = c.req.query('date');
  const where: string[] = [];
  const args: any[] = [];
  if (officerId) { where.push('officer_id = ?'); args.push(parseInt(officerId, 10)); }
  if (date) { where.push('route_date = ?'); args.push(date); }
  const sql = `SELECT * FROM serve_routes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY route_date DESC, id DESC LIMIT 200`;
  const rows = await query(db, sql, ...args);
  return c.json(rows);
});

// ── POST /routes ────────────────────────────────────────────
si.post('/routes', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<any>().catch(() => ({}));
  const user = c.get('user') as { id: number } | undefined;
  if (!body.officer_id && !user?.id) return c.json({ error: 'officer_id required' }, 400);
  const db = getDb(c.env);
  const r = await execute(
    db,
    `INSERT INTO serve_routes (
      officer_id, route_date, optimized_order_json, waypoints_json,
      total_distance_miles, total_time_minutes,
      start_lat, start_lng, end_lat, end_lng, notes
    ) VALUES (?,?,?,?, ?,?, ?,?,?,?, ?)`,
    body.officer_id ?? user?.id, body.route_date ?? null,
    JSON.stringify(body.optimized_order ?? []),
    JSON.stringify(body.waypoints ?? []),
    body.total_distance_miles ?? null, body.total_time_minutes ?? null,
    body.start_lat ?? null, body.start_lng ?? null,
    body.end_lat ?? null, body.end_lng ?? null,
    body.notes ?? null,
  );
  return c.json({ success: true, id: r.meta.last_row_id });
});

// ── GET /export.csv — admin/manager ─────────────────────────
si.get('/export.csv', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const rows = await query<any>(
    db,
    `SELECT id, status, priority, recipient_name, recipient_address, recipient_city,
            recipient_state, document_type, case_number, court_name, deadline,
            attempt_count, officer_id, created_at
       FROM serve_queue ORDER BY id DESC LIMIT 10000`,
  );
  const headers = [
    'id', 'status', 'priority', 'recipient_name', 'recipient_address', 'recipient_city',
    'recipient_state', 'document_type', 'case_number', 'court_name', 'deadline',
    'attempt_count', 'officer_id', 'created_at',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(','));
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="serve-queue.csv"',
    },
  });
});

export default si;
