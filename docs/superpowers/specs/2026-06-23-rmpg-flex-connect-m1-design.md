# RMPG Flex Connect — M1 Officer Core Design

| Field | Value |
|---|---|
| **Date** | 2026-06-23 |
| **Status** | Approved |
| **Author** | Claude + Christopher Zamora |
| **Scope** | M1 officer-core feature content: Home, CFS, Scan, Reports, offline outbox, GPS |
| **Parent spec** | `2026-06-22-rmpg-flex-connect-ios-design.md` |
| **Builds on** | M0 + M1-starter (PRs #1627–#1641, live on device) |

---

## 1. Decisions locked in brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Home screen layout | **A — Status-first** | Big duty hero, live shift timer, 3 quick-action buttons, 4 stat tiles |
| CFS tab layout | **B — Segmented** | Mine / All Open / History; tap → detail sheet |
| Package architecture | **C — Hybrid** | 2 new feature pkgs + 2 new core pkgs + expand 3 existing |
| Live CFS updates | **30s polling** | Simpler than WebSocket across iOS background transitions; sufficient CAD latency |

---

## 2. Package changes

### New feature packages

**`FeatureScan`** — `Packages/FeatureScan/`
Camera mode picker, ALPR plate capture, Run ID (DL barcode + passport MRZ), FI photo. Depends on: `CoreAPI`, `CoreOffline`, `DesignSystem`.

**`FeatureReports`** — `Packages/FeatureReports/`
Daily Activity Report, FI card form, citation entry, report history. Depends on: `CoreAPI`, `CoreOffline`, `DesignSystem`.

### New core packages

**`CoreOffline`** — `Packages/CoreOffline/`
SwiftData-backed outbox queue, drain orchestrator, idempotency keys, NWPathMonitor integration.

**`CoreLocation`** — `Packages/CoreLocation/`
`CLLocationManager` wrapper, background location lifecycle, 30s GPS ping to `/api/dispatch/gps`, geofence primitives (stubbed for M7).

### Expanded packages

**`FeatureShell`** — adds `HomeView` (A-layout), `OffDutyHomeView`  
**`FeatureCFS`** — adds `CFSListView`, `CFSDetailSheet`, `CFSStatusActionView`, `CFSAPI.fetchList()`, `CFSAPI.updateStatus()`  
**`FeatureDuty`** — adds `MileageLogView`, `PreTripInspectionForm`, `OdometerEntrySheet`  
**`DesignSystem`** — adds `MiniTile`, `FormRow`, `ScanOverlay`, `CameraFrame`, `StatusSegmentPicker`

### Unchanged

`CoreAPI` (minor API method additions only), `CoreAuth`, `FeatureQuickActions`

---

## 3. Home tab — Status-first (A)

### On-duty state
```
┌─────────────────────────────┐  ← HeroCard, gold left accent
│ ● ON DUTY · Unit 19         │
│ Officer Zamora              │
│ Shift started 06:00 · Sierra│
│                             │
│  04:22:07                   │  ← live 1s timer
│                             │
│ [New Call] [Status] [Plate] │  ← 3 quick-action buttons
└─────────────────────────────┘
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│CFS   │ │Miles │ │Plates│ │FI    │  ← 4 MiniTile grid
│  3   │ │ 47.2 │ │  12  │ │  1   │
└──────┘ └──────┘ └──────┘ └──────┘
```

### Off-duty state
HeroCard shows "Off Duty" badge, `Start Patrol` primary button (→ `StartPatrolView`). Tiles show `—`.

### Data sources
- `DutyState.isOnDuty`, `.shiftStartedAt`, `.unitID` — from `FeatureDuty`
- `DutyState.cfsCount`, `.milesCount`, `.platesCount`, `.fiCount` — incremented locally on each successful form submit; refreshed from server on clock-on
- Quick-action buttons route via existing `QuickActionsRegistry` handlers

---

## 4. CFS tab — Segmented (B)

### Layout
```
[Mine]  [All Open]  [History]   ← StatusSegmentPicker
─────────────────────────────
CFS-2026-4481                   ← tap → CFSDetailSheet
10-91 Disturbance
247 W 900 S  ·  🟡 En Route
─────────────────────────────
CFS-2026-4477
Welfare Check
89 E Broadway  ·  ⚪ Pending
─────────────────────────────
```

### Segments
- **Mine** — `GET /api/dispatch/calls?assigned_to=me&status=open` — officer's assigned calls
- **All Open** — `GET /api/dispatch/calls?status=open` — full agency queue, read-only for officers
- **History** — `GET /api/dispatch/calls/history` — calls closed today by this officer

### Detail sheet (`CFSDetailSheet`)
Full-screen sheet on tap. Shows call number, type, address, narrative, units, timeline. Action strip:

| Button | API call | Next status |
|---|---|---|
| **Arrive** | `PATCH /api/dispatch/calls/:id/status` `{status:"on_scene"}` | On Scene |
| **Narrative** | Opens `NarrativeEntryView` inline | — |
| **Clear** | `PATCH …` `{status:"cleared"}` | Cleared |
| **Cancel** | `PATCH …` `{status:"cancelled"}` | Cancelled |

Buttons appear/hide based on current status (En Route shows Arrive; On Scene shows Clear).

### Refresh cadence
- List: 30s `Task` loop while view is visible
- Detail: 10s `Task` loop while sheet is open
- Manual: pull-to-refresh on list

### Nav bar
`+` button → `NewCallForm` (already built in `FeatureCFS`)

---

## 5. Scan tab — FeatureScan

### Mode picker
Horizontal segmented bar at top: `Plate` · `ID` · `FI Photo`

### Plate mode
1. Live `AVCaptureVideoPreviewLayer` (`CameraFrame`) with `ScanOverlay` (corner brackets, shutter)
2. Tap shutter → capture JPEG → `POST /api/alpr/capture` (multipart, optional `call_id`)
3. Result card: plate text, confidence badge, make/model/color/year, hit indicator (stolen / watchlist)
4. Offline: if no connectivity, entry queues in `CoreOffline` outbox with the JPEG spooled to disk

### ID mode
1. Same camera feed; `AVMetadataObjectTypeDataMatrixCode` + `PDF417` detector for DL barcode
2. Parse AAMVA fields: first/last, DOB, address, DL number, expiry
3. On success → pre-fills `FICardForm` with parsed fields; user reviews then submits
4. Passport MRZ: `VNRecognizeTextRequest` on captured frame → parse TD-3 MRZ lines

### FI Photo mode
Single-shot capture. Attaches to active call (if `DutyState` has one) or creates a standalone photo record. `POST /api/alpr/capture` with `call_id` if available.

---

## 6. Reports tab — FeatureReports

### Section list
```
Daily Activity Report  ›
FI Cards (3)          ›
Citations (0)         ›
```

### Daily Activity Report
- Form auto-populated: officer name (from JWT), unit, shift date, clock-on/off times, calls handled (count + list from `DutyState`), miles driven, activities from mileage log
- Manual narrative field (multiline)
- `POST /api/records/daily-activity-reports`
- One DAR per shift; "Edit" opens the existing draft if not yet submitted

### FI Card
- Fields: first / last / DOB / address / phone / vehicle (plate + make/model/color) / narrative
- Can be pre-filled from ID scan (§5) or plate scan
- Links to active call via `call_id` if `DutyState.activeCallID` is set
- `POST /api/records/fi-cards`

### Citation
- Fields: violation code (picker), location, vehicle (pre-filled from plate scan), officer signature placeholder, narrative
- `POST /api/records/citations`
- Offline-queued via `CoreOffline` if no connectivity

---

## 7. CoreOffline

### SwiftData model
```swift
@Model final class OutboxEntry {
    var id: UUID
    var endpoint: String
    var method: String          // "POST" | "PATCH"
    var body: Data              // JSON body, or file-ref JSON for large payloads
    var headers: [String:String]
    var attemptCount: Int
    var lastError: String?
    var createdAt: Date
    var status: EntryStatus     // .pending | .draining | .failed
}
```

Large payloads (photos ≥ 100 KB): `body` = `{"_file":"<uuid>"}`, actual bytes at `Caches/Outbox/<uuid>`. File evicted on drain success. Sub-100 KB payloads (JSON forms, citation text) are inlined in `body` directly.

### Drain
- Trigger 1: `NWPathMonitor` `.satisfied` event
- Trigger 2: `sceneDidBecomeActive` (every foreground)
- Each entry gets `Idempotency-Key: <entry.id>` header
- Retry: exponential backoff, max 24h → `.failed`
- `.failed` entries surface in Settings → "Pending Submissions"

---

## 8. CoreLocation

### Interface
```swift
@Observable @MainActor
public final class CLLocationProvider {
    public nonisolated static let shared = CLLocationProvider()
    public var currentLocation: CLLocation?
    public var authorizationStatus: CLAuthorizationStatus
    public func requestAlwaysAuthorization()
    public func startDutyTracking(apiClient: APIClient)  // begins 30s GPS pings
    public func stopDutyTracking()
}
```

### GPS ping
`POST /api/dispatch/gps` every 30s while on duty. Body: `{lat, lng, accuracy, speed, heading, timestamp}`. Fire-and-forget (`waitUntil` pattern using detached `Task`).

### Info.plist keys required
```
NSLocationAlwaysAndWhenInUseUsageDescription
NSLocationWhenInUseUsageDescription
UIBackgroundModes: [location]
```

### M7 stubs
`addRegion(center:radius:identifier:)` and `removeRegion(identifier:)` — wired to `CLCircularRegion` but no handler logic in M1.

---

## 9. DesignSystem additions

| Component | Purpose |
|---|---|
| `MiniTile(icon:label:value:)` | 4-up stat tile on Home screen |
| `FormRow(label:content:)` | Standard label+control row for all forms |
| `ScanOverlay` | Camera viewport with corner brackets, mode label, shutter button |
| `CameraFrame` | `AVCaptureVideoPreviewLayer` as SwiftUI `UIViewRepresentable` |
| `StatusSegmentPicker(segments:selection:)` | Mine/All Open/History control |

All use the existing `DesignSystem` Swift color constants (e.g. `Color.rmpgSurface`, `Color.rmpgGold`, `Color.rmpgBorder`). No raw `Color(red:green:blue:)` literals.

---

## 10. API changes in the Worker

All changes are additive query-param filters or new routes on existing tables — no migrations needed.

| Method | Path | Change |
|---|---|---|
| `GET` | `/api/dispatch/calls` | Add `?assigned_to=me` and `?status=open\|closed` filters |
| `GET` | `/api/dispatch/calls/history` | New route — today's closed calls for auth'd officer |
| `PATCH` | `/api/dispatch/calls/:id/status` | Verify `status` enum accepts all M1 values |
| `POST` | `/api/devices/location` | Alias or extend existing `/api/dispatch/gps` |

Verify `POST /api/records/fi-cards` and `POST /api/records/citations` are mounted and accepting the expected fields.

---

## 11. Testing

Each new package gets a `Tests/` target:

- **ViewModels**: state machine tests (idle → loading → success / error) using mock `APIClient`
- **API models**: `Codable` decode tests against fixture JSON files in `Tests/Fixtures/`
- **CoreOffline**: outbox enqueue → drain → success round-trip; large-payload spool/evict cycle
- **CoreLocation**: mock `CLLocationManager` — auth request sequence, GPS ping cadence
- **DesignSystem**: snapshot tests via `swift-snapshot-testing` for all 5 new components

Manual QA on device after each package lands (one PR per package).

---

## 12. Build order

Ship one PR per package to keep CI fast and device installs frequent:

1. `CoreOffline` + `CoreLocation` (foundation for everything else)
2. `DesignSystem` additions (shared components)
3. `FeatureShell` HomeView
4. `FeatureCFS` full list + detail
5. `FeatureDuty` mileage + pre-trip
6. `FeatureScan` (camera, ALPR, Run ID)
7. `FeatureReports` (DAR, FI, citations)
8. Worker API additions (can overlap with any iOS PR above)
9. Integration PR: wire all new packages into `RMPGFlexConnect.xcodeproj`
