# Delivery Scheduler → CAD Push Integration (Piece 1 of 3)

**Date**: 2026-09-14
**Status**: Approved for implementation
**Scope**: One-way push of confirmed rmpgutahps.us delivery appointments into RMPG Flex as dispatchable CAD calls.

## Context

This is piece 1 of a 3-piece integration between rmpgutahps.us (a delivery-scheduling
app in the same organization, fully owned/controlled — different repo, Cloudflare
Workers + Hono + D1 stack, same architecture family as Flex) and RMPG Flex CAD/RMS:

1. **This doc** — push confirmed deliveries as CAD-visible, dispatchable calls.
2. Flag risky delivery addresses using Flex's warrant/incident history, for office review on the scheduler side. (separate design doc, not started)
3. Replace the scheduler's flat global-capacity model with real officer/unit availability pulled from Flex. (separate design doc, not started — the deep one; scheduler currently has no officer/unit concept at all)

These are decomposed into independent specs because they have different data flows,
different failure modes, and piece 3 requires changes to the scheduler's core
scheduling logic, not just a data exchange.

## Trigger & Transport

- **Trigger**: direct call from the scheduler's `POST /api/admin/delivery-slots/:id/approve`
  endpoint, fired via `waitUntil` (matching that repo's existing fire-and-forget
  pattern for outbound side effects — e.g. its Task 6 approve/decline emails).
  Non-blocking: a failed push does not fail or delay the approve response.
- **Scope**: v1 is **confirm-only**. Only the approve action pushes to Flex.
  Declines, cancellations, and reschedules after initial confirmation are handled
  manually by a dispatcher in Flex; no additional webhook triggers in this phase.
- **No outbox/queue for v1**: the scheduler repo has no existing outbox pattern to
  mirror (its dominant convention is direct fire-and-forget), and a silently-dropped
  push is made visible instead of retried automatically — see Failure Visibility
  below. A Cron sweep is a plausible fast-follow once real failure-rate data
  exists, not a v1 requirement.

## Auth

HMAC-signed webhook, matching this repo's existing `servemanager-signature.ts` /
`fleetioWebhook.ts` conventions rather than a static API key (no service-to-service
auth mechanism currently exists between the two systems, and this repo's own
inbound-webhook precedent is always HMAC-verified before the payload is touched).

- New route: `POST /api/deliveries/webhook`, mounted **before** `authMiddleware`
  (same pattern as `/api/fleetio/webhook` — this is a signed, unauthenticated-JWT
  endpoint that authenticates via signature instead).
- Header: `x-rmpg-flex-hmac-sha256`, computed the same way `hmacSha256Hex` in
  `src/routes/fleetioWebhook.ts` already does (Web Crypto HMAC-SHA256 over the raw
  body string, `TextEncoder` byte conversion — not `btoa` — so UTF-8 in subject
  names/addresses is handled safely; this exact bug class is called out in
  CLAUDE.md as something already hit once elsewhere in this repo).
- Secret: new env var `RMPG_FLEX_WEBHOOK_SECRET`, set via `wrangler secret put`
  (mirrors `SERVEMANAGER_WEBHOOK_SECRET` naming convention). Unset → route returns
  503 per this repo's `503-not-configured` convention for optional integrations.
- Verification: constant-time compare (`constantTimeEquals`, also lifted from
  `fleetioWebhook.ts`) of the computed HMAC against the header value, **before**
  any payload parsing or DB write.

## Data Model

No new table. Extends the existing `calls_for_service_ext` 1:1 overflow table
(`id` = FK to `calls_for_service.id`, `ON DELETE CASCADE`) — the pattern this repo
already established for exactly this reason (`calls_for_service` is at/near the D1
100-column hard cap; see CLAUDE.md gotcha #19 and the `0262` rebuild incident).
A brand-new dedicated table was considered and rejected: the delivery needs to be
a **real dispatchable call** (assignable to a unit through the normal CAD queue),
not a separate visibility-only layer, so it must be a `calls_for_service` row.

On a verified confirm event, insert:

- **`calls_for_service`**: `incident_type = 'delivery'` (free TEXT column, no
  `CHECK` constraint — confirmed against `migrations/baseline/schema.sql:144`, so
  this needs no schema change), `source = 'other'` (the existing `source` `CHECK`
  enum has no `'delivery_scheduler'` value; adding one would require a `CHECK`
  rebuild of the 100-column table — the same risky `0262`-style operation CLAUDE.md
  warns against — so v1 deliberately reuses `'other'` rather than touching the
  constraint), `status = 'pending'`, `location_address` from the pushed address,
  `latitude`/`longitude` geocoded if resolvable else left null (renders as an
  address-only pin pending manual dispatcher fill-in).
- **`calls_for_service_ext`**: new columns via migration (see below) —
  `delivery_slot_id` (INTEGER, UNIQUE — the idempotency key), `delivery_case_number`
  (TEXT, descriptive/searchable, not unique — a subject can have more than one
  delivery scheduled over time, e.g. after a decline/reschedule), `delivery_origin`
  (TEXT, constant `'rmpg_flex_delivery'` — the free-text discriminator standing in
  for what would otherwise need a `source` CHECK value), `delivery_scheduled_date`,
  `delivery_time_window`, `delivery_contact_name`, `delivery_contact_phone`,
  `delivery_contact_email`, `delivery_subject_name` (nullable — populated only if
  the scheduler's payload includes it), `delivery_status` (TEXT, mirrors the
  scheduler's `delivery_slots.status` at push time for reference/display).

### Migration

New file `migrations/0289_delivery_ext_columns.sql` (next free prefix — high-water
is `0288`, confirmed via `ls migrations/ | tail`). Idempotent `ALTER TABLE ... ADD
COLUMN` statements against `calls_for_service_ext` (not `calls_for_service` itself
— stays clear of the 100-column table entirely) plus the unique index on
`delivery_slot_id`. Per `migrations/README.md`, D1 does not support
`IF NOT EXISTS` on `ADD COLUMN`; accept failure on re-apply, consistent with every
other migration in this repo.

After merge: apply directly to live D1 `785de7ae` via `scripts/apply-migration.sh`
per this repo's standing gotcha that the deploy step's migration apply is
`continue-on-error` and cannot be trusted alone.

## Idempotency

Unique index on `calls_for_service_ext.delivery_slot_id`. A retried webhook
(network retry, duplicate approve click, etc.) with the same `delivery_slots.id`
updates the existing CFS/ext row pair in place rather than creating a duplicate
call. Keyed on the slot id (not `case_number`) per the scheduler side's
correction — case_number alone isn't guaranteed unique across a subject's
delivery history.

## Payload Contents

Scheduler sends: `delivery_slots.id`, `case_number`, `slot_date`, `time_window`,
`name`, `email`, `phone`, `notes`, and (when reasonably available via join at
push time) the case's address and subject name from `cases`. If pulling
case/subject data into the payload proves nontrivial on the scheduler side (PII/
access-scoping concerns), `delivery_slots`' own contact fields are an acceptable
fallback and Flex degrades gracefully (address-only pin, no subject name shown).

## Failure Visibility (scheduler-side, referenced for context)

Not implemented in this repo — noted here because it changes how a Flex-side
outage is surfaced. The scheduler adds `flex_push_status`
(`'pending'|'sent'|'failed'`) and `flex_push_error` columns to `delivery_slots`,
set on the same approve request, with a manual "resend" button on its admin page
— mirroring that repo's existing `last_webhook_error`/`last_sync_warning`
visibility pattern for ServeManager. This means a failed push is visible and
retriable, not silently dropped, without Flex needing to implement any retry
logic of its own.

## Out of Scope (v1)

- Cancellation/reschedule webhooks — confirm-only trigger.
- Automatic retry/dead-letter queue on the Flex receiving side — the scheduler's
  manual-resend button is the retry mechanism for v1.
- Officer/unit assignment logic changes — the delivery becomes a normal
  dispatchable `calls_for_service` row; existing CAD assignment workflow applies
  unchanged.
- Pieces 2 and 3 (risk flagging, capacity model) — separate specs.
