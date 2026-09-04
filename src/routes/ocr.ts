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
  extractFromImage,
  extractTextFromPdf,
  extractPdfMarkdown,
  isScanStub,
  familyFromFileName,
  type PdfTextResult,
  type ExtractionResult,
  type ExtractedField,
} from '../utils/serveIntakeExtract';
import { aiBudget, withTimeout, ocrText } from '../utils/serveIntakeOcr';
import { precleanText, detectHomoglyphs } from '../utils/serveIntakePreclean';
import { finalizeFields } from '../utils/serveIntakeValidate';
import { extractVision, extractVisionWorkersAI } from '../utils/visionExtract';
import type { OcrProfileSelector } from '../utils/ocrProfiles';
import { getContainer } from '@cloudflare/containers';
import { getAnthropicKey, getClaudeModel, callClaude } from '../utils/anthropic';
import { getOpenAiKey } from '../utils/openai';
import { getProviderCooldownReason } from '../utils/callAi';
import { log } from '../utils/logger';
import { dbErrorResponse } from '../utils/dbErrors';

const ocr = new Hono<Env>();

const PDF_TOOLS_NAME = 'shared';
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const INTAKE_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher', 'officer'];

// Minimum browser-extracted text length to trust a PDF as "born-digital" and
// extract from the client-provided text directly instead of the container.
// Mirrors serveIntake.ts MIN_CLIENT_TEXT_CHARS.
const MIN_CLIENT_TEXT_CHARS = 200;

// toMarkdown (env.AI.toMarkdown) is zero-neuron — it walks the PDF StructTree
// without any model inference, so it gets a tight ceiling separate from the
// shared AI budget. Mirror serveIntake.ts.
const TOMARKDOWN_TIMEOUT_MS = 8_000;
const CONTAINER_TIMEOUT_MS = 12_000;

// aiBudget + withTimeout are imported from serveIntakeOcr.ts so the per-attempt
// ceiling (AI_TIMEOUT_MS) and the shared total-budget (TOTAL_AI_BUDGET_MS) are
// defined exactly once. A local copy would silently diverge when the canonical
// values are tuned in serveIntakeOcr.ts (happened during the 35→45 s raise).

function emptyExtraction(model: string, error?: string): ExtractionResult {
  return {
    success: false, documentType: 'other', confidence: 0,
    fields: {} as Record<string, ExtractedField>, rawText: '', allDates: [],
    model, ms: 0, error,
  };
}

// GET /api/ocr/claude-health — verify the configured Claude key + model can be
// reached (text-only ping). Surfaces the real Anthropic error (401/404/400) so an
// admin can tell "advanced OCR is live on Claude" from "key/model misconfigured,
// silently falling back to Workers AI". Admin/manager only.
//
// Also reports OpenAI + the callAi() cooldown circuit breaker (src/utils/callAi.ts)
// WITHOUT spending an OpenAI call — cooldown state is a cheap KV read reflecting
// the most recent real failure, not a fresh probe. Found live 2026-07-02: both
// configured keys were exhausted and every serve-intake OCR call was silently
// falling all the way through to Workers AI with no visibility anywhere — this
// is the visibility.
ocr.get('/claude-health', async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || !['admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const openaiKey = await getOpenAiKey(c.env);
  const openaiCooldown = await getProviderCooldownReason(c.env.KV, 'openai');
  const openai = {
    configured: !!openaiKey,
    cooling_down: !!openaiCooldown,
    cooldown_reason: openaiCooldown,
  };

  const key = await getAnthropicKey(c.env);
  const claudeCooldown = await getProviderCooldownReason(c.env.KV, 'claude');
  if (!key) {
    return c.json({ configured: false, engine: 'workers-ai-vision', openai });
  }
  const model = await getClaudeModel(c.env);
  try {
    const reply = await callClaude(key, { text: 'Reply with the single word: OK', maxTokens: 16, model });
    return c.json({
      configured: true, ok: true, engine: 'claude-vision', model, reply: reply.trim().slice(0, 40),
      cooling_down: !!claudeCooldown, cooldown_reason: claudeCooldown, openai,
    });
  } catch (err) {
    return c.json({
      configured: true, ok: false, model, error: err instanceof Error ? err.message : String(err),
      cooling_down: !!claudeCooldown, cooldown_reason: claudeCooldown, openai,
    });
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
      // 1) Claude vision (best). 2) profile-aware Workers-AI vision (free, works for
      // all profiles). 3) legacy serve-doc Workers-AI extractor (last resort).
      const leg = aiBudget();
      let r = await withTimeout(
        extractVision(c.env, bytes, file.type, sel), leg(), 'Claude OCR timed out',
      ).catch(() => null);
      let engine = 'claude-vision';
      if (!r) {
        r = await withTimeout(
          extractVisionWorkersAI(c.env, bytes, file.type, sel), leg(), 'Workers AI OCR timed out',
        ).catch(() => null);
        engine = 'workers-ai-vision';
      }
      if (!r) {
        r = await withTimeout(extractFromImage(c.env.AI, bytes), leg(), 'Vision OCR timed out');
        engine = 'workers-ai-vision';
      }
      return c.json({
        success: r.success, documentType: r.documentType, confidence: r.confidence,
        fields: r.fields, rawText: r.rawText, allDates: r.allDates,
        ocrUsed: true, ocrEngine: engine,
        profile: sel, model: r.model, extractionMs: r.ms, error: r.error,
      });
    }

    if (file.type === 'application/pdf') {
      const bytes = new Uint8Array(await file.arrayBuffer());

      // Optional browser-extracted pdfjs text sent alongside the file.
      // If present and long enough, it skips both the toMarkdown tier and the
      // container — mirrors the /serve-intake/scan-document path so the two
      // endpoints stay behaviorally identical.
      const clientText = (() => {
        const raw = form.get('client_text');
        return typeof raw === 'string' ? raw.trim() : '';
      })();

      let text: string;
      let pageCount = 0;
      let ocrEngine: string;

      // Tier 1 — zero-neuron structured extraction: env.AI.toMarkdown() walks
      // the PDF StructTree and avoids the two-column interleaving hazard that
      // pdfjs's positional concatenation produces on court forms. Preferred
      // over client text because pdfjs is exactly the source of that hazard.
      const EMPTY_PDF: PdfTextResult = { text: '', source: 'empty', structured: false, page_count: 0 };
      const md = await withTimeout(
        extractPdfMarkdown(c.env.AI, bytes, file.name || 'doc.pdf'),
        TOMARKDOWN_TIMEOUT_MS, 'toMarkdown timed out',
      ).catch(() => EMPTY_PDF);

      if (md.text && !isScanStub(md.text, md.page_count)) {
        text = md.text;
        pageCount = md.page_count;
        ocrEngine = 'workers-ai-tomarkdown';
        log.info('ocr/scan-document: toMarkdown structured extraction used', {
          traceId: c.get('traceId'), file: file.name, chars: md.text.length,
          structured: md.structured, page_count: md.page_count,
        });
      } else if (clientText.length >= MIN_CLIENT_TEXT_CHARS) {
        // Tier 2 — browser-extracted pdfjs text (born-digital PDFs only).
        text = clientText;
        ocrEngine = 'pdfjs-client';
      } else {
        // Tier 3 — container Tesseract (scan-only PDFs / toMarkdown misses).
        const container = getContainer(c.env.PDF_TOOLS, PDF_TOOLS_NAME);
        const leg = aiBudget();
        try {
          const txt = await withTimeout(
            extractTextFromPdf(container, bytes, file.name || 'doc.pdf'),
            leg(CONTAINER_TIMEOUT_MS), 'PDF text extraction timed out',
          );
          text = txt.text;
          pageCount = txt.page_count ?? 0;
          ocrEngine = txt.ocr_used ? 'tesseract' : 'pdftotext';
        } catch (e) {
          log.warn('ocr/scan-document: container unavailable, using empty text', {
            traceId: c.get('traceId'),
            error: e instanceof Error ? e.message : String(e),
          });
          text = clientText;
          ocrEngine = 'container-unavailable';
        }
      }

      // Single choke point for OCR-noise scrubbing — applied after tier
      // selection so every path (toMarkdown, pdfjs-client, container) receives
      // homoglyph normalization, watermark-stamp removal, and typography fixes
      // before reaching the model or the ZIP/state validator. Idempotent, so
      // already-clean container text is safe to pass through.
      const rawTextForHomoglyphCheck = text;
      text = precleanText(text);
      const homoglyphSubstitutions = detectHomoglyphs(rawTextForHomoglyphCheck);
      if (homoglyphSubstitutions.length > 0) {
        log.info('ocr/scan-document: homoglyph substitutions detected', {
          traceId: c.get('traceId'), substitutions: homoglyphSubstitutions,
        });
      }

      // Derive the document family from the filename so both the Claude and
      // Workers-AI extraction legs get the same layout-specific prompt guidance
      // that the /upload commit path uses — without this, the preview (what the
      // officer reviews) and the commit (what saves to the DB) could disagree.
      const docFamily = familyFromFileName(file.name);
      const r: ExtractionResult = text.trim().length >= 20
        ? await ocrText(c.env, text, docFamily)
        : emptyExtraction('none', 'Insufficient text to extract');

      // finalizeFields = normalizeFields + validateFields as a pair.
      // The officer reviews THIS preview, so it must show the same normalized,
      // validated values that /upload will actually commit. Previously this
      // path returned raw model output while /upload normalized — the officer
      // then reviewed "6/26/2026" / "Utah" / "(435) 986-1200" on screen but
      // the DB received "2026-06-26" / "UT" / "4359861200". In this domain,
      // reviewing one value and saving another is a correctness failure, not
      // a display quirk.
      const preview = finalizeFields(r.fields, new Date().toISOString());
      if (preview.issues.length > 0) {
        log.warn('ocr/scan-document: validation issues', {
          traceId: c.get('traceId'),
          count: preview.issues.length,
          issues: preview.issues.slice(0, 10),
        });
      }

      return c.json({
        success: r.success, documentType: r.documentType, confidence: r.confidence,
        fields: preview.adjusted, validationIssues: preview.issues,
        rawText: r.rawText, allDates: r.allDates,
        pageCount, ocrUsed: true, ocrEngine,
        model: r.model, extractionMs: r.ms, error: r.error,
      });
    }

    return c.json({ error: `Unsupported file type: ${file.type}` }, 400);
  } catch (err) {
    return dbErrorResponse(c, err, 'Extraction failed');
  }
});

export default ocr;
