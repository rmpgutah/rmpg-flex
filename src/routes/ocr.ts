// ============================================================
// RMPG Flex — OCR alias router
// ============================================================
// Thin alias so `/api/ocr/scan-document` (called from the client
// via ServeIntakePage's in-page image preview path) reaches the
// same handler as `/api/serve-intake/scan-document`. We don't
// export shared handler objects from serveIntake.ts (Hono routers
// are intentionally per-file in this codebase) — instead this
// router re-issues the request internally so both URLs share
// behavior, telemetry, and auth coverage without code duplication.
//
// Adding more OCR aliases later (e.g. /api/ocr/classify-only,
// /api/ocr/verify) just means adding routes here.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import {
  extractFromText,
  extractFromImage,
  extractTextFromPdf,
} from '../utils/serveIntakeExtract';
import { extractVision } from '../utils/visionExtract';
import type { OcrProfileSelector } from '../utils/ocrProfiles';
import { getContainer } from '@cloudflare/containers';
import { getAnthropicKey, getClaudeModel, callClaude } from '../utils/anthropic';

const ocr = new Hono<Env>();

const PDF_TOOLS_NAME = 'shared';
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const INTAKE_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher', 'officer'];

// Minimum browser-extracted text length to trust a PDF as "born-digital" and
// extract from the client-provided text directly instead of the container.
// Mirrors serveIntake.ts MIN_CLIENT_TEXT_CHARS.
const MIN_CLIENT_TEXT_CHARS = 200;

// Per-call timeout ceilings — mirror serveIntake.ts so the in-page preview
// path can't hang forever on a stalled Vision/PDF/LLM call (the "stuck on
// upload" failure mode the commit pipeline already guards against). The
// catch block below turns a thrown timeout into a clean HTTP 500.
const AI_TIMEOUT_MS = 35_000;
const CONTAINER_TIMEOUT_MS = 12_000;
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

// GET /api/ocr/claude-health — verify the configured Claude key + model can be
// reached (text-only ping). Surfaces the real Anthropic error (401/404/400) so an
// admin can tell "advanced OCR is live on Claude" from "key/model misconfigured,
// silently falling back to Workers AI". Admin/manager only.
ocr.get('/claude-health', async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || !['admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const key = await getAnthropicKey(c.env);
  if (!key) return c.json({ configured: false, engine: 'workers-ai-vision' });
  const model = await getClaudeModel(c.env);
  try {
    const reply = await callClaude(key, { text: 'Reply with the single word: OK', maxTokens: 16, model });
    return c.json({ configured: true, ok: true, engine: 'claude-vision', model, reply: reply.trim().slice(0, 40) });
  } catch (err) {
    return c.json({ configured: true, ok: false, model, error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/ocr/accept-llama-license — one-time Meta-Llama Community License
// acceptance for the Workers-AI vision/extract models. Cloudflare gates first use
// behind submitting the prompt "agree" (error 5016); running it through the AI
// binding records acceptance account-wide so the Workers-AI OCR fallback works
// (independent of the Anthropic-credit-gated Claude path). Admin/manager only.
ocr.post('/accept-llama-license', async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || !['admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const models = [
    '@cf/meta/llama-3.2-11b-vision-instruct',     // image OCR (extractFromImage)
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',   // text extraction (extractFromText)
  ];
  const results: Record<string, string> = {};
  for (const m of models) {
    try {
      await c.env.AI.run(m as any, { prompt: 'agree' } as any);
      results[m] = 'accepted';
    } catch (e) {
      results[m] = e instanceof Error ? e.message : String(e);
    }
  }
  const ok = Object.values(results).every((v) => v === 'accepted');
  return c.json({ ok, results });
});

ocr.post('/scan-document', async (c) => {
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

  try {
    if (file.type.startsWith('image/')) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Dynamic profile-driven OCR: 'auto' lets Claude classify (ID card / plate /
      // serve document) AND extract in one vision call; a concrete docType forces
      // that profile. Falls back to Workers-AI serve-doc vision if Claude is
      // unavailable (no key / no credits / error).
      const raw = String(form.get('docType') || 'auto');
      const sel = (['id_card', 'license_plate', 'serve_document', 'auto'].includes(raw)
        ? raw : 'auto') as OcrProfileSelector;
      const vision = await withTimeout(
        extractVision(c.env, bytes, file.type, sel), AI_TIMEOUT_MS, 'Claude OCR timed out',
      ).catch(() => null);
      const r = vision ?? await withTimeout(extractFromImage(c.env.AI, bytes), AI_TIMEOUT_MS, 'Vision OCR timed out');
      return c.json({
        success: r.success, documentType: r.documentType, confidence: r.confidence,
        fields: r.fields, rawText: r.rawText, allDates: r.allDates,
        ocrUsed: true, ocrEngine: vision ? 'claude-vision' : 'workers-ai-vision',
        profile: sel, model: r.model, extractionMs: r.ms, error: r.error,
      });
    }
    if (file.type === 'application/pdf') {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Mirror the hardened /upload path: prefer the browser's pdfjs text
      // (passed as the optional `client_text` field) for born-digital PDFs so
      // we never touch the PDF Tools container, which is intentionally NOT
      // rolled out in prod (--containers-rollout=none). Only genuinely empty
      // scans fall through to the container.
      const clientText = (() => {
        const raw = form.get('client_text');
        return typeof raw === 'string' ? raw.trim() : '';
      })();

      let text = clientText;
      let pageCount = 0;
      let ocrUsed = false;
      let ocrEngine = 'pdfjs-client';

      if (clientText.length < MIN_CLIENT_TEXT_CHARS) {
        // Born-digital text insufficient — try the container, but race it
        // against a timeout. The container is off in prod, so this almost
        // always times out / errors; rather than hang to a 500, fall back.
        try {
          const container = getContainer(c.env.PDF_TOOLS, PDF_TOOLS_NAME);
          const txt = await withTimeout(
            extractTextFromPdf(container, bytes, file.name || 'doc.pdf'),
            CONTAINER_TIMEOUT_MS, 'PDF Tools container timed out or unavailable',
          );
          text = txt.text; pageCount = txt.page_count; ocrUsed = txt.ocr_used;
          ocrEngine = txt.ocr_used ? 'tesseract' : 'pdftotext';
        } catch {
          // Container unavailable AND no usable client text → this is a scanned
          // PDF we can't OCR server-side. Return a clean 422 with actionable
          // guidance instead of hanging to a 500. The client rasterizes the
          // PDF to images and resends those (the Vision path below handles
          // images and keeps working unchanged).
          return c.json({
            error: 'scanned_pdf_unsupported',
            code: 'SCANNED_PDF',
            message: 'Scanned PDF — rasterize the pages client-side and resend each as an image.',
          }, 422);
        }
      }

      if (text.trim().length < 20) {
        // Even after the container, no readable text — a scan. 422, not 500.
        return c.json({
          error: 'scanned_pdf_unsupported',
          code: 'SCANNED_PDF',
          message: 'Scanned PDF — rasterize the pages client-side and resend each as an image.',
        }, 422);
      }

      const r = await withTimeout(extractFromText(c.env.AI, text, c.env.SERVE_INTAKE_LORA), AI_TIMEOUT_MS, 'Text extraction timed out');
      return c.json({
        success: r.success, documentType: r.documentType, confidence: r.confidence,
        fields: r.fields, rawText: r.rawText, allDates: r.allDates,
        pageCount, ocrUsed, ocrEngine,
        model: r.model, extractionMs: r.ms, error: r.error,
      });
    }
    return c.json({ error: `Unsupported file type: ${file.type}` }, 400);
  } catch (err) {
    return c.json({
      error: 'Extraction failed',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

export default ocr;
