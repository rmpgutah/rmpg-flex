// ============================================================
// RMPG Flex — PDF Tools routes (Cloudflare Workers / Hono)
// ============================================================
// Worker-side proxy that forwards PDF encryption work to the
// Cloudflare Container sidecar at containers/pdf-tools/.
// The Worker handles JWT auth + role gating; the container
// handles the actual qpdf shell-out.
//
// Why proxy instead of run qpdf directly: V8 isolates can't
// execute native binaries. The container holds qpdf; the Worker
// holds auth + the URL surface (CLAUDE.md gotcha #34 path forward).
// ============================================================

import { Hono } from 'hono';
import { getContainer } from '@cloudflare/containers';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';

// Stable container name. Stateless workload — every authenticated
// caller goes to the same instance until it saturates, then
// Cloudflare scales to max_instances (configured in wrangler.toml).
const CONTAINER_NAME = 'shared';

export function mountPdfToolsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/pdf-tools/health — surface tool availability to the admin UI.
  // No role gate: any authed user can probe whether encryption is live.
  api.get('/health', async (c) => {
    try {
      const container = getContainer(c.env.PDF_TOOLS, CONTAINER_NAME);
      const res = await container.fetch(new Request('http://container/health'));
      const body = await res.json();
      return c.json(body, res.status as any);
    } catch (err: any) {
      // Container down / not provisioned yet — return a structured
      // payload so the admin UI can show a "PDF tools unavailable" chip
      // instead of just a 500.
      return c.json({
        status: 'unavailable',
        code: 'CONTAINER_UNREACHABLE',
        detail: err?.message,
      }, 503);
    }
  });

  // POST /api/pdf-tools/encrypt — multipart upload + permission flags.
  // Body forwarded verbatim to the container; response (JSON envelope
  // with base64'd encrypted PDF + auto-generated owner password) is
  // streamed back to the caller.
  //
  // Admin/manager only — encryption changes permission flags on
  // documents that may be shared with attorneys or in discovery.
  api.post('/encrypt', requireRole('admin', 'manager'), async (c) => {
    try {
      const container = getContainer(c.env.PDF_TOOLS, CONTAINER_NAME);

      // Forward the raw request to the container. The container's FastAPI
      // server.py parses multipart itself; we don't reconstruct it here.
      // Cloning the body + headers preserves Content-Type's multipart
      // boundary which is otherwise easy to corrupt by re-serializing.
      const forwarded = new Request('http://container/encrypt', {
        method: 'POST',
        headers: c.req.raw.headers,
        body: c.req.raw.body,
        // @ts-expect-error — Workers fetch needs this when body is a stream
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
        error: 'Failed to encrypt PDF',
        code: 'ENCRYPT_FAILED',
        detail: err?.message,
      }, 500);
    }
  });

  app.route('/api/pdf-tools', api);
}
