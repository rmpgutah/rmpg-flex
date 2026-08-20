# Fleet.io Webhook Hardening — Design

**Date:** 2026-07-23
**Scope:** Second sub-project of the broader "advanced Fleet.io hardening" program. Follows [Reliability & Observability Hardening](2026-07-23-fleetio-reliability-observability-design.md) (PR #2971, merged). Third sub-project (deferred coverage — parts inventory, vendor lifecycle UI, custom fields engine) is a separate spec, done after this one.

## Background

`src/routes/fleetioWebhook.ts` (`POST /api/fleetio/webhook`) is the inbound receiver for Fleet.io's webhook events. It's already reasonably well-built: constant-time Authorization-header comparison against `FLEETIO_WEBHOOK_SECRET`, dedup via `UNIQUE (direction, event_id)` on `fleetio_events`, and audit logging for both bad-auth attempts and unparseable payloads.

It has one real, previously-unidentified gap. `src/middleware/auth.ts`'s `isPublicAuthBypass()` lets this route through without a JWT (Fleet.io has no session to send one from) by calling `next()` immediately — but `src/middleware/rateLimit.ts`'s `apiRateLimit` middleware, which is still mounted for the `/api/fleetio/*` prefix, keys its counter entirely on `c.get('userId')`:

```ts
const userId = c.get('userId') as number | undefined;
if (userId != null) { /* only path that actually checks the limit */ }
await next();
```

Since the webhook route never sets `userId` (it bypasses auth entirely), this middleware is a silent no-op for it. The route has **zero rate limiting**. Combined with the fact that every failed auth attempt writes an unthrottled `INSERT INTO audit_log` row, the endpoint is:
- Brute-forceable against `FLEETIO_WEBHOOK_SECRET` at unlimited request volume (the constant-time compare defeats timing attacks, not volume attacks).
- A D1 write-amplification vector — an attacker can flood POSTs at zero cost to themselves, each triggering a real D1 write on our side, with no alerting that it's happening.

No live inbound webhook has ever landed in production (confirmed via D1 query during the prior phase), so this is a latent, not yet exploited, gap — worth closing before the integration sees real traffic.

## Part 1 — IP-keyed rate limit

Add a rate-limit check at the very top of `fleetioWebhook.post('/webhook', ...)`, before the `FLEETIO_WEBHOOK_SECRET` unset-check and before the Authorization-header comparison — so a flood gets a cheap `429` before any D1 read/write or crypto compare.

Reuses the existing `rateLimitAllow(kv, bucket, limit, windowSeconds): Promise<boolean>` from `src/utils/rateLimit.ts` (already used by the per-user `apiRateLimit` middleware) — no new rate-limiting primitive needed. Bucket key: `fleetio-webhook:${ip}`, where `ip` is `c.req.header('cf-connecting-ip') ?? 'unknown'` (same header the existing bad-auth audit log already reads). Limit: **30 requests / 60 seconds** per IP. Fleet.io's documented retry policy is 5×/hr + 1×/hr for 24h per failed delivery — legitimate traffic, even with several concurrent event types retrying, is nowhere near 30/min; this is sized to stop abuse, not throttle real usage.

On rate-limit exceeded: return `c.json({ error: 'rate_limited' }, 429)` immediately — no D1 write, no audit log entry (logging every single blocked request during an active flood is itself the write-amplification problem this fix closes; the flood is already visible via the probe-detection alert in Part 2, which fires once per window, not once per request).

## Part 2 — Probe-detection alert

A second, coarser KV counter (also via `rateLimitAllow`, same utility, different bucket) tracks bad-auth failures specifically — not all requests, just the ones that reach and fail the Authorization-header comparison. Bucket key: `fleetio-webhook-badauth:${ip}`, limit **10 / 600 seconds** (10-minute window). This is checked *after* a request fails auth, using `rateLimitAllow`'s own return value as the "have we already alerted in this window" signal: the first bad-auth attempt from an IP that pushes the counter to exactly the limit (i.e., the call that returns `false`) is the one that fires the alert — every failure after that in the same window returns `false` again but does not re-fire (see Part 3 for why redundant firing isn't a concern either way, but the natural once-per-window behavior of a fixed-window counter falling through this path is sufficient and needs no extra state).

On that trigger, fire a new `fleetio_webhook_probe_detected` notification via the existing `evaluateNotificationRules(db, 'fleetio_webhook_probe_detected', { title, message, priority: 'high', entity_type: 'fleetio_webhook_probe' }, env)` — same engine as Phase 1's `fleetio_event_dead_lettered`/`fleetio_queue_unhealthy`. A new migration seeds one more default-active `notification_rules` row for this trigger, targeting `admin`, following the exact pattern of migration `0203`.

Message content: IP address, and the fact that 10+ auth failures occurred in a 10-minute window — enough for an admin to decide whether to investigate or rotate `FLEETIO_WEBHOOK_SECRET`.

## Part 3 — Bounded audit logging

The existing bad-auth `audit_log` INSERT (`FLEETIO_WEBHOOK_BAD_AUTH`) stays for genuine visibility into occasional auth mistakes (e.g., an operator re-registering the webhook with a stale secret), but is capped at the first **5** failures per IP per 10-minute window — reusing the same `fleetio-webhook-badauth:${ip}` counter from Part 2 (read via a second, smaller-limit `rateLimitAllow` call, OR — simpler and avoiding a second KV read on every request — checked against the count `rateLimitAllow` already tracked, by having Part 2's helper return the running count rather than just a boolean; see Implementation note below). Once an IP is confirmed to be actively probing (the Part 2 alert has already fired), there's no new information in logging every subsequent identical failure — the rate limiter in Part 1 is also actively capping the request volume by this point anyway.

**Implementation note:** `rateLimitAllow` currently returns only `boolean`. Rather than change its return type (used elsewhere, e.g. the general `apiRateLimit` middleware, which only needs the boolean), add a small new helper in `src/utils/rateLimit.ts` — `rateLimitCount(kv, bucket, windowSeconds): Promise<number>` — that reads the same KV key shape `rateLimitAllow` writes (`rl:${bucket}:${windowStart}`) without incrementing, so the webhook route can cheaply check "how many bad-auth attempts has this IP had in the current window" after `rateLimitAllow` has already incremented it, and use that count to decide both the alert-once-per-window firing (Part 2, count reaches exactly 10) and the audit-log cap (Part 3, count ≤ 5). This avoids a second independent counter and keeps Parts 2 and 3 reading one shared piece of state.

## Testing

- `rateLimitCount` (new, `src/utils/rateLimit.ts`): unit test against a mock `KVNamespace` — asserts it reads without incrementing, returns 0 for an absent key, and returns the correct count after `rateLimitAllow` has written N times to the same bucket/window.
- Webhook route rate-limiting: extend `tests/fleetioWebhook.test.ts`'s existing test harness with cases for: (a) request N+1 within the window after N successful requests returns 429 with no D1 write attempted; (b) the bad-auth counter reaching exactly 10 triggers exactly one `evaluateNotificationRules` call (mock it, assert call count); (c) bad-auth attempts 1–5 write to `audit_log`, attempts 6+ in the same window do not.
- Migration (seeded `fleetio_webhook_probe_detected` rule): verify locally via `npm run migrate:local` + `SELECT * FROM notification_rules WHERE trigger_event = 'fleetio_webhook_probe_detected'`; apply to live D1 post-merge per `scripts/apply-migration.sh`.

## Out of scope

- HMAC body-signing — Fleet.io doesn't support it (see the existing file header comment); the retained `hmacSha256Hex`/`normalizeSignatureHeader` helpers stay unused/future-vendor-only, unchanged by this spec.
- Rotating `FLEETIO_WEBHOOK_SECRET` automatically on probe detection — out of scope; the alert gives an admin the information to decide, not an automated response (auto-rotation would itself require operator action to re-register the new secret in Fleet.io's UI, so automating half the loop adds risk without removing operator involvement).
- Global (cross-IP) rate limiting — this spec is IP-scoped only, matching the threat model (a single bad actor or misconfigured client), not a distributed-flood scenario, which would need a different mitigation (e.g. Cloudflare-level WAF rules) outside this application code's reach anyway.
