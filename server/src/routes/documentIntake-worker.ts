// ============================================================
// RMPG Flex — Document Intake routes (Cloudflare Workers / Hono)
// ============================================================
// Worker-side proxy for PDF text extraction (pdftotext + ocrmypdf
// fallback). Same Container as pdfTools-worker — qpdf and OCR
// share a single sidecar to amortize the cold-start cost.
//
// The container's /extract-text endpoint decides whether to OCR
// based on pdftotext output sparsity (CLAUDE.md gotcha #47 — OCR
// is a fallback, not a replacement).
// ============================================================

import { Hono } from 'hono';
import { getContainer } from '@cloudflare/containers';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';

const CONTAINER_NAME = 'shared';

export function mountDocumentIntakeRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  api.get('/health', async (c) => {
    try {
      const container = getContainer(c.env.PDF_TOOLS, CONTAINER_NAME);
      const res = await container.fetch(new Request('http://container/health'));
      const body = await res.json();
      return c.json(body, res.status as any);
    } catch (err: any) {
      return c.json({
        status: 'unavailable',
        code: 'CONTAINER_UNREACHABLE',
        detail: err?.message,
      }, 503);
    }
  });

  // POST /api/document-intake/extract-text — multipart PDF upload.
  // Returns: { text, char_count, page_count, ocr_used, ocr_skipped_reason? }
  //
  // Open to dispatch/officer/etc so process-service intake (the
  // primary caller per CLAUDE.md gotcha #47) can extract court
  // packets at scale.
  api.post(
    '/extract-text',
    requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
    async (c) => {
      try {
        const container = getContainer(c.env.PDF_TOOLS, CONTAINER_NAME);

        const forwarded = new Request('http://container/extract-text', {
          method: 'POST',
          headers: c.req.raw.headers,
          body: c.req.raw.body,
          // @ts-expect-error — Workers fetch needs `duplex` for streaming bodies
          duplex: 'half',
        });

        const res = await container.fetch(forwarded);
        const body = await res.text();
        return new Response(body, {
          status: res.status,
          headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
        });
      } catch (err: any) {
        return c.json({
          error: 'Failed to extract text',
          code: 'EXTRACT_TEXT_FAILED',
          detail: err?.message,
        }, 500);
      }
    },
  );

  app.route('/api/document-intake', api);
}
