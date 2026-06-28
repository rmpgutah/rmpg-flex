// ============================================================
// RMPG Flex — PDF Tools route (Worker proxy → Container)
// ============================================================
// Forwards qpdf encryption requests to the Cloudflare Container
// sidecar at containers/pdf-tools/. The Worker handles JWT auth +
// role gating; the container holds qpdf and shells out to it.
//
// Why proxy instead of run qpdf directly: V8 isolates can't execute
// native binaries. Plan §Phase 3.
// ============================================================

import { Hono } from 'hono';
import { getContainer } from '@cloudflare/containers';
import type { Env } from '../types';
import { getPdfSigningKey, bytesToBase64 } from '../utils/pdfSign';

const pdfTools = new Hono<Env>();

// Stable container name. Stateless workload — every authenticated
// caller goes to the same instance until it saturates, then
// Cloudflare scales to max_instances (configured in wrangler.toml).
const CONTAINER_NAME = 'shared';

// GET /api/pdf-tools/health — surface tool availability to admin UI.
// No role gate beyond auth — any user can probe whether encryption is live.
pdfTools.get('/health', async (c) => {
  try {
    const container = getContainer(c.env.PDF_TOOLS, CONTAINER_NAME);
    const res = await container.fetch(new Request('http://container/health'));
    const body = await res.json();
    return c.json(body as Record<string, unknown>, res.status as any);
  } catch (err) {
    // Container down / not yet provisioned — return a structured payload
    // so the admin UI can show a "PDF tools unavailable" chip instead of
    // a generic 500.
    return c.json({
      status: 'unavailable',
      code: 'CONTAINER_UNREACHABLE',
      detail: err instanceof Error ? err.message : String(err),
    }, 503);
  }
});

// POST /api/pdf-tools/encrypt — multipart upload + permission flags.
// Body forwarded verbatim to the container; response (JSON envelope
// with base64'd encrypted PDF + auto-generated owner password) is
// streamed back.
//
// Admin / manager only — encryption changes permission flags on
// documents that may be shared with attorneys or used in discovery.
pdfTools.post('/encrypt', async (c) => {
  const user = c.get('user');
  if (!user || !['admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  try {
    const container = getContainer(c.env.PDF_TOOLS, CONTAINER_NAME);

    // Forward the raw request. Cloning headers + body preserves the
    // multipart Content-Type boundary, which re-serializing would
    // easily corrupt. `duplex: 'half'` is required when forwarding a
    // streaming body through fetch() in the Workers runtime —
    // without it the container receives empty multipart with no
    // observable error.
    const forwarded = new Request('http://container/encrypt', {
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
      error: 'Failed to encrypt PDF',
      code: 'ENCRYPT_FAILED',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// POST /api/pdf-tools/sign-payload — signs a (formKey, caseNumber, payloadHash)
// triple with the server's Ed25519 key so a generated PDF can be later verified
// offline (court/exhibit chain-of-custody). Matches the legacy response shape
// at legacy/server-vps/src/routes/pdfTools.ts:60.
//
// Now always signs (was a hard 503 "SIGNING_NOT_CONFIGURED"): the key is
// derived from PDF_SIGNING_KEY when provisioned, else stably from JWT_SECRET,
// so no secret-provisioning step is required. Returns { signature, signedAt,
// algorithm:'Ed25519', keyId, ... } — the shape client/src/utils/pdfIntegrity.ts
// expects. The client still tolerates a null/!signature response (older
// graceful-unsigned fallback) if signing ever errors.
pdfTools.post('/sign-payload', async (c) => {
  try {
    const body = await c.req.json<{ formKey?: string; caseNumber?: string; payloadHash?: string }>();
    const formKey = typeof body.formKey === 'string' ? body.formKey.trim() : '';
    const caseNumber = typeof body.caseNumber === 'string' ? body.caseNumber.trim() : '';
    const payloadHash = typeof body.payloadHash === 'string' ? body.payloadHash.trim().toLowerCase() : '';

    if (!formKey || !payloadHash) {
      return c.json({ error: 'formKey and payloadHash are required' }, 400);
    }
    // SHA-256 hex sanity check (mirror legacy validation) — reject obvious
    // typos before paying the signature cost.
    if (!/^[0-9a-f]{64}$/.test(payloadHash)) {
      return c.json({ error: 'payloadHash must be a 64-char lowercase SHA-256 hex string' }, 400);
    }

    // Sign the (formKey | caseNumber | payloadHash) triple with the server's
    // stable Ed25519 key. Any tamper to those three fields invalidates the
    // signature — the chain-of-custody guarantee the trailer page relies on.
    const { key, keyId } = await getPdfSigningKey(c.env);
    const message = new TextEncoder().encode(`${formKey}|${caseNumber}|${payloadHash}`);
    const sigBuf = await crypto.subtle.sign('Ed25519', key, message);
    const signature = bytesToBase64(new Uint8Array(sigBuf));
    // Server-minted signing timestamp (current wall-clock, not a parsed value).
    const signedAt = new Date().toISOString(); // new-date-ok

    return c.json({
      signature,
      signedAt,
      algorithm: 'Ed25519',
      keyId,
      formKey,
      caseNumber: caseNumber || '',
      payloadHash,
    });
  } catch (err) {
    return c.json({ error: 'Signing failed', detail: (err as Error)?.message }, 500);
  }
});

export default pdfTools;
