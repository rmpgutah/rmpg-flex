# Fleet.io API Reference + Gap Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce two markdown deliverables — a verified Fleet.io API reference doc, and a gap audit report diffing that reference against CLAUDE.md's claims and the actual codebase — with zero code changes and zero fixes applied.

**Architecture:** No new subsystem. Each task fetches one Fleet.io resource's live API docs (via the Browser tool — WebFetch alone returns an empty shell for readme.io-rendered pages, confirmed 2026-07-29), records every request field verbatim, cross-checks it against this codebase's existing mapper function, and appends a section to `docs/fleetio-api-reference.md`. The final task synthesizes all of that plus a read of the real routes/pages into the gap audit report.

**Tech Stack:** Browser tool (`mcp__Claude_Browser__*`) for fetching readme.io docs pages, `mcp__bfc8f52c-a149-4323-966f-b8144c5ec84a__d1_database_query` for verifying any live-data claims in the audit, git/gh for commits and PR.

## Global Constraints

- Every field claim in `docs/fleetio-api-reference.md` must cite the live URL it came from — no field recorded from memory (spec Deliverable 1, step 1-2).
- Nothing found during this program gets fixed as part of it — findings only (spec Non-goals, explicit user instruction: "report first, then fix").
- Scope is exactly 5 resources: vehicles, vendors, parts, work_orders, fuel_entries — the `FLEETIO_LINK_RESOURCE` set in [`resources.ts`](../../../src/utils/fleetio/resources.ts). Do not document Fleet.io resources this codebase doesn't touch.
- Every audit finding must be reproducible from a file:line in this repo or a `d1_database_query` result — no finding based on assumption alone (spec "Testing / verification").
- Commit after each task. This is docs-only work — no test suite gates it, but `npx vitest run` costs nothing to run before each commit as a safety check that no code file was accidentally touched.

---

### Task 1: Scaffold the reference doc + document `vehicles`

**Files:**
- Create: `docs/fleetio-api-reference.md`
- Read (do not modify): `src/utils/fleetio/seed.ts` (`mapVehicleFieldsToFleetio`, `buildVehiclePayload`), `src/utils/fleetio/client.ts` (`createVehicle`, `updateVehicle`, `archiveVehicle`)

**Interfaces:**
- Produces: `docs/fleetio-api-reference.md` with a top-level intro section (auth, pagination, rate limit — see Task 6 for full content, but the file must exist with a heading structure other tasks append to) and a complete `## Vehicles` section.

- [ ] **Step 1: Create the doc skeleton**

Write `docs/fleetio-api-reference.md`:

```markdown
# Fleet.io API Reference (RMPG Flex integration surface)

> Captured live from developer.fleetio.com on 2026-07-29. Every field below
> is sourced from a live fetch of Fleet.io's own reference pages, not from
> memory — see the cited URL in each section. Cross-referenced against this
> codebase's mappers in `src/utils/fleetio/seed.ts` and `client.ts`.
>
> Scope: the 5 resources this codebase syncs (`FLEETIO_LINK_RESOURCE` in
> `src/utils/fleetio/resources.ts`). Not a full Fleet.io API reference.

## Vehicles

<!-- filled in Task 1 -->

## Vendors

<!-- filled in Task 2 -->

## Parts

<!-- filled in Task 3 -->

## Work Orders

<!-- filled in Task 4 -->

## Fuel Entries

<!-- filled in Task 5 -->

## Shared: auth, pagination, rate limits

<!-- filled in Task 6 -->
```

- [ ] **Step 2: Fetch the live vehicles create/update docs**

Open the Browser tool and navigate to `https://developer.fleetio.com/reference/create-vehicle`. If that 404s, use `WebSearch` with query `"developer.fleetio.com/reference" create vehicle` to find the correct slug (this is exactly how the fuel_entries page was found this session — the slug is not always the resource's plain name). Use `mcp__Claude_Browser__get_page_text` to extract the rendered content (the page is client-side rendered; a raw WebFetch returns an empty shell). Repeat for `update-vehicle`.

- [ ] **Step 3: Write the Vehicles section**

Replace the `<!-- filled in Task 1 -->` placeholder under `## Vehicles` with:
- The exact POST/PATCH URLs.
- A table of every request field: name, type, required/optional, one-line description, copied from the live page.
- A **"Cross-check against this codebase"** subsection: read `mapVehicleFieldsToFleetio` in `seed.ts` — list every field it sends, and flag (as `⚠️ MISMATCH`) any field Fleet.io doesn't define, or any Fleet.io-required field the mapper never sends. Do the same for `buildVehiclePayload` (the `/seed` route's separate mapper — note if the two mappers disagree with each other, that's also a mismatch to flag).

Do not fix any mismatch found — write it down under the `⚠️ MISMATCH` marker so Task 7 can pull it into the audit report.

- [ ] **Step 4: Run the safety check and commit**

```bash
npx vitest run
git add docs/fleetio-api-reference.md
git commit -m "docs(fleetio): capture live Vehicles API reference + mapper cross-check"
```

Expected: vitest passes (no code was touched); commit succeeds.

---

### Task 2: Document `vendors`

**Files:**
- Modify: `docs/fleetio-api-reference.md` (replace `## Vendors` placeholder)
- Read: `src/utils/fleetio/seed.ts` (`mapVendorFieldsToFleetio`), `src/utils/fleetio/client.ts` (`createVendor`, `updateVendor`, `archiveVendor`)

**Interfaces:**
- Consumes: the doc skeleton from Task 1.
- Produces: a completed `## Vendors` section, same shape as `## Vehicles`.

- [ ] **Step 1: Fetch the live vendors create/update/archive docs**

Navigate (Browser tool) to `https://developer.fleetio.com/reference/create-vendor`, `.../update-vendor`, and `.../archive-vendor` (fall back to `WebSearch` for the correct slug if any 404s, as in Task 1). Extract with `get_page_text`. The archive endpoint matters here specifically because [PR #3162](https://github.com/rmpgutah/rmpg-flex/pull/3162) fixed a live bug where a 404 from this exact endpoint was mishandled — confirm the doc records what a 404 response means for this endpoint (resource not found) so the audit in Task 7 can verify the fix's reasoning was correct.

- [ ] **Step 2: Write the Vendors section**

Same structure as Task 1 Step 3: URLs, request field table, cross-check subsection against `mapVendorFieldsToFleetio` in `seed.ts`. Also note: `archiveVendor` in `client.ts` currently has no explicit doc comment about what other status codes (besides 404) it can return — record what the live docs say and flag if `dispatchOutbound`'s vendor/delete branch (in `sync.ts`) doesn't handle a documented case.

- [ ] **Step 3: Run the safety check and commit**

```bash
npx vitest run
git add docs/fleetio-api-reference.md
git commit -m "docs(fleetio): capture live Vendors API reference + mapper cross-check"
```

---

### Task 3: Document `parts`

**Files:**
- Modify: `docs/fleetio-api-reference.md` (replace `## Parts` placeholder)
- Read: `src/utils/fleetio/seed.ts` (`mapPartFieldsToFleetio`), `src/utils/fleetio/client.ts` (`createPart`, `updatePart`, `deletePart`)

**Interfaces:**
- Consumes: the doc skeleton from Task 1.
- Produces: a completed `## Parts` section.

- [ ] **Step 1: Fetch the live parts create/update/delete docs**

Navigate to `https://developer.fleetio.com/reference/create-part`, `.../update-part`, `.../delete-part` (WebSearch fallback for slugs as needed). Extract with `get_page_text`.

- [ ] **Step 2: Write the Parts section**

Same structure as prior tasks: URLs, field table, cross-check against `mapPartFieldsToFleetio`. Note that parts use a real hard `DELETE` (unlike vendors' archive) — confirm the live docs agree, since CLAUDE.md's Fleet.io invariants section asserts this asymmetry explicitly ("RMPG hard-deletes parts and fuel entries → Fleet.io DELETE").

- [ ] **Step 3: Run the safety check and commit**

```bash
npx vitest run
git add docs/fleetio-api-reference.md
git commit -m "docs(fleetio): capture live Parts API reference + mapper cross-check"
```

---

### Task 4: Document `work_orders`

**Files:**
- Modify: `docs/fleetio-api-reference.md` (replace `## Work Orders` placeholder)
- Read: `src/utils/fleetio/sync.ts` (`dispatchOutbound`'s `work_order` branches — `createWorkOrder`, `updateWorkOrder`), `src/utils/fleetio/client.ts`

**Interfaces:**
- Consumes: the doc skeleton from Task 1.
- Produces: a completed `## Work Orders` section.

- [ ] **Step 1: Fetch the live work_orders create/update docs**

Navigate to `https://developer.fleetio.com/reference/create-work-order`, `.../update-work-order` (WebSearch fallback for slugs). Extract with `get_page_text`.

- [ ] **Step 2: Write the Work Orders section**

Same structure. Work orders have **no explicit mapper** in `seed.ts` — per the spec (Deliverable 1, step 3), verify `translateOutboundFks` plus the raw `filteredPayload` pass-through in `dispatchOutbound` is still accurate: list what fields actually reach Fleet.io (read the `work_order`/`create` and `work_order`/`update` branches in `sync.ts` directly) and flag any Fleet.io-required field never sent, same as the mapper cross-checks in Tasks 1-3.

- [ ] **Step 3: Run the safety check and commit**

```bash
npx vitest run
git add docs/fleetio-api-reference.md
git commit -m "docs(fleetio): capture live Work Orders API reference + pass-through cross-check"
```

---

### Task 5: Document `fuel_entries` (post-fix verification)

**Files:**
- Modify: `docs/fleetio-api-reference.md` (replace `## Fuel Entries` placeholder)
- Read: `src/utils/fleetio/seed.ts` (`mapFuelEntryFieldsToFleetio`, as fixed in #3162)

**Interfaces:**
- Consumes: the doc skeleton from Task 1.
- Produces: a completed `## Fuel Entries` section — this one doubles as a **regression check** that #3162's fix is actually correct, not just "doesn't crash."

- [ ] **Step 1: Re-fetch the live fuel_entries create docs**

Navigate to `https://developer.fleetio.com/reference/create-fuel-entry` (already confirmed reachable this session) and, if it exists, `.../update-fuel-entry`. Extract with `get_page_text`.

- [ ] **Step 2: Write the Fuel Entries section**

Same structure as prior tasks. In the cross-check subsection, explicitly confirm (or refute) that the post-#3162 `mapFuelEntryFieldsToFleetio` sends `price_per_volume_unit` and `meter_entry_attributes.value` correctly per the live docs — this is the one section where the cross-check is expected to come back clean, since it was just fixed. If it does NOT come back clean, that's a high-severity finding for Task 7 (it would mean the fix shipped incorrect).

- [ ] **Step 3: Run the safety check and commit**

```bash
npx vitest run
git add docs/fleetio-api-reference.md
git commit -m "docs(fleetio): capture live Fuel Entries API reference, confirm #3162 fix"
```

---

### Task 6: Document shared auth/pagination/rate-limit contract

**Files:**
- Modify: `docs/fleetio-api-reference.md` (replace `## Shared: auth, pagination, rate limits` placeholder)
- Read: `src/utils/fleetio/client.ts` (`iterateList`, `listAllVehicles`, `PACE_MS`, auth header construction), CLAUDE.md's "Fleet.io invariants" section

**Interfaces:**
- Consumes: the doc skeleton from Task 1.
- Produces: a completed shared section covering the parts of the API surface that aren't per-resource.

- [ ] **Step 1: Fetch the live authentication + pagination docs**

Navigate to `https://developer.fleetio.com/docs/authentication` and `https://developer.fleetio.com/docs/pagination` (or the current equivalent slugs — use `WebSearch` if these 404). Extract with `get_page_text`.

- [ ] **Step 2: Write the shared section**

Cover: the two auth headers (`Authorization: Token <key>`, `Account-Token: <token>`), the cursor-vs-legacy pagination split CLAUDE.md already documents (verify it's still accurate against what you just fetched — this is one of the things Task 7 needs confirmed, not assumed), and the 50 req/min rate limit / `PACE_MS` = 1.2s pacing. Cite the live URLs.

- [ ] **Step 3: Run the safety check, commit, and open the PR**

```bash
npx vitest run
git add docs/fleetio-api-reference.md
git commit -m "docs(fleetio): capture shared auth/pagination/rate-limit contract"
git push -u origin <branch-name>
gh pr create -R rmpgutah/rmpg-flex --title "docs(fleetio): full API reference for the 5 synced resources" --body "Deliverable 1 of docs/superpowers/specs/2026-07-29-fleetio-api-reference-and-gap-audit-design.md. Every field is sourced from a live fetch of Fleet.io's own reference docs, cross-checked against this codebase's mappers. No code changes."
```

(Use whatever branch this plan is being executed on — check `git branch --show-current` before running the last two commands.)

---

### Task 7: Write the gap audit report

**Files:**
- Create: `docs/superpowers/specs/2026-07-29-fleetio-fleet-manager-gap-audit.md`
- Read: `CLAUDE.md` (Fleet.io section), all 6 existing `docs/superpowers/specs/*fleetio*` files, `src/routes/fleet.ts`, `src/routes/fleetio.ts`, `src/routes/fleetioWebhook.ts`, all of `src/utils/fleetio/*.ts`, `client/src/pages/fleet/*`, and `docs/fleetio-api-reference.md` (Tasks 1-6's output)

**Interfaces:**
- Consumes: `docs/fleetio-api-reference.md` (complete, from Tasks 1-6) as the "correct per Fleet.io" source of truth, plus every `⚠️ MISMATCH` flagged inline in Tasks 1-6.
- Produces: `docs/superpowers/specs/2026-07-29-fleetio-fleet-manager-gap-audit.md`, the final deliverable of this plan.

- [ ] **Step 1: Collect every `⚠️ MISMATCH` flagged in Tasks 1-6**

Grep the finished reference doc:

```bash
grep -n "MISMATCH" docs/fleetio-api-reference.md
```

Each hit becomes a row in the "Schema-mismatch bugs" bucket below. Note the file:line in `seed.ts`/`sync.ts` each one traces back to (already recorded in the reference doc's cross-check subsections).

- [ ] **Step 2: Check every `EMIT_KIND_TO_RESOURCE` entry has a working dispatch branch**

Read `EMIT_KIND_TO_RESOURCE` in `src/utils/fleetio/events.ts` and, for each kind, confirm a matching `if (row.resource === '...' && row.action === '...')` branch exists in `dispatchOutbound` (`src/utils/fleetio/sync.ts`) that doesn't fall through to the `throw new FleetioHttpError(... 501)` catch-all at the bottom. List any kind that does fall through — that's a "genuinely missing functionality" finding (per the vendor/delete 404 and fuel/delete 501 incidents CLAUDE.md already documents, this exact class of bug has recurred twice before #3162).

- [ ] **Step 3: Confirm the webhook receiver is live and query real inbound event history**

Confirm `fleetioWebhook` is mounted in `src/index.ts` (`app.route(...)` or equivalent) and that `FLEETIO_WEBHOOK_SECRET` is referenced (not hardcoded) in `fleetioWebhook.ts`. Then query live D1 for real inbound activity to settle whether "PR 4 bidirectional sync" is live, partial, or aspirational:

```
mcp__bfc8f52c-a149-4323-966f-b8144c5ec84a__d1_database_query
database_id: 785de7ae-3e7a-4e01-93bb-d24ddd813f6b
sql: SELECT resource, action, status, COUNT(*) AS n, MAX(created_at) AS most_recent
     FROM fleetio_events WHERE direction = 'inbound' GROUP BY resource, action, status
     ORDER BY most_recent DESC
```

Record the result verbatim in the report — this is the "reproducible from a d1_database_query result" evidence the spec requires for this finding.

- [ ] **Step 4: Diff CLAUDE.md's Fleet.io claims against what Steps 1-3 actually found**

Read CLAUDE.md's "Fleet.io (commercial fleet management SaaS)" section top to bottom. For each concrete claim (e.g. "bidirectional real-time + webhooks land in PR 4", the pagination-contract writeup, the link-resource canonicalization migration `0206`), mark it `✅ confirmed` (cite the file:line or query result that confirms it), `❌ stale/wrong` (cite what it actually says now), or `❓ unverifiable from this audit's scope`.

- [ ] **Step 5: Read the Fleet Manager UI surface for the same treatment**

List every page under `client/src/pages/fleet/` and every route in `src/routes/fleet.ts`. For each, note in one line whether it reads/writes fields that Task 1-5's cross-checks flagged as mismatched, and whether it surfaces sync status (link to the existing `/admin/fleetio-health` dashboard this session started from) or `fleetio_conflicts` rows anywhere in its UI.

- [ ] **Step 6: Write the report**

Create `docs/superpowers/specs/2026-07-29-fleetio-fleet-manager-gap-audit.md` with this structure:

```markdown
# Fleet.io / Fleet Manager Gap Audit

**Date:** 2026-07-29
**Companion to:** docs/fleetio-api-reference.md

## Schema-mismatch bugs

| Finding | File:line | Severity | Evidence |
|---|---|---|---|
| ... one row per Step 1 finding ... |

## Missing dispatch coverage

| Emit kind | Dispatch branch exists? | Severity | Evidence |
|---|---|---|---|
| ... one row per Step 2 finding ... |

## Bidirectional sync status ("is PR 4 done?")

[Narrative answer, backed by the Step 3 query result and Step 2 findings —
complete / partial / aspirational, with specifics.]

## Stale or wrong documentation

| CLAUDE.md / spec claim | Actual state | Evidence |
|---|---|---|
| ... one row per ❌ finding from Step 4 ... |

## Fleet Manager UI gaps

[Step 5's findings, one paragraph or table row per page.]

## Recommended fix ordering

[Your ranked opinion, clearly labeled as a recommendation the user decides
on — do not imply any of this is already approved or scheduled.]
```

Fill in every section with the real findings from Steps 1-5 — no placeholders left in the committed file.

- [ ] **Step 7: Run the safety check, commit, push, and open the PR**

```bash
npx vitest run
git add docs/superpowers/specs/2026-07-29-fleetio-fleet-manager-gap-audit.md
git commit -m "docs(fleetio): gap audit report — schema mismatches, dispatch coverage, PR 4 status"
git push -u origin <branch-name>
gh pr create -R rmpgutah/rmpg-flex --title "docs(fleetio): Fleet Manager / Fleet.io gap audit report" --body "Deliverable 2 of docs/superpowers/specs/2026-07-29-fleetio-api-reference-and-gap-audit-design.md. Report only — no fixes applied. User reviews and prioritizes before any follow-up fix PRs are opened."
```

---

## Self-review notes

- **Spec coverage:** Deliverable 1 (5 resources + shared contract) → Tasks 1-6. Deliverable 2 (three-way diff + bidirectional sync status) → Task 7, Steps 1-5. The spec's "report first, then fix" constraint → explicitly no fix steps anywhere in this plan, and Task 7's report is the terminal deliverable.
- **No placeholders:** every task step names the exact URL pattern to fetch, the exact function/file to cross-check against, and the exact D1 query to run — no "add validation" or "similar to Task N" steps.
- **Type/name consistency:** function names (`mapVehicleFieldsToFleetio`, `mapVendorFieldsToFleetio`, `mapPartFieldsToFleetio`, `mapFuelEntryFieldsToFleetio`, `dispatchOutbound`, `EMIT_KIND_TO_RESOURCE`, `translateOutboundFks`) are used consistently across tasks and match their actual names in `src/utils/fleetio/seed.ts`, `sync.ts`, and `events.ts` as read during this session.
