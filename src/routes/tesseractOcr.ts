// ============================================================
// RMPG Flex — Custom Tesseract OCR route (Worker proxy → Container)
// ============================================================
// Forwards OCR requests to the self-hosted, fine-tuned Tesseract
// Container sidecar at containers/tesseract-ocr/. Data-sovereignty
// motivated — see
// docs/superpowers/specs/2026-08-08-custom-tesseract-ocr-design.md.
//
// NOT wired into production OCR extraction (callAi()/extractVision()).
// This route exists so the A/B script (scripts/serve-intake-vision-ab.ts)
// can measure this candidate against a deployed instance, the same way
// it measures the other four candidates.
// ============================================================

import { Hono } from 'hono';
import { getContainer } from '@cloudflare/containers';
import type { Env } from '../types';

const tesseractOcr = new Hono<Env>();

const CONTAINER_NAME = 'shared';

// GET /api/tesseract-ocr/health
tesseractOcr.get('/health', async (c) => {
  try {
    const container = getContainer(c.env.TESSERACT_OCR, CONTAINER_NAME);
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

// POST /api/tesseract-ocr/ocr — multipart `image` field, forwarded verbatim.
// Admin/manager only — same role gate as PDF Tools encryption
// (src/routes/pdfTools.ts), since this is measurement tooling, not a
// general-purpose endpoint.
tesseractOcr.post('/ocr', async (c) => {
  const user = c.get('user');
  if (!user || !['admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  try {
    const container = getContainer(c.env.TESSERACT_OCR, CONTAINER_NAME);
    const forwarded = new Request('http://container/ocr', {
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
    return c.json({
      error: 'OCR request failed',
      code: 'OCR_FAILED',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

export default tesseractOcr;
