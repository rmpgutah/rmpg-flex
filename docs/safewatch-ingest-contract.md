# SafeWatch → RMPG Flex: inbound alert contract

**Audience:** the team building the SafeWatch sender.
**Status:** endpoint is live; it returns `not_configured` until RMPG sets the shared secret.

This document is safe to share outside RMPG. It describes only the public
request/response contract — no internal schema, credentials, or infrastructure.

---

## 1. What this integration is

SafeWatch pushes alerts **into** RMPG Flex. Nothing flows back out: there is no
endpoint here that returns RMPG dispatch data, and none is planned. If your
design assumes a bidirectional feed, that assumption is wrong and worth
resolving before you build.

Two kinds of alert are accepted:

- **`community`** — a resident submitted a report through SafeWatch.
- **`feed`** — SafeWatch relayed an item from an upstream publisher (NWS, a
  police feed, etc.). Name that publisher in `source`.

### What happens to an alert after you send it

An accepted alert is **quarantined**. It does not create a call for service, it
does not dispatch a unit, and no officer is sent anywhere on the strength of it.
It lands in a review queue where an RMPG supervisor reads it and decides whether
to promote it into a tip record.

This is deliberate: SafeWatch content is unverified third-party input arriving in
a law-enforcement system, so a human is always in the loop. Alerts of severity
`advisory` or `urgent` raise a notification for on-duty dispatch staff so the
queue gets looked at promptly; `info` alerts land silently.

**Do not build anything that assumes an emergency response follows from a
`201`.** A `201` means "stored for review", nothing more. SafeWatch must not be
presented to the public as a way to summon police.

---

## 2. Endpoint

```
POST https://api.rmpgutah.us/api/safewatch/ingest
Content-Type: application/json
x-rmpg-flex-hmac-sha256: <hex signature>
```

No other method is supported. There is no sandbox host; test against the live
endpoint with throwaway `external_id` values (see §7).

---

## 3. Authentication

Every request carries an HMAC-SHA256 signature of the request body, keyed with a
shared secret RMPG will issue you, hex-encoded, in the
`x-rmpg-flex-hmac-sha256` header. Comparison is case-insensitive and
constant-time.

### The one mistake that will cost you an afternoon

**Sign the exact bytes you transmit.** Not a pretty-printed version, not the
result of `JSON.stringify(JSON.parse(body))`, not a re-serialization from your
object model. Build the body string once, sign *that* string, and send *that*
string. Any difference — key order, whitespace, a trailing newline — produces a
different signature and a `401`.

```js
// correct
const body = JSON.stringify(alert);
const sig  = crypto.createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
await fetch(url, { method: 'POST', body, headers: { 'x-rmpg-flex-hmac-sha256': sig, ... } });

// wrong — the framework may re-serialize `alert` differently than you signed it
await fetch(url, { method: 'POST', body: JSON.stringify(alert), headers: { ...sig of something else } });
```

Handling of the shared secret: store it as a secret in your deployment
environment. Never commit it, never put it in a client bundle (the browser must
not sign these — this is a server-to-server call), and never paste it into a
chat, issue, or PR. If it is ever exposed, tell RMPG and it will be rotated.

---

## 4. Request body

JSON object. Two fields are required; everything else is optional.

| Field | Type | Required | Notes |
|---|---|---|---|
| `external_id` | string | **yes** | Your stable ID for this alert. Max 200 chars. See §6 — this is what makes retries safe. |
| `headline` | string | **yes** | One-line summary. Max 200 chars; **longer is truncated, not rejected**. |
| `source_kind` | `"community"` \| `"feed"` | no | Defaults to `community`. An unrecognized value is a **400**, not a fallback. |
| `source` | string | no | Defaults to `"safewatch"`. For `feed`, the upstream publisher (`"nws"`, `"slcpd"`). Max 64. |
| `severity` | `"info"` \| `"advisory"` \| `"urgent"` | no | Defaults to `info`. Unrecognized → **400**. `advisory`/`urgent` notify dispatch. |
| `alert_type` | string | no | Free-text category (`"suspicious_activity"`, `"flash_flood"`). Max 64. |
| `body` | string | no | Full report text. Max 4000 chars; truncated, not rejected. |
| `location_text` | string | no | Human-readable location. Max 200. |
| `latitude` | number | no | −90 to 90. See below. |
| `longitude` | number | no | −180 to 180. See below. |
| `reporter_contact` | string | no | Contact the reporter chose to give. Max 200. Send only with their consent; omit it otherwise. |
| `occurred_at` | string | no | When the event happened (ISO 8601 preferred). Normalized to UTC ISO. |

### Behaviours worth knowing before you debug them

- **Unknown enum values are rejected, never coerced.** Sending
  `source_kind: "official"` returns 400. This is on purpose: silently mapping it
  to `community` would let a relayed feed item be indistinguishable from a
  resident's report, and RMPG staff act differently on those two.
- **Coordinates are atomic.** Supply both `latitude` and `longitude` or neither.
  A lone one is discarded, as is any pair out of range or non-finite. Send them
  as JSON **numbers**, not strings — `"40.75"` is dropped, because a coordinate
  arriving as text means the sender's serialization is wrong and guessing is
  worse than losing it.
- **Over-long strings truncate; they do not fail.** A 5000-character `body`
  stores the first 4000. If full fidelity matters, keep within the limits.
- **An unparseable `occurred_at` is dropped, not rejected.** The alert is still
  accepted; the field is simply empty. `received_at` is always recorded by RMPG.
- **Triage fields are ignored.** Anything you send named `status`, `reviewed_by`
  or similar is discarded. Review state belongs to RMPG.

### Example

```json
{
  "external_id": "sw_01HQ7X8N2K",
  "source_kind": "community",
  "source": "safewatch",
  "alert_type": "suspicious_activity",
  "severity": "advisory",
  "headline": "Group loitering behind the strip mall",
  "body": "Three people near the loading dock, one carrying a crowbar.",
  "location_text": "900 S State St, Salt Lake City, UT",
  "latitude": 40.7508,
  "longitude": -111.888,
  "occurred_at": "2026-09-15T18:04:00Z"
}
```

---

## 5. Responses

| Status | Body | Meaning |
|---|---|---|
| `201` | `{"ok":true,"alert_id":123,"notified":1}` | Stored. `notified` = dispatch staff alerted (0 for `info`). |
| `400` | `{"ok":false,"error":"<reason>"}` | Malformed JSON, or a field failed validation. `error` names it. Do not retry unchanged. |
| `401` | `{"ok":false,"error":"Missing signature"\|"Invalid signature"}` | Signature absent or wrong. See §3. Do not retry unchanged. |
| `413` | `{"ok":false,"error":"Payload too large"}` | Body over 64 KB. |
| `500` | `{"ok":false,"error":"Internal error"}` | RMPG-side fault. **Safe to retry** — see §6. |
| `200` | `{"ok":false,"skipped":true,"code":"not_configured"}` | RMPG has not set the shared secret yet. Note the `200`: check `ok`, not just the status code. |

That last row is the one that catches people. A missing secret is a
configuration gap, not an outage, so it returns `200` deliberately — retrying
won't help and it shouldn't trip your error alarms. **Treat `ok: false` as
failure regardless of status.**

---

## 6. Retries and idempotency

`external_id` (paired with `source`) is a unique key. Re-sending the same
`external_id` **updates the existing alert in place** rather than creating a
duplicate, and concurrent duplicate deliveries converge on one record.

So: retry `500`s and network failures freely, with backoff. Do not retry `400`
or `401` without changing the request — they will fail identically.

Two consequences:

- **Use a stable ID.** A UUID generated fresh per delivery attempt defeats this
  entirely and will fill the queue with duplicates.
- **Re-sending is how you correct an alert.** Send the same `external_id` with
  updated content. RMPG's own review state is preserved — a correction will not
  resurrect an alert a supervisor already dismissed.

---

## 7. Limits and etiquette

- **64 KB** maximum request body.
- No fixed rate limit is published, but this is a dispatch queue watched by
  people. Send real alerts only, pace bulk backfills, and don't poll-push.
- **Testing:** use `severity: "info"` and an obvious `external_id` prefix such as
  `test_`. `info` does not notify dispatch, so it won't page anyone at 3am. Tell
  RMPG before any load or volume testing.

---

## 8. Reference sender

```js
import crypto from 'node:crypto';

const ENDPOINT = 'https://api.rmpgutah.us/api/safewatch/ingest';
const SECRET = process.env.RMPG_FLEX_SAFEWATCH_SECRET; // never hard-code

export async function sendAlert(alert) {
  const body = JSON.stringify(alert);          // serialize ONCE
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(body, 'utf8')                      // sign the exact bytes sent
    .digest('hex');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-rmpg-flex-hmac-sha256': signature,
    },
    body,                                      // send the same string
  });

  const json = await res.json().catch(() => ({}));

  // `ok:false` can arrive with HTTP 200 (not_configured) — check both.
  if (!res.ok || json.ok !== true) {
    const retryable = res.status >= 500;
    throw Object.assign(
      new Error(`SafeWatch ingest failed: ${res.status} ${json.error ?? json.code ?? ''}`),
      { retryable, status: res.status },
    );
  }
  return json; // { ok: true, alert_id, notified }
}
```

---

## 9. Questions to settle with RMPG before go-live

- **Which upstream feeds will you relay?** RMPG already pulls National Weather
  Service alerts directly. If SafeWatch relays NWS too, the same alert arrives
  twice by two paths with no deduplication between them. Agree who owns that
  source before enabling it.
- **Expected volume**, so the review queue is staffed to match.
- **What SafeWatch tells the public.** RMPG's position is that this is not an
  emergency-reporting channel and must not be described as one. 911 remains the
  route for anything urgent.
