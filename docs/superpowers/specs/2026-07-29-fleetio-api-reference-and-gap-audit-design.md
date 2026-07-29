# Fleet.io API Reference + Fleet Manager/Fleet.io Gap Audit

**Date:** 2026-07-29
**Status:** Approved, not yet implemented

## Context

`src/utils/fleetio/` is ~9,600 lines across `client.ts`, `sync.ts`, `seed.ts`,
`events.ts`, `ownership.ts`, `pull.ts`, `resources.ts`, and the webhook route,
backed by 6 prior design docs in this directory. CLAUDE.md documents a long
list of already-hardened invariants (cursor pagination, `fleetio_links`
canonicalization, FK translation, POST/DELETE non-retry, per-emit-kind
dispatch coverage). This is not a green-field integration.

It is also not a fully-trustworthy one. [PR #3162](https://github.com/rmpgutah/rmpg-flex/pull/3162)
(same session) fixed two live dead-lettered events:

- `fuel_entry/create` sent a `cost` field Fleet.io's API doesn't have and
  omitted `meter_entry_attributes`, which Fleet.io marks **required**. This
  bug shipped and ran in production for 11 days before appearing on the
  Fleet.io Integration Health dashboard.
- `vendor/delete` treated a 404 from `POST /vendors/:id/archive` (vendor
  already gone remotely) as a hard failure instead of a completed goal state.

Neither bug was caught by tests, because the tests encoded the same wrong
assumptions the code did — there was no independent source of truth for
Fleet.io's actual schema. That's the gap this program closes: not "build
more Fleet.io integration," but "give the integration a ground truth to be
checked against, and use it to find what else is silently wrong."

## Goals

1. A durable, versioned reference for every Fleet.io resource this codebase
   touches, so the next mapper bug is caught by reading a doc instead of by
   a live 422/404 dead-lettering for days.
2. A single written audit of where Fleet Manager + the Fleet.io integration
   actually stand today, replacing scattered claims across CLAUDE.md and 6
   design docs with one current, verified picture.
3. A prioritized, actionable gap list the user can decide how to act on —
   this program produces the report; fixing gaps is separate, later work
   (per user's explicit "report first, then fix" instruction).

## Non-goals

- Not rebuilding or redesigning the Fleet.io integration. If the audit finds
  bidirectional sync is substantially complete (the evidence in CLAUDE.md
  suggests it is), this program does not add scope to prove otherwise.
- Not fixing anything found. Gaps are reported with enough detail (file:line,
  severity, reproduction) to be fixed independently, in prioritized follow-up
  PRs the user reviews and orders.
- Not re-documenting Fleet.io resources this codebase doesn't touch (e.g.
  inspections, issues, contacts) — scope is bounded by `resources.ts`'s
  `FLEETIO_LINK_RESOURCE` plus whatever `client.ts` already calls.

## Deliverable 1 — `docs/fleetio-api-reference.md`

One file, one resource per section: **vehicles, vendors, parts, work_orders,
fuel_entries** (the five resources `FLEETIO_LINK_RESOURCE` in
[`resources.ts`](../../../src/utils/fleetio/resources.ts) tracks).

Each section is built the same way the fuel_entries bug was actually found
in this session — not from training-data memory of Fleet.io's API, which is
exactly what produced the wrong `cost`/`meter_entry_attributes` mapping in
the first place:

1. Fetch the live `developer.fleetio.com/reference/create-<resource>` and
   `.../update-<resource>` pages via the Browser tool (readme.io renders
   client-side; WebFetch alone returns an empty shell — confirmed this
   session).
2. Record every request field, its type, and required/optional status
   verbatim from that page.
3. Cross-reference against this codebase's mapper for that resource
   (`mapVehicleFieldsToFleetio`, `mapVendorFieldsToFleetio`,
   `mapPartFieldsToFleetio`, `mapFuelEntryFieldsToFleetio` in
   [`seed.ts`](../../../src/utils/fleetio/seed.ts); work_orders pass through
   `translateOutboundFks` without an explicit mapper — verify that's still
   accurate) and note any field the codebase sends that Fleet.io doesn't
   define, and any Fleet.io-required field the codebase never sends.
4. Also capture, once (not per-resource): auth headers, the pagination
   contract (`cursor` vs `page` — see CLAUDE.md's existing writeup, verify
   it's still accurate), and rate limits (50 req/min, `PACE_MS`).

Any mismatch found in step 3 is **not fixed here** — it's logged as a
candidate finding, carried into Deliverable 2.

## Deliverable 2 — Gap audit report

New file: `docs/superpowers/specs/2026-07-29-fleetio-fleet-manager-gap-audit.md`.

Three-way diff, each row a specific, checkable claim:

| Column | Source |
|---|---|
| **Claimed** | CLAUDE.md's Fleet.io section + the 6 existing `docs/superpowers/specs/*fleetio*` design docs |
| **Actual** | Read the real code: `src/routes/fleet.ts`, `src/routes/fleetio.ts`, `src/routes/fleetioWebhook.ts`, `src/utils/fleetio/*.ts`, `client/src/pages/fleet/*` |
| **Correct per Fleet.io** | Deliverable 1's reference doc |

Findings are grouped into three buckets, each with severity (per finding:
does it silently corrupt data / dead-letter / just mislead a reader) and a
file:line pointer:

- **Schema-mismatch bugs** — same class as the two just fixed. Primary
  target: every `map*FieldsToFleetio` function and every inbound-payload
  reader, checked against Deliverable 1.
- **Stale or wrong documentation** — CLAUDE.md or a spec doc asserting
  something the code doesn't do (or no longer does). These get flagged, not
  silently corrected — CLAUDE.md edits are a separate, explicit ask.
- **Genuinely missing functionality** — something CLAUDE.md's own "PR 4"
  framing implies should exist (e.g. specific webhook event types, specific
  Fleet Manager UI affordances) but doesn't. Distinguish "not started" from
  "started but broken" from "works but was never documented."

Bidirectional sync is investigated as part of this pass, not separately:
confirm every `EMIT_KIND_TO_RESOURCE` entry has a working
`dispatchOutbound` branch (mirroring how the vendor/delete 404 bug was
found), confirm the webhook route in `fleetioWebhook.ts` is live and its
handler (`applyInbound`) round-trips correctly for each resource, and report
whether "PR 4" is actually complete, partially complete, or aspirational.

## Testing / verification for this program itself

- Deliverable 1 has no code, so "testing" means: every field claim is sourced
  from a live fetch of Fleet.io's own docs (cite the URL), not memory.
- Deliverable 2's findings must each be reproducible from a file:line in this
  repo or a `d1_database_query` result against live D1 (`785de7ae-…`) — no
  finding based on assumption alone.
- Both deliverables are markdown; commit them normally, no CI gate applies.

## Open question for the user, deferred to the fix phase

Once the gap report exists, the user reviews and orders the fix work
(explicit instruction: report first, fix second). This spec does not
pre-decide that ordering.
