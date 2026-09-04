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
import { clampIntParam } from '../utils/paginationParams';
import { getContainer } from '@cloudflare/containers';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, columnExists } from '../utils/db';
import {
  extractFromText,
  extractTextFromPdf,
  extractPdfMarkdown,
  isScanStub,
  fieldsToQueueRow,
  familyFromFileName,
  needsCriticPass,
  applyCriticResults,
  criticExtract,
  CRITIC_TIMEOUT_MS,
  normalizeFields,
  toIsoDate,
  type ExtractionResult,
  type ExtractedField,
  type PdfTextResult,
} from '../utils/serveIntakeExtract';
import { withTimeout, ocrImage, ocrText } from '../utils/serveIntakeOcr';
import { loadFlags } from './adminDev';
import { estimateNeurons, estimatePacketNeurons, FREE_NEURONS_PER_DAY } from '../utils/serveIntakeNeurons';
import { precleanText, detectHomoglyphs } from '../utils/serveIntakePreclean';
import { arbitrateFields, reconcileIdentityConflicts, type DocCandidate, type FieldConflict, type IdentityWinnerDoc } from '../utils/serveIntakeArbitrate';
import { finalizeFields } from '../utils/serveIntakeValidate';
import { judgeMerged } from '../utils/serveIntakeJudge';
import { parseDefendants } from '../utils/serveIntakeDefendants';
import { commitIntake, type CommitResult } from '../utils/serveIntakeRecords';
import { emitAlert } from '../utils/alertHub';
import { lookupPsoCode, codeToLegacyResult } from '../utils/processServiceCodes';
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
import {
  loadPersistedPlanContext, planContextFromRow,
  PLAN_CONTEXT_COLUMNS, type PlanContextRow,
} from '../utils/servePlanContext';
import { broadcastAll } from './ws';
import { recordAudit } from '../utils/auditLog';
import { notifyServeCompletion } from '../utils/serveCompletionNotify';

import { dbErrorResponse } from '../utils/dbErrors';
import { log } from '../utils/logger';
import { putEncrypted, getDecrypted, FileEncryptionError } from '../utils/encryptedR2';
import { routeJsonColumn } from '../utils/serveRoutePayload';
// ── Migration 0140 runtime reconciler ───────────────────────
// D1 deploy apply is continue-on-error; columns may be absent on live.
// One-shot per Worker instance (cold starts re-run, idempotent).
let scheduleSchemaReconciled = false;
async function reconcileScheduleSchema(db: D1Database): Promise<void> {
  if (scheduleSchemaReconciled) return;
  // Set flag ONLY after all DDL succeeds — same pattern as ensureQualityGateColumns.
  // Setting it before means a failed ALTER on one cold-start permanently skips
  // reconciliation for the lifetime of that isolate.
  let allOk = true;

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
    } catch (err) { log.warn(`[serve-intake] reconcile ${name} failed`, { name, error: err instanceof Error ? err.message : String(err) }); allOk = false; }
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
    } catch (err) { log.warn(`[serve-intake] reconcile ${name} failed`, { name, error: err instanceof Error ? err.message : String(err) }); allOk = false; }
  }

  // PR 2: updated_at for optimistic concurrency on PATCH /schedule/:slotId
  for (const [name, type] of [
    ['updated_at', "TEXT NOT NULL DEFAULT (datetime(\'now\'))"],
  ] as const) {
    try {
      if (!(await columnExists(db, 'serve_attempt_schedules', name))) {
        await execute(db, `ALTER TABLE serve_attempt_schedules ADD COLUMN ${name} ${type}`);
      }
    } catch (err) { log.warn(`[serve-intake] reconcile ${name} failed`, { name, error: err instanceof Error ? err.message : String(err) }); allOk = false; }
  }

  if (allOk) scheduleSchemaReconciled = true;
}

// ── Migration 0152 runtime reconciler ───────────────────────
// Same pattern as reconcileScheduleSchema — deploy.yml's migration
// apply is continue-on-error, so the Worker self-heals.
let qualityGateReconciled = false;
async function ensureQualityGateColumns(db: D1Database): Promise<void> {
  if (qualityGateReconciled) return;
  // Set the flag only after DDL succeeds so a caught failure on this isolate
  // doesn't permanently skip reconciliation for subsequent requests.
  let allOk = true;

  try {
    await execute(db, `CREATE TABLE IF NOT EXISTS serve_intake_judge_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime(\'now\')),
      model TEXT NOT NULL,
      ms INTEGER NOT NULL,
      raw_response TEXT,
      flagged_field_count INTEGER NOT NULL DEFAULT 0,
      overall_status TEXT NOT NULL,
      fallback_chain TEXT NOT NULL,
      upload_user_id INTEGER
    )`);
  } catch (err) {
    log.warn('[serve-intake] judge_runs create failed', { error: err instanceof Error ? err.message : String(err) });
    allOk = false;
  }

  for (const [name, type] of [
    ['quality_status', "TEXT NOT NULL DEFAULT 'clean'"],
    ['judge_run_id', 'INTEGER'],
    ['quality_reviewed_by', 'INTEGER'],
    ['quality_reviewed_at', 'TEXT'],
  ] as const) {
    try {
      if (!(await columnExists(db, 'serve_queue', name))) {
        await execute(db, `ALTER TABLE serve_queue ADD COLUMN ${name} ${type}`);
      }
    } catch (err) {
      log.warn(`[serve-intake] reconcile ${name} failed`, { name, error: err instanceof Error ? err.message : String(err) });
      allOk = false;
    }
  }

  if (allOk) qualityGateReconciled = true;
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
const STATUSES = new Set(['pending', 'assigned', 'in_progress', 'served', 'attempted', 'failed', 'cancelled', 'archived']);
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

function emptyExtraction(model: string, error?: string): ExtractionResult {
  return {
    success: false, documentType: 'other', confidence: 0,
    fields: {} as Record<string, ExtractedField>, rawText: '', allDates: [],
    model, ms: 0, error,
  };
}

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

// Ceiling on the Workers AI toMarkdown() call. It walks the PDF StructTree
// and invokes no model, so it's normally fast — but it's still a binding
// call, and a stalled one shouldn't hang the request. On timeout we fall
// through to the container path exactly like a rejected/empty result.
const TOMARKDOWN_TIMEOUT_MS = 8_000;
const EMPTY_PDF_TEXT: PdfTextResult = { text: '', source: 'empty', structured: false, page_count: 0 };

// Per-call ceiling on any single Workers AI invocation (per-doc text
// extraction or per-image Vision). Without this a slow/stalled model
// call hangs the whole /upload request — the original "stuck on upload"
// cause. On timeout we record the doc as failed rather than blocking.
// 35s (was 25s): real extractions land ~20-22s even after dropping the
// json_schema constraint, so 25s left only a 3-5s margin and tipped over
// under model load. Calls run in PARALLEL, so this is the per-doc ceiling
// AND roughly the whole-request ceiling — not additive across docs.
// Per-ATTEMPT ceiling. Raised from 35s on 2026-07-24: the recorded live failure
// (`Extraction failed: Text extraction timed out`) was a legitimately slow
// extraction on a large document, not a hung call, so the old ceiling was simply
// too tight.
//
// aiBudget/withTimeout/ocrImage/ocrText now live in ../utils/serveIntakeOcr —
// hoisted out (2026-07-26) so they're importable from plain Node vitest tests
// without dragging in this file's @cloudflare/containers import (which needs
// a real Workers/Miniflare runtime). AI_TIMEOUT_MS stays here too since it's
// used directly below (not just via aiBudget's default).
const AI_TIMEOUT_MS = 45_000;

const TESSERACT_CONTAINER_NAME = 'shared'; // matches src/routes/tesseractOcr.ts's CONTAINER_NAME

// Tesseract-first OCR leg, gated behind the tesseract_ocr_primary feature
// flag (default OFF — see src/routes/adminDev.ts DEFAULT_FLAGS). When
// enabled, calls the self-hosted Tesseract container for raw text, then
// runs that text through the SAME Claude-first/Workers-AI-fallback field
// extraction as every other text-based leg (ocrText) — Tesseract only
// replaces the OCR step, not field extraction. Falls back to the existing
// Claude-vision -> Workers-AI-vision chain (ocrImage) on ANY container
// error, exactly like every other leg in this pipeline degrades rather
// than failing the request.
async function ocrImageWithTesseractGate(
  env: Env['Bindings'], bytes: Uint8Array, mime: string,
): Promise<ExtractionResult> {
  let tesseractEnabled = false;
  try {
    const flags = await loadFlags(env.KV);
    tesseractEnabled = flags.tesseract_ocr_primary;
  } catch {
    tesseractEnabled = false; // KV read failure must not block OCR — fall through to the existing chain
  }

  if (tesseractEnabled) {
    try {
      const form = new FormData();
      form.append('image', new Blob([bytes], { type: mime }), 'input');
      const container = getContainer(env.TESSERACT_OCR, TESSERACT_CONTAINER_NAME);
      const res = await container.fetch(new Request('http://container/ocr', { method: 'POST', body: form }));
      if (res.ok) {
        const body = await res.json() as { text?: string };
        const text = (body.text ?? '').trim();
        if (text.length >= 20) {
          const extraction = await ocrText(env, text);
          if (extraction.success) {
            return { ...extraction, model: `tesseract+${extraction.model}` };
          }
        }
      }
    } catch {
      // Container unreachable, timed out, or returned unusable text — fall
      // through to the existing chain below, same as every other leg here.
    }
  }

  return ocrImage(env, bytes, mime);
}

async function storeToR2(env: Env['Bindings'], file: File, uploaderId: number | null): Promise<string> {
  const ts = Date.now();
  const safeName = (file.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const key = `serve-intake/${uploaderId ?? 'anon'}/${ts}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
  await putEncrypted(env.UPLOADS, getDb(env), env, key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
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
      extraction = await ocrImageWithTesseractGate(c.env, bytes, file.type);
      ocrEngine = extraction.model.startsWith('tesseract+')
        ? 'tesseract'
        : extraction.model.startsWith('claude') ? 'claude-vision' : 'workers-ai-vision';
    } else if (isPdf(file.type)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text: string;
      // Zero-neuron structured tier first: env.AI.toMarkdown() walks the PDF
      // StructTree and does not interleave two-column layouts the way the
      // client's naive positional pdfjs concatenation (item.str joined by
      // reading order) does. Try it BEFORE the client text — pdfjs-client is
      // exactly the two-column interleaving hazard toMarkdown exists to avoid,
      // and any real intake form clears MIN_CLIENT_TEXT_CHARS, so putting
      // pdfjs-client first meant toMarkdown almost never ran. Only fall
      // through to pdfjs-client, then the container (not rolled out in prod
      // anyway), when toMarkdown comes back empty or looks like an unreadable
      // scan stub.
      const md = await withTimeout(
        extractPdfMarkdown(c.env.AI, bytes, file.name || 'doc.pdf'),
        TOMARKDOWN_TIMEOUT_MS, 'toMarkdown timed out',
      ).catch(() => EMPTY_PDF_TEXT);
      if (md.text && !isScanStub(md.text, md.page_count)) {
        text = md.text;
        pageCount = md.page_count;
        ocrEngine = 'workers-ai-tomarkdown';
        log.info('scan-document: toMarkdown structured extraction used', {
          traceId: c.get('traceId'), file: file.name, structured: md.structured,
          chars: md.text.length, page_count: md.page_count,
        });
      } else if (clientText.length >= MIN_CLIENT_TEXT_CHARS) {
        text = clientText;
        ocrEngine = 'pdfjs-client';
      } else {
        const container = getContainer(c.env.PDF_TOOLS, PDF_TOOLS_NAME);
        try {
          const txt = await withTimeout(
            extractTextFromPdf(container, bytes, file.name || 'doc.pdf'),
            CONTAINER_TIMEOUT_MS, 'PDF Tools container timed out or unavailable',
          );
          text = txt.text;
          pageCount = txt.page_count;
          ocrUsed = txt.ocr_used;
          ocrEngine = ocrUsed ? 'tesseract' : 'pdftotext';
        } catch (e) {
          log.warn('scan-document: PDF Tools container unavailable, falling back to client_text', {
            traceId: c.get('traceId'),
            error: e instanceof Error ? e.message : String(e),
          });
          text = clientText;
          ocrEngine = 'container-unavailable';
        }
      }
      // Single choke point for OCR-noise scrubbing — see the matching note
      // on /upload. Applying precleanText after tier selection (rather than
      // only on the container leg) is what keeps the pdfjs-client tier, the
      // exact tier where the RUSH watermark and Cyrillic homoglyphs survive,
      // from reaching the model and the state/ZIP validator uncleaned.
      // Idempotent, so the already-cleaned toMarkdown/container text is safe.
      const rawTextForHomoglyphCheck = text;
      text = precleanText(text);
      const homoglyphSubstitutions = detectHomoglyphs(rawTextForHomoglyphCheck);
      if (homoglyphSubstitutions.length > 0) {
        log.info('scan-document: homoglyph substitutions detected', {
          traceId: c.get('traceId'),
          substitutions: homoglyphSubstitutions,
        });
      }
      // Same family-derivation as /upload — this is the pre-commit PREVIEW
      // the officer actually reviews, so it must use the SAME prompt guidance
      // the eventual /upload commit extraction gets. Without this, the two
      // paths could disagree on the same document.
      const docFamily = familyFromFileName(file.name);
      extraction = text.trim().length >= 20
        ? await ocrText(c.env, text, docFamily)
        : emptyExtraction('none', 'Insufficient text to extract');
    } else {
      return c.json({ error: `Unsupported file type: ${file.type}` }, 400);
    }
  } catch (err) {
    return dbErrorResponse(c, err, 'Extraction failed');
  }

  // This is the PREVIEW the officer reviews before committing. It must show
  // the same values /upload will actually write — previously this returned
  // the model's raw fields while /upload normalized+validated them, so the
  // screen said `6/26/2026` / `Utah` / `(435) 986-1200` and the record said
  // `2026-06-26` / `UT` / `4359861200`. Same seam, same result.
  const previewValidation = finalizeFields(extraction.fields, new Date().toISOString());
  if (previewValidation.issues.length) {
    log.warn('scan-document validation issues', {
      traceId: c.get('traceId'),
      count: previewValidation.issues.length,
      issues: previewValidation.issues.slice(0, 10),
    });
  }

  return c.json({
    success: extraction.success,
    documentType: extraction.documentType,
    confidence: extraction.confidence,
    fields: previewValidation.adjusted,
    validationIssues: previewValidation.issues,
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

  // Client-provided pdfjs text, keyed by filename. The browser already ran
  // pdfjs on each PDF during drag-drop. toMarkdown (see below) is tried
  // FIRST for every PDF — this client text is only the fallback for
  // born-digital PDFs toMarkdown can't read, used instead of round-tripping
  // through the PDF Tools container (which is NOT rolled out in prod —
  // deploy uses --containers-rollout=none — so a container fetch would
  // hang). Only PDFs that toMarkdown AND client text both fail on fall
  // through to the container.
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
  await ensureQualityGateColumns(db);
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
    // Packet family derived from the uploaded FILE NAME (ICU's fixed naming
    // convention), independent of what the model guessed the document was.
    // Arbitration ranks on this when present: the filename is the reliable
    // signal, and the model's DOC_TYPES classification is not — it will
    // reasonably call "Court Docket.pdf" a 'subpoena'. undefined when the
    // name doesn't match a known convention, in which case arbitration
    // falls back to ex.documentType.
    family?: string;
    error?: string;          // file-level (read/store) error
    // Positive fact: true only if this doc's extraction call was actually
    // invoked (extractFromText/ocrImage), regardless of whether it then
    // succeeded or timed out. False for unsupported types, read/store
    // errors, and PDFs with too little text to bother calling — those get
    // an emptyExtraction() stand-in but never touch the model, so they must
    // never be priced. See serveIntakeNeurons.ts PacketDocNeuronInput.
    modelCalled: boolean;
  }

  const collected: Collected[] = await Promise.all(files.map(async (file): Promise<Collected> => {
    const r2Key = await storeToR2(c.env, file, user.id).catch(() => null);
    // Intake packets follow a fixed naming convention ("<job#> Field
    // Sheet.pdf" / "Court Docket.pdf" / "Information Form.pdf") — derive
    // the document family from the uploaded file's own name so the system
    // prompt gets that family's layout-specific guidance AND arbitration
    // ranks on the reliable signal rather than the model's guess. Falls
    // back to undefined (generic prompt / ex.documentType) for anything
    // that doesn't clearly match one of the three conventions.
    const docFamily = familyFromFileName(file.name);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());

      // Images: Vision does OCR + extraction in one timeout-bounded pass.
      if (isImage(file.type)) {
        const ex = await ocrImageWithTesseractGate(c.env, bytes, file.type)
          .catch((e) => emptyExtraction('workers-ai-vision', e instanceof Error ? e.message : String(e)));
        const engine = ex.model.startsWith('tesseract+')
          ? 'tesseract'
          : ex.model.startsWith('claude') ? 'claude-vision' : 'workers-ai-vision';
        for (const d of ex.allDates) allDates.add(d);
        return { file, text: ex.rawText, pageCount: 0, ocrUsed: true, ocrEngine: engine, r2Key, ex, family: docFamily, modelCalled: true };
      }

      // PDFs: acquire text, then extract fields from THIS doc alone.
      if (isPdf(file.type)) {
        let text = '';
        let ocrEngine = 'pdfjs-client';
        let ocrUsed = false;
        let pageCount = 0;
        const clientText = clientTextByName.get(file.name) || '';
        // Same zero-neuron structured tier as /scan-document: try toMarkdown
        // BEFORE the pdfjs-client text (that positional-concatenation text is
        // exactly the two-column interleaving hazard toMarkdown exists to
        // avoid) and before the container round-trip.
        const md = await withTimeout(
          extractPdfMarkdown(c.env.AI, bytes, file.name || 'doc.pdf'),
          TOMARKDOWN_TIMEOUT_MS, 'toMarkdown timed out',
        ).catch(() => EMPTY_PDF_TEXT);
        if (md.text && !isScanStub(md.text, md.page_count)) {
          text = md.text; pageCount = md.page_count;
          ocrEngine = 'workers-ai-tomarkdown';
          log.info('upload: toMarkdown structured extraction used', {
            traceId: c.get('traceId'), file: file.name, structured: md.structured,
            chars: md.text.length, page_count: md.page_count,
          });
        } else if (clientText.length >= MIN_CLIENT_TEXT_CHARS) {
          text = clientText;
        } else {
          const container = getContainer(c.env.PDF_TOOLS, PDF_TOOLS_NAME);
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
        // ── Single choke point for OCR-noise scrubbing ──────────────
        // precleanText MUST run on whichever tier won, not just on the
        // container leg. The pdfjs-client tier is precisely where the
        // hazard lives: positional concatenation leaves a diagonal RUSH
        // watermark as isolated H/S/U/R lines, and homoglyph substitutions
        // ("СA" with a Cyrillic С) survive into recipient_state, where
        // validateFields' STATE_ZIP_PREFIX lookup then misses entirely and
        // SILENTLY skips the ZIP↔state check. precleanText is idempotent,
        // so applying it once here after tier selection covers every tier
        // (including the already-cleaned container text) with no double-
        // scrub risk, and no future tier can escape it.
        const rawTextForHomoglyphCheck = text;
        text = precleanText(text);
        const homoglyphSubstitutions = detectHomoglyphs(rawTextForHomoglyphCheck);
        if (homoglyphSubstitutions.length > 0) {
          log.info('upload: homoglyph substitutions detected', {
            traceId: c.get('traceId'),
            substitutions: homoglyphSubstitutions,
          });
        }
        // modelCalled is set true ONLY inside the branch that actually
        // invokes extractFromText — not derived from the outcome, so a
        // timeout/error caught below still counts as "reached the model"
        // (real neuron cost was incurred even though the call failed).
        const willCallModel = text.trim().length >= 20;
        const ex = willCallModel
          ? await withTimeout(
              extractFromText(c.env.AI, text.slice(0, PER_DOC_CAP), c.env.SERVE_INTAKE_LORA, docFamily),
              AI_TIMEOUT_MS, 'Field extraction timed out',
            ).catch((e) => emptyExtraction(EXTRACT_MODEL, e instanceof Error ? e.message : String(e)))
          : emptyExtraction(EXTRACT_MODEL, 'Insufficient text to extract');
        ex.rawText = text;
        for (const d of ex.allDates) allDates.add(d);
        return { file, text, pageCount, ocrUsed, ocrEngine, r2Key, ex, family: docFamily, modelCalled: willCallModel };
      }

      return {
        file, text: '', pageCount: 0, ocrUsed: false, ocrEngine: 'unsupported', r2Key,
        ex: emptyExtraction(EXTRACT_MODEL, `Unsupported type ${file.type}`),
        error: `Unsupported type ${file.type}`,
        family: docFamily,
        modelCalled: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        file, text: '', pageCount: 0, ocrUsed: false, ocrEngine: 'error', r2Key,
        ex: emptyExtraction(EXTRACT_MODEL, msg), error: msg, family: docFamily, modelCalled: false,
      };
    }
  }));

  // ── Neuron cost accounting (spec §6) ────────────────────────
  // Estimates Workers AI Neuron consumption so the 10k/day free ceiling is
  // observable before it's hit. Per doc, not per combined string: /upload
  // runs one extraction call PER DOCUMENT (see the "why per-doc" note
  // above), each capped at PER_DOC_CAP chars — so `sentChars` mirrors the
  // exact slice handed to extractFromText, not the doc's full raw text.
  // extraction.model is read per-doc too, since ocrText/extractFromText can
  // fall back to a different model than the configured default.
  //
  // Vision docs (images) are excluded from the input-token estimate: their
  // model input is the image itself, not text, and c2.text there holds the
  // OCR'd OUTPUT, not what was sent in. There's no chars/4-style proxy for
  // image input given here, and guessing one would measure the wrong thing
  // — worse than omitting it. Their neuron cost still exists; it's just not
  // estimable from values already in hand, so this total is a floor, not a
  // ceiling, for image-heavy packets — surfaced below via `vision_docs` /
  // `partial` so the log is self-describing instead of relying on a source
  // comment nobody watching the log can see.
  //
  // Documents that never reached the model (unsupported type, read/store
  // error, insufficient text) are excluded via `modelCalled` — a positive
  // fact set at the point of the actual call, NOT inferred from `ocrEngine`
  // string matching. String matching only covers the engines someone
  // remembered to list, and previously let unsupported/errored/skipped PDFs
  // get priced at ~105 phantom neurons apiece for calls that never happened.
  const visionDocs = collected.filter(
    (c2) => c2.ocrEngine === 'workers-ai-vision' || c2.ocrEngine === 'claude-vision',
  ).length;
  const intakeNeurons = estimatePacketNeurons(collected.map((c2) => ({
    model: c2.ex.model,
    textLength: Math.min(c2.text.length, PER_DOC_CAP),
    modelCalled: c2.modelCalled,
    isVision: c2.ocrEngine === 'workers-ai-vision' || c2.ocrEngine === 'claude-vision',
  })));
  log.info('serve-intake neurons', {
    traceId: c.get('traceId'),
    neurons: intakeNeurons,
    free_daily: FREE_NEURONS_PER_DAY,
    docs: collected.length,
    vision_docs: visionDocs,
    partial: visionDocs > 0,
  });

  // ── Cross-document arbitration ──
  // Was: highest-confidence value per field wins, source-blind. That lets
  // a confidently-wrong value from the wrong document beat an authoritative
  // one — the Field Sheet's Case/Court cells are frequently blank or
  // watermark-corrupted while the Court Docket has them authoritatively,
  // and the Information Form is the operational record for service
  // mechanics. arbitrateFields() ranks candidates by source precedence
  // (confidence only breaks a tie within the same rank) and RETAINS the
  // losing candidate in `conflicts` so a human can pick it later (PR 4
  // review UI) instead of silently discarding it.
  //
  // Rank on the FILENAME-derived family first. The model classifies the lead
  // document specifically — it will reasonably call "Court Docket.pdf" a
  // 'subpoena' — and a specific-but-correct classification that isn't one of
  // the three packet-family names would otherwise rank 0 and lose to the
  // field sheet, inverting precedence on the modal packet. (arbitrateFields
  // also collapses court-form enum members onto court_filing as a second line
  // of defense for the ex.documentType fallback.)
  // Normalize per-candidate BEFORE arbitration so the conflicts audit records
  // the values that will actually be committed. Previously arbitration ran on
  // raw model output and normalization ran once afterwards (via
  // finalizeFields, below), so a persisted conflict could read
  // chosen: "6/26/2026" while the row held "2026-06-26" — PR 4's resolver
  // would show a value that disagrees with the record it is resolving.
  const docCandidates: DocCandidate[] = collected.map((c2) => ({
    docType: c2.family ?? c2.ex.documentType,
    fields: normalizeFields(c2.ex.fields),
  }));
  const arbitration = arbitrateFields(docCandidates);
  const mergedFields: Record<string, ExtractedField> = arbitration.merged;
  let conflicts: FieldConflict[] = arbitration.conflicts;
  let bestConfidence = 0;
  let bestDocType = 'other';
  // synthetic combined.error placeholder so downstream warning logic can
  // report the most relevant extraction failure.
  let combinedError: string | null = null;
  for (const c2 of collected) {
    if (c2.ex.confidence > bestConfidence) {
      bestConfidence = c2.ex.confidence;
      bestDocType = c2.ex.documentType;
    }
    if (c2.ex.error && !combinedError) combinedError = c2.ex.error;
  }
  if (conflicts.length) {
    log.info('serve-intake: cross-document field conflicts arbitrated', {
      traceId: c.get('traceId'),
      count: conflicts.length,
      fields: conflicts.map((cf) => cf.field),
    });
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
  // Score (and select) from the NORMALIZED docCandidates, not the raw
  // c2.ex extraction results. Two reasons: (1) the winner's fields flow
  // straight into reconcileIdentityConflicts as `winnerDoc`, and that
  // function writes `winnerDoc.fields[k]` verbatim into both
  // `mergedFields` and `conflicts[].chosen` — if that source were raw
  // model output, an identity field the guard overrides (e.g.
  // recipient_dob in `M/D/YYYY`) would persist a conflict whose `chosen`
  // disagrees with the normalized value finalizeFields commits, exactly
  // the chosen≠committed bug part (a) above exists to close, just via
  // this second path. (2) a name field that normalizes to empty (all
  // placeholder/noise) should score 0, not the model's optimistic
  // confidence — docCandidates already reflects that via normalizeFields.
  const recipientScore = (fields: Record<string, ExtractedField>): number => {
    // Weight the name-defining fields; a doc that only mentions a DOB
    // shouldn't outrank one that has the actual first+last name.
    return (fields.recipient_first_name?.value ? fields.recipient_first_name.confidence : 0)
      + (fields.recipient_last_name?.value ? fields.recipient_last_name.confidence : 0)
      + (fields.recipient_business_name?.value ? fields.recipient_business_name.confidence : 0);
  };
  let bestDoc: IdentityWinnerDoc | null = null;
  let bestScore = 0;
  for (const dc of docCandidates) {
    const s = recipientScore(dc.fields);
    if (s > bestScore) { bestScore = s; bestDoc = { documentType: dc.docType, fields: dc.fields }; }
  }
  // This guard can override arbitration's per-field pick (it selects the
  // whole name group from one document, not per-field precedence), so
  // `conflicts`/`mergedFields` must be reconciled — pulled out as a pure,
  // independently-tested function (see serveIntakeArbitrate.ts) since the
  // rest of this handler needs D1/R2/AI bindings a unit test can't supply.
  conflicts = reconcileIdentityConflicts(conflicts, mergedFields, docCandidates, bestDoc, IDENTITY_GROUP);

  // ── Deterministic normalization + cross-field validation ───────
  // finalizeFields() is the ONE seam that applies both, in order:
  //   normalize — enforce the shapes the prompt only *requests* (digits-only
  //   phones, 2-letter states, 5(+4) ZIPs, ISO dates), so every downstream
  //   consumer (queue row, person/property writes, the success card) sees
  //   clean values;
  //   validate — the model self-reports confidence and it is optimistic, so
  //   check what can be checked without a model (ZIP↔state agreement, phone
  //   digit count, date sanity) and fold the result back into the score.
  // /scan-document runs the identical seam, so the preview an officer
  // reviews and the record that commits can no longer disagree.
  const nowIso = new Date().toISOString();
  const validation = finalizeFields(mergedFields, nowIso);
  if (validation.issues.length) {
    log.warn('serve-intake validation issues', {
      count: validation.issues.length,
      issues: validation.issues.slice(0, 10),
    });
  }
  let validatedFields = validation.adjusted;
  // The issue set that will be PERSISTED alongside the committed record.
  // Starts as the first-pass issues, but the critic pass below re-runs
  // finalizeFields on its own output — if that revalidation isn't also
  // captured here, a persisted validation_issues can go stale relative to
  // `validatedFields`: it can show an issue the critic already resolved,
  // or omit one the critic-adjusted revalidation newly introduced. The
  // officer reading the reason for a lowered confidence must see the
  // reason for the value actually on the record, not the pre-critic one.
  let committedValidationIssues = validation.issues;

  // ── Bounded critic pass (spec item 10) ──────────────────────────
  // Re-ask the model ONLY about the doubtful critical fields (capped at 5
  // by needsCriticPass), so a badly-scanned packet gets a second look
  // without doubling neuron spend on every packet. A critic failure must
  // never fail the upload — the catch below keeps the first-pass fields,
  // and applyCriticResults() never lets an empty critic answer overwrite
  // a value the first pass already found.
  // needsCriticPass deliberately reads the PRE-critic `validation.issues`
  // — that's the correct input for deciding whether to run the critic at
  // all, a different job from explaining the committed record.
  const criticFields = needsCriticPass(validatedFields, validation.issues);
  if (criticFields.length) {
    const combinedText = collected.map((c2) => c2.text || '').filter(Boolean).join('\n\n');
    log.info('serve-intake critic pass', { traceId: c.get('traceId'), fields: criticFields });
    try {
      const critic = await withTimeout(
        criticExtract(c.env, combinedText, criticFields),
        CRITIC_TIMEOUT_MS, 'Critic pass timed out',
      );
      const postCritic = finalizeFields(applyCriticResults(validatedFields, critic), nowIso);
      validatedFields = postCritic.adjusted;
      committedValidationIssues = postCritic.issues;
    } catch (e) {
      log.warn('serve-intake critic pass failed; keeping first-pass fields', {
        traceId: c.get('traceId'),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ── Phase 1 Quality Gate: judge the merged result ──────────────
  const rawDocsForJudge = collected.map(c2 => ({ name: c2.file.name, text: c2.text || '' }));
  const docTypesForJudge = collected.map(c2 => c2.ex.documentType);
  const judgeResult = await judgeMerged(
    c.env,
    validatedFields,
    rawDocsForJudge,
    docTypesForJudge,
  );

  // ── Operator pre-submission overrides ──────────────────────────────
  // Client sends `field_overrides` JSON (key → string) for values the
  // operator edited in the review panel before clicking Create. Applied
  // after normalizeFields so they bypass the formatter and commit as-is;
  // confidence 1.0 ensures they beat any AI-extracted value downstream.
  const overridesRaw = form.get('field_overrides');
  if (typeof overridesRaw === 'string') {
    try {
      const overrides = JSON.parse(overridesRaw) as Record<string, string>;
      // Date fields typed manually by the operator arrive as free text (e.g. "Aug 25, 2026").
      // normalizeFields() ran before this point on AI values but not on operator overrides,
      // so we apply toIsoDate() here for known date fields to keep storage consistent.
      const DATE_OVERRIDE_FIELDS = new Set([
        'service_deadline', 'hearing_date', 'filing_date', 'attempt_start_not_before', 'recipient_dob',
      ]);
      for (const [k, v] of Object.entries(overrides)) {
        if (typeof v === 'string' && v.trim()) {
          const raw = v.trim();
          const normalized = DATE_OVERRIDE_FIELDS.has(k) ? (toIsoDate(raw) || raw) : raw;
          validatedFields[k] = { value: normalized, confidence: 1.0 };
        }
      }
      for (const k of Object.keys(overrides)) {
        if (judgeResult.verdicts[k]) delete judgeResult.verdicts[k];
      }
      judgeResult.flagged_field_count = Object.values(judgeResult.verdicts).filter(v => !v.ok).length;
      if (judgeResult.flagged_field_count === 0) judgeResult.overall_status = 'clean';
    } catch { /* ignore malformed overrides blob */ }
  }

  let judgeRunId: number | null = null;
  try {
    const judgeInsert = await db.prepare(`
      INSERT INTO serve_intake_judge_runs
        (model, ms, raw_response, flagged_field_count, overall_status, fallback_chain, upload_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      judgeResult.model,
      judgeResult.ms,
      judgeResult.raw_response,
      judgeResult.flagged_field_count,
      judgeResult.overall_status,
      JSON.stringify(judgeResult.fallback_chain),
      user.id,
    ).run();
    judgeRunId = judgeInsert.meta?.last_row_id ?? null;
  } catch (err) {
    log.warn('[serve-intake] judge_runs insert failed, proceeding without judge run id', { error: err instanceof Error ? err.message : String(err) });
  }

  // Operator-selected client_id (integer FK) sent as a separate FormData field
  // so it doesn't get coerced through the string-only field_overrides path.
  const clientIdRaw = form.get('client_id');
  const clientId = typeof clientIdRaw === 'string' && /^\d+$/.test(clientIdRaw.trim())
    ? Number(clientIdRaw.trim()) : null;

  let defendantsSelected: string[] | null = null;
  const defendantsRaw = form.get('defendants_selected');
  if (typeof defendantsRaw === 'string') {
    try {
      const arr = JSON.parse(defendantsRaw);
      if (Array.isArray(arr) && arr.every(s => typeof s === 'string')) {
        defendantsSelected = arr.map(s => s.trim()).filter(Boolean);
        if (defendantsSelected.length === 0) defendantsSelected = null;
      }
    } catch { /* malformed — fall back to single-recipient path */ }
  }

  // Expose under the same name the rest of the handler already reads.
  const combined = { error: combinedError } as { error: string | null };

  // ── Phase 3: persist a serve_intake_documents row per file ──
  const documents: any[] = [];
  const failedDocs: string[] = [];   // docs that yielded no usable extraction
  for (const c2 of collected) {
    if (c2.error && !c2.text) {
      // Persist even pre-extraction failures (upload/OCR error before any
      // text was recovered) — previously these were dropped from the
      // response only and never written to serve_intake_documents, so they
      // could never surface in the doc-recovery review queue for a retry.
      const failRes = await execute(
        db,
        `INSERT INTO serve_intake_documents (
          uploaded_by, file_name, file_type, r2_key, size_bytes, page_count,
          ocr_used, ocr_engine, status, error_message
        ) VALUES (?,?,?,?,?,?, ?,?,?,?)`,
        user.id, c2.file.name, c2.file.type, c2.r2Key, c2.file.size, c2.pageCount,
        c2.ocrUsed ? 1 : 0, c2.ocrEngine, 'failed', c2.error,
      );
      documents.push({ id: failRes.meta.last_row_id, file_name: c2.file.name, status: 'failed', error: c2.error });
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
  const row = fieldsToQueueRow(validatedFields);
  const docSummary = buildCallDescription(row, validatedFields, documents.length);
  let commit: CommitResult = {
    serve_queue_id: null, person_id: null, agent_person_id: null,
    business_id: null, property_id: null, call_id: null, call_number: null,
    case_id: null, rmpg_case_number: null,
    created: { person: false, agent_person: false, business: false, property: false, call: false },
  };
  if (row.recipient_name || row.recipient_address) {
    await reconcileScheduleSchema(db);
    commit = await commitIntake(db, {
      fields: validatedFields,
      queueRow: row,
      userId: user.id,
      documentSummary: docSummary,
      docCount: documents.length,
      clientId,
      defendantsSelected,
      judgeRunId,
      qualityStatus: judgeResult.overall_status === 'error' ? 'needs_review' : judgeResult.overall_status,
      // Per-document OCR provenance → "OCR & EXTRACTION CONTEXT" note on the
      // call + compact line on serve_queue.notes + parsed_data._intake audit.
      docs: documents.map((d) => ({
        file_name: d.file_name, doc_type: d.doc_type ?? null,
        ocr_engine: d.ocr_engine ?? null, confidence: d.confidence ?? 0,
        success: !!d.success, page_count: d.page_count ?? null,
      })),
      allDates: [...allDates],
      conflicts,
      validationIssues: committedValidationIssues,
      env: c.env,
    });
    // Back-link the document rows to the new queue entry — and to the
    // auto-created Case File when commitIntake produced one. case_id
    // column lands with migration 0146; on legacy D1 the UPDATE 500s
    // and we fall back to the queue-only UPDATE (try/catch per doc).
    if (commit.serve_queue_id) {
      for (const d of documents) {
        if (!d.id) continue;
        let linkedCase = false;
        if (commit.case_id) {
          try {
            await execute(db,
              'UPDATE serve_intake_documents SET serve_queue_id = ?, case_id = ? WHERE id = ?',
              commit.serve_queue_id, commit.case_id, d.id);
            linkedCase = true;
          } catch { /* legacy D1 without case_id col — fall through */ }
        }
        if (!linkedCase) {
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
  // Collected rather than a single reassigned string -- these three
  // conditions are independent (a duplicate-intake match can co-occur with a
  // partial extraction failure on one of the attached documents), and
  // overwriting a prior warning previously hid it entirely.
  const warnings: string[] = [];
  if (noRecords) {
    warnings.push(hadText
      ? `Documents stored but no recipient could be extracted${combined.error ? ` (${combined.error})` : ''}. Review the documents and create the entry manually.`
      : 'No readable text found in the uploaded documents (likely scans). Nothing was extracted.');
  }
  // Partial failure: the entry WAS created, but one or more documents didn't
  // extract — fields that live only on those (e.g. attorney/case details from a
  // Court Docket whose OCR timed out) may be missing. Previously this was
  // silent; surface it so the user knows to review those documents.
  if (!noRecords && failedDocs.length > 0) {
    warnings.push(`Entry created, but ${failedDocs.length} document(s) didn't extract (${failedDocs.join(', ')}). Some fields may be missing — review those documents.`);
  }
  // Duplicate intake: an ACTIVE queue entry already covers this case +
  // recipient. The uploaded documents were attached to it (back-link above);
  // no new call/queue/person records were created.
  if (commit.duplicate_of) {
    warnings.push(`Active serve entry #${commit.duplicate_of.serve_queue_id} already exists for this case and recipient (status: ${commit.duplicate_of.status}). Documents were attached to the existing entry — no new call was created.`);
  }
  const warning: string | null = warnings.length > 0 ? warnings.join(' ') : null;

  // Intake can spawn a CAD call (createServiceCall writes calls_for_service
  // directly, bypassing the calls.ts POST broadcast). Fan it to every dispatch
  // console via AlertHubDO so the new call lands on the board live, not only on
  // the next 20s poll. Best-effort — never blocks the response.
  if (commit.call_id) {
    try {
      const newCall = await queryFirst(db, `SELECT ${LIST_VIEW_COLUMNS.join(', ')} FROM calls_for_service WHERE id = ?`, commit.call_id);
      if (newCall) await emitAlert(c.env, 'dispatch_update', { action: 'call_created', call: newCall });
    } catch (err) { log.warn('[serveIntake] call_created broadcast skipped (non-fatal)', { error: err instanceof Error ? err.message : String(err) }); }
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
    // Auto-created Case File anchoring this batch (migration 0146).
    // Null when the case-create failed (best-effort) OR on legacy D1
    // without the cases table. UI surfaces "Case 26-000123-SV" on the
    // success card so the operator can jump straight to the file.
    case_id: commit.case_id ?? null,
    rmpg_case_number: commit.rmpg_case_number ?? null,
    created: commit.created,
    latitude: null,
    longitude: null,
    weather: null,
    lighting: null,
    // Legacy IntakeResult shape so the existing success card on
    // ServeIntakePage renders without any client-side branching on
    // which endpoint was hit.
    extracted: buildExtractedBlock(validatedFields),
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
    judge_verdicts: judgeResult.verdicts,
    quality_status: judgeResult.overall_status === 'error' ? 'needs_review' : judgeResult.overall_status,
    judge_run_id: judgeRunId,
    defendants_detected: parseDefendants(validatedFields.defendant?.value),
    merged: {
      documentType: bestDocType,
      confidence: bestConfidence,
      fields: validatedFields,
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
    hearingDate: get('hearing_date'),
    jurisdiction: get('jurisdiction'),
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
    recipientType: get('recipient_type'),
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

  // No hard cap previously — a packet with long business/attorney names,
  // multiple parties, and a long court name could produce a description well
  // past what the CAD board's one-line summary can show. Truncate at a
  // whole-segment boundary (never mid-word) so it still reads cleanly.
  const MAX_DESCRIPTION_LEN = 500;
  const full = parts.join(' · ');
  if (full.length <= MAX_DESCRIPTION_LEN) return full;
  let truncated = full.slice(0, MAX_DESCRIPTION_LEN);
  const lastSep = truncated.lastIndexOf(' · ');
  if (lastSep > 0) truncated = truncated.slice(0, lastSep);
  return truncated + ' …';
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

  // This route receives browser-extracted pdfjs text — positional
  // concatenation, the exact tier where a diagonal RUSH watermark lands as
  // isolated single letters and where Cyrillic homoglyphs ("СA") survive
  // into recipient_state and silently defeat validateFields' ZIP↔state
  // check. precleanText was never applied here; it is idempotent, so
  // scrubbing per-document before concatenation is safe regardless of what
  // the client already did.
  const combined = docs
    .map((d) => `--- ${d.type || 'document'} ---\n${precleanText(d.text || '')}`)
    .join('\n\n');
  const extraction = await extractFromText(c.env.AI, combined, c.env.SERVE_INTAKE_LORA);
  // Neuron cost accounting (spec §6): `combined` is exactly the text sent to
  // extractFromText above (no slicing/capping on this legacy route), and
  // extraction.model is whichever model actually ran — not necessarily the
  // configured default, since extractFromText can itself fall back. Output
  // tokens are a fixed 512 estimate for the structured JSON field payload;
  // Workers AI doesn't report actual usage back to this call. Pure
  // arithmetic — no extra AI/network call.
  log.info('serve-intake neurons', {
    traceId: c.get('traceId'),
    model: extraction.model,
    neurons: estimateNeurons(extraction.model, Math.ceil(combined.length / 4), 512),
    free_daily: FREE_NEURONS_PER_DAY,
    docs: docs.length,
  });
  // Same normalize+validate seam /upload and /scan-document apply, so this
  // legacy single-call route produces equally clean field shapes AND the
  // same cross-field validation (ZIP↔state, phone digit count, date sanity)
  // — without this, a cross-state paste through /intake would commit at an
  // un-penalized confidence with no validation-issue log line.
  const intakeValidation = finalizeFields(extraction.fields, new Date().toISOString());
  if (intakeValidation.issues.length) {
    log.warn('serve-intake validation issues', {
      traceId: c.get('traceId'),
      count: intakeValidation.issues.length,
      issues: intakeValidation.issues.slice(0, 10),
    });
  }
  const normalized = intakeValidation.adjusted;
  const row = fieldsToQueueRow(normalized);

  let commit: CommitResult = {
    serve_queue_id: null, person_id: null, agent_person_id: null,
    business_id: null, property_id: null, call_id: null, call_number: null,
    case_id: null, rmpg_case_number: null,
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
      // R9: these were computed and logged two lines above but never passed,
      // so the row persisted `validation_issues: []` while the log said
      // otherwise — an audit-trail lie on one of the two paths most likely
      // to HAVE issues.
      validationIssues: intakeValidation.issues,
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
    } catch (err) { log.warn('[serveIntake] call_created broadcast skipped (non-fatal)', { error: err instanceof Error ? err.message : String(err) }); }
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
  const denied = requireRole(c, ...INTAKE_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
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
  const denied = requireRole(c, ...INTAKE_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const docId = parseInt(c.req.param('docId'), 10);
  if (!Number.isFinite(docId) || docId < 1) return c.json({ error: 'Invalid docId' }, 400);
  const db = getDb(c.env);
  const doc = await queryFirst<{ r2_key: string; file_type: string; file_name: string }>(
    db,
    'SELECT r2_key, file_type, file_name FROM serve_intake_documents WHERE id = ?',
    docId,
  );
  if (!doc?.r2_key) return c.json({ error: 'Not found' }, 404);
  try {
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
  } catch (err) {
    if (err instanceof FileEncryptionError) {
      log.error('Serve-intake document decrypt failed', { docId }, err);
      return c.json({ error: 'File storage is temporarily unavailable. Contact a supervisor.', code: 'ENCRYPTION_FAILED' }, 503);
    }
    throw err;
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
    // getDecrypted() cleanly returns null for the legacy pre-encryption case
    // (no file_encryption_keys row — production already holds serve-intake/
    // objects written before this task shipped); it THROWS for a genuine
    // decrypt failure, which is deliberately left uncaught here so it
    // propagates as a real error instead of masquerading as "no image".
    const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env, doc.r2_key);
    let bytes: Uint8Array | null = decrypted ? decrypted.bytes : null;
    if (!bytes) {
      const legacy = await c.env.UPLOADS.get(doc.r2_key);
      if (legacy) bytes = new Uint8Array(await legacy.arrayBuffer());
    }
    if (bytes) extraction = await ocrImageWithTesseractGate(c.env, bytes, doc.file_type).catch(() => null);
  } else if ((doc.raw_text || '').trim().length >= 20) {
    // Same family derivation as /upload and /scan-document, from the
    // originally-uploaded file name stored on the document row.
    const docFamily = familyFromFileName(doc.file_name || '');
    // Rows written before precleanText existed on this path still hold raw,
    // uncleaned OCR text — reprocess is precisely the recovery path for
    // those rows, so it must not assume upstream cleaning already happened.
    // precleanText is idempotent, so already-clean text is unaffected.
    extraction = await ocrText(c.env, precleanText(doc.raw_text), docFamily).catch(() => null);
  }
  if (!extraction) {
    return { success: false, documentType: doc.doc_type || 'other', confidence: 0, model: '',
      committedQueueId: null, note: 'No image or stored text to re-extract (scanned PDF — re-upload as images)' };
  }
  // Same normalize+validate seam every other entry point applies — without
  // it, a re-extracted row would commit at an un-penalized confidence with
  // no validation-issue log line, even though this is the exact recovery
  // path for previously-failed rows.
  const reprocessValidation = finalizeFields(extraction.fields, new Date().toISOString());
  if (reprocessValidation.issues.length) {
    log.warn('serve-intake validation issues', {
      count: reprocessValidation.issues.length,
      issues: reprocessValidation.issues.slice(0, 10),
    });
  }
  const normalized = reprocessValidation.adjusted;
  const queueRow = fieldsToQueueRow(normalized);
  await execute(db,
    `UPDATE serve_intake_documents SET fields_json=?, confidence=?, extraction_model=?, doc_type=?,
       status=?, error_message=NULL, updated_at=datetime(\'now\') WHERE id=?`,
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
      // R9: same drop as the /intake path — computed + logged above, never
      // persisted. Reprocess is the recovery path for previously-failed
      // rows, so it is the MOST likely to carry real validation issues.
      validationIssues: reprocessValidation.issues,
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

// GET /review-queue — serve_queue entries filtered by quality_status.
// Defaults to 'needs_review'; accepts ?quality_status=clean|needs_review|reviewed_ok|reviewed_fixed.
// Also accepts ?count=1 to return only { count } for badge display.
si.get('/review-queue', async (c) => {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user || !INTAKE_ROLES.includes(user.role)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const db = getDb(c.env);
  await ensureQualityGateColumns(db);
  const status = c.req.query('quality_status');
  const countOnly = c.req.query('count') === '1';

  const qualityFilter = (status === 'needs_review' || status === 'clean' || status === 'reviewed_ok' || status === 'reviewed_fixed')
    ? status : 'needs_review';

  if (countOnly) {
    const row = await queryFirst<{ n: number }>(db,
      `SELECT COUNT(*) AS n FROM serve_queue WHERE quality_status = ?`, qualityFilter);
    return c.json({ count: row?.n ?? 0 });
  }

  // LEFT JOIN serve_intake_judge_runs to surface flagged_field_count + raw verdicts.
  const sql = `SELECT sq.id, sq.recipient_name, sq.recipient_address, sq.case_number,
                      sq.quality_status, sq.judge_run_id, sq.created_at,
                      sq.deadline, sq.priority,
                      jr.flagged_field_count, jr.raw_response AS judge_raw_response
               FROM serve_queue sq
               LEFT JOIN serve_intake_judge_runs jr ON jr.id = sq.judge_run_id
               WHERE sq.quality_status = ?
               ORDER BY sq.created_at DESC LIMIT 200`;
  const rows = await query(db, sql, qualityFilter);
  return c.json({ rows });
});

const REVIEW_ROLES = ['admin', 'manager', 'supervisor'] as const;

si.post('/review-queue/:id/accept', async (c) => {
  const denied = requireRole(c, ...REVIEW_ROLES);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const user = c.get('user') as { id: number } | undefined;
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  await ensureQualityGateColumns(db);
  const r = await db.prepare(
    `UPDATE serve_queue SET quality_status = ?, quality_reviewed_by = ?, quality_reviewed_at = datetime(\'now\') WHERE id = ?`,
  ).bind('reviewed_ok', user?.id ?? null, id).run();
  if ((r.meta?.changes ?? 0) === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true, quality_status: 'reviewed_ok' });
});

si.post('/review-queue/:id/fix', async (c) => {
  const denied = requireRole(c, ...REVIEW_ROLES);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const user = c.get('user') as { id: number } | undefined;
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  await ensureQualityGateColumns(db);
  const r = await db.prepare(
    `UPDATE serve_queue SET quality_status = ?, quality_reviewed_by = ?, quality_reviewed_at = datetime(\'now\') WHERE id = ?`,
  ).bind('reviewed_fixed', user?.id ?? null, id).run();
  if ((r.meta?.changes ?? 0) === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true, quality_status: 'reviewed_fixed' });
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
  const limit = clampIntParam(c.req.query('limit'), 10, 1, 25);
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
  const denied = requireRole(c, ...INTAKE_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const total = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM serve_queue');
  const pending = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM serve_queue WHERE status='pending'");
  const inProgress = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM serve_queue WHERE status IN ('assigned','in_progress','attempted')");
  const served = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM serve_queue WHERE status='served'");
  const overdue = await queryFirst<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM serve_queue WHERE deadline IS NOT NULL AND deadline < datetime(\'now\') AND status NOT IN ('served','cancelled','failed')",
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
  // Exposes recipient names + addresses + case numbers — same gate as /queue.
  const denied = requireRole(c, ...INTAKE_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const status = c.req.query('status');
  const officerId = c.req.query('officer_id');
  const priority = c.req.query('priority');
  const search = c.req.query('q');
  const limit = clampIntParam(c.req.query('limit'), 100, 1, 500);

  const where: string[] = [];
  const args: any[] = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (officerId) { where.push('officer_id = ?'); args.push(parseInt(officerId, 10)); }
  if (priority) { where.push('priority = ?'); args.push(priority); }
  if (search) {
    where.push('(recipient_name LIKE ? OR case_number LIKE ? OR recipient_address LIKE ?)');
    const s = `%${search.slice(0, 48)}%`; // D1 LIKE cap: pattern >50 chars silently returns nothing
    args.push(s, s, s);
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

// ── GET /queue — list serve_queue rows with filters ──────────
si.get('/queue', async (c) => {
  // Exposes recipient names + addresses + case numbers — gate to operations roles.
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  await reconcileScheduleSchema(db);
  const officerParam = c.req.query('officer_id');
  const statusParam = c.req.query('status') ?? 'pending,assigned';
  // Allowlist rather than pass the raw split through: `status` is caller-supplied
  // and fed straight into an IN-list, so an unfiltered `?status=a,a,a,…` past 100
  // entries throws at D1's bound-parameter cap. Constraining to the known enum
  // bounds the list by construction and drops junk filters that could only ever
  // match zero rows.
  const VALID_QUEUE_STATUSES = new Set([
    'pending', 'assigned', 'in_progress', 'served',
    'attempted', 'failed', 'cancelled', 'archived',
  ]);
  const statuses = [...new Set(
    statusParam.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  )].filter((s) => VALID_QUEUE_STATUSES.has(s));
  if (!statuses.length) return c.json([]);
  const placeholders = statuses.map(() => '?').join(',');

  let officerClause = '';
  const binds: unknown[] = [...statuses];
  if (officerParam === 'null') officerClause = 'AND officer_id IS NULL';
  else if (officerParam && /^\d+$/.test(officerParam)) {
    officerClause = 'AND officer_id = ?';
    binds.push(parseInt(officerParam, 10));
  }

  const rows = await query<any>(
    db,
    `SELECT id, recipient_name, case_number, deadline, urgency_tier, priority, document_type
       FROM serve_queue
      WHERE status IN (${placeholders}) ${officerClause}
      ORDER BY (deadline IS NULL), deadline ASC, id ASC
      LIMIT 200`,
    ...binds,
  );
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

  // Client may request a specific date range + per-slot enrichment.
  // ?start_date=YYYY-MM-DD (default: today Denver)
  // ?end_date=YYYY-MM-DD   (default: start + 14 days)
  // ?include=tier,cluster  (comma list — tier joins urgency_tier; cluster joins geo_cluster_id)
  const YMD = /^\d{4}-\d{2}-\d{2}$/;
  const startParam = c.req.query('start_date');
  const endParam = c.req.query('end_date');
  const startDate = startParam && YMD.test(startParam) ? startParam : now.slice(0, 10);
  const endDate = endParam && YMD.test(endParam)
    ? endParam
    : (() => {
        const [sy, sm, sd] = startDate.split('-').map(Number);
        const d = new Date(Date.UTC(sy, sm - 1, sd) + 14 * 86_400_000);
        return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Denver' }).format(d);
      })();
  const include = new Set((c.req.query('include') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const withTier = include.has('tier');
  const withCluster = include.has('cluster');

  const tierProj = withTier ? `, q.urgency_tier` : '';
  const clusterProj = withCluster ? `, q.geo_cluster_id` : '';

  const rows = await query<{
    id: number; queue_id: number; attempt_number: number;
    scheduled_date: string; window_start: string; window_end: string;
    window_label: string; notify_at: string; notify_before_secs: number;
    notified: number; dismissed: number;
    officer_id: number | null; manually_moved: number;
    auto_replan_source: number | null;
    recipient_name: string | null; recipient_address: string | null;
    recipient_city: string | null; recipient_state: string | null;
    case_number: string | null; priority: string; deadline: string | null;
    status: string;
    urgency_tier?: string | null; geo_cluster_id?: string | null;
  }>(
    db,
    `SELECT s.id, s.queue_id, s.attempt_number, s.scheduled_date,
            s.window_start, s.window_end, s.window_label, s.notify_at,
            s.notify_before_secs, s.notified, s.dismissed,
            s.officer_id, s.manually_moved, s.auto_replan_source,
            q.recipient_name, q.recipient_address, q.recipient_city, q.recipient_state,
            q.case_number, q.priority, q.deadline, q.status${tierProj}${clusterProj}
     FROM serve_attempt_schedules s
     JOIN serve_queue q ON q.id = s.queue_id
     WHERE s.dismissed = 0
       AND s.scheduled_date >= ?
       AND s.scheduled_date <= ?
       AND q.status NOT IN ('served','cancelled','failed')
     ORDER BY s.scheduled_date ASC, s.window_start ASC`,
    startDate,
    endDate,
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

// ── POST /schedule/backfill — generate slots for active jobs with no schedule ─
// Idempotent: only touches queue rows that have 0 rows in serve_attempt_schedules.
// Designed to be called once after deploying the scheduler feature, or via the
// "Generate Schedule" button in ServeSchedulerPanel when the view is empty.
si.post('/schedule/backfill', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  await reconcileScheduleSchema(db);

  const { persistAttemptSchedule, denverNow } = await import('../utils/serveAttemptScheduler');
  const { planAttemptWindows } = await import('../utils/serveDiligencePlanner');

  const nowIso = new Date().toISOString();
  const nowDenver = denverNow();
  const todayYmd = nowDenver.slice(0, 10);

  // Find active queue jobs with no existing schedule rows.
  // Fetch business_id + recipient_type so planAttemptWindows uses the right
  // window strategy (business = weekday 09:30-11:30 / 13:30-15:30,
  // residential = evening first, then morning, then weekend).
  const unscheduled = await query<{
    id: number; deadline: string | null; priority: string;
    attempt_count: number; max_attempts: number;
    business_id: number | null; created_at: string;
    recipient_type: string | null;
  } & PlanContextRow>(
    db,
    // R6: pull the persisted address class + client constraints in the SAME
    // query rather than one round trip per job.
    `SELECT q.id, q.deadline, q.priority, q.attempt_count, q.max_attempts,
            q.business_id, q.created_at,
            q.parsed_data->>'recipient_type' AS recipient_type,
            ${PLAN_CONTEXT_COLUMNS.replace(/parsed_data/g, 'q.parsed_data')}
     FROM serve_queue q
     WHERE q.status IN ('pending', 'in_progress')
       AND NOT EXISTS (
         SELECT 1 FROM serve_attempt_schedules s
          WHERE s.queue_id = q.id AND s.dismissed = 0
       )`,
  );

  let seeded = 0;
  for (const job of unscheduled) {
    const remainingAttempts = job.max_attempts - job.attempt_count;
    if (remainingAttempts <= 0) continue;
    try {
      // Determine serve target type from structural FK (business_id) or
      // OCR-derived field in parsed_data. Business → weekday office windows.
      const isBusiness = !!job.business_id || (job.recipient_type ?? '').toLowerCase() === 'business';

      // Use created_at as the planning baseline when the intake happened today —
      // gives morning uploads an evening-first plan rather than tomorrow-first.
      const uploadedToday = job.created_at?.slice(0, 10) === todayYmd;
      const baseIso = uploadedToday ? job.created_at : nowIso;

      // R6: use the address class + client hours/days/start bar commitIntake
      // persisted, not an interim isBusiness mapping with no client
      // constraints. D-2: an unconfirmed class yields residential timing.
      const ctx = planContextFromRow(job);
      const plan = planAttemptWindows(baseIso, job.deadline ?? null, 'America/Denver', {
        isBusiness,
        addressClass: ctx.addressClass,
        addressClassConfirmed: ctx.addressClassConfirmed,
        clientBands: ctx.clientBands,
        allowedDays: ctx.allowedDays,
        startNotBefore: ctx.startNotBefore,
      });
      // Trim plan to only remaining attempts and only future dates.
      const futurePlan = plan
        .filter((w) => w.date >= todayYmd)
        .slice(0, remainingAttempts)
        .map((w, i) => ({ ...w, attempt: job.attempt_count + i + 1 }));
      if (futurePlan.length === 0) continue;
      await persistAttemptSchedule(db, job.id, futurePlan, nowIso);
      seeded++;
    } catch {
      // Skip individual failures — don't abort the whole backfill.
    }
  }

  return c.json({ seeded, total_unscheduled: unscheduled.length });
});

// ── GET /officers — minimal officer roster for the scheduler lanes ─
// Returns active users in field-facing roles so dispatchers can render
// the swim-lane view without needing /admin/users access.
si.get('/officers', async (c) => {
  // Lane labels for the scheduler — same operations roles that can see /queue.
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const rows = await query<{ id: number; name: string }>(
    db,
    `SELECT id, COALESCE(full_name, username, 'User ' || id) AS name
       FROM users
      WHERE status = 'active'
        AND role IN ('officer','dispatcher','supervisor','manager','admin')
      ORDER BY full_name, username`,
  );
  return c.json(rows);
});

// ── PATCH /schedule/:slotId — manual reschedule (drag-drop or full-page edit) ─
si.patch('/schedule/:slotId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);

  const slotId = parseInt(c.req.param('slotId'), 10);
  if (!Number.isFinite(slotId) || slotId < 1) return c.json({ error: 'Invalid slot id' }, 400);

  const db = getDb(c.env);
  await reconcileScheduleSchema(db);

  const body = await c.req.json<any>().catch(() => ({}));
  // Ordinary reschedules are open to dispatchers, but FORCING an overlap
  // deliberately double-books an officer, so it needs supervisor or above —
  // the same MANAGE_ROLES set the clients gate their drag handlers on. Checked
  // separately from the route gate above so a dispatcher's normal move still
  // succeeds and only the override is refused.
  const force = c.req.query('force') === '1';
  if (force) {
    const forceDenied = requireRole(c, 'admin', 'manager', 'supervisor');
    if (forceDenied) {
      return c.json({
        error: 'Forcing an overlapping move requires supervisor or above',
        code: 'force_forbidden',
      }, 403);
    }
  }
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
  // Coerce officer_id: undefined → current; null → null (unassign);
  // numeric string → number; otherwise fall back to current to avoid silent string-vs-number mismatch.
  const candidateOfficer = body.officer_id === undefined
    ? current.officer_id
    : body.officer_id === null
    ? null
    : Number.isFinite(Number(body.officer_id))
    ? Number(body.officer_id)
    : current.officer_id;

  if (!force) {
    // Pull all other slots on the candidate (officer, date) for overlap detection.
    //
    // `s.dismissed = 0` is load-bearing: GET /schedule hides dismissed rows
    // (see the WHERE at the schedule listing above), so leaving them in the
    // peer set makes a dismissed slot an INVISIBLE blocker — the operator sees
    // an empty band, drops onto it, and gets "conflicts with another scheduled
    // attempt" with nothing on screen that could explain it.
    //
    // recipient_name/case_number ride along so the 409 body can NAME the
    // conflicting job; the client renders them in the force-overlap confirm.
    const peers = await query<{
      id: number; queue_id: number; officer_id: number | null;
      scheduled_date: string; window_start: string; window_end: string;
      updated_at: string;
      recipient_name: string | null; case_number: string | null;
    }>(
      db,
      `SELECT s.id, s.queue_id, s.officer_id, s.scheduled_date,
              s.window_start, s.window_end, s.updated_at,
              q.recipient_name, q.case_number
         FROM serve_attempt_schedules s
         JOIN serve_queue q ON q.id = s.queue_id
        WHERE s.dismissed = 0
          AND s.scheduled_date = ?
          AND s.officer_id IS ?`,
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

// ── POST /schedule/rebalance — dry-run preview or apply ───────
si.post('/schedule/rebalance', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);

  const db = getDb(c.env);
  await reconcileScheduleSchema(db);

  const body = await c.req.json<any>().catch(() => ({}));
  const dry = body.dry_run !== false; // default true — preview unless explicitly set false

  const { previewRangeRebalance } = await import('../utils/rebalancePreview');

  const rows = await query<{
    id: number; deadline: string | null; max_attempts: number;
    attempt_count: number; priority: string; urgency_tier: string | null;
  }>(
    db,
    `SELECT id, deadline, max_attempts, attempt_count, priority, urgency_tier
       FROM serve_queue
      WHERE status IN ('pending', 'assigned', 'in_progress', 'attempted')`,
  );

  const nowIso = new Date().toISOString();
  const preview = previewRangeRebalance(rows, nowIso);

  if (dry) {
    return c.json({ dry_run: true, ...preview });
  }

  // Apply: one UPDATE per changed row. Low volume; in-loop is acceptable.
  for (const change of preview.changes) {
    const priorityClause = change.to_priority === 'rush' ? `, priority = 'rush'` : '';
    await execute(
      db,
      `UPDATE serve_queue
          SET urgency_tier = ?, urgency_computed_at = datetime(\'now\') ${priorityClause}
        WHERE id = ?`,
      change.to_tier, change.queue_id,
    );
  }

  await recordAudit(c, {
    action: 'serve_schedule.rebalance_applied',
    entityType: 'serve_queue',
    entityId: null,
    details: {
      changes: preview.changes.length,
      tiers_promoted_critical: preview.tiers_promoted_critical,
      priority_escalated: preview.priority_escalated,
    },
  });

  broadcastAll('data_changed', {
    module: 'serve-schedule',
    entity: 'queue',
    action: 'rebalanced',
    count: preview.changes.length,
  });

  return c.json({ dry_run: false, ...preview });
});

// ── DELETE /schedule/:slotId — dismiss a slot ────────────────
si.delete('/schedule/:slotId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const slotId = parseInt(c.req.param('slotId'), 10);
  if (!Number.isFinite(slotId) || slotId < 1) return c.json({ error: 'Invalid slot id' }, 400);
  const db = getDb(c.env);
  await execute(db, 'UPDATE serve_attempt_schedules SET dismissed = 1 WHERE id = ?', slotId);
  return c.json({ success: true });
});

// ── GET /record-lookup — property + business match for the review panel ──
// Lightweight search used by ServeRecordMatchPanel to show gate codes,
// alarm codes, and key-holder info from existing records while the
// operator is still reviewing the extracted fields before submitting.
si.get('/record-lookup', async (c) => {
  // Exposes gate/alarm codes and key-holder contact info — same gate as /queue.
  const denied = requireRole(c, ...INTAKE_ROLES);
  if (denied) return c.json({ error: denied }, 403);
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
  const denied = requireRole(c, ...INTAKE_ROLES);
  if (denied) return c.json({ error: denied }, 403);
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
  const denied = requireRole(c, ...INTAKE_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
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

// ── POST /bulk — BulkDefendantTable (paste/type a table of defendants) ──
// The client (client/src/components/serve/BulkDefendantTable.tsx) has posted
// to this route from the start; it never existed on the worker, so every
// bulk-intake submission 404'd. Creates one serve_queue row per valid row.
// Duplicate/merge detection (the `merged` field in the response contract) is
// NOT implemented — there's no existing name+address matching logic to reuse
// safely here, so every valid row always lands in `created`, never `merged`.
si.post('/bulk', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<any>().catch(() => ({}));
  const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return c.json({ error: 'rows required' }, 400);
  const db = getDb(c.env);

  const created: Array<{ rowIndex: number; call_id: number; call_number: string }> = [];
  const errors: Array<{ rowIndex: number; message: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    try {
      const isBusiness = r.kind === 'business';
      const recipientName = isBusiness
        ? String(r.businessName ?? '').trim()
        : [r.firstName, r.middleName, r.lastName].filter(Boolean).map(String).join(' ').trim();
      const address = String(r.address ?? '').trim();
      if (!recipientName || !address) {
        errors.push({ rowIndex: i, message: 'Missing recipient name or address' });
        continue;
      }
      const contractId = r.contractId != null && r.contractId !== '' ? parseInt(r.contractId, 10) : null;
      const parsedData = JSON.stringify({
        recipient_type: isBusiness ? 'business' : 'individual',
        recipient_dob: r.dob || null,
        recipient_sex: r.sex || null,
      });
      const result = await execute(
        db,
        `INSERT INTO serve_queue (recipient_name, recipient_address, contract_id, priority, status, max_attempts, parsed_data)
         VALUES (?, ?, ?, 'normal', 'pending', 3, ?)`,
        recipientName, address, Number.isFinite(contractId) ? contractId : null, parsedData,
      );
      const newId = result.meta.last_row_id as number;
      created.push({ rowIndex: i, call_id: newId, call_number: `PS-${newId}` });
    } catch (err) {
      errors.push({ rowIndex: i, message: err instanceof Error ? err.message : 'Insert failed' });
    }
  }

  return c.json({
    success: errors.length === 0,
    created,
    merged: [],
    errors,
    summary: { total: rows.length, created: created.length, merged: 0, failed: errors.length },
  });
});

// ── PUT /:id ────────────────────────────────────────────────
si.put('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  const db = getDb(c.env);

  const allowed = [
    'call_id', 'sm_job_id', 'officer_id', 'serve_date',
    'recipient_name', 'recipient_person_id', 'recipient_address', 'recipient_address_2', 'recipient_city',
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
  // Scheduling constraint fields live inside the parsed_data JSON blob.
  // They're written via json_set() alongside the flat column update, or in a
  // separate statement when no flat columns changed, rather than reading the
  // blob out and back in (avoids a round-trip race on a concurrent save).
  const PARSED_DATA_FIELDS: Record<string, string> = {
    address_class:              '$._intake.address_class.klass',
    attempt_start_not_before:   '$.attempt_start_not_before',
    service_days_allowed:       '$.service_days_allowed',
  };
  const parsedPatches: { path: string; value: string }[] = [];
  for (const [fieldKey, jsonPath] of Object.entries(PARSED_DATA_FIELDS)) {
    if (fieldKey in body && typeof body[fieldKey] === 'string') {
      parsedPatches.push({ path: jsonPath, value: body[fieldKey] });
    }
  }

  if (!sets.length && !parsedPatches.length) return c.json({ error: 'No fields to update' }, 400);

  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    args.push(id);
    await execute(db, `UPDATE serve_queue SET ${sets.join(', ')} WHERE id = ?`, ...args);
  }

  if (parsedPatches.length) {
    // Build a chained json_set call: json_set(json_set(parsed_data, path1, ?), path2, ?)
    let expr = "COALESCE(parsed_data, '{}')"
    const patchArgs: string[] = [];
    for (const { path, value } of parsedPatches) {
      expr = `json_set(${expr}, ?, ?)`;
      patchArgs.push(path, value);
    }
    await execute(
      db,
      `UPDATE serve_queue SET parsed_data = ${expr}, updated_at = datetime(\'now\') WHERE id = ?`,
      ...patchArgs,
      id,
    );
  }

  // Propagate officer_id to auto-placed schedule slots so the lane timeline stays in sync.
  // Manually-moved slots (manually_moved=1) keep their officer assignment intact.
  if ('officer_id' in body) {
    const newOfficer = body.officer_id == null ? null : Number(body.officer_id) || null;
    await execute(
      db,
      `UPDATE serve_attempt_schedules SET officer_id = ? WHERE queue_id = ? AND manually_moved = 0 AND dismissed = 0`,
      newOfficer,
      id,
    );
  }

  return c.json({ success: true });
});

// ── DELETE /:id — admin/manager only ────────────────────────
si.delete('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);

  // Read first so audit can capture context after the row is gone.
  const queue = await queryFirst<{
    id: number; recipient_name: string | null; case_number: string | null;
    document_type: string | null; status: string;
  }>(
    db, 'SELECT id, recipient_name, case_number, document_type, status FROM serve_queue WHERE id = ?', id,
  );
  if (!queue) return c.json({ error: 'Not found' }, 404);

  // Explicit cleanup for all related tables. D1 does not enforce PRAGMA
  // foreign_keys, so FK CASCADE/SET NULL clauses may not fire. Tables
  // without any REFERENCES clause (serve_nudges, case_serve_jobs) are
  // guaranteed orphans without these DELETEs.
  // ── serve_qr_scans: REFERENCES serve_queue(id) with no ON DELETE clause
  //    (default NO ACTION) — blocks parent delete on any scanned job
  await execute(db, 'DELETE FROM serve_qr_scans WHERE job_id = ?', id);
  // ── serve_nudges: no FK constraint (migration 0105) — would orphan
  await execute(db, 'DELETE FROM serve_nudges WHERE serve_queue_id = ?', id);
  // ── case_serve_jobs: FK on case_id only, no FK on serve_queue_id (migration 0146)
  await execute(db, 'DELETE FROM case_serve_jobs WHERE serve_queue_id = ?', id);
  // ── serve_queue_persons: FK CASCADE but PRAGMA not enforced (migration 0002)
  await execute(db, 'DELETE FROM serve_queue_persons WHERE serve_queue_id = ?', id);
  // ── serve_charges + serve_charge_lines: FK CASCADE but PRAGMA not enforced
  await execute(db, 'DELETE FROM serve_charge_lines WHERE serve_charge_id IN (SELECT id FROM serve_charges WHERE serve_queue_id = ?)', id);
  await execute(db, 'DELETE FROM serve_charges WHERE serve_queue_id = ?', id);
  // ── serve_intake_documents: FK SET NULL but PRAGMA not enforced (migration 0034)
  await execute(db, 'UPDATE serve_intake_documents SET serve_queue_id = NULL WHERE serve_queue_id = ?', id);
  // ── serve_attempt_schedules: no FK constraint (migration 0130)
  await execute(db, 'DELETE FROM serve_attempt_schedules WHERE queue_id = ?', id);
  // ── serve_attempts + serve_skip_traces: FK CASCADE but PRAGMA not enforced
  await execute(db, 'DELETE FROM serve_skip_traces WHERE serve_queue_id = ?', id);
  await execute(db, 'DELETE FROM serve_attempts WHERE serve_queue_id = ?', id);
  await execute(db, 'DELETE FROM serve_queue WHERE id = ?', id);

  await recordAudit(c, {
    action: 'serve_queue.delete',
    entityType: 'serve_queue',
    entityId: id,
    details: {
      recipient_name: queue.recipient_name,
      case_number: queue.case_number,
      document_type: queue.document_type,
      status_at_delete: queue.status,
    },
  });

  broadcastAll('data_changed', {
    module: 'serve-schedule',
    entity: 'queue',
    action: 'deleted',
    queue_id: id,
  });

  return c.json({ success: true });
});

// ── GET /:id/attempts ───────────────────────────────────────
si.get('/:id/attempts', async (c) => {
  const denied = requireRole(c, ...INTAKE_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
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
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
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

  // Resolve result + disposition_code. When a structured PS code is supplied
  // (PS/00..PS/45.XX), derive the legacy `result` from it. Fall back to the
  // body's result field otherwise. Mirrors serve.ts logAttempt.
  let dispositionCode: string | null = null;
  let finalResult: string;
  if (body.disposition_code && typeof body.disposition_code === 'string' && body.disposition_code.trim()) {
    const code = body.disposition_code.trim().toUpperCase();
    if (lookupPsoCode(code)) {
      dispositionCode = code;
      finalResult = codeToLegacyResult(code);
    } else {
      finalResult = ATTEMPT_RESULTS.has(body.result) ? body.result : 'other';
    }
  } else {
    finalResult = ATTEMPT_RESULTS.has(body.result) ? body.result : 'other';
  }
  const nextNum = (queue.attempt_count || 0) + 1;

  // Check if disposition_code column exists (migration 0143 may not be applied)
  const hasDispositionCol = await columnExists(db, 'serve_attempts', 'disposition_code');

  const cols = ['serve_queue_id', 'attempt_number', 'officer_id', 'result',
    'latitude', 'longitude', 'notes', 'attempt_type', 'photo_ids', 'signature_data'];
  const vals = ['?', '?', '?', '?', '?', '?', '?', '?', '?', '?'];
  const args: unknown[] = [
    id, nextNum, body.officer_id ?? user?.id ?? null, finalResult,
    body.latitude ?? null, body.longitude ?? null, body.notes ?? null,
    body.attempt_type ?? null,
    JSON.stringify(body.photo_ids ?? []), body.signature_data ?? null,
  ];
  if (hasDispositionCol && dispositionCode) {
    cols.push('disposition_code');
    vals.push('?');
    args.push(dispositionCode);
  }

  const ins = await execute(
    db,
    `INSERT INTO serve_attempts (${cols.join(', ')}) VALUES (${vals.join(', ')})`,
    ...args,
  );

  let newStatus = queue.status;
  if (finalResult === 'served') newStatus = 'served';
  else if (nextNum >= (queue.max_attempts || 3)) newStatus = 'failed';
  else newStatus = 'attempted';

  const closedClause = (newStatus === 'served' || newStatus === 'failed')
    ? ", closed_at = datetime('now')"
    : '';
  await execute(
    db,
    `UPDATE serve_queue SET attempt_count = ?, status = ?, updated_at = datetime(\'now\')${closedClause} WHERE id = ?`,
    nextNum, newStatus, id,
  );

  // Completion → auto-compute the serve charge (pending_review) so it shows up in
  // billing without a manual step. Mirrors serve.ts; best-effort — generateServeCharges
  // never throws (it logs its own failures internally) and never breaks the
  // attempt write.
  if (newStatus === 'served') {
    const { generateServeCharges } = await import('../utils/serveChargeStore');
    await generateServeCharges(db, id);
  }

  // Fire-and-forget: notify the client the job reached a terminal outcome.
  // serveCompletionNotify.ts documents itself as callable from serve.ts's
  // logAttempt(), but this intake path is the OTHER attempt-logging route and
  // never called it either — jobs completed here never notified anyone.
  if (newStatus === 'served' || newStatus === 'failed') {
    notifyServeCompletion(db, id, newStatus).catch((err) => {
      log.error('notifyServeCompletion failed', { src: 'src/routes/serveIntake.ts', serveQueueId: id, newStatus }, err);
    });
  }

  // Auto-replan on failure (PR 1) — spawn next slot, recompute tier
  let replanSummary: { slot_id: number; scheduled_date: string; window: string } | null = null;
  const attemptId = ins.meta.last_row_id as number;

  // Use finalResult (the resolved outcome), not raw body.result -- a
  // disposition-code-only submission (structured PS/xx code, no body.result)
  // derives finalResult via codeToLegacyResult() but left body.result
  // undefined, so this check silently never triggered auto-replan for those
  // submissions even when the derived result should have.
  if (REPLAN_RESULTS.has(finalResult)) {
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
      // R6: read the class + the client's dictated hours/days/start bar that
      // commitIntake persisted. Before this, EVERY attempt after the first
      // ignored the client's authorized hours — the court-exposure case, on
      // the path that generates most attempts.
      const planCtx = await loadPersistedPlanContext(db, id);

      const next = replanAfterFailedAttempt(
        {
          attempt_at: new Date().toISOString(),
          result: finalResult,
          window: typeof body.window === 'string' ? body.window : null,
        },
        {
          deadline: q.deadline,
          max_attempts: q.max_attempts,
          attempt_count: q.attempt_count,
          recipient_lat: q.recipient_lat,
          recipient_lng: q.recipient_lng,
          isBusiness,
          addressClass: planCtx.addressClass,
          addressClassConfirmed: planCtx.addressClassConfirmed,
          clientBands: planCtx.clientBands,
          allowedDays: planCtx.allowedDays,
          startNotBefore: planCtx.startNotBefore,
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
            log.warn('[serveIntake] auto_replan_source FK stamp skipped', { error: e instanceof Error ? e.message : String(e) });
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
          `UPDATE serve_queue SET urgency_tier = ?, urgency_computed_at = datetime(\'now\') ${priorityClause}
             WHERE id = ?`,
          tier, id,
        ).catch((e) => {
          log.warn('[serveIntake] urgency_tier update skipped', { error: e instanceof Error ? e.message : String(e) });
          return null;
        }); // urgency_tier column may not exist on live yet (mig 0140 pending Task 7)
      } else {
        // replanAfterFailedAttempt returned null (no viable window) — mark failed.
        await execute(
          db,
          `UPDATE serve_queue SET status = 'failed', updated_at = datetime(\'now\') WHERE id = ?`,
          id,
        );
      }
    }
  }

  // Broadcast auto-replan slot creation to all clients so dashboards refetch.
  if (replanSummary) {
    broadcastAll('data_changed', {
      module: 'serve-schedule',
      entity: 'slot',
      action: 'created',
      slot_id: replanSummary.slot_id,
      queue_id: id,
    });
  }

  return c.json({
    success: true,
    id: attemptId,
    attempt_number: nextNum,
    queue_status: newStatus,
    ...(replanSummary ? { replan: replanSummary } : {}),
  });
});

// ── GET /:id/skip-trace ─────────────────────────────────────
si.get('/:id/skip-trace', async (c) => {
  const denied = requireRole(c, ...INTAKE_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const rows = await query<Record<string, unknown>>(db, 'SELECT * FROM serve_skip_traces WHERE serve_queue_id = ? ORDER BY created_at DESC', id);
  const data = rows.map((row: Record<string, unknown>) => {
    let addresses_found: unknown[] = [];
    const raw = row.addresses_found_json;
    if (typeof raw === 'string' && raw.trim()) {
      try { addresses_found = JSON.parse(raw); } catch { addresses_found = []; }
    } else if (Array.isArray(row.addresses_found)) {
      addresses_found = row.addresses_found as unknown[];
    }
    let results_json: unknown = row.results_json;
    if (typeof results_json === 'string' && results_json.trim()) {
      try { results_json = JSON.parse(results_json); } catch { /* keep string */ }
    }
    const { addresses_found_json: _drop, ...rest } = row;
    return { ...rest, results_json, addresses_found };
  });
  return c.json({ data });
});

// ── POST /:id/skip-trace ────────────────────────────────────
si.post('/:id/skip-trace', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
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
  const denied = requireRole(c, ...INTAKE_ROLES);
  if (denied) return c.json({ error: denied }, 403);
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
    // Same dual-spelling normalization as POST /api/process-server/routes —
    // see src/utils/serveRoutePayload.ts. Reading only the bare keys stored
    // "[]" for any caller sending the *_json spelling.
    routeJsonColumn(body.optimized_order_json, body.optimized_order),
    routeJsonColumn(body.waypoints_json, body.waypoints),
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
            COALESCE(q.recipient_lat, CAST(q.parsed_data->>'recipient_lat' AS REAL))  AS recipient_lat,
            COALESCE(q.recipient_lng, CAST(q.parsed_data->>'recipient_lng' AS REAL))  AS recipient_lng,
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
