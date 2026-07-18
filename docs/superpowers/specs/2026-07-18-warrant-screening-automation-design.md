# Warrant Screening Automation — Design

**Date:** 2026-07-18
**Status:** Approved for planning

## Purpose

Warrants currently only surface NSOPW (sex-offender registry) hits via `WarrantNsopwStatus`, and
only on manual re-screen. The other 6 screening sources in the registry
(`src/utils/screening/registry.ts`: Interpol red/yellow/UN notices, OFAC sanctions, Utah SOR, UDC)
never touch a warrant's subject unless that person happens to already be on a
`screening_watchlist`/`intel_watchlist` entry and the periodic cadence scan picks them up. There is
no "screen this person against everything, right now" capability and no unified view.

This feature adds:
1. Automatic screening of a warrant's subject against all 7 sources on warrant create/update.
2. A unified multi-source status panel on both warrant detail surfaces.
3. A link from that panel into the existing ad-hoc `ScreeningPage` search for follow-up queries.

## Current-state findings (grounding this design)

- `runScreeningScans` (`src/utils/screening/runScreeningScans.ts`) only scans persons already on
  `screening_watchlist`/`intel_watchlist`, gated by a per-source cadence (`next_run_at`). It has no
  single-person, run-now entry point.
- NSOPW's `screenPersonForSor` (`src/utils/nsopw/index.ts`) is a separate, bespoke, NSOPW-only
  function, already triggered on `person_create`, `dl_scan_create`, and `cfs_subject_add`
  (`src/routes/records.ts`, `src/routes/dispatch/callLinks.ts`) — but never on warrant create.
- `warrants.ts`'s `POST /` and `PUT /:id` handlers do not call any screening function today.
- Two separate UI surfaces render a warrant's detail (a pre-existing split, not introduced by this
  feature): the Utah-scraped-warrant modal in `WarrantsPage.tsx`, and the primary detail panel in
  `WarrantsListTab.tsx`. Both need the new panel — the prior `LegalDataHunterValidateButton` PR
  (#2825) hit this same split and had to be fixed as a follow-up; this design wires both from the
  start.
- `ScreeningPage.tsx` already supports ad-hoc searches (`GET /api/screening/search`) and has a
  deep-link mechanism (`?screen_id=`, `?person_id=`) — but the existing `person_id` handling sets
  the `name` field to the raw numeric ID (`setName(personId)`), which is a pre-existing bug. This
  design does not touch that path; it adds a new, separate `surname` param instead.

## Non-goals

- Not fixing the pre-existing `person_id` deep-link bug in `ScreeningPage.tsx`.
- Not changing `WarrantNsopwStatus.tsx` itself — it's still used on non-warrant surfaces (e.g.
  person profile pages) and is left as-is. The new component is additive.
- Not adding new screening sources or changing adapter scoring/matching logic.
- Not changing the batch cadence system's watchlist semantics — the on-demand path is independent
  of it, per the approach chosen during brainstorming (option 2: new function, not watchlist
  extension).

## Architecture

### 1. Shared per-person scan helper

`src/utils/screening/runScreeningScans.ts`: extract the per-person body of `runOne()`'s loop
(fetch candidates for one person, score, upsert `screening_hits`) into a standalone exported
function:

```ts
export async function scanPersonAgainstAdapter(
  env: Bindings,
  adapter: ScreeningAdapter,
  person: PersonRow,
  opts: { threshold: number },
): Promise<{ checked: 1; newHits: number; errors: number }>
```

`runOne()` calls this once per person in its watch-population slice instead of inlining the logic
— no behavior change to the batch path, just a refactor to make the logic reusable.

### 2. On-demand all-sources screen

New file `src/utils/screening/screenPerson.ts`:

```ts
export interface ScreenPersonOpts { triggeredBy?: string }
export async function screenPersonAllSources(
  env: Bindings,
  personId: number,
  opts?: ScreenPersonOpts,
): Promise<{ sourcesRun: number; newHits: number; errors: number }>
```

Loads the person row, iterates `getAdapters()`, skips adapters where `supportsWatch` is false or
the source is disabled/circuit-broken (same checks `runOne` already does), calls
`scanPersonAgainstAdapter` for each remaining adapter against just this one person — independent
of `next_run_at`/cadence, always runs when called. Errors from one adapter don't stop the others
(same per-adapter try/catch pattern as the existing batch loop).

### 3. Warrant create/update trigger

`src/routes/warrants.ts`:

- `POST /`: after the `INSERT` succeeds, if `body.subject_person_id` is set:
  ```ts
  c.executionCtx.waitUntil(
    screenPersonAllSources(c.env, Number(body.subject_person_id), { triggeredBy: 'warrant_create' })
      .catch((err) => console.error('[warrants] screening trigger failed:', err))
  );
  ```
- `PUT /:id`: same trigger, but only when the update payload includes `subject_person_id` AND its
  value differs from the warrant's current `subject_person_id` (fetch-before-update comparison,
  the handler already loads the existing row for its partial-update logic). Prevents re-screening
  on every unrelated field edit (status change, bail amount, notes).
- Fire-and-forget in both cases — a screening failure never fails the warrant write, matching the
  existing NSOPW trigger pattern's error handling.

### 4. New screen-person route

`src/routes/screening.ts` gets a new endpoint, mirroring NSOPW's existing
`POST /api/nsopw/screen-person/:id`:

```
POST /api/screening/screen-person/:id   (requireRole ...SCAN_ROLES)
```

Thin wrapper: `await screenPersonAllSources(c.env, id, { triggeredBy: 'manual:' + user.id })`,
returns `{ success: true, sourcesRun, newHits }`. This is what the panel's "Screen Now" button
calls — synchronous (not fire-and-forget) since it's a manual, user-initiated action where the
user expects to see the result.

### 5. Unified panel component

New `client/src/components/WarrantScreeningStatus.tsx`:

- Props: `{ personId: number; subjectSurname?: string }`.
- Fetches `GET /api/screening/hits?person_id=<personId>` (existing endpoint, already supports this
  filter) — groups the returned hits by `source_key`.
- Renders one compact row per registered source (from `GET /api/screening/sources`): source label,
  status (clear / N active hits / never screened — inferred from absence of any `screening_hits`
  row for that source+person), matching the visual density of the existing warrant detail panels
  (CLAUDE.md's dense-table convention).
- "Screen Now" button calls `POST /api/screening/screen-person/:id`, shows a loading state, then
  re-fetches hits.
- "Search other sources" link/icon navigates to `/screening?surname=<subjectSurname>` (only shown
  when `subjectSurname` is provided).

Wired into **both** detail surfaces:
- `WarrantsPage.tsx`'s Utah-scraped-warrant modal, replacing the existing `WarrantNsopwStatus`
  usage there.
- `WarrantsListTab.tsx`'s primary detail panel, replacing the existing `WarrantNsopwStatus` usage
  there.

`WarrantNsopwStatus.tsx` itself is untouched — still used on non-warrant surfaces.

### 6. ScreeningPage surname deep-link

`client/src/pages/ScreeningPage.tsx`: additive change to the existing deep-link `useEffect` —
alongside the existing `screen_id`/`person_id` handling, read a new `surname` param and (if
present) set the `name` field to it, then strip the param the same way the existing params are
stripped. Does not modify the existing `person_id` branch's behavior.

## Testing

- `tests/scanPersonAgainstAdapter.test.ts` (or extend the existing screening test file if one
  covers `runScreeningScans`) — unit tests with a mocked adapter, verifying scoring/upsert
  behavior matches what `runOne` did before the extraction (regression-safe refactor).
- `tests/screenPersonAllSources.test.ts` — unit tests with multiple mocked adapters: confirms it
  runs regardless of cadence, skips disabled/circuit-broken sources, isolates per-adapter errors.
- `test-workers/screeningScreenPerson.test.ts` — Miniflare smoke test for the new
  `POST /api/screening/screen-person/:id` route (auth/role gate, happy path).
- Manual verification: create a warrant with a subject, confirm background screening fires
  (check `screening_hits`/`screening_scan_runs` for new rows), open both warrant detail surfaces
  and confirm the panel renders identically.

## Migration

None — reuses `screening_hits`, `screening_source_state`, `screening_scan_runs` as-is.
