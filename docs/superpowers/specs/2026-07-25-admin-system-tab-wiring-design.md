# Admin → System Config: path every function and link it to real results

**Date:** 2026-07-25
**Surface:** `https://rmpgutah.us/admin?tab=system` → [`client/src/pages/admin/AdminSystemTab.tsx`](../../../client/src/pages/admin/AdminSystemTab.tsx) (2849 lines, 13 sections)
**Status:** Phase 0 approved for immediate implementation; Phases 1–3 specified, each needs its own plan.

---

## 1. Problem

The System Config tab presents 13 sections of editable configuration. Most of it saves
successfully to D1 and then affects nothing — and in two cases does not even survive a
page reload. An administrator has no way to tell the difference between a setting that
changed system behavior and one that wrote a row nobody reads.

This is not a new bug class in this repo. `src/routes/settings.ts:18` records the same
problem being fixed for a *different* tab: *"Before this, Console Settings wrote 458 rows
that nothing read."* That fix built a real rail — the typed `system_settings` table
(migration `0049_admin_settings.sql`) → `GET /api/settings` → the getters in
[`client/src/utils/systemSettings.ts`](../../../client/src/utils/systemSettings.ts).
**AdminSystemTab was left behind on the older `system_config` key/value bag.** The core of
this work is moving it onto the rail that already exists, not inventing a new one.

### 1.1 Confirmed defects

Each item below was verified against source, not inferred.

| # | Severity | Defect |
|---|----------|--------|
| 1 | **High** | **System Settings never reads back what it saves.** `PUT /admin/system-settings` ([`src/routes/admin.ts:2006`](../../../src/routes/admin.ts)) INSERTs only `config_key, config_value, updated_at`. `system_config.category` is `NOT NULL DEFAULT 'general'` (`migrations/0001_initial_schema.sql:381`), so every row files under `general`. The tab reloads from `grouped.system_settings` (`AdminSystemTab.tsx:543`), which is therefore empty, and all 60 fields silently revert to `DEFAULT_SYSTEM_SETTINGS`. `src/routes/audit.ts:312` confirms the intended convention is `category='system_settings'`. |
| 2 | **High** | **Custom dispositions never reach the dropdowns.** The tab writes `config_key: 'disposition_code'` (`AdminSystemTab.tsx:733`). The flat `GET /admin/config` builds its disposition list only from keys prefixed `disposition.` (`src/routes/admin.ts:75`); a `disposition_code` row falls through to the scalar branch. `DispatchPage.tsx:984` and `IncidentsPage.tsx:497` — the only consumers — therefore never see an admin-created code. |
| 3 | **High** | **Criminal Codes fires an unbounded request loop.** `expandedSections` is a fresh object literal on every render (`AdminSystemTab.tsx:370`) and appears in an effect dependency array (`:634`). While that section is active: render → `fetchStatutes` → `setLoadingStatutes` → render → fetch, without settling. The search input is also undebounced. |
| 4 | **Medium** | **Six sections have zero consumers anywhere in `src/` or `client/src/`:** Priority Levels (`priority_levels`), Call Sources (`call_source_list`), Unit Types (`unit_type_list`), Zones & Beats (`zone_beat_list`), Evidence Types (`evidence_type_list`), Security Policy (`security_settings`). Only Branding is wired (`client/src/utils/pdfGenerator.ts:157`). Separately, 59 of the 60 System Settings keys are read by nothing. |
| 5 | **Low** | Duplicate `admin.get('/config-history')` at `src/routes/admin.ts:773` and `:2108`. Hono matches first-registered, so the second handler is dead code. |
| 6 | **Low** | Statute rows expose copy-only context actions despite `/law-book?statute_id=<id>` being a supported deep link (`client/src/pages/LawBookPage.tsx:287`). |

### 1.2 Sections already wired end-to-end

Incident Types, Branding, Quick Templates (`DispatchPage.tsx:980` consumes
`/admin/call-templates`), and Dispatch Units (real `/dispatch/units` CRUD). These are the
model the rest should match; no changes proposed.

---

## 2. Architecture: one store, two readers

**Store.** `system_settings` (migration 0049) owns all 60 System Settings keys. It is typed
(`type`, `default_value`, `min_value`/`max_value`, `options`), labeled, role-gated
(`required_role`), and UI-ordered — everything the untyped `system_config` bag lacks.
`system_config` retains what it legitimately owns: incident types, dispositions,
integrations, and map settings.

**Client reader.** The existing [`client/src/utils/systemSettings.ts`](../../../client/src/utils/systemSettings.ts)
getters — `getSystemSetting` / `getBoolSetting` / `getNumSetting` / `useSystemSetting`.
Already populated once per session from `GET /api/settings` and already reaching every
authenticated client. No new client plumbing is required.

**Worker reader (new).** `src/utils/systemSettings.ts` — a KV-cached `getSettings(env)`
plus typed getters mirroring the client API. This is the one genuinely missing piece;
`src/utils/scheduleEngine.ts:299` issues ad-hoc `SELECT`s today because nothing shared
exists. One D1 read per cache window, invalidated on write.

**Write path.** `PUT /api/admin/settings` (bulk) and `PUT /api/admin/settings/:key`
already exist in [`src/routes/adminSettings.ts`](../../../src/routes/adminSettings.ts),
mounted at `src/routesConfig.ts:369`. The tab repoints at these; no new endpoints.

### 2.1 Resolved overlap

`map_default_zoom`, `map_center_lat`, and `map_center_lng` are **removed from the System
Settings panel entirely**. Admin → Map Settings (`/admin/map-config`, already functional)
remains the single source of truth for map defaults. Migrating them would create two
stores disagreeing about one value.

---

## 3. Phases

Each phase is independently shippable and gets its own implementation plan. Phase 0 does
not depend on Phases 1–3 and is approved for immediate implementation.

### Phase 0 — Defects and honesty (approved, build now)

Scope is deliberately narrow: make today's behavior correct and legible, change no
operational defaults.

1. **Close the settings round-trip.** Add `category` (and explicit `is_active`) to the
   INSERT in `PUT /admin/system-settings`, writing `'system_settings'` to match the
   `src/routes/audit.ts:312` convention. Saved values then reload correctly. This is a
   two-line fix that stops the silent data loss immediately, and it stays correct after
   Phase 1 repoints the tab elsewhere.
2. **Reconcile the disposition namespace.** Teach flat `GET /admin/config` to recognize
   `category='dispositions'` rows in addition to `disposition.`-prefixed keys, merging both
   into the same output array. Backward-compatible and server-only: DispatchPage and
   IncidentsPage pick up admin-created dispositions with no client change and no
   double-counting (dedupe by `code`, existing custom rows continue to override defaults).
3. **Stabilize the statute effect.** Depend on `activeSection === 'criminal_codes'` rather
   than the recreated `expandedSections` object, and debounce `statuteSearch` (300 ms).
   Removes the request loop and makes search usable.
4. **Delete the dead duplicate** `admin.get('/config-history')` at `src/routes/admin.ts:2108`,
   keeping the first-registered handler at `:773`.
5. **Link statutes to the Law Book.** Add a "View in Law Book" context action and a
   clickable citation opening `/law-book?statute_id=<id>`.
6. **Label the unenforced sections.** A small shared inline notice component on each
   section whose values no consumer reads yet (the six from defect #4, plus the System
   Settings groups until their Phase 2 PR lands), stating plainly that the value is stored
   but not yet enforced. Each Phase 2/3 PR removes the notice for what it wires.

**Explicitly out of scope for Phase 0:** a Dispatch Units deep link. No `unit`/`unit_id`
URL parameter exists on DispatchPage or MapPage, so the link would require adding
parameter handling inside a ~6k-line megafile. Deferred rather than silently expanded.

**Verification.** Worker `npm run typecheck`; `cd client && npx tsc --noEmit && npx vitest run`;
manual browser check of each of the 13 sections; confirm the statute panel issues one
request per interaction (Network panel) instead of a continuous stream; confirm a saved
System Settings value survives reload; confirm a new disposition appears in the DispatchPage
disposition dropdown.

### Phase 1 — Registry migration

- New migration seeding the ~60 keys (minus the 3 map keys) into `system_settings` with
  `category`, `key`, `default_value`, `type`, `label`, `description`, `ui_order`, and
  `required_role`. Idempotent (`INSERT OR IGNORE`), per `migrations/README.md`.
- Backfill any values already present in `system_config` under `category='system_settings'`
  (including rows repaired by Phase 0) so no administrator edit is lost.
- Repoint the tab's System Settings panel from `/admin/system-settings` to
  `/api/admin/settings` (`GET /values` to read, `PUT /` to bulk-write).
- Add the Worker-side `src/utils/systemSettings.ts` reader.
- Apply directly to live D1 `785de7ae` after merge and verify with `pragma_table_info` —
  the deploy migration step is `continue-on-error`.

**Exit criterion:** every one of the ~57 keys is readable from both the Worker and the SPA
through a shared getter, and survives a reload. Enforcement is not yet expected.

### Phase 2 — Enforcement, grouped by subsystem

One PR per group, each with its own spec, each removing the Phase 0 notice for what it
wires: feature toggles (nav/route gating) · records case-numbering and retention · dispatch
rules (`dispatch_auto_clear_hours`, `dispatch_require_disposition`,
`dispatch_alert_stale_calls_minutes`, `dispatch_max_calls_per_unit`) · notification
thresholds · evidence and legal · officer and personnel · reporting and PDF.

**Binding constraint.** Several of these change behavior officers depend on in the field —
`dispatch_require_disposition` and `officer_require_body_cam` in particular. Every seeded
`default_value` must reproduce **today's effective behavior**, not the value currently
sitting in `DEFAULT_SYSTEM_SETTINGS` in the client. Where those disagree, today's behavior
wins and the divergence is called out in the PR body.

### Phase 3 — The six orphan JSON sections

Wire Priority Levels, Call Sources, Unit Types, Zones & Beats, Evidence Types and Security
Policy to their consumers. **Security Policy is the highest-value item** and should be
sequenced first: it ought to drive real password validation and connect to the existing
account-lockout implementation from PR #2840. Zones & Beats needs a reconciliation
decision against the existing geography/geofence tables before implementation — it is the
most likely of the six to already have a competing source of truth.

---

## 4. Risks

- **Defect #2's merge could double-list dispositions** if a code exists under both
  namespaces. Mitigated by deduping on `code` with the existing custom-overrides-default
  precedence.
- **Phase 1's backfill runs against a table with known dirty schema.** Query live
  `sqlite_master` / `pragma_table_info` before writing the migration rather than trusting
  the migration files (`migrations/README.md`; prior drift sweep 2026-06-22).
- **Phase 2 is behavior-changing by definition.** The default-value constraint above is
  the primary control; each PR should also be reviewable in isolation so a single group can
  be reverted without unwinding the registry.
- **Phase 0 item 1 is superseded but not wasted.** Phase 1 repoints the tab off
  `/admin/system-settings`, but that endpoint has other potential callers and the fix keeps
  it honest either way.
