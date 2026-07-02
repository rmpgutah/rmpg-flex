// ============================================================
// RMPG Flex — Document Intake route (Worker proxy → Container)
// ============================================================
// Forwards PDF text-extraction requests to the shared PDF Tools
// container. Same Container as pdfTools.ts — qpdf and OCR share
// a single sidecar to amortize cold-start cost.
//
// The container's /extract-text endpoint decides whether to OCR
// based on pdftotext output sparsity (CLAUDE.md gotcha #47:
// "OCR is a fallback, not a replacement"). Adopts OCR output only
// if it produces MORE text than the original pdftotext pass.
// ============================================================

import { Hono } from 'hono';
import { getContainer } from '@cloudflare/containers';
import type { Env } from '../types';
import { buildDocumentExtraction } from '../utils/documentIntakeExtract';

import { dbErrorResponse } from '../utils/dbErrors';
const documentIntake = new Hono<Env>();

const CONTAINER_NAME = 'shared';
const INTAKE_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher', 'officer'];

documentIntake.get('/health', async (c) => {
  try {
    const container = getContainer(c.env.PDF_TOOLS, CONTAINER_NAME);
    const res = await container.fetch(new Request('http://container/health'));
    const body = await res.json();
    return c.json(body as Record<string, unknown>, res.status as any);
  } catch (err) {
    return c.json({
      status: 'unavailable',
      code: 'CONTAINER_UNREACHABLE',
      detail: err instanceof Error ? err.message : String(err),
    }, 503);
  }
});

// POST /api/document-intake/extract-text — multipart PDF upload.
// Returns: { text, char_count, page_count, ocr_used, ocr_skipped_reason? }
//
// Open to dispatch / officer / supervisor / admin / manager so
// process-service intake (the primary caller per CLAUDE.md gotcha
// #47) can extract court packets at scale.
documentIntake.post('/extract-text', async (c) => {
  const user = c.get('user');
  const allowedRoles = ['admin', 'manager', 'supervisor', 'dispatcher', 'officer'];
  if (!user || !allowedRoles.includes(user.role)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  try {
    const container = getContainer(c.env.PDF_TOOLS, CONTAINER_NAME);

    const forwarded = new Request('http://container/extract-text', {
      method: 'POST',
      headers: c.req.raw.headers,
      body: c.req.raw.body,
      // @ts-expect-error — Workers fetch needs `duplex` for streaming
      duplex: 'half',
    });

    const res = await container.fetch(forwarded);
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to extract text', 'EXTRACT_TEXT_FAILED');
  }
});

// POST /api/document-intake/extract — classify + extract structured fields.
//
// The client (DocumentIntakePage) extracts PDF text in-browser via pdfjs (the
// PDF_TOOLS container is OFF in prod — see memory project-pdf-tools-container-off)
// and POSTs { text, page_count, used_ocr, filename }. We classify the document
// kind and pull anchored fields deterministically, returning the
// DocumentExtraction envelope the reviewer consumes. No AI, no container.
documentIntake.post('/extract', async (c) => {
  const user = c.get('user');
  if (!user || !INTAKE_ROLES.includes(user.role)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  let body: { text?: string; page_count?: number; used_ocr?: boolean; filename?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected JSON { text, page_count, used_ocr }', code: 'BAD_REQUEST' }, 400);
  }
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) {
    // No text layer (likely a scan). Surface it explicitly rather than
    // returning an empty extraction that looks like a parse success.
    return c.json({
      error: 'No readable text in the document — it is likely a scan. OCR is not enabled for document intake.',
      code: 'NO_TEXT',
    }, 422);
  }
  try {
    const extraction = buildDocumentExtraction({
      text,
      pageCount: Number(body.page_count) || 0,
      usedOcr: !!body.used_ocr,
    });
    return c.json(extraction);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to extract document fields', 'EXTRACT_FAILED');
  }
});

export default documentIntake;
