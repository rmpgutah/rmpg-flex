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
import { getContainer } from '@cloudflare/containers';

const ocr = new Hono<Env>();

const PDF_TOOLS_NAME = 'shared';
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const INTAKE_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher', 'officer'];

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
      const r = await extractFromImage(c.env.AI, bytes);
      return c.json({
        success: r.success, documentType: r.documentType, confidence: r.confidence,
        fields: r.fields, rawText: r.rawText, allDates: r.allDates,
        ocrUsed: true, ocrEngine: 'workers-ai-vision',
        model: r.model, extractionMs: r.ms, error: r.error,
      });
    }
    if (file.type === 'application/pdf') {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const container = getContainer(c.env.PDF_TOOLS, PDF_TOOLS_NAME);
      const txt = await extractTextFromPdf(container, bytes, file.name || 'doc.pdf');
      const r = await extractFromText(c.env.AI, txt.text);
      return c.json({
        success: r.success, documentType: r.documentType, confidence: r.confidence,
        fields: r.fields, rawText: r.rawText, allDates: r.allDates,
        pageCount: txt.page_count, ocrUsed: txt.ocr_used,
        ocrEngine: txt.ocr_used ? 'tesseract' : 'pdftotext',
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
