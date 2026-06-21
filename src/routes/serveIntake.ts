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
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, columnExists } from '../utils/db';
import {
  extractFromText,
  extractFromImage,
  extractFromImageClaude,
  extractFromTextClaude,
  extractTextFromPdf,
  fieldsToQueueRow,
  normalizeFields,
  type ExtractionResult,
  type ExtractedField,
} from '../utils/serveIntakeExtract';
import { commitIntake, type CommitResult } from '../utils/serveIntakeRecords';
import { emitAlert } from '../utils/alertHub';
import {
  findLocationNote, listLocationNotes, createLocationNote,
  updateLocationNote, deactivateLocationNote,
  type CreateNoteInput,
} from '../utils/serveLocationNotes';
import { LIST_VIEW_COLUMNS } from './dispatch/calls';
import {
  replanAfterFailedAttempt,
  applyUrgencyTier,
  type AttemptWindow,
} from '../utils/serveDiligencePlanner';
import { persistAttemptSchedule, appendAttemptSlot } from '../utils/serveAttemptScheduler';
import { broadcastAll } from './ws';
import { recordAudit } from '../utils/auditLog';

// ── Migration 0140 runtime reconciler ───────────────────────
// D1 deploy apply is continue-on-error; columns may be absent on live.
// One-shot per Worker instance (cold starts re-run, idempotent).
let scheduleSchemaReconciled = false;
async function reconcileScheduleSchema(db: D1Database): Promise<void> {
  if (scheduleSchemaReconciled) return;
  scheduleSchemaReconciled = true;

  // serve_attempt_schedules columns from migration 0140
  for (const [name, type] of [
    ['manually_moved', 'INTEGER NOT NULL DEFAULT 0'],
    ['moved_by_user_id', 'INTEGER'],
    ['moved_at', 'TEXT'],
    ['auto_replan_source', 'INTEGER'],
    ['officer_id', 'INTEGER'],
  ] as const) {
    try {
      if (!(await columnExists(db, 'serve_attempt_schedules', name))) {
        await execute(db, `ALTER TABLE serve_attempt_schedules ADD COLUMN ${name} ${type}`);
      }
    } catch (err) { console.warn(`[serve-intake] reconcile ${name} failed:`, err); }
  }

  // serve_queue columns from migration 0140
  for (const [name, type] of [
    ['geo_cluster_id', 'TEXT'],
    ['urgency_tier', 'TEXT'],
    ['urgency_computed_at', 'TEXT'],
  ] as const) {
    try {
      if (!(await columnExists(db, 'serve_queue', name))) {
        await execute(db, `ALTER TABLE serve_queue ADD COLUMN ${name} ${type}`);
      }
    } catch (err) { console.warn(`[serve-intake] reconcile ${name} failed:`, err); }
  }

  // PR 2: updated_at for optimistic concurrency on PATCH /schedule/:slotId
  for (const [name, type] of [
    ['updated_at', "TEXT NOT NULL DEFAULT (datetime('now'))"],
  ] as const) {
    try {
      if (!(await columnExists(db, 'serve_attempt_schedules', name))) {
        await execute(db, `ALTER TABLE serve_attempt_schedules ADD COLUMN ${name} ${type}`);
      }
    } catch (err) { console.warn(`[serve-intake] reconcile ${name} failed:`, err); }
  }
}

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
const REPLAN_RESULTS = new Set(['no_answer', 'refused', 'bad_address', 'moved']);

// ── OCR + upload constants ──────────────────────────────────
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;   // 25 MB per file
// A single job folder legitimately carries many documents — Field Sheet +
// Information Form + Court Docket + Summons + Complaint + Cover Sheet + Notices
// — and scanned PDFs each fan out to several rasterized page-images. 12 was too
// low for a whole-folder drop; 30 covers a real packet. Extraction is per-doc,
// parallel, and timeout-bounded, so the higher count doesn't lengthen any single
// AI call (only widens the parallel fan-out).
const MAX_FILES_PER_UPLOAD = 30;
const PDF_TOOLS_NAME = 'shared';
const INTAKE_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher', 'officer'];

function isPdf(mime: string): boolean { return mime === 'application/pdf'; }
function isImage(mime: string): boolean { return mime.startsWith('image/'); }

// Minimum browser-extracted text length to trust a PDF as "born-digital"
// and skip the OCR container. A court summons cover page alone is ~800
// chars; 200 comfortably clears sparse single-page exhibits while still
// catching truly-empty scans (which return 0).
const MIN_CLIENT_TEXT_CHARS = 200;

// Hard ceiling on the PDF Tools container round-trip. The container is
// currently NOT rolled out in prod (deploy uses --containers-rollout=none),
// so this is mostly a guard against an indefinite hang — a missing/cold
// container fetch is raced against this timeout and we fall back.
const CONTAINER_TIMEOUT_MS = 12_000;

// Per-call ceiling on any single Workers AI invocation (per-doc text
// extraction or per-image Vision). Without this a slow/stalled model
// call hangs the whole /upload request — the original "stuck on upload"
// cause. On timeout we record the doc as failed rather than blocking.
// 35s (was 25s): real extractions land ~20-22s even after dropping the
// json_schema constraint, so 25s left only a 3-5s margin and tipped over
// under model load. Calls run in PARALLEL, so this is the per-doc ceiling
// AND roughly the whole-request ceiling — not additive across docs.
const AI_TIMEOUT_MS = 35_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

// Claude-first OCR with Workers-AI fallback. Claude (extractFrom*Claude) uses the
// SAME rich serve-doc prompt + parser, so the result shape is identical and the
// merge/commit code is unchanged. Returns null from the Claude leg (no key / no
// credits / error) → we transparently fall back to the free Workers-AI path.
// extraction.model carries 'claude:…' vs the Llama id so callers can label engine.
async function ocrImage(env: Env['Bindings'], bytes: Uint8Array, mime: string): Promise<ExtractionResult> {
  const claude = await withTimeout(
    extractFromImageClaude(env, bytes, mime), AI_TIMEOUT_MS, 'Claude OCR timed out',
  ).catch(() => null);
  return claude ?? withTimeout(extractFromImage(env.AI, bytes), AI_TIMEOUT_MS, 'Vision OCR timed out');
}
async function ocrText(env: Env['Bindings'], text: string): Promise<ExtractionResult> {
  const claude = await withTimeout(
    extractFromTextClaude(env, text), AI_TIMEOUT_MS, 'Claude text timed out',
  ).catch(() => null);
  return claude ?? withTimeout(
    extractFromText(env.AI, text, env.SERVE_INTAKE_LORA), AI_TIMEOUT_MS, 'Text extraction timed out',
  );
}

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

  // Optional browser-extracted pdfjs text for born-digital PDFs. Mirrors the
  // /upload path: prefer this over the PDF Tools container (which is NOT rolled
  // out in prod — --containers-rollout=none — so a container fetch would hang
  // the request the full CONTAINER_TIMEOUT_MS and then 500).
  const clientText = (() => {
    const raw = form.get('client_text');
    return typeof raw === 'string' ? raw.trim() : '';
  })();

  let extraction: ExtractionResult;
  let pageCount = 0;
  let ocrUsed = false;
  let ocrEngine: string;

  try {
    if (isImage(file.type)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      extraction = await ocrImage(c.env, bytes, file.type);
      ocrEngine = extraction.model.startsWith('claude') ? 'claude-vision' : 'workers-ai-vision';
    } else if (isPdf(file.type)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text = clientText;
      ocrEngine = 'pdfjs-client';

      if (clientText.length < MIN_CLIENT_TEXT_CHARS) {
        // Insufficient born-digital text — race the (prod-disabled) container
        // against its timeout rather than awaiting it bare. On timeout /
        // unavailable AND no usable client text, this is a scanned PDF we
        // cannot OCR server-side: return a clean 422 with guidance instead of
        // hanging to a 500. The client rasterizes to images and resends those.
        try {
          const container = getContainer(c.env.PDF_TOOLS, PDF_TOOLS_NAME);
          const txt = await withTimeout(
            extractTextFromPdf(container, bytes, file.name || 'doc.pdf'),
            CONTAINER_TIMEOUT_MS, 'PDF Tools container timed out or unavailable',
          );
          text = txt.text;
          pageCount = txt.page_count;
          ocrUsed = txt.ocr_used;
          ocrEngine = ocrUsed ? 'tesseract' : 'pdftotext';
        } catch {
          return c.json({
            error: 'scanned_pdf_unsupported',
            code: 'SCANNED_PDF',
            message: 'Scanned PDF — rasterize the pages client-side and resend each as an image.',
          }, 422);
        }
      }

      if (text.trim().length < 20) {
        return c.json({
          error: 'scanned_pdf_unsupported',
          code: 'SCANNED_PDF',
          message: 'Scanned PDF — rasterize the pages client-side and resend each as an image.',
        }, 422);
      }

      extraction = await ocrText(c.env, text);
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

  // Client-provided pdfjs text, keyed by filename. The browser already
  // ran pdfjs on each PDF during drag-drop; we use that text directly
  // for born-digital PDFs instead of round-tripping through the PDF
  // Tools container (which is NOT rolled out in prod — deploy uses
  // --containers-rollout=none — so a container fetch would hang).
  // Only genuinely empty PDFs (scans) fall through to the container.
  const clientTextByName = new Map<string, string>();
  const clientTextRaw = form.get('client_text');
  if (typeof clientTextRaw === 'string') {
    try {
      const arr = JSON.parse(clientTextRaw) as Array<{ name?: string; text?: string }>;
      for (const e of arr) {
        if (e?.name) clientTextByName.set(e.name, (e.text || '').trim());
      }
    } catch { /* ignore malformed client_text — fall back to server extraction */ }
  }

  const db = getDb(c.env);
  const container = getContainer(c.env.PDF_TOOLS, PDF_TOOLS_NAME);
  const allDates = new Set<string>();

  // ── Phase 1+2: per-file text acquisition + field extraction, IN PARALLEL ──
  // Each document is fully processed independently and concurrently:
  //   • acquire text (pdfjs client text / container OCR / Vision for images)
  //   • store to R2
  //   • run field extraction on THAT doc alone, timeout-bounded
  //
  // Why per-doc instead of one combined call: a combined 90K-char prompt
  // (dominated by a 47K-char court docket of summons boilerplate) blew the
  // 25s timeout and lost EVERYTHING, including the recipient that lived in
  // the 1KB field sheet (job 16009904). Extracting per-doc in parallel
  // means the small structured docs (field sheet / info form) return in
  // seconds and yield the recipient even if the giant docket's call times
  // out. Resilience through independence — partial success beats all-or-
  // nothing. Each doc's text is also capped so no single call runs long.
  const PER_DOC_CAP = 40_000;
  const EXTRACT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

  interface Collected {
    file: File;
    text: string;
    pageCount: number;
    ocrUsed: boolean;
    ocrEngine: string;
    r2Key: string | null;
    ex: ExtractionResult;   // per-document field extraction
    error?: string;          // file-level (read/store) error
  }

  const emptyExtraction = (model: string, error?: string): ExtractionResult => ({
    success: false, documentType: 'other', confidence: 0,
    fields: {} as Record<string, ExtractedField>, rawText: '', allDates: [],
    model, ms: 0, error,
  });

  const collected: Collected[] = await Promise.all(files.map(async (file): Promise<Collected> => {
    const r2Key = await storeToR2(c.env, file, user.id).catch(() => null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());

      // Images: Vision does OCR + extraction in one timeout-bounded pass.
      if (isImage(file.type)) {
        const ex = await ocrImage(c.env, bytes, file.type)
          .catch((e) => emptyExtraction('workers-ai-vision', e instanceof Error ? e.message : String(e)));
        const engine = ex.model.startsWith('claude') ? 'claude-vision' : 'workers-ai-vision';
        for (const d of ex.allDates) allDates.add(d);
        return { file, text: ex.rawText, pageCount: 0, ocrUsed: true, ocrEngine: engine, r2Key, ex };
      }

      // PDFs: acquire text, then extract fields from THIS doc alone.
      if (isPdf(file.type)) {
        let text = '';
        let ocrEngine = 'pdfjs-client';
        let ocrUsed = false;
        let pageCount = 0;
        const clientText = clientTextByName.get(file.name) || '';
        if (clientText.length >= MIN_CLIENT_TEXT_CHARS) {
          text = clientText;
        } else {
          try {
            const txt = await withTimeout(
              extractTextFromPdf(container, bytes, file.name || 'doc.pdf'),
              CONTAINER_TIMEOUT_MS, 'PDF Tools container timed out or unavailable',
            );
            text = txt.text; pageCount = txt.page_count; ocrUsed = txt.ocr_used;
            ocrEngine = txt.ocr_used ? 'tesseract' : 'pdftotext';
          } catch {
            text = clientText; ocrEngine = 'container-unavailable';
          }
        }
        const ex = text.trim().length >= 20
          ? await ocrText(c.env, text.slice(0, PER_DOC_CAP))
              .catch((e) => emptyExtraction(EXTRACT_MODEL, e instanceof Error ? e.message : String(e)))
          : emptyExtraction(EXTRACT_MODEL, 'Insufficient text to extract');
        ex.rawText = text;
        for (const d of ex.allDates) allDates.add(d);
        return { file, text, pageCount, ocrUsed, ocrEngine, r2Key, ex };
      }

      return {
        file, text: '', pageCount: 0, ocrUsed: false, ocrEngine: 'unsupported', r2Key,
        ex: emptyExtraction(EXTRACT_MODEL, `Unsupported type ${file.type}`),
        error: `Unsupported type ${file.type}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { file, text: '', pageCount: 0, ocrUsed: false, ocrEngine: 'error', r2Key, ex: emptyExtraction(EXTRACT_MODEL, msg), error: msg };
    }
  }));

  // ── Merge per-document fields by confidence ──
  // Field-sheet / info-form docs (structured, recipient-dense) usually win
  // each field; the court docket fills gaps. Highest-confidence value per
  // field survives — so a timed-out docket simply contributes nothing
  // rather than blanking the recipient the field sheet already provided.
  const mergedFields: Record<string, ExtractedField> = {};
  let bestConfidence = 0;
  let bestDocType = 'other';
  // synthetic combined.error placeholder so downstream warning logic can
  // report the most relevant extraction failure.
  let combinedError: string | null = null;
  for (const c2 of collected) {
    for (const [k, v] of Object.entries(c2.ex.fields)) {
      const cur = mergedFields[k];
      if (!cur || (v.value && v.confidence > cur.confidence)) mergedFields[k] = v;
    }
    if (c2.ex.confidence > bestConfidence) {
      bestConfidence = c2.ex.confidence;
      bestDocType = c2.ex.documentType;
    }
    if (c2.ex.error && !combinedError) combinedError = c2.ex.error;
  }

  // ── Name-coherence guard ──────────────────────────────────────
  // The per-field merge above picks the highest-confidence value for
  // EACH field independently — which can stitch recipient_first_name
  // from the field sheet onto recipient_last_name from the docket and
  // invent a person who appears in neither doc. Identity must stay
  // internally consistent, so we take the WHOLE name group from the one
  // document with the strongest recipient signal rather than cherry-
  // picking per field. (Other fields — court, case#, attorney — are
  // independent facts and the per-field merge is correct for them.)
  const IDENTITY_GROUP = [
    'recipient_type', 'recipient_first_name', 'recipient_middle_name',
    'recipient_last_name', 'recipient_business_name', 'recipient_dob',
  ] as const;
  const recipientScore = (ex: ExtractionResult): number => {
    const f = ex.fields;
    // Weight the name-defining fields; a doc that only mentions a DOB
    // shouldn't outrank one that has the actual first+last name.
    return (f.recipient_first_name?.value ? f.recipient_first_name.confidence : 0)
      + (f.recipient_last_name?.value ? f.recipient_last_name.confidence : 0)
      + (f.recipient_business_name?.value ? f.recipient_business_name.confidence : 0);
  };
  let bestDoc: ExtractionResult | null = null;
  let bestScore = 0;
  for (const c2 of collected) {
    const s = recipientScore(c2.ex);
    if (s > bestScore) { bestScore = s; bestDoc = c2.ex; }
  }
  if (bestDoc) {
    for (const k of IDENTITY_GROUP) {
      const v = bestDoc.fields[k];
      // Only override with a non-empty value — a blank field on the
      // winning doc shouldn't wipe a value another doc legitimately
      // supplied (e.g. winner has the name, a second doc has the DOB).
      if (v && v.value) mergedFields[k] = v;
    }
  }

  // ── Deterministic field normalization ─────────────────────────
  // Enforce the shapes the prompt only *requests*: digits-only phones,
  // 2-letter states, 5(+4) ZIPs, ISO dates. Runs on the merged set so
  // every downstream consumer (queue row, person/property writes, the
  // success card) sees clean values.
  const normalizedFields = normalizeFields(mergedFields);

  // ── Operator pre-submission overrides ──────────────────────────────
  // Client sends `field_overrides` JSON (key → string) for values the
  // operator edited in the review panel before clicking Create. Applied
  // after normalizeFields so they bypass the formatter and commit as-is;
  // confidence 1.0 ensures they beat any AI-extracted value downstream.
  const overridesRaw = form.get('field_overrides');
  if (typeof overridesRaw === 'string') {
    try {
      const overrides = JSON.parse(overridesRaw) as Record<string, string>;
      for (const [k, v] of Object.entries(overrides)) {
        if (typeof v === 'string' && v.trim()) {
          normalizedFields[k] = { value: v.trim(), confidence: 1.0 };
        }
      }
    } catch { /* ignore malformed overrides blob */ }
  }

  // Operator-selected client_id (integer FK) sent as a separate FormData field
  // so it doesn't get coerced through the string-only field_overrides path.
  const clientIdRaw = form.get('client_id');
  const clientId = typeof clientIdRaw === 'string' && /^\d+$/.test(clientIdRaw.trim())
    ? Number(clientIdRaw.trim()) : null;

  // Expose under the same name the rest of the handler already reads.
  const combined = { error: combinedError } as { error: string | null };

  // ── Phase 3: persist a serve_intake_documents row per file ──
  const documents: any[] = [];
  const failedDocs: string[] = [];   // docs that yielded no usable extraction
  for (const c2 of collected) {
    if (c2.error && !c2.text) {
      documents.push({ file_name: c2.file.name, status: 'failed', error: c2.error });
      failedDocs.push(c2.file.name);
      continue;
    }
    // Per-document extraction now lives on c2.ex (Vision for images,
    // text-LLM for PDFs) — no combined-call indirection.
    const docFields = c2.ex.fields;
    const docType = c2.ex.documentType;
    const docConf = c2.ex.confidence;
    const docModel = c2.ex.model;
    const docMs = c2.ex.ms;
    const hasText = (c2.text || '').trim().length > 0;
    // Capture this doc's own extraction error (timeout / parse miss / AI
    // error) so a confidence=0 row is diagnosable instead of silent.
    const docError = c2.error ?? c2.ex.error ?? null;
    if (docError) failedDocs.push(c2.file.name);   // extracted text but no fields → flag for the partial-failure warning
    const res = await execute(
      db,
      `INSERT INTO serve_intake_documents (
        uploaded_by, file_name, file_type, r2_key, size_bytes, page_count,
        raw_text, ocr_used, ocr_engine, doc_type, fields_json, confidence,
        extraction_model, extraction_ms, status, error_message
      ) VALUES (?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?)`,
      user.id, c2.file.name, c2.file.type, c2.r2Key, c2.file.size, c2.pageCount,
      (c2.text || '').slice(0, 200_000), c2.ocrUsed ? 1 : 0, c2.ocrEngine,
      docType, JSON.stringify(docFields), docConf, docModel, docMs,
      hasText ? 'extracted' : 'failed', docError,
    );
    documents.push({
      id: res.meta.last_row_id,
      file_name: c2.file.name,
      file_type: c2.file.type,
      r2_key: c2.r2Key,
      page_count: c2.pageCount,
      ocr_used: c2.ocrUsed,
      ocr_engine: c2.ocrEngine,
      doc_type: docType,
      confidence: docConf,
      success: hasText,
      model: docModel,
      extraction_ms: docMs,
      fields: docFields,
    });
  }

  // ── Commit the merged extraction into the full RMS record set:
  //    business / person / property / call / serve_queue + links.
  const row = fieldsToQueueRow(normalizedFields);
  const docSummary = buildCallDescription(row, normalizedFields, documents.length);
  let commit: CommitResult = {
    serve_queue_id: null, person_id: null, agent_person_id: null,
    business_id: null, property_id: null, call_id: null, call_number: null,
    created: { person: false, agent_person: false, business: false, property: false, call: false },
  };
  if (row.recipient_name || row.recipient_address) {
    await reconcileScheduleSchema(db);
    commit = await commitIntake(db, {
      fields: normalizedFields,
      queueRow: row,
      userId: user.id,
      documentSummary: docSummary,
      docCount: documents.length,
      clientId,
      // Per-document OCR provenance → "OCR & EXTRACTION CONTEXT" note on the
      // call + compact line on serve_queue.notes + parsed_data._intake audit.
      docs: documents.map((d) => ({
        file_name: d.file_name, doc_type: d.doc_type ?? null,
        ocr_engine: d.ocr_engine ?? null, confidence: d.confidence ?? 0,
        success: !!d.success, page_count: d.page_count ?? null,
      })),
      allDates: [...allDates],
      env: c.env,
    });
    // Back-link the document rows to the new queue entry.
    if (commit.serve_queue_id) {
      for (const d of documents) {
        if (d.id) {
          await execute(db,
            'UPDATE serve_intake_documents SET serve_queue_id = ? WHERE id = ?',
            commit.serve_queue_id, d.id);
        }
      }
    }
  }

  // Make the "text extracted but nothing usable came back" case explicit
  // instead of a silent partial success (doc rows but no queue entry).
  const noRecords = commit.serve_queue_id == null && commit.call_id == null;
  const hadText = collected.some((c2) => (c2.text || '').trim().length > 0);
  let warning: string | null = noRecords
    ? (hadText
        ? `Documents stored but no recipient could be extracted${combined.error ? ` (${combined.error})` : ''}. Review the documents and create the entry manually.`
        : 'No readable text found in the uploaded documents (likely scans). Nothing was extracted.')
    : null;
  // Partial failure: the entry WAS created, but one or more documents didn't
  // extract — fields that live only on those (e.g. attorney/case details from a
  // Court Docket whose OCR timed out) may be missing. Previously this was
  // silent; surface it so the user knows to review those documents.
  if (!noRecords && failedDocs.length > 0) {
    warning = `Entry created, but ${failedDocs.length} document(s) didn't extract (${failedDocs.join(', ')}). Some fields may be missing — review those documents.`;
  }
  // Duplicate intake: an ACTIVE queue entry already covers this case +
  // recipient. The uploaded documents were attached to it (back-link above);
  // no new call/queue/person records were created.
  if (commit.duplicate_of) {
    warning = `Active serve entry #${commit.duplicate_of.serve_queue_id} already exists for this case and recipient (status: ${commit.duplicate_of.status}). Documents were attached to the existing entry — no new call was created.`;
  }

  // Intake can spawn a CAD call (createServiceCall writes calls_for_service
  // directly, bypassing the calls.ts POST broadcast). Fan it to every dispatch
  // console via AlertHubDO so the new call lands on the board live, not only on
  // the next 20s poll. Best-effort — never blocks the response.
  if (commit.call_id) {
    try {
      const newCall = await queryFirst(db, `SELECT ${LIST_VIEW_COLUMNS.join(', ')} FROM calls_for_service WHERE id = ?`, commit.call_id);
      if (newCall) await emitAlert(c.env, 'dispatch_update', { action: 'call_created', call: newCall });
    } catch (err) { console.warn('[serveIntake] call_created broadcast skipped (non-fatal):', err); }
  }

  return c.json({
    success: commit.serve_queue_id != null || commit.call_id != null,
    warning,
    extraction_error: combined.error ?? null,
    serve_queue_id: commit.serve_queue_id,
    person_id: commit.person_id,
    agent_person_id: commit.agent_person_id,
    business_id: commit.business_id,
    property_id: commit.property_id,
    call_id: commit.call_id,
    call_number: commit.call_number,
    created: commit.created,
    latitude: null,
    longitude: null,
    weather: null,
    lighting: null,
    // Legacy IntakeResult shape so the existing success card on
    // ServeIntakePage renders without any client-side branching on
    // which endpoint was hit.
    extracted: buildExtractedBlock(normalizedFields),
    confidence: bestConfidence,
    documentType: bestDocType,
    // Server-side advanced fields (the /intake legacy path can't
    // produce these — only /upload has R2 keys + per-document model
    // confidence + page counts).
    documents,
    // OCR provenance for the success card: the filed context note + the
    // critical fields the extractor could not find (verify-before-service).
    intake_note: commit.intake_note ?? null,
    missing_critical: commit.missing_critical ?? [],
    attempt_plan: commit.attempt_plan ?? [],
    duplicate_of: commit.duplicate_of ?? null,
    merged: {
      documentType: bestDocType,
      confidence: bestConfidence,
      fields: normalizedFields,
      allDates: [...allDates],
      queue_row: row,
    },
  });
});

// Build the legacy `extracted` block the client's IntakeResult expects.
// Both /upload and /intake return this shape so ServeIntakePage's success
// card renders the same regardless of which path the client took.
function buildExtractedBlock(fields: Record<string, { value: string; confidence: number }>) {
  const get = (k: string) => (fields[k]?.value || '').trim();
  return {
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
    registeredAgent: get('registered_agent_name'),
    businessName: get('recipient_business_name'),
  };
}

// Description written to calls_for_service.description — the dispatcher's
// one-line situational picture shown in the call queue BEFORE they open the
// call. Structured as ordered dot-segments so every critical fact is legible
// at a scan: paper type → who → where → case → parties → hiring party →
// deadline (with urgency tag) → job # → doc count.
function buildCallDescription(
  row: ReturnType<typeof fieldsToQueueRow>,
  fields: Record<string, { value: string; confidence: number }>,
  docCount: number,
): string {
  const f = (k: string) => (fields[k]?.value || '').trim();
  const parts: string[] = [];

  // ── 1. Paper type ─────────────────────────────────────────────
  // Use the more-specific subtype when the extractor found one (e.g.
  // "Summons + Complaint" is more useful than just "court_filing").
  const docType = f('document_subtype') || row.document_type || 'Civil paper';
  const isBusiness = f('recipient_type').toLowerCase() === 'business';
  parts.push(`SERVE / ${docType}${isBusiness ? ' (Corporate)' : ''}`);

  // ── 2. Target party ──────────────────────────────────────────
  // For individuals: full name + DOB (identity confirmation before tender).
  // For businesses: entity name + registered agent (who we need at the door).
  const agentName = f('registered_agent_name');
  const bizName = f('recipient_business_name');
  if (isBusiness) {
    const entity = bizName || row.recipient_name;
    if (entity) {
      parts.push(entity + (agentName ? ` (R/A: ${agentName})` : ''));
    }
  } else if (row.recipient_name) {
    const dob = f('recipient_dob');
    parts.push(row.recipient_name + (dob ? ` DOB ${dob}` : ''));
  }

  // ── 3. Service address with city/state for quick district context ─
  const addrCity = [
    row.recipient_address,
    [row.recipient_city, row.recipient_state].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
  if (addrCity) parts.push(addrCity);

  // ── 4. Case # + court ────────────────────────────────────────
  const caseStr = [
    row.case_number ? `Case ${row.case_number}` : '',
    row.court_name || '',
  ].filter(Boolean).join(' — ');
  if (caseStr) parts.push(caseStr);

  // ── 5. Parties (plaintiff v. defendant) ──────────────────────
  // Both are normally present on a summons/complaint; evictions may have
  // only a plaintiff (landlord). Shows the legal relationship at a glance.
  if (row.plaintiff && row.defendant) {
    parts.push(`${row.plaintiff} v. ${row.defendant}`);
  } else if (row.plaintiff) {
    parts.push(`Plaintiff: ${row.plaintiff}`);
  }

  // ── 6. Hiring party + callback ───────────────────────────────
  // Client name preferred (the firm paying); attorney name as fallback.
  const hiringParty = row.client_name || row.attorney_name;
  const attyPhone = f('attorney_phone');
  if (hiringParty) {
    parts.push(`Atty: ${hiringParty}${attyPhone ? ` (${attyPhone})` : ''}`);
  } else if (attyPhone) {
    parts.push(`Callback: ${attyPhone}`);
  }

  // ── 7. Deadline + urgency tag ────────────────────────────────
  if (row.deadline) {
    const urgency = row.priority === 'urgent' ? ' ⚠ URGENT'
      : row.priority === 'rush' ? ' ⚠ RUSH'
      : '';
    parts.push(`Due ${row.deadline}${urgency}`);
  }

  // ── 8. Hearing / court date ──────────────────────────────────
  if (row.court_date) parts.push(`Hearing ${row.court_date}`);

  // ── 9. Client job # ──────────────────────────────────────────
  const jobNum = f('job_number');
  if (jobNum) parts.push(`Job #${jobNum}`);

  // ── 10. Document count ───────────────────────────────────────
  if (docCount) parts.push(`${docCount} doc${docCount > 1 ? 's' : ''} on file`);

  return parts.join(' · ');
}

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
  const extraction = await ocrText(c.env, combined);
  // Same deterministic normalization the /upload path applies, so the
  // legacy single-call route produces equally clean field shapes.
  const normalized = normalizeFields(extraction.fields);
  const row = fieldsToQueueRow(normalized);

  let commit: CommitResult = {
    serve_queue_id: null, person_id: null, agent_person_id: null,
    business_id: null, property_id: null, call_id: null, call_number: null,
    created: { person: false, agent_person: false, business: false, property: false, call: false },
  };
  if (row.recipient_name || row.recipient_address) {
    const db = getDb(c.env);
    await reconcileScheduleSchema(db);
    commit = await commitIntake(db, {
      fields: normalized,
      queueRow: row,
      userId: user.id,
      documentSummary: buildCallDescription(row, normalized, docs.length),
      docCount: docs.length,
      env: c.env,
    });
  }

  // Shape mirrors client/src/pages/ServeIntakePage.tsx IntakeResult.
  // person/property/call IDs now reflect the freshly-linked records;
  // weather/lighting/lat/lng remain null (those need a geocode step
  // — not in this PR; the geocode route at /api/geocode handles it
  // post-intake when the queue entry is opened in the route planner).
  // Same live-board fan-out as /upload: surface an intake-spawned CAD call on
  // every dispatch console immediately (best-effort).
  if (commit.call_id) {
    try {
      const newCall = await queryFirst(getDb(c.env), `SELECT ${LIST_VIEW_COLUMNS.join(', ')} FROM calls_for_service WHERE id = ?`, commit.call_id);
      if (newCall) await emitAlert(c.env, 'dispatch_update', { action: 'call_created', call: newCall });
    } catch (err) { console.warn('[serveIntake] call_created broadcast skipped (non-fatal):', err); }
  }

  return c.json({
    success: extraction.success && (commit.serve_queue_id !== null || commit.call_id !== null),
    person_id: commit.person_id,
    agent_person_id: commit.agent_person_id,
    business_id: commit.business_id,
    property_id: commit.property_id,
    call_id: commit.call_id,
    call_number: commit.call_number,
    serve_queue_id: commit.serve_queue_id,
    created: commit.created,
    latitude: null,
    longitude: null,
    weather: null,
    lighting: null,
    extracted: buildExtractedBlock(normalized),
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

// ── Recovery: re-extract failed/unmatched intake documents ──────────────────
// Re-runs OCR on a STORED document through the (now Claude-first) engine and, when
// a recipient identity is recovered and the doc isn't already linked, commits it to
// a real serve job — turning a previously-failed upload into a queue entry without
// re-uploading. Image docs re-extract from R2 bytes; PDFs/text from stored raw_text
// (scanned PDFs with no stored text must be re-uploaded as images — container OCR
// is disabled in prod).
async function reprocessDocument(
  c: any, doc: any, userId: number,
): Promise<{ success: boolean; documentType: string; confidence: number; model: string; committedQueueId: number | null; note?: string }> {
  const db = getDb(c.env);
  let extraction: ExtractionResult | null = null;
  if (isImage(doc.file_type) && doc.r2_key) {
    const obj = await c.env.UPLOADS.get(doc.r2_key);
    if (obj) extraction = await ocrImage(c.env, new Uint8Array(await obj.arrayBuffer()), doc.file_type).catch(() => null);
  } else if ((doc.raw_text || '').trim().length >= 20) {
    extraction = await ocrText(c.env, doc.raw_text).catch(() => null);
  }
  if (!extraction) {
    return { success: false, documentType: doc.doc_type || 'other', confidence: 0, model: '',
      committedQueueId: null, note: 'No image or stored text to re-extract (scanned PDF — re-upload as images)' };
  }
  const normalized = normalizeFields(extraction.fields);
  const queueRow = fieldsToQueueRow(normalized);
  await execute(db,
    `UPDATE serve_intake_documents SET fields_json=?, confidence=?, extraction_model=?, doc_type=?,
       status=?, error_message=NULL, updated_at=datetime('now') WHERE id=?`,
    JSON.stringify(extraction.fields), extraction.confidence, extraction.model, extraction.documentType,
    extraction.success ? 'extracted' : 'failed', doc.id);
  let committedQueueId: number | null = null;
  const hasIdentity = !!(normalized.recipient_last_name?.value || normalized.recipient_business_name?.value);
  if (!doc.serve_queue_id && extraction.success && hasIdentity) {
    await reconcileScheduleSchema(db);
    const commit = await commitIntake(db, {
      env: c.env, fields: normalized, queueRow, userId,
      documentSummary: (normalized.documents_to_serve?.value || doc.doc_type || '').trim(),
      docCount: 1,
    });
    if (commit.serve_queue_id) {
      committedQueueId = commit.serve_queue_id;
      await execute(db, `UPDATE serve_intake_documents SET serve_queue_id=?, status='extracted' WHERE id=?`, committedQueueId, doc.id);
      await emitAlert(c.env, 'dispatch_update', { action: 'call_created' }).catch(() => {});
    }
  }
  return {
    success: extraction.success, documentType: extraction.documentType, confidence: extraction.confidence,
    model: extraction.model, committedQueueId,
    note: !hasIdentity && extraction.success ? 'Extracted but no recipient identity — needs manual entry' : undefined,
  };
}

// GET /review-queue — docs that never became a serve job (unlinked), failed, or
// extracted at low confidence. The operator's "needs attention" list.
si.get('/review-queue', async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || !INTAKE_ROLES.includes(user.role)) return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  const rows = await query(getDb(c.env),
    `SELECT id, file_name, file_type, doc_type, confidence, status, serve_queue_id,
            extraction_model, error_message, created_at,
            CASE WHEN serve_queue_id IS NULL THEN 1 ELSE 0 END AS unlinked,
            substr(raw_text, 1, 180) AS raw_preview
       FROM serve_intake_documents
      WHERE serve_queue_id IS NULL OR status = 'failed' OR confidence < 0.4
      ORDER BY created_at DESC LIMIT 200`);
  return c.json({ documents: rows });
});

// POST /documents/:docId/reprocess — re-extract one doc; auto-commit if recovered.
si.post('/documents/:docId/reprocess', async (c) => {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user || !INTAKE_ROLES.includes(user.role)) return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  const docId = parseInt(c.req.param('docId'), 10);
  const doc = await queryFirst<any>(getDb(c.env), 'SELECT * FROM serve_intake_documents WHERE id = ?', docId);
  if (!doc) return c.json({ error: 'Document not found' }, 404);
  const r = await reprocessDocument(c, doc, user.id);
  return c.json({ document_id: docId, ...r, committed: r.committedQueueId ? { serve_queue_id: r.committedQueueId } : null });
});

// POST /reprocess-failed?limit=10 — batch recovery (admin/manager).
si.post('/reprocess-failed', async (c) => {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user || !['admin', 'manager'].includes(user.role)) return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  const limit = Math.min(25, Math.max(1, parseInt(c.req.query('limit') || '10', 10)));
  const docs = await query<any>(getDb(c.env),
    `SELECT * FROM serve_intake_documents
      WHERE serve_queue_id IS NULL AND (status = 'failed' OR confidence < 0.4)
        AND (file_type LIKE 'image/%' OR length(raw_text) >= 20)
      ORDER BY created_at DESC LIMIT ?`, limit);
  const results: any[] = [];
  for (const doc of docs) {
    try { results.push({ document_id: doc.id, file_name: doc.file_name, ...(await reprocessDocument(c, doc, user.id)) }); }
    catch (e) { results.push({ document_id: doc.id, file_name: doc.file_name, success: false, error: e instanceof Error ? e.message : String(e) }); }
  }
  return c.json({ processed: results.length, recovered: results.filter((r) => r.committedQueueId).length, results });
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

// ── GET /schedule — upcoming attempt windows (calendar feed) ─
// Returns all pending/assigned/in_progress queue items' attempt windows
// for the next 14 days, grouped by date. Used by the dashboard calendar.
si.get('/schedule', async (c) => {
  const db = getDb(c.env);
  await reconcileScheduleSchema(db);
  // Guard: table may not exist on live yet (migration pending).
  const tableExists = await queryFirst<{ n: number }>(
    db, `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='serve_attempt_schedules'`,
  );
  if (!tableExists?.n) return c.json({ schedule: [], generated_at: '' });
  const { denverNow } = await import('../utils/serveAttemptScheduler');
  const now = denverNow();
  // "14 days out" in the same local-time string format
  const cutoff = (() => {
    const d = new Date(Date.now() + 14 * 86_400_000);
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Denver',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    }).format(d).replace(' ', 'T');
  })();

  const rows = await query<{
    id: number; queue_id: number; attempt_number: number;
    scheduled_date: string; window_start: string; window_end: string;
    window_label: string; notify_at: string; notify_before_secs: number;
    notified: number; dismissed: number;
    recipient_name: string | null; recipient_address: string | null;
    recipient_city: string | null; recipient_state: string | null;
    case_number: string | null; priority: string; deadline: string | null;
    status: string;
  }>(
    db,
    `SELECT s.id, s.queue_id, s.attempt_number, s.scheduled_date,
            s.window_start, s.window_end, s.window_label, s.notify_at,
            s.notify_before_secs, s.notified, s.dismissed,
            q.recipient_name, q.recipient_address, q.recipient_city, q.recipient_state,
            q.case_number, q.priority, q.deadline, q.status
     FROM serve_attempt_schedules s
     JOIN serve_queue q ON q.id = s.queue_id
     WHERE s.dismissed = 0
       AND s.scheduled_date >= ?
       AND (s.queue_id || 'T' || s.window_start) <= ?
       AND q.status NOT IN ('served','cancelled','failed')
     ORDER BY s.scheduled_date ASC, s.window_start ASC`,
    now.slice(0, 10),
    cutoff,
  );

  // Group by date
  const byDate = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!byDate.has(row.scheduled_date)) byDate.set(row.scheduled_date, []);
    byDate.get(row.scheduled_date)!.push(row);
  }
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const schedule = [...byDate.entries()].map(([date, slots]) => {
    const dow = new Date(`${date}T12:00:00Z`).getDay();
    return { date, weekday: DAYS[dow], slots };
  });
  return c.json({ schedule, generated_at: now });
});

// ── PATCH /schedule/:slotId — manual reschedule (drag-drop or full-page edit) ─
si.patch('/schedule/:slotId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);

  const slotId = parseInt(c.req.param('slotId'), 10);
  if (isNaN(slotId)) return c.json({ error: 'Invalid slot id' }, 400);

  const db = getDb(c.env);
  await reconcileScheduleSchema(db);

  const body = await c.req.json<any>().catch(() => ({}));
  const force = c.req.query('force') === '1';
  const userId = (c.get('userId') as number | undefined) ?? null;
  const ifUnmodifiedSince = c.req.header('If-Unmodified-Since') ?? body.if_unmodified_since ?? null;

  const { detectSlotOverlap, isStaleUpdate, normalizeWindow } = await import('../utils/serveScheduleEdit');

  // Read the slot being edited.
  const current = await queryFirst<{
    id: number; queue_id: number; officer_id: number | null;
    scheduled_date: string; window_start: string; window_end: string;
    updated_at: string;
  }>(
    db,
    `SELECT id, queue_id, officer_id, scheduled_date, window_start, window_end, updated_at
       FROM serve_attempt_schedules WHERE id = ?`,
    slotId,
  );
  if (!current) return c.json({ error: 'Not found' }, 404);

  if (isStaleUpdate(ifUnmodifiedSince, current.updated_at)) {
    return c.json({ error: 'stale', current }, 409);
  }

  // Build the candidate window from body + current row defaults.
  let candidateWindow: { window_start: string; window_end: string };
  try {
    candidateWindow = normalizeWindow(
      String(body.window_start ?? current.window_start),
      String(body.window_end ?? current.window_end),
    );
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  const candidateDate = typeof body.scheduled_date === 'string' && body.scheduled_date
    ? body.scheduled_date
    : current.scheduled_date;
  const candidateOfficer = body.officer_id === undefined ? current.officer_id : body.officer_id;

  if (!force) {
    // Pull all other slots on the candidate (officer, date) for overlap detection.
    const peers = await query<{
      id: number; queue_id: number; officer_id: number | null;
      scheduled_date: string; window_start: string; window_end: string;
      updated_at: string;
    }>(
      db,
      `SELECT id, queue_id, officer_id, scheduled_date, window_start, window_end, updated_at
         FROM serve_attempt_schedules
        WHERE scheduled_date = ? AND officer_id IS ?`,
      candidateDate, candidateOfficer,
    );
    const conflicts = detectSlotOverlap(
      peers,
      { officer_id: candidateOfficer, scheduled_date: candidateDate, ...candidateWindow },
      slotId,
    );
    if (conflicts.length) {
      return c.json({ error: 'overlap', conflicts }, 409);
    }
  }

  // Apply the update. updated_at refreshes so the next read picks up the new value.
  await execute(
    db,
    `UPDATE serve_attempt_schedules
        SET scheduled_date = ?, window_start = ?, window_end = ?,
            officer_id = ?, manually_moved = 1, moved_by_user_id = ?,
            moved_at = datetime('now'), notified = 0,
            updated_at = datetime('now')
      WHERE id = ?`,
    candidateDate, candidateWindow.window_start, candidateWindow.window_end,
    candidateOfficer, userId, slotId,
  );

  // If the officer changed, propagate to serve_queue so future attempts route correctly.
  if (candidateOfficer !== current.officer_id) {
    await execute(
      db,
      `UPDATE serve_queue SET officer_id = ? WHERE id = ?`,
      candidateOfficer, current.queue_id,
    );
  }

  // Audit (force = supervisor flag for visibility).
  await recordAudit(c, {
    action: force ? 'serve_schedule.force_overlap' : 'serve_schedule.move',
    entityType: 'serve_schedule_slot',
    entityId: slotId,
    details: {
      from: { scheduled_date: current.scheduled_date, window: `${current.window_start}-${current.window_end}`, officer_id: current.officer_id },
      to: { scheduled_date: candidateDate, window: `${candidateWindow.window_start}-${candidateWindow.window_end}`, officer_id: candidateOfficer },
      reason: typeof body.reason === 'string' ? body.reason : null,
    },
  });

  // Broadcast — clients refetch via useLiveSync.
  broadcastAll('data_changed', {
    module: 'serve-schedule',
    entity: 'slot',
    action: 'updated',
    slot_id: slotId,
    queue_id: current.queue_id,
  });

  const updated = await queryFirst(
    db,
    `SELECT id, queue_id, attempt_number, scheduled_date, window_start, window_end,
            window_label, notify_at, notify_before_secs, notified, dismissed,
            officer_id, manually_moved, moved_by_user_id, moved_at,
            auto_replan_source, updated_at
       FROM serve_attempt_schedules WHERE id = ?`,
    slotId,
  );

  return c.json({ slot: updated });
});

// ── DELETE /schedule/:slotId — dismiss a slot ────────────────
si.delete('/schedule/:slotId', async (c) => {
  const slotId = parseInt(c.req.param('slotId'), 10);
  if (isNaN(slotId)) return c.json({ error: 'Invalid slot id' }, 400);
  const db = getDb(c.env);
  await execute(db, 'UPDATE serve_attempt_schedules SET dismissed = 1 WHERE id = ?', slotId);
  return c.json({ success: true });
});

// ── GET /record-lookup — property + business match for the review panel ──
// Lightweight search used by ServeRecordMatchPanel to show gate codes,
// alarm codes, and key-holder info from existing records while the
// operator is still reviewing the extracted fields before submitting.
si.get('/record-lookup', async (c) => {
  const db = getDb(c.env);
  const addressQ = (c.req.query('address') || '').trim();
  const nameQ = (c.req.query('business_name') || '').trim();
  const { normAddr } = await import('../utils/serveIntakeRecords');

  let property: any = null;
  if (addressQ) {
    const norm = normAddr(addressQ);
    const candidates = await query<any>(
      db,
      `SELECT id, name, address, gate_code, alarm_code, alarm_account,
              alarm_company, key_holder_name, key_holder_phone,
              post_orders, access_instructions, hazard_notes
         FROM properties
        WHERE LOWER(address) LIKE ? LIMIT 10`,
      `%${norm.split(' ').slice(0, 4).join(' ')}%`,
    );
    for (const row of candidates) {
      if (normAddr(row.address) === norm) { property = row; break; }
    }
  }

  let business: any = null;
  if (nameQ) {
    business = await queryFirst<any>(
      db,
      `SELECT id, name, address, owner_name, owner_phone,
              contact_name, contact_phone, phone, notes
         FROM businesses WHERE LOWER(name) = LOWER(?) LIMIT 1`,
      nameQ,
    ) ?? null;
  }

  return c.json({ property, business });
});

// ── GET /clients — active clients for the intake client selector ──
si.get('/clients', async (c) => {
  const db = getDb(c.env);
  const rows = await query<{ id: number; name: string; contact_name: string | null; contact_phone: string | null }>(
    db,
    `SELECT id, name, contact_name, contact_phone
       FROM clients WHERE status = 'active' ORDER BY name ASC`,
  );
  return c.json(rows);
});

// ── GET /:id ────────────────────────────────────────────────
// Param constrained to digits so literal single-segment GETs registered
// later in this file (/routes, /export.csv, /map-items, /location-notes)
// are not shadowed. Hono's SmartRouter falls back to the order-sensitive
// TrieRouter on static-vs-param overlap; the {[0-9]+} regex narrows the
// param-only branch to numeric ids. See properties.ts:43-45 for the
// codebase's precedent fix for the same trap.
si.get('/:id{[0-9]+}', async (c) => {
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
  await reconcileScheduleSchema(db);

  const queue = await queryFirst<{ attempt_count: number; max_attempts: number; status: string }>(
    db,
    'SELECT attempt_count, max_attempts, status FROM serve_queue WHERE id = ?',
    id,
  );
  if (!queue) return c.json({ error: 'Queue entry not found' }, 404);

  const result = ATTEMPT_RESULTS.has(body.result) ? body.result : 'other';
  const nextNum = (queue.attempt_count || 0) + 1;

  // NB: live serve_attempts does NOT have the `status` column that
  // migration 0030 defines (schema drift — the column was never applied
  // to the 785de7ae DB). Inserting it crashes with "no such column".
  // It's redundant anyway: per-attempt status is derivable from `result`
  // (served → served, else → attempted), and the workflow state lives on
  // serve_queue.status which we update below. So we omit it entirely.
  // See [[feedback-verify-live-schema-before-insert]].
  const ins = await execute(
    db,
    `INSERT INTO serve_attempts (
      serve_queue_id, attempt_number, officer_id, result,
      latitude, longitude, notes, attempt_type, photo_ids, signature_data
    ) VALUES (?,?,?,?, ?,?,?,?, ?,?)`,
    id, nextNum, body.officer_id ?? user?.id ?? null, result,
    body.latitude ?? null, body.longitude ?? null, body.notes ?? null,
    body.attempt_type ?? null,
    JSON.stringify(body.photo_ids ?? []), body.signature_data ?? null,
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

  // Completion → auto-compute the serve charge (pending_review) so it shows up in
  // billing without a manual step. Mirrors serve.ts; best-effort — generateServeCharges
  // swallows its own errors and never breaks the attempt write.
  if (newStatus === 'served') {
    const { generateServeCharges } = await import('../utils/serveChargeStore');
    await generateServeCharges(db, id).catch(() => null);
  }

  // Auto-replan on failure (PR 1) — spawn next slot, recompute tier
  let replanSummary: { slot_id: number; scheduled_date: string; window: string } | null = null;
  const attemptId = ins.meta.last_row_id as number;

  if (REPLAN_RESULTS.has(String(body.result ?? ''))) {
    // Re-read the queue row to get the post-increment attempt_count + recipient details.
    const q = await queryFirst<{
      id: number; deadline: string | null; max_attempts: number;
      attempt_count: number; recipient_lat: number | null;
      recipient_lng: number | null; document_type: string | null;
      recipient_type: string | null;
    }>(
      db,
      `SELECT id, deadline, max_attempts, attempt_count, recipient_lat,
              recipient_lng, document_type,
              parsed_data->>'recipient_type' AS recipient_type
         FROM serve_queue WHERE id = ?`,
      id,
    );

    if (q && q.attempt_count < q.max_attempts) {
      const isBusiness = (q.recipient_type ?? '').toLowerCase() === 'business';

      const next = replanAfterFailedAttempt(
        {
          attempt_at: new Date().toISOString(),
          result: String(body.result),
          window: typeof body.window === 'string' ? body.window : null,
        },
        {
          deadline: q.deadline,
          max_attempts: q.max_attempts,
          attempt_count: q.attempt_count,
          recipient_lat: q.recipient_lat,
          recipient_lng: q.recipient_lng,
          isBusiness,
        },
      );

      if (next) {
        // Append the next slot WITHOUT deleting prior slots (appendAttemptSlot).
        // Using persistAttemptSchedule here would DELETE all prior schedule rows
        // including completed/notified ones, losing attempt history after attempt #1.
        await appendAttemptSlot(db, id, next, new Date().toISOString());

        // Look up the newly-inserted slot for the response payload.
        const slot = await queryFirst<{ id: number; scheduled_date: string; window_start: string; window_end: string }>(
          db,
          `SELECT id, scheduled_date, window_start, window_end
             FROM serve_attempt_schedules
            WHERE queue_id = ? AND scheduled_date = ?
            ORDER BY id DESC LIMIT 1`,
          id, next.date,
        );
        if (slot) {
          // Stamp the auto_replan_source FK to the attempt we just inserted.
          await execute(
            db,
            `UPDATE serve_attempt_schedules SET auto_replan_source = ? WHERE id = ?`,
            attemptId, slot.id,
          ).catch((e) => {
            console.warn('[serveIntake] auto_replan_source FK stamp skipped:', e instanceof Error ? e.message : e);
            return null;
          }); // column may not exist on live yet (mig 0140 pending Task 7)
          replanSummary = {
            slot_id: slot.id,
            scheduled_date: slot.scheduled_date,
            window: `${slot.window_start}–${slot.window_end}`,
          };
        }

        // Recompute tier; bump priority to 'rush' on flip-to-critical (one-way ratchet).
        const tier = applyUrgencyTier(q.deadline, q.attempt_count, q.max_attempts, new Date().toISOString());
        const priorityClause = tier === 'critical'
          ? `, priority = CASE WHEN priority IN ('urgent') THEN priority ELSE 'rush' END`
          : '';
        await execute(
          db,
          `UPDATE serve_queue SET urgency_tier = ?, urgency_computed_at = datetime('now') ${priorityClause}
             WHERE id = ?`,
          tier, id,
        ).catch((e) => {
          console.warn('[serveIntake] urgency_tier update skipped:', e instanceof Error ? e.message : e);
          return null;
        }); // urgency_tier column may not exist on live yet (mig 0140 pending Task 7)
      } else {
        // replanAfterFailedAttempt returned null (no viable window) — mark failed.
        await execute(
          db,
          `UPDATE serve_queue SET status = 'failed', updated_at = datetime('now') WHERE id = ?`,
          id,
        );
      }
    }
  }

  return c.json({
    success: true,
    id: attemptId,
    attempt_number: nextNum,
    queue_status: newStatus,
    ...(replanSummary ? { replan: replanSummary } : {}),
  });
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

// ── GET /map-items — geocoded queue items for the intake map ──
si.get('/map-items', async (c) => {
  const denied = requireRole(c, ...INTAKE_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  // Join next scheduled attempt window per queue item for popup display.
  const rows = await query<{
    id: number; status: string; priority: string;
    recipient_name: string | null; recipient_address: string | null;
    recipient_city: string | null; recipient_state: string | null;
    document_type: string | null; case_number: string | null;
    deadline: string | null; attempt_count: number; recipient_type: string | null;
    recipient_lat: number | null; recipient_lng: number | null;
    location_note_id: number | null; location_note_text: string | null;
    next_attempt_date: string | null; next_attempt_window: string | null;
  }>(
    db,
    `SELECT q.id, q.status, q.priority,
            q.recipient_name, q.recipient_address, q.recipient_city, q.recipient_state,
            q.document_type, q.case_number, q.deadline, q.attempt_count,
            q.parsed_data->>'recipient_type' AS recipient_type,
            q.parsed_data->>'recipient_lat'  AS recipient_lat,
            q.parsed_data->>'recipient_lng'  AS recipient_lng,
            sn.id   AS location_note_id,
            sn.note_text AS location_note_text,
            ns.scheduled_date AS next_attempt_date,
            ns.window_start || '–' || ns.window_end AS next_attempt_window
     FROM serve_queue q
     LEFT JOIN serve_attempt_schedules ns ON ns.id = (
       SELECT id FROM serve_attempt_schedules
       WHERE queue_id = q.id AND dismissed = 0 AND notified = 0
       ORDER BY scheduled_date ASC, window_start ASC LIMIT 1
     )
     LEFT JOIN serve_location_notes sn ON sn.id = ns.location_note_id AND sn.active = 1
     WHERE q.status NOT IN ('served','cancelled','failed')
     ORDER BY q.priority DESC, q.deadline ASC NULLS LAST
     LIMIT 500`,
  );
  return c.json(rows);
});

// ── Location notes — CRUD + lookup ───────────────────────────

si.get('/location-notes', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const { search, active_only } = c.req.query() as Record<string, string>;
  const notes = await listLocationNotes(db, {
    search: search || undefined,
    active_only: active_only !== 'false',
  });
  return c.json(notes);
});

si.get('/location-notes/lookup', async (c) => {
  const denied = requireRole(c, ...INTAKE_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const { businessName, personName, address } = c.req.query() as Record<string, string>;
  const note = await findLocationNote(db, {
    businessName: businessName || null,
    personName: personName || null,
    address: address || null,
  });
  return c.json(note ?? null);
});

si.post('/location-notes', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const body = await c.req.json<CreateNoteInput>();
  if (!body.note_text?.trim()) return c.json({ error: 'note_text required' }, 400);
  if (!body.entity_type) return c.json({ error: 'entity_type required' }, 400);
  const id = await createLocationNote(db, {
    ...body,
    created_by: c.var.user?.id ?? null,
  });
  return c.json({ id }, 201);
});

si.put('/location-notes/:noteId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const id = Number(c.req.param('noteId'));
  if (!id) return c.json({ error: 'invalid id' }, 400);
  const body = await c.req.json<Partial<CreateNoteInput>>();
  await updateLocationNote(db, id, body);
  return c.json({ ok: true });
});

si.delete('/location-notes/:noteId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const id = Number(c.req.param('noteId'));
  if (!id) return c.json({ error: 'invalid id' }, 400);
  await deactivateLocationNote(db, id);
  return c.json({ ok: true });
});

export default si;
