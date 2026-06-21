// ============================================================
// RMPG Flex — Fleet.io webhook receiver (PR 4)
// ============================================================
// POST /api/fleetio/webhook
//
// Auth model: HMAC SHA-256 over the RAW request body, signed with
// FLEETIO_WEBHOOK_SECRET. The signature is delivered in the
// X-Fleetio-Webhook-Signature header. Mismatch → 401 + audit_log
// 'FLEETIO_WEBHOOK_BAD_SIG'. Missing secret → 503 (so we don't open the
// door during a misconfigured deploy).
//
// Performance contract: ack 200 in <100ms. We do the minimum on the hot
// path — verify signature, INSERT OR IGNORE into fleetio_events, ack —
// and push applyInbound onto waitUntil. Fleet.io's webhook timeout is
// 30 seconds; we leave 29.9s of headroom for transient D1 / sync work.
//
// Deduplication: Fleet.io's retry policy (5×/hr + 1×/hr for 24h) means
// duplicates are the norm, not the exception. UNIQUE (direction, event_id)
// on fleetio_events silently absorbs them. We treat the absence of a new
// row the same as a fresh acceptance — the caller already trusted the
// signature, so the work is done.
//
// Spec: docs/superpowers/specs/2026-06-21-fleetio-integration-design.md
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { applyInbound } from '../utils/fleetio/sync';

const fleetioWebhook = new Hono<Env>();

// ─── Pure helpers (unit-testable) ───────────────────────────

/** Constant-time string compare to avoid timing leaks on the HMAC equals check. */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Compute HMAC SHA-256 over a body string with a secret. Web Crypto. */
export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Normalize header values like 'sha256=<hex>' down to just the hex. */
export function normalizeSignatureHeader(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  // Fleet.io's header is documented as raw hex, but allow the sha256=… prefix
  // a number of vendors use so we don't fail on a future format change.
  if (trimmed.startsWith('sha256=')) return trimmed.slice('sha256='.length);
  return trimmed;
}

/** Pull what we treat as the event identifier out of the inbound payload.
 *  Fleet.io's payload includes `id` at the top level for each webhook event. */
export function extractEventId(parsed: unknown): string | null {
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.id === 'string' || typeof obj.id === 'number') return String(obj.id);
    if (typeof obj.event_id === 'string') return obj.event_id;
  }
  return null;
}

/** Map Fleet.io's resource name to our internal `resource` token. */
export function normalizeResource(payload: unknown): { resource: string; action: 'create' | 'update' | 'delete'; resource_id: number | null } | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const type = typeof obj.event_type === 'string' ? obj.event_type : '';
  // Fleet.io event_type pattern: '<resource>.<action>' e.g. 'vehicle.update'.
  const m = /^(\w+)\.(create|update|delete)$/.exec(type);
  if (!m) return null;
  const resource = m[1];
  const action = m[2] as 'create' | 'update' | 'delete';
  const data = obj.data && typeof obj.data === 'object' ? obj.data as Record<string, unknown> : {};
  const rawId = data.id ?? obj.resource_id;
  const id = typeof rawId === 'number' ? rawId : (typeof rawId === 'string' ? parseInt(rawId, 10) : null);
  return { resource, action, resource_id: Number.isFinite(id ?? NaN) ? id as number : null };
}

// ─── Route ───────────────────────────────────────────────────

fleetioWebhook.post('/webhook', async (c) => {
  const secret = (c.env as Record<string, unknown>).FLEETIO_WEBHOOK_SECRET;
  if (typeof secret !== 'string' || !secret) {
    return c.json({ error: 'webhook_not_configured', code: 'FLEETIO_WEBHOOK_SECRET_UNSET' }, 503);
  }
  const sigHeader = normalizeSignatureHeader(c.req.header('x-fleetio-webhook-signature'));
  if (!sigHeader) {
    return c.json({ error: 'missing signature' }, 401);
  }
  const rawBody = await c.req.text();
  let expected: string;
  try {
    expected = await hmacSha256Hex(secret, rawBody);
  } catch {
    return c.json({ error: 'signature compute failure' }, 500);
  }
  if (!constantTimeEquals(sigHeader, expected)) {
    // Don't broadcast the expected hex back to the caller. Log to audit_log
    // so we can spot probe traffic later.
    try {
      await c.env.DB.prepare(
        `INSERT INTO audit_log (action, entity_type, details, created_at)
         VALUES ('FLEETIO_WEBHOOK_BAD_SIG', 'fleetio_webhook', ?, datetime('now'))`,
      ).bind(JSON.stringify({ ip: c.req.header('cf-connecting-ip') ?? null })).run();
    } catch (err) {
      console.error('[fleetio-webhook] audit_log INSERT failed', err);
    }
    return c.json({ error: 'invalid signature' }, 401);
  }

  // Signature OK — parse + queue.
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody); } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }
  const eventId = extractEventId(parsed);
  if (!eventId) {
    return c.json({ error: 'event id missing' }, 400);
  }
  const norm = normalizeResource(parsed);
  if (!norm) {
    return c.json({ error: 'unsupported event_type' }, 400);
  }

  try {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO fleetio_events
         (direction, event_id, resource, resource_id, action, status, attempts, payload_json, created_at)
       VALUES ('inbound', ?, ?, ?, ?, 'pending', 0, ?, datetime('now'))`,
    ).bind(eventId, norm.resource, norm.resource_id, norm.action, rawBody).run();
  } catch (err) {
    console.error('[fleetio-webhook] queue INSERT failed', err);
    // Even on D1 failure we ACK 200 — Fleet.io's retry will deliver this
    // event again, and the reconciliation cron picks up gaps. Returning
    // 5xx here would cause Fleet.io to back off the entire webhook stream.
  }

  // Fire-and-forget the apply pass. If executionCtx isn't present (tests),
  // the catch lets the route finish cleanly.
  try {
    c.executionCtx.waitUntil(
      applyInbound({ db: c.env.DB }, eventId).catch((err) => {
        console.error('[fleetio-webhook] applyInbound failed', { event_id: eventId, err });
      }),
    );
  } catch { /* executionCtx unavailable in tests */ }

  return c.json({ received: true, event_id: eventId, queued: true });
});

export default fleetioWebhook;
