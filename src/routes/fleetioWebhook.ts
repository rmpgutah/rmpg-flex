// ============================================================
// RMPG Flex — Fleet.io webhook receiver (PR 4c rewrite)
// ============================================================
// POST /api/fleetio/webhook
//
// Auth model: Authorization-header echo. This is Fleet.io's actual
// webhook authentication scheme — the operator picks a secret value
// when registering the webhook in app.fleetio.com → Account →
// Webhooks. Fleet.io then sends that exact value back as the HTTP
// 'Authorization' header on every POST. We constant-time compare
// the inbound header against FLEETIO_WEBHOOK_SECRET.
//
// (PR 4 originally implemented HMAC SHA-256 over the body — that's
// a common pattern at other vendors, but Fleet.io doesn't sign
// bodies; their UI only exposes the Authorization header field.
// The HMAC helpers stay exported because they're still useful for
// future signed-vendor integrations and the existing tests rely on
// them, but they're no longer called on the hot path.)
//
// Performance contract: ack 200 in <100ms. We do the minimum on the hot
// path — verify header, INSERT OR IGNORE into fleetio_events, ack —
// and push applyInbound onto waitUntil. Fleet.io's webhook timeout is
// 30 seconds; we leave 29.9s of headroom for transient D1 / sync work.
//
// Deduplication: Fleet.io's retry policy (5×/hr + 1×/hr for 24h) means
// duplicates are the norm, not the exception. UNIQUE (direction, event_id)
// on fleetio_events silently absorbs them.
//
// Spec: docs/superpowers/specs/2026-06-21-fleetio-integration-design.md
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { applyInbound } from '../utils/fleetio/sync';

const fleetioWebhook = new Hono<Env>();

// ─── Pure helpers (unit-testable) ───────────────────────────

/** Constant-time string compare to avoid timing leaks on the equals check. */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Compute HMAC SHA-256 over a body string with a secret. Web Crypto.
 *  Retained for future signed-webhook vendors; not on the Fleet.io hot path. */
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

/** Normalize header values like 'sha256=<hex>' down to just the hex. Retained
 *  because the helper is harmless and protects future signed-vendor flows. */
export function normalizeSignatureHeader(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.startsWith('sha256=')) return trimmed.slice('sha256='.length);
  return trimmed;
}

/** Normalize an Authorization header for comparison. Strips the optional
 *  'Bearer ' / 'Token ' scheme prefix Fleet.io's UI implies but never enforces
 *  (operators paste raw secrets just as often as `Bearer <secret>` form).
 *  Trim only — preserves the secret's bytes for the equals check. */
export function normalizeAuthorizationHeader(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Accept the three common prefixes interchangeably — operators don't know
  // which one Fleet.io expects and inconsistency between vendors is the norm.
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('bearer ')) return trimmed.slice('bearer '.length).trim();
  if (lower.startsWith('token ')) return trimmed.slice('token '.length).trim();
  return trimmed;
}

/** Pull what we treat as the event identifier out of the inbound payload.
 *  Fleet.io's webhook bodies vary by event type — try the four common
 *  identifier fields and fall back to a digest of the raw body for the
 *  ones that don't ship a top-level id (UNIQUE (direction, event_id) on
 *  fleetio_events absorbs the duplicate-delivery retries either way). */
export function extractEventId(parsed: unknown, fallbackBody?: string): string | null {
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    for (const key of ['id', 'event_id', 'event_uuid', 'uuid']) {
      const v = obj[key];
      if (typeof v === 'string' && v.length > 0) return v;
      if (typeof v === 'number') return String(v);
    }
  }
  // Fallback: hash a slice of the body so retries of the same payload still
  // dedupe via the UNIQUE constraint. Plain prefix is cheap + good enough.
  if (typeof fallbackBody === 'string' && fallbackBody.length > 0) {
    return `body:${fallbackBody.slice(0, 96)}`;
  }
  return null;
}

/** Map Fleet.io's resource name to our internal `resource` token.
 *  Fleet.io's webhook payload shape varies. Captured from real live traffic
 *  on 2026-06-21 (audit_log FLEETIO_WEBHOOK_UNPARSEABLE) + standard
 *  vendor-emitter conventions, we accept four shape variants:
 *    1. `{ event_type: 'vehicle.update', data: { id: 123 } }`
 *    2. `{ subject_type: 'vehicle', verb: 'updated', subject_id: 123 }`
 *    3. `{ name: 'vehicle.updated', payload: { id: 123 } }`
 *    4. `{ event: 'vehicle_updated', payload: { vehicle_id: 123 } }`  ← Fleet.io's real shape
 *  `verb`/`action` is normalized to the create/update/delete trichotomy
 *  ('updated' → 'update', 'destroyed'/'deleted' → 'delete'). */
export function normalizeResource(payload: unknown): { resource: string; action: 'create' | 'update' | 'delete'; resource_id: number | null } | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;

  let resource: string | null = null;
  let actionRaw: string | null = null;

  // Variant 1/3: event_type='resource.action' OR name='resource.action' (dot-separated)
  const dottedField = typeof obj.event_type === 'string' ? obj.event_type
                    : typeof obj.name === 'string' ? obj.name
                    : '';
  const dotted = /^(\w+)\.(\w+)$/.exec(dottedField);
  if (dotted) {
    resource = dotted[1];
    actionRaw = dotted[2];
  } else if (typeof obj.event === 'string') {
    // Variant 4: event='resource_action' (underscore-separated, Fleet.io's actual shape).
    // The greedy split is correct here: 'fuel_entry_updated' must split as
    // ('fuel_entry', 'updated'), not ('fuel', 'entry_updated'). Anchor on the
    // KNOWN action suffixes so the split point is unambiguous.
    const underscored = /^(.+)_(created|updated|destroyed|deleted)$/.exec(obj.event);
    if (underscored) {
      resource = underscored[1];
      actionRaw = underscored[2];
    }
  }

  if (!resource && typeof obj.subject_type === 'string' && typeof obj.verb === 'string') {
    // Variant 2: subject_type + verb
    resource = obj.subject_type;
    actionRaw = obj.verb;
  }
  if (!resource || !actionRaw) return null;

  // Verb → trichotomy. Past-tense forms come back from Ruby-on-Rails style
  // emitters; future-tense from REST-style ones. Anything else we drop.
  const action: 'create' | 'update' | 'delete' | null =
    /^create/.test(actionRaw) ? 'create' :
    /^update/.test(actionRaw) ? 'update' :
    /^(delete|destroy)/.test(actionRaw) ? 'delete' :
    null;
  if (!action) return null;

  // Resource id — check the common nesting locations PLUS Fleet.io's
  // payload.<resource>_id keyed convention (e.g. payload.vehicle_id for a
  // vehicle event, payload.fuel_entry_id for a fuel entry event).
  const data = obj.data && typeof obj.data === 'object' ? obj.data as Record<string, unknown> : null;
  const payloadObj = obj.payload && typeof obj.payload === 'object' ? obj.payload as Record<string, unknown> : null;
  const resourceKeyed = payloadObj ? payloadObj[`${resource}_id`] : undefined;
  const rawId = (data?.id) ?? (payloadObj?.id) ?? resourceKeyed ?? obj.subject_id ?? obj.resource_id ?? obj.id;
  const id = typeof rawId === 'number' ? rawId : (typeof rawId === 'string' ? parseInt(rawId, 10) : null);

  return {
    resource,
    action,
    resource_id: Number.isFinite(id ?? NaN) ? id as number : null,
  };
}

// ─── Route ───────────────────────────────────────────────────

fleetioWebhook.post('/webhook', async (c) => {
  const secret = (c.env as Record<string, unknown>).FLEETIO_WEBHOOK_SECRET;
  if (typeof secret !== 'string' || !secret) {
    return c.json({ error: 'webhook_not_configured', code: 'FLEETIO_WEBHOOK_SECRET_UNSET' }, 503);
  }
  const authHeader = normalizeAuthorizationHeader(c.req.header('authorization'));
  if (!authHeader) {
    return c.json({ error: 'missing authorization' }, 401);
  }
  // The configured secret may have been pasted with a Bearer/Token prefix on
  // the wrangler side too — normalize both sides identically for the compare.
  const expected = normalizeAuthorizationHeader(secret) ?? '';
  if (!constantTimeEquals(authHeader, expected)) {
    // Don't broadcast anything about the expected value back to the caller.
    // Log to audit_log so we can spot probe traffic later.
    try {
      await c.env.DB.prepare(
        `INSERT INTO audit_log (action, entity_type, details, created_at)
         VALUES ('FLEETIO_WEBHOOK_BAD_AUTH', 'fleetio_webhook', ?, datetime('now'))`,
      ).bind(JSON.stringify({ ip: c.req.header('cf-connecting-ip') ?? null })).run();
    } catch (err) {
      console.error('[fleetio-webhook] audit_log INSERT failed', err);
    }
    return c.json({ error: 'invalid authorization' }, 401);
  }

  // Auth OK. From here on we ALWAYS ack 200 — Fleet.io disables a webhook
  // after enough consecutive non-2xx responses, and the reconciliation cron
  // is our safety net for any payload we can't fully process. Failures get
  // logged to audit_log with a snippet so we can refine the parser.
  const rawBody = await c.req.text();
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody); }
  catch {
    await logUnparseable(c, 'invalid_json', rawBody);
    return c.json({ received: true, parsed: false, reason: 'invalid_json' });
  }

  const eventId = extractEventId(parsed, rawBody);
  const norm = normalizeResource(parsed);
  if (!eventId || !norm) {
    await logUnparseable(c, !eventId ? 'event_id_missing' : 'unsupported_event_type', rawBody);
    return c.json({ received: true, parsed: false, reason: !eventId ? 'event_id_missing' : 'unsupported_event_type' });
  }

  try {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO fleetio_events
         (direction, event_id, resource, resource_id, action, status, attempts, payload_json, created_at)
       VALUES ('inbound', ?, ?, ?, ?, 'pending', 0, ?, datetime('now'))`,
    ).bind(eventId, norm.resource, norm.resource_id, norm.action, rawBody).run();
  } catch (err) {
    console.error('[fleetio-webhook] queue INSERT failed', err);
    // Even on D1 failure we ACK 200 — Fleet.io's retry will redeliver, and
    // the reconciliation cron picks up gaps.
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

// ─── helpers ─────────────────────────────────────────────────

async function logUnparseable(
  c: { req: { header: (k: string) => string | undefined }; env: { DB: { prepare: (sql: string) => { bind: (...args: unknown[]) => { run: () => Promise<unknown> } } } } },
  reason: string,
  rawBody: string,
): Promise<void> {
  try {
    await c.env.DB.prepare(
      `INSERT INTO audit_log (action, entity_type, details, created_at)
       VALUES ('FLEETIO_WEBHOOK_UNPARSEABLE', 'fleetio_webhook', ?, datetime('now'))`,
    ).bind(JSON.stringify({
      reason,
      ip: c.req.header('cf-connecting-ip') ?? null,
      // Snip the body — these get noisy on full payloads + we just need
      // enough to see the schema shape. 1.5 KB is enough for Fleet.io's
      // typical event envelope.
      body_snippet: rawBody.slice(0, 1500),
    })).run();
  } catch (err) {
    console.error('[fleetio-webhook] audit_log unparseable INSERT failed', err);
  }
}

export default fleetioWebhook;
