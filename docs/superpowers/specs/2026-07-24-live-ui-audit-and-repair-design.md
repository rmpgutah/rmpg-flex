# Live UI Audit and Repair — Core Operational Pages

**Date:** 2026-07-24
**Status:** Approved (design), audit pending
**Scope owner:** Christopher Zamora

## Problem

The live app at https://rmpgutah.us has accumulated UI bugs, dead controls, and
degraded PDF/visual output across its daily-use surfaces. No evidence-backed
inventory of those defects exists, so fix work has been reactive and anecdotal.

This spec covers **phase 1 (audit)** and the **shape of the fix waves** that
follow operator triage. It does not enumerate the fixes themselves — those
cannot be known until the audit runs.

## Constraints

1. **Cloudflare managed challenge.** Every path except `/api/health` on both
   `rmpgutah.us` and `api.rmpgutah.us` is behind a managed challenge. `curl`
   returns HTTP 403 ("Just a moment…") regardless of app health. The audit must
   run in a real browser with JS + cookies — the Browser pane, not a shell
   script.
2. **Two independently-deployed halves.** The React SPA (Cloudflare Pages) and
   the Hono Worker (`api.rmpgutah.us`) ship separately. A blank panel may be a
   client render crash *or* a Worker 5xx. Every finding records both the console
   evidence and the network evidence so the responsible layer is unambiguous.
3. **Account lockout.** 5 failed logins in 15 minutes locks the account
   (`users.failed_login_count` / `users.locked_until`). Login gets at most two
   attempts, then stop and ask the operator. No DB-level password reset without
   explicit approval.
4. **D1 100-column cap.** No `ALTER TABLE … ADD COLUMN` against
   `calls_for_service` (100 cols) or `persons` (94 cols). Overflow goes to the
   `_ext` tables.
5. **Protected `main`.** PR flow only; full local gate (worker tsc + client tsc
   + client vitest) before every push.

## Phase 1 — Audit

### Target surfaces

Six core operational pages, in order:

1. Dispatch
2. Map
3. Records / Persons
4. Warrants
5. A Call-for-Service detail view
6. MDT / mobile

### Per-page probe set

A fixed five-probe pass, applied identically to every page so findings are
comparable rather than anecdotal:

| Probe | Tool | Detects |
|---|---|---|
| Load | `read_page` | blank panels, missing sections, dead nav entries |
| Console | `read_console_messages` | React crashes, undefined property access, thrown exceptions |
| Network | `read_network_requests` | 4xx/5xx responses, empty `{}` payloads (the missing-`await` D1 signature) |
| Interact | `computer` / `form_input` | dead buttons, non-submitting forms, broken modals |
| Visual | `screenshot`, `resize_window` | overflow, contrast failures, surfaces that did not re-theme |

### PDF and visual coverage

On each audited page, trigger its real export and inspect the produced file:

- missing or blank fields
- wrong or offset timestamps (America/Denver; storage is UTC)
- table overflow past the page margin
- page breaks splitting a record mid-row
- font and agency-branding consistency

Charts and stat cards are checked for empty-versus-stale data and for
legibility under the Blue & Silver dark palette. Hardcoded hex encountered on an
audited page is logged for migration to the theme tokens.

## Findings artifact

A ranked report. Each finding carries:

- page and control
- symptom, stated observably
- **evidence**: console line, request URL + status, and/or screenshot
- suspected source file
- layer: client / Worker / D1
- severity

### Severity ladder

| Severity | Meaning |
|---|---|
| `blocks-work` | An officer or dispatcher cannot complete a task |
| `wrong-data` | The UI displays incorrect information without failing visibly |
| `degraded` | Works, but slowly, awkwardly, or with a visible error |
| `cosmetic` | Appearance only; no functional impact |

`wrong-data` deliberately outranks `degraded`. In a CAD/RMS, a report that
silently shows the wrong person is more dangerous than one that visibly fails
to load.

## Phase 2 — Fix waves

After operator triage of the findings list:

- One PR per wave, branched fresh off current `origin/main`.
- Full local gate before each push.
- No merge and no deploy without explicit operator approval.
- Each PR body lists the findings it closes, by ID.

## Out of scope

- CRM, Fleet, Intel, Serve, Invoices, and Admin tab surfaces
- Any schema migration against `calls_for_service` or `persons`
- Refactoring of the client megafiles (`FirecrawlTab.tsx`, `MapPage.tsx`,
  `DispatchPage.tsx`, `WarrantsPage.tsx`) beyond what a specific fix requires

## Success criteria

1. All six target pages audited with the full five-probe pass, evidence captured.
2. Findings report delivered, ranked, every entry carrying reproducible evidence.
3. Operator triage completed and fix waves scoped.
4. Each merged fix wave verified against the live app after deploy.
