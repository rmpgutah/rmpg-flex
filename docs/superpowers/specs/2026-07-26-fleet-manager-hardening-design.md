# Fleet Manager Hardening & Improvement — Design

**Date:** 2026-07-26
**Scope:** `/fleet` (Fleet Management page) — client UI, client state architecture, and the
Worker routes it depends on.
**Status:** Approved for planning.

---

## 1. Problem

`/fleet` is the Fleet Manager surface: a vehicle list, a per-vehicle detail panel with 12
tabs, and 5 fleet-wide views. It works, but a line-level read of
[`client/src/pages/fleet/FleetPage.tsx`](../../../client/src/pages/fleet/FleetPage.tsx)
(1,827 lines) plus [`src/routes/fleet.ts`](../../../src/routes/fleet.ts) found ten confirmed
defects — one of which shows operators the wrong data under a correct-looking label — and a
structural shape that makes each of them expensive to fix.

### 1.1 Structural diagnosis

The page is a **container with dumb children**: roughly 40 `useState` hooks and every fetch
live in `FleetPage`, and `FleetDetailPanel` receives **48 props**. Adding one feature touches
the page, the panel's prop list, and the tab component. This is why the defects below have
accumulated rather than being fixed in passing.

A second structural issue causes several of the individual bugs: the page has **two top-level
mode mechanisms with different implementations**.

| Mechanism | Drives | Implementation | Persisted | a11y |
|---|---|---|---|---|
| `activeTab` | 12 per-vehicle tabs | `usePersistedTab` | Yes (but defeated — §2.4) | Via `FleetDetailPanel` |
| `viewMode` | 5 fleet-wide views | plain `useState` | No | None (§2.9) |

Unifying these removes the asymmetry that produced findings 2, 4, and 9.

### 1.2 Confirmed defects

Every item is line-verified. None are speculative.

| # | Finding | Location |
|---|---|---|
| 1 | **Per-vehicle Analytics tab renders fleet-wide data.** `fetchVehicleAnalytics` calls `/fleet/analytics` with no vehicle identifier, and the route accepts only `?period=`. Numbers are labeled per-vehicle but are fleet aggregates. | `FleetPage.tsx:384`, `src/routes/fleet.ts:194` |
| 2 | **Banned gold `#d4a017` hardcoded 10×** on the 5 fleet-wide tab buttons, plus `#888` for the inactive state. CLAUDE.md bans `#d4a017` in the blue-silver block: it fails WCAG AA (4.50 / 3.57 / 5.41) *and* has a 1.11 luminance ratio to `--sev-warn`, making decorative gold confusable with a real overdue alert. | `FleetPage.tsx:1479–1524` |
| 3 | **Ten DOM elements share `id="ff-fleetpage-2"`** — the pre-trip checkbox `id` is a literal inside a `.map()`. Duplicate ids break label association and any id-based test selector. | `FleetPage.tsx:1771` |
| 4 | **Tab persistence is defeated.** The `selectedId` reset effect calls `setActiveTab('overview')` and also runs on mount, so `usePersistedTab('rmpg_fleet_tab', …)` restores a value that is immediately clobbered. The persistence is dead code today. | `FleetPage.tsx:318` |
| 5 | **Full page reload inside the SPA.** "Daily Reports" sets `window.location.href = '/fleet/reports'`, discarding all React state and re-downloading the bundle. | `FleetPage.tsx:1204` |
| 6 | **Silent list truncation.** The client requests `/fleet?archived=…` with no `per_page`; the Worker defaults to 200 (`src/routes/fleet.ts:126`). The client reads `resp.data` and ignores `resp.pagination`, so a fleet past 200 vehicles silently loses rows with no indication. | `FleetPage.tsx:289` |
| 7 | **`Cost/Mi` button fails silently.** `loadCostPerMile` catches to `setCostPerMile(null)` with no toast and no loading state, so a failed click is indistinguishable from a broken button. | `FleetPage.tsx:252` |
| 8 | **Hand-rolled pre-trip modal.** No focus trap, no focus restore, and a backdrop `onClick` that discards a filled-in checklist with no confirmation. The other five dialogs on this page use the shared modal. | `FleetPage.tsx:1751` |
| 9 | **Fleet-wide tab strip has no tab semantics.** No `role="tablist"`/`role="tab"`/`aria-selected`, no arrow-key navigation, and `viewMode` is not persisted across reloads. | `FleetPage.tsx:1473` |
| 10 | **Hardcoded thresholds presented as facts.** Utilization bars divide by a literal `150000`; three separate expiry checks hardcode a 30-day window; the service badge hardcodes 14 days. None reflect any configured RMPG policy. | `FleetPage.tsx:1445`, `:443`, `:451`, `:1435` |

### 1.3 Adjacent finding (documented, not fixed here)

`src/routes/settings.ts` returns a `system` map from `system_settings` and its header comment
states a `SystemSettingsProvider` applies it client-side. **No such provider exists** — `grep`
for `SystemSettingsProvider` / `useSystemSettings` across `client/src` returns nothing. Console
Settings therefore still writes rows nothing reads. Phase 3 PR 3 builds the reader as a
by-product of the threshold work; the stale comment is corrected in that PR.

---

## 2. Goals and non-goals

**Goals**

1. Operators never see data labeled as one scope while it reports another.
2. No banned or hardcoded color literals in the page's chrome.
3. Every failure path is visible — no button that does nothing on error.
4. Both mode mechanisms behave identically: persisted, keyboard-navigable, screen-reader-correct.
5. Operational thresholds are configured, not compiled in.
6. `FleetPage.tsx` is small enough to hold in context, so the next change is cheap.

**Non-goals**

- Redesigning the visual layout. This is hardening, not a reskin.
- Touching the 12 per-vehicle tab components beyond what the above requires.
- Migrating the page's severity-color palette (`STATUS_COLOR`, utilization band colors). Those
  are fixed CAD semantics and are correctly literal per CLAUDE.md.
- Fleet.io integration work. Separate program.

---

## 3. Architecture

### 3.1 Phase 1 — Correctness, a11y, theme (PR 1)

Pure fixes. No moved code. New files are tests only.

**Analytics scoping (finding 1) — the "Both" resolution.**

Worker `GET /fleet/analytics` gains an optional `?vehicle_id=`:

- When absent, behavior is byte-identical to today (fleet-wide). This is what preserves the
  existing dashboard.
- When present and numeric, every sub-query gains a scoped predicate. The existing `safe()`
  wrapper is retained so one failing sub-query still degrades to a fallback rather than 500ing.
- Every new sub-query names its columns explicitly. No `SELECT v.*` — `calls_for_service`
  (100 cols) and `persons` (94 cols) sit at the D1 SELECT cap, and a widening join is exactly
  how that cap gets hit.
- Response gains two fields:
  - `scope: 'vehicle' | 'fleet'` — what this payload actually describes.
  - `fleet_comparison` — fleet averages over the same period, present only when
    `scope === 'vehicle'`, so a vehicle can be read against the fleet.

Client passes `selectedId` when fetching for the per-vehicle tab. The tab renders the scope
label from `scope` — not from which component called it — so a mismatch surfaces instead of
being papered over.

**Rollout tolerance.** Cloudflare Pages and the Worker deploy independently and can be briefly
mismatched (both are steps in `deploy.yml` and either can fail alone). The client therefore
treats a missing `scope` field as `'fleet'` and a missing `fleet_comparison` as "hide the
comparison band" — an old Worker with a new client degrades to today's behavior rather than
rendering `undefined`.

**Theme (finding 2).** The 10 literals are replaced by the **silver** ramp classes used by the
equivalent view strip at `client/src/pages/ServePage.tsx:1495`
(`text-brand-gold-500 border-brand-gold-500 bg-brand-gold-500/5` — `brand-gold-*` renders silver
via the deliberate compat alias). Gold is *not* correct here: it has exactly two sanctioned
roles, `--field-label-color` (field labels) and `--panel-header-color` (section/panel headers),
and a tab is neither. No raw `text-accent-gold-*` class is written in the component.

**Duplicate ids (finding 3).** `id={`ff-pretrip-${item.key}`}` with a matching `htmlFor` on the
wrapping `<label>`.

**Tab persistence (finding 4).** A `useRef` mount guard makes the reset effect skip its first
run, so the persisted tab survives a reload. The reset still fires when `selectedId` genuinely
changes — switching vehicles should not inherit the previous vehicle's tab, which is the
behavior the effect was written for.

**SPA navigation (finding 5).** `useNavigate()` from react-router.

**Truncation (finding 6).** The client sends an explicit `per_page`, reads
`pagination.total`, and renders a "showing N of M" line when they differ. Making the
truncation visible is the fix; raising the cap alone would just move the cliff.

**Silent failure (finding 7).** `loadCostPerMile` gains a loading flag (button shows pending)
and an error toast. This follows the project's established rule that an unavailable dependency
must report itself rather than vanish.

**Pre-trip modal (finding 8).** There is **no shared modal component** in this app — `ConfirmDialog`
is confirm-only, and the five fleet form modals each hand-roll the same convention. The pre-trip
modal is brought up to that convention as established by `VehicleFormModal`: `role="dialog"` +
`aria-modal` + `aria-labelledby` via `useId`, a dirty-guarded Escape, a dirty-guarded backdrop
click, and initial focus. The page-level `keydown` listener is rewritten to route through the
guard rather than closing unconditionally.

**Out of scope, stated explicitly:** no modal in this app implements a focus *trap*. Adding one
only to the pre-trip modal would be inconsistent with its five siblings, so it is not done here.
An app-wide focus trap is a separate change.

**Tablist semantics (finding 9).** `role="tablist"` / `role="tab"` / `aria-selected` /
`aria-controls`, arrow-key navigation, and `viewMode` moved to `usePersistedTab` — the same
mechanism `activeTab` uses. This closes the §1.1 asymmetry.

### 3.2 Phase 2 — Decompose (PR 2)

Behavior-preserving extraction. Phase 1's tests are the safety net: they must stay green with
no assertion edits. An assertion that needs changing means behavior moved, which is out of
scope for this PR.

| New hook | Owns |
|---|---|
| `useFleetVehicles` | Vehicle list, status filter, search, archive toggle, live sync |
| `useVehicleDetail` | Detail, maintenance, fuel, inspections, assignments, personnel |
| `useFleetCosts` | Five cost categories, budgets, `recomputeCostSummary` |
| `useFleetForms` | The four `useFormDraft` instances and their save handlers |

`FleetDetailPanel`'s 48 props collapse into grouped objects (`data`, `costs`, `actions`). Each
hook is independently testable and answers the three questions that matter: what it does, how
you use it, what it depends on.

**Target:** `FleetPage.tsx` under 400 lines, containing layout and composition only.

### 3.3 Phase 3 — New functions (PRs 3–6)

Sequenced deliberately. PRs 4 and 5 both modify vehicle-list rendering; running them in
sequence avoids the same-file collision that produced a CI-only failure in the `callStatus`
work.

**PR 3 — Configurable thresholds (finding 10).**

New `system_settings` rows, category `fleet`:

| Key | Replaces | Default |
|---|---|---|
| `fleet_utilization_max_miles` | literal `150000` at `:1445` | `150000` |
| `fleet_expiry_warn_days` | three 30-day checks at `:443`, `:451`, `getExpiryStatus` | `30` |
| `fleet_service_warn_days` | literal `14` at `:1435` | `14` |

Defaults equal today's literals, so PR 3 ships with zero behavior change until an admin edits a
value — the change is auditable in isolation.

New `useSystemSettings()` hook reads the existing `GET /api/settings` `system` map once and
exposes typed, defaulted getters. Editing UI comes free: `system_settings` already carries
`category` and `ui_order`, so the existing Admin → Console Settings tab picks the rows up with
no new tab (per CLAUDE.md, adding an `AdminPage.tsx` tab needs four separate edits and is easy
to half-wire — avoided entirely). The stale `SystemSettingsProvider` comment in
`src/routes/settings.ts` is corrected here.

Migration is additive `INSERT OR IGNORE` seed rows only. No `ALTER TABLE` against any watched
table. Per CLAUDE.md the migration is applied to live D1 `785de7ae` via
`scripts/apply-migration.sh` after merge and verified with `pragma_table_info` — the deploy
step is `continue-on-error` and cannot be trusted alone.

**PR 4 — URL-addressable state + saved filters.**

`useSearchParams` (the established pattern in 20+ pages) carries status filter, search query,
active tab, view mode, and selected vehicle, making any view bookmarkable and shareable.
Precedence on load: URL param > persisted value > default, so an explicit link always wins
over a stale local preference.

Saved named filters persist per-user through the existing user-settings blob
(`PUT /api/settings/user`) — no new table.

**PR 5 — Bulk actions.**

Multi-select on the vehicle list following the `WarrantsListTab` precedent (that page is also
CLAUDE.md's approved exception for looser rows, so its pattern is the right one to copy for a
selectable list). Actions: bulk status change, bulk archive, export-selected.

Every bulk mutation confirms with an explicit affected count before firing. Bulk archive is
reversible via the existing unarchive route; there is no bulk delete — permanent multi-record
deletion is not a one-click affordance.

**PR 6 — Fleet readiness board.**

A fleet-wide panel answering "what is road-ready right now," and for everything that is not,
why: overdue service, failed most-recent inspection, expired registration, expired insurance,
or an explicit out-of-service status. Ranked by severity. Reads PR 3's thresholds rather than
introducing new literals. Composes existing data — no new Worker route.

---

## 4. Data flow

```
GET /api/fleet?archived=&per_page=      → useFleetVehicles  → list + "showing N of M"
GET /api/fleet/:id                      → useVehicleDetail  → FleetDetailPanel
GET /api/fleet/analytics                → fleet-wide dashboard   (scope: 'fleet')
GET /api/fleet/analytics?vehicle_id=:id → per-vehicle tab        (scope: 'vehicle'
                                                                  + fleet_comparison)
GET /api/settings  → system map         → useSystemSettings → thresholds (PR 3)
URL search params                       → filters / tab / selection      (PR 4)
```

---

## 5. Error handling

The governing rule: **a failure must be visible at the point of use.**

| Failure | Behavior |
|---|---|
| Vehicle list fetch fails | Error toast; list keeps last-known rows rather than blanking |
| `?vehicle_id=` sub-query fails | Existing `safe()` fallback; that chart renders empty, siblings unaffected |
| Analytics returns no `scope` (old Worker) | Treated as `'fleet'`; comparison band hidden |
| `cost-per-mile` fails | Error toast + button leaves pending state (finding 7) |
| `GET /api/settings` fails | `useSystemSettings` returns compiled defaults — identical to today's literals |
| Bulk action partially fails | Per-vehicle result reported; successes are not rolled back, failures are named |

---

## 6. Testing

**Per PR, all six gates:** worker typecheck, worker vitest, Miniflare integration, client
typecheck, **full** client vitest, and `vite build`. Targeted client runs are not sufficient —
a red test hid behind green targeted runs for four consecutive tasks in the 2026-07-24 sweep.
The measured baseline is clean on all gates, so any failure is caused by the change in hand and
is a hard stop.

`npx tsx scripts/audit-hex.mjs` must show the in-scope literal count **decrease** for PR 1.

**New tests**

| Area | Assertion |
|---|---|
| Analytics scoping | `?vehicle_id=` returns only that vehicle's rows; absent param is unchanged from today; `scope` is correct in both cases |
| Analytics rollout | A payload with no `scope` renders as fleet-wide with no comparison band |
| Tab persistence | A persisted tab survives remount; switching vehicles still resets to overview |
| Pre-trip ids | The ten checkboxes have ten distinct ids, each label-associated |
| Truncation | `total > data.length` renders the "showing N of M" line |
| `cost-per-mile` failure | A rejected fetch produces a toast and clears the pending state |
| Thresholds | A configured value changes the utilization/expiry output; a failed settings fetch yields today's values |
| Bulk actions | Confirmation reports the exact affected count; a partial failure names the failures |

For the failure-path tests, the fix is broken deliberately once to confirm the test goes red —
a test that passes against both the bug and the fix asserts nothing.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Analytics response shape changes | Additive fields only; client tolerates their absence (§3.1) |
| Phase 2 refactor regresses behavior silently | Phase 1 tests must pass with no assertion edits; an edit means behavior moved |
| PRs 4 and 5 collide in vehicle-list rendering | Strict sequencing, 4 before 5 |
| Migration never reaches live D1 | `scripts/apply-migration.sh` + `pragma_table_info` verify after merge |
| Squash-merge drops a wiring line | Grep for the registration/wiring line on `origin/main` after each merge — this has happened 3× in this repo |

---

## 8. Deliverables

| PR | Content | Depends on |
|---|---|---|
| 1 | Findings 1–9: correctness, a11y, theme | — |
| 2 | Hook extraction; `FleetPage.tsx` under 400 lines | PR 1 |
| 3 | Configurable thresholds (finding 10) + `useSystemSettings` | PR 2 |
| 4 | URL-addressable state + saved filters | PR 3 |
| 5 | Bulk actions on the vehicle list | PR 4 |
| 6 | Fleet readiness board | PR 3 |
