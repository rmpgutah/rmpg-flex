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
import { signTriple } from '../utils/pdfSign';

import { dbErrorResponse } from '../utils/dbErrors';
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
    return dbErrorResponse(c, err, 'Failed to encrypt PDF', 'ENCRYPT_FAILED');
  }
});

// POST /api/pdf-tools/sign-payload — signs a (formKey, caseNumber, payloadHash)
// triple with THREE algorithms (Ed25519 + ML-DSA-87 + SLH-DSA-256f — see
// src/utils/pdfSign.ts) so a generated PDF can be later verified offline
// (court/exhibit chain-of-custody) even against a future quantum computer.
// Always signs (key derives from PDF_SIGNING_KEY when provisioned, else
// stably from JWT_SECRET — no secret-provisioning step required). Returns
// { signedAt, keyId, ed25519, mlDsa87, slhDsa256f, formKey, caseNumber,
// payloadHash } — the shape client/src/utils/pdfIntegrity.ts expects.
pdfTools.post('/sign-payload', async (c) => {
  try {
    const body = await c.req.json<{ formKey?: string; caseNumber?: string; payloadHash?: string }>();
    const formKey = typeof body.formKey === 'string' ? body.formKey.trim() : '';
    const caseNumber = typeof body.caseNumber === 'string' ? body.caseNumber.trim() : '';
    const payloadHash = typeof body.payloadHash === 'string' ? body.payloadHash.trim().toLowerCase() : '';

    if (!formKey || !payloadHash) {
      return c.json({ error: 'formKey and payloadHash are required' }, 400);
    }
    if (!/^[0-9a-f]{64}$/.test(payloadHash)) {
      return c.json({ error: 'payloadHash must be a 64-char lowercase SHA-256 hex string' }, 400);
    }

    const ctx = (() => { try { return c.executionCtx; } catch { return undefined; } })();
    const signed = await signTriple(c.env, formKey, caseNumber, payloadHash, ctx);

    return c.json({
      ...signed,
      formKey,
      caseNumber: caseNumber || '',
      payloadHash,
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Signing failed');
  }
});

export default pdfTools;
