# iOS App Upgrade & Reorganization — Design Spec

**Date:** 2026-06-15
**Target:** `ios/RMPGFlexTester` (native SwiftUI iPhone field app)
**Author:** brainstormed with operator (Christopher Zamora)

## Summary

Turn the iOS app from a developer-flavored "tester console + field app" hybrid
into a clean, standard-feeling police field app — then layer dynamic, live
behavior on top. Delivered as **four independently-shippable phases**, one PR
each, in order 1 → 2 → 3 → 4.

The app currently has **7 bottom tabs** (iOS silently collapses tabs 5–7 into the
unthemeable stock "More" list) and a `System` hub that mixes officer-facing
surfaces with raw developer tools (a live SQL console, a Cloudflare resource
browser, HTTP smoke-test probes, a raw data viewer). Those dev tools are exactly
the "stuff that would not generally be present in a standard app of its type."

## Goals

1. **Neaten & organize** — ≤5 tabs, a sectioned "More" hub, slimmed Settings,
   a real product display name.
2. **Remove dev/test artifacts** — delete the SQL console, data viewer, cloud
   status, and smoke-test screens entirely, plus their now-dead support code.
3. **Add dynamic function** — live badges, a state-aware Home, pull-to-refresh
   everywhere, contextual quick actions.
4. **Advanced roster** — self clock in/out, live "who's on what", my-timecard,
   and **automatic start-of-shift vehicle inspection** (photos + notes) when an
   officer is assigned a fleet vehicle, integrated with the desktop fleet system.
5. **Advanced field tools** — context-aware prefill, customizable favorites,
   Home quick-launch, and a few new on-device calculators.

## Non-Goals

- **No theme/color change.** The pure-black Spillman iOS theme (`Theme.swift`)
  stays. (This is the iOS app's own theme, independent of the web client's
  steel-blue day/night system.)
- **No bundle-id or Xcode target rename** — only the user-visible display name
  changes (signing/provisioning untouched).
- **No rewrites** of working field screens beyond the targeted enhancements
  listed here.
- **No new web features** beyond what Phase 3's inspection-photo rendering needs.

## Key Architectural Facts (grounded 2026-06-15)

- **Xcode project uses file-system-synchronized groups**
  (`PBXFileSystemSynchronizedRootGroup`). Deleting a `.swift` file from disk
  removes it from the build — **no `project.pbxproj` file-reference surgery**.
  Corollary: deletions must be *complete* (file + every referencing symbol) or
  the build fails.
- **Display name** is currently `$(TARGET_NAME)` via `GENERATE_INFOPLIST_FILE`.
  Rename = add `INFOPLIST_KEY_CFBundleDisplayName = "RMPG Flex Field"` to both
  Debug/Release configs of the app target in `project.pbxproj` (a build-setting
  edit, safe — not a file-ref edit).
- **`RMPGAPIClient.isWAFChallenge` is production code** (kept). Its test
  `WAFDetectionTests` **stays**; only `D1ClientTests`, `CloudflareClientTests`,
  `SQLSafetyTests` are deleted.
- **`AppConfig.apiClient()`** is the shared API-client factory used everywhere;
  **`AppConfig.d1Client()`** is used only by the deleted dev tools + Settings.
- **Start-of-shift vehicle report already half-exists**: `ShiftStartSheet`
  (`ShiftVehicleSheets.swift`) already POSTs `api/dispatch/duty/start` then
  `api/fleet/:id/inspections` + `api/fleet/:id/maintenance`.
- **`fleet_inspections` has no photo column** (only `fleet_damage.photo_urls`
  and the dashcam tables do photos). Photos for inspections need a server
  migration + route change + desktop render.
- **Verification on this Mac**: `xcodebuild` deadlocks. Use
  `ios/run-workflow-tests.sh` (SwiftPM unit harness) + `swiftc -typecheck`
  sweeps; device install via `ios/refresh-device.sh`.

---

## Phase 1 — Cleanup & Reorganization (iOS only)

**PR scope:** structural cleanup, zero behavior change to surviving screens.

### Navigation (`App.swift`)
`MainTabView` becomes exactly **5 tabs**:

| Tab | View | systemImage |
|-----|------|-------------|
| Home | `DashboardView` | `house.fill` |
| Field Ops | `FieldOpsView` | `shield.lefthalf.filled` |
| ID Scan | `IDScanView` | `person.text.rectangle` |
| Toolkit | `FieldToolkitView` | `square.grid.3x3.fill` |
| More | `MoreHubView` (renamed `SystemHubView`) | `ellipsis.circle.fill` |

Roster and Recorder leave the tab bar and move into the hub.

### "More" hub (`MoreHubView`)
Rename `SystemHubView` → `MoreHubView`, title `"MORE"`. Replace the flat list
with **3 labeled sections** (reuse existing `SectionHeader`/`themeCard()`):

- **Patrol** — Duty Roster, Live Alerts, Watchlist, Fleet Readiness
- **Reports & Records** — Daily Activity Report, Recorder
- **Account** — My Officer ID, Settings

Remove the `d1`, `data`, `cloud`, `smoke` entries. Keep the Lock / Sign Out
controls and the version footer.

### Files deleted (dev-only, self-contained)
`D1ConsoleView.swift`, `DataViewerView.swift`, `CloudStatusView.swift`,
`SmokeTestView.swift`, `D1Client.swift`, `CloudflareClient.swift`,
`ResultsTable.swift`, `SQLSafety.swift`, and tests `D1ClientTests.swift`,
`CloudflareClientTests.swift`, `SQLSafetyTests.swift`.

### `AppConfig.swift`
Remove `d1Client()` and the `liveDatabaseId` constant. Keep `apiClient()`.

### `SettingsView.swift`
Delete the **CLOUDFLARE (D1 Console / Data Viewer)** section (Account ID, API
Token, Test D1), the `cfAccountId`/`cfToken`/`cfDatabaseId` state, their
Keychain saves, and `testD1()`. Rename section "RMPG FLEX (SMOKE TESTS)" →
"RMPG FLEX LOGIN". Keep RMPG credentials, Verifier token, and preferences.
(Leave the orphaned `cf*` Keychain keys harmlessly in place — no migration to
delete them; they're simply never read or written again.)

### Polish
- Add `INFOPLIST_KEY_CFBundleDisplayName = "RMPG Flex Field"` to the app
  target's Debug + Release build settings.
- Consistent `.navigationBarTitleDisplayMode(.inline)` titles on hub
  destinations.
- Update `ios/README.md`: drop the "test console" framing and the four removed
  screens; describe the 5-tab shell + sectioned More hub.

### Verification
`ios/run-workflow-tests.sh` green (minus the 3 deleted suites); `swiftc
-typecheck` of the app sources passes with **no dangling references** to any
deleted symbol.

---

## Phase 2 — Dynamic Shell (iOS only)

**PR scope:** live, state-aware UI over the existing real-time plumbing
(`MDTLink` polling, `Connectivity`, `LocationManager`, `AlertsFeed`,
`OfflineSync`).

### Live counts service
A small shared `@MainActor` observable (e.g. `LiveCounts`) that derives:
- active-call count (from the dispatch/MDT poll already running),
- unread alert + watchlist-hit count (from `AlertsFeed`),
- offline-queue depth (from `OfflineQueue`).

It updates on the existing poll tick + on app-foreground. No new polling loop if
an existing one can be observed; otherwise a single coalesced timer.

### Tab badges
- **Field Ops** tab → `.badge(activeCallCount)`.
- **More** tab → `.badge(unreadAlerts + watchlistHits)`.
- More-hub rows show their own per-row count chips (Alerts, Watchlist, Fleet
  not-ready, offline queue).

### Live Home dashboard (`DashboardView`)
State-aware landing:
- **Shift status** card — on/off duty + live shift-elapsed timer (when on duty).
- **Active call** card — current assigned call with a live elapsed timer and a
  one-tap "open call" / status action; hidden when no active call.
- **Connectivity + GPS pills** — online/offline (amber when offline, gold when
  syncing) and GPS-fix quality, from `Connectivity` + `LocationManager`.
- **Quick actions** that change by state: off-duty → "Start shift"; on a call →
  "Arrive / Clear"; idle on-duty → "New BOLO / Scan ID / …".

### Pull-to-refresh everywhere
Add `.refreshable { await reload() }` + refresh-on-`.scenePhase == .active` to
every list surface: Calls queue, Roster, Alerts, Watchlist, Fleet, Notifications,
DAR. Each reload is the screen's existing fetch, factored into an `async`
function if not already.

### Contextual quick actions
- Swipe actions on call rows (`CallsQueueView`) and roster rows
  (status-appropriate: e.g. arrive/clear on a call; clock-out on self row).
- A compact state-aware action bar on `FieldOpsView` mirroring the Home
  quick-actions, so the most likely next action is always one tap away.

### Verification
New pure logic (count derivation, quick-action state machine) unit-tested in the
SwiftPM harness. `swiftc -typecheck` clean.

---

## Phase 3 — Advanced Roster + Vehicle Automation (iOS + Worker + desktop)

**PR scope:** the only cross-stack phase. Requires a D1 migration applied to live
`785de7ae`, a Worker route change, an SW-bumped desktop change, plus iOS.

### Self clock in/out (`DutyRosterView` + a new "My Shift" surface)
- Every officer (not just dispatch-tier) gets a personal **My Shift** view:
  one-tap **Start shift** / **End shift** + **break** toggles, with a live
  shift-elapsed timer.
- Reuses the existing `api/dispatch/duty/start` and `api/dispatch/duty/end`
  endpoints (already called by `ShiftStartSheet`/`ShiftEndSheet`).
- Offline-safe: clock events queue through `OfflineQueue` when out of coverage.

### Live "who's on what"
- The On Duty section gains each officer's **current status + active call /
  assignment**, auto-refreshing on the poll tick (Phase 2 plumbing).

### My timecard summary
- Personal hours-this-shift / hours-this-week + recent entries, from
  `api/personnel/time?officer_id=…`, available to every officer (the existing
  `TimeEntryEditSheet` correction flow stays dispatch-tier).

### Vehicle-assignment automation (the headline feature)
**Trigger:** when an officer starts a shift (self clock-in) and has an assigned
fleet vehicle, the app **automatically presents the start-of-shift vehicle
inspection** (the existing `ShiftStartSheet`/`VehicleInspectionForm` flow),
rather than relying on the officer to open it manually.

- **Vehicle assignment source:** the officer's assigned vehicle is read from the
  duty/roster payload (`api/dispatch/duty/me` / roster row). If no vehicle is
  assigned, the inspection step is skipped (clock-in still completes).
- **Photos + notations:** `VehicleInspectionForm` gains per-section photo
  capture (reusing `FieldPhotoView`/`MultipartUpload`/`OfflinePhotoQueue`) and a
  free-text notes field per defect + an overall notes field.
- **Submission:** inspection posts to `api/fleet/:id/inspections` (existing),
  now including photo references; photos upload to R2 and create `field_photos`
  rows, and the inspection carries `photo_urls` (the established pattern that the
  desktop already renders).
- **Server is source of truth:** the existing `summarizeInspection` server logic
  (critical defect → vehicle `out_of_service`) is preserved. Photo handling must
  not regress that derivation.

**Server changes (`src/routes/fleet.ts` + migration):**
- New migration `migrations/00XX_fleet_inspection_photos.sql` adding
  `photo_urls TEXT` to `fleet_inspections` (idempotent; reconciled at boot per
  the repo's drift pattern). **Apply directly to live `785de7ae` after merge**
  (deploy migration step is `continue-on-error`).
- `POST /:id/inspections` accepts `photo_urls` (JSON array of R2 keys / field
  photo ids) and persists it; photo binaries upload via the existing field-photo
  multipart path so they land in R2 + `field_photos` and auto-attach.
- `GET /:id/inspections` (and `mapInspectionRow`) return `photo_urls`.

**Desktop changes (`client/src/pages/fleet/`):**
- `FleetDetailPanel` inspections tab renders the inspection's photos + notes
  (reusing the existing field-photo/`photo_urls` viewer components).
- Bump `client/public/sw.js` `CACHE_NAME`.

### Verification
- Worker `npm run typecheck`; new route logic covered if a Worker test harness
  is added (smoke at minimum).
- `pragma_table_info('fleet_inspections')` confirms `photo_urls` on live after
  apply.
- Desktop `tsc --noEmit` + `vite build`; SW bumped.
- iOS: inspection-payload + photo-attach pure logic unit-tested; `swiftc
  -typecheck` clean.

---

## Phase 4 — Advanced Field Tools (iOS only)

**PR scope:** enhance `FieldToolkitView` (already rich: favorites, recents,
categories, ~25 tools).

### Context-aware prefill
- Field actions (ALPR scan, warrant search, add-call-note, BOLO) auto-attach to
  the officer's **active call** when one exists.
- Calculators seed from context where sensible: distance/coordinate tools from
  current GPS; plate/name tools from the last ID/plate scan.

### Customizable favorites
- Drag-to-reorder favorites; pin any tool to the **Home quick-actions** bar.
- Persist per-user (extend the existing `ToolPrefs` store).

### Home quick-launch
- Surface the officer's pinned/most-recent tools as one-tap tiles on the Phase 2
  Home dashboard (depends on Phase 2).

### A few new on-device calculators
Add high-value, fully-offline calculators (pure functions, unit-tested):
following-distance / 3-second rule, weight/dose conversion, and one or two more
chosen with the operator. Each is a new `case` in the existing tool enum +
`FieldCalc` pure function + test.

### Verification
New calculators + prefill/favorite-ordering logic unit-tested in the SwiftPM
harness; `swiftc -typecheck` clean.

---

## Cross-Phase Risks & Mitigations

- **Synchronized-group deletions must be complete** — a leftover reference to a
  deleted symbol fails the whole build. Mitigation: the `swiftc -typecheck`
  sweep is the gate; grep each deleted symbol to zero before claiming done.
- **Phase 3 migration may not reach live** (deploy apply is
  `continue-on-error`). Mitigation: apply `photo_urls` directly to live
  `785de7ae` and verify with `pragma_table_info` (repo's standard drift dance).
- **`xcodebuild` deadlocks on this Mac.** Mitigation: SwiftPM `run-workflow-tests`
  + `swiftc -typecheck` for CI-equivalent confidence; device build via
  `refresh-device.sh`.
- **Scope creep across phases.** Mitigation: each phase is its own PR; do not
  start a later phase's work in an earlier PR.

## Delivery

Four PRs off the PR→deploy flow (feature branch → `gh pr create` → review →
merge → deploy), in order 1 → 2 → 3 → 4. SW bump only on Phase 3 (the sole phase
touching the web client). Each PR independently builds, typechecks, and passes
the iOS SwiftPM harness.
