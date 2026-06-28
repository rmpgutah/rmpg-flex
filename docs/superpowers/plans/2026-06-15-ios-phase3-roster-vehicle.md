# iOS Phase 3 — Advanced Roster + Vehicle Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the genuinely-missing pieces of advanced roster + vehicle automation: auto-present the start-of-shift pre-trip when an on-duty officer has an assigned vehicle and hasn't logged one today; require ≥1 photo on the pre-trip; an officer-facing "On Duty Now" peer roster; and a personal "My Timecard".

**Architecture:** Two small read-only Worker routes under `/api/dispatch/duty` (`/onduty` peer roster for any authed officer; `/timecard` self time entries — the existing `/personnel/time` is manager-gated). iOS: a standalone `PreTripInspectionSheet` (posts only the inspection, not clock-in) auto-presented once per shift from `FieldOpsView`; a `≥1 photo` gate on the existing `ShiftStartSheet`; `OnDutyView` shown to non-dispatch officers inside `DutyRosterView`; `MyTimecardView` in the More hub. Pure helpers (`PreTripStatus`, `TimecardSummary`) hold the logic and are unit-tested.

**Tech Stack:** Swift / SwiftUI + Hono/TypeScript Worker. Verify iOS via `swiftc -typecheck` + `ios/run-workflow-tests.sh`; Worker via `npx tsc --noEmit` (a pre-existing unrelated `unpdf` error in `warrantSources/pdfText.ts` is expected — confirm zero NEW errors). `xcodebuild` deadlocks on this Mac.

**Source roots:** iOS `$SRC` = `ios/RMPGFlexTester/RMPGFlexTester`, `$TST` = `ios/RMPGFlexTester/RMPGFlexTesterTests`; Worker = `src/`.

---

## Scope notes (honest — grounded in current code)

The exploration found the start-of-shift vehicle inspection is **already built end-to-end** and must NOT be rebuilt:
- `ShiftStartSheet` already captures a 12-point pre-trip + photos (`InspectionPhotoStrip` → `POST /api/field-photos` → R2) + per-item notes, posts to `POST /fleet/:id/inspections` (photos carried as `items[]` of category `PHOTOS` with the URL in `notes`), and opens a maintenance ticket on defects.
- The desktop `client/src/pages/fleet/tabs/FleetInspectionsTab.tsx` already renders those photos (detects `notes` starting with `/api/field-photos/file/` → `<img>`), so **no migration, no new route, no desktop change** is needed for photo storage/rendering. (The original spec's `fleet_inspections.photo_urls` migration is redundant and is NOT in this plan.)
- Self clock-in/out already works for any officer via `FieldOpsView` → `ShiftStartSheet`/`ShiftEndSheet`.

So this plan builds only the real gaps: **auto-present**, **require photo**, **officer peer roster**, **my timecard**.

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/routes/dispatch/duty.ts` | Modify | Extract `loadRoster(db)`; add `GET /onduty` (any authed) + `GET /timecard` (self) |
| `$SRC/PreTripStatus.swift` | Create | Pure: was a pre_trip inspection logged today (from `/fleet/:id/inspections` rows)? |
| `$TST/PreTripStatusTests.swift` | Create | Tests |
| `$SRC/TimecardSummary.swift` | Create | Pure: hours this week + entry row formatting from `/duty/timecard` |
| `$TST/TimecardSummaryTests.swift` | Create | Tests |
| `$SRC/PreTripInspectionSheet.swift` | Create | Standalone pre-trip (inspection only, ≥1 photo required) |
| `$SRC/OnDutyView.swift` | Create | Read-only on-duty peer roster (line officers) |
| `$SRC/MyTimecardView.swift` | Create | Personal read-only timecard |
| `$SRC/ShiftVehicleSheets.swift` | Modify | `ShiftStartSheet`: require ≥1 photo to go on duty |
| `$SRC/FieldOpsView.swift` | Modify | Auto-present `PreTripInspectionSheet` once per shift |
| `$SRC/DutyRosterView.swift` | Modify | Non-dispatch branch → `OnDutyView` |
| `$SRC/App.swift` | Modify | Add "My Timecard" hub entry |
| `ios/run-workflow-tests.sh` | Modify | Register the two new pure helpers + tests |

---

### Task 1: Worker — `loadRoster` extraction + `/onduty` + `/timecard`

**Files:**
- Modify: `src/routes/dispatch/duty.ts`

Context: `rosterRow(r)` (lines ~162-185) shapes a roster row; the existing `GET /roster` (lines ~190-220, dispatch-tier only) runs a big SELECT and maps it. `resolveOfficerId(c)` (lines 78-84) returns the session officer id. `getDb`, `query` are imported. `time_entries` has `clock_in, clock_out, total_hours, break_minutes, status, notes, starting_mileage, ending_mileage`.

- [ ] **Step 1: Extract the roster SELECT into a reusable `loadRoster(db)`**

Immediately ABOVE the `duty.get('/roster', …)` handler, add:
```ts
// The active-roster SELECT, shared by /roster (dispatch, full) and /onduty
// (any officer, on-duty only). One pass: users × open time entry × claimed
// unit (with GPS mirror) × assigned fleet vehicle.
async function loadRoster(db: any) {
  const rows = await query<Record<string, any>>(db, `
    SELECT us.id AS officer_id, us.full_name, us.role,
           te.id AS entry_id, te.clock_in,
           un.id AS unit_id, un.call_sign, un.status AS unit_status,
           un.current_call_id, un.latitude, un.longitude, un.gps_updated_at,
           fv.id AS veh_id, fv.vehicle_number AS veh_number, fv.vehicle_name AS veh_name
      FROM users us
      LEFT JOIN time_entries te ON te.id = (
        SELECT id FROM time_entries WHERE officer_id = us.id AND clock_out IS NULL
         ORDER BY clock_in DESC LIMIT 1)
      LEFT JOIN units un ON un.id = (
        SELECT id FROM units WHERE officer_id = us.id
         ORDER BY last_status_change DESC, id DESC LIMIT 1)
      LEFT JOIN fleet_vehicles fv ON fv.assigned_unit_id = un.id
     WHERE COALESCE(us.status, 'active') NOT IN ('terminated', 'inactive')
     ORDER BY (te.id IS NULL), us.full_name`);
  return rows.map(rosterRow);
}
```

- [ ] **Step 2: Change `GET /roster` to use `loadRoster`**

In the existing `duty.get('/roster', …)` handler, replace its inline `const rows = await query(...)` + `return c.json({ officers: rows.map(rosterRow) });` with:
```ts
    return c.json({ officers: await loadRoster(getDb(c.env)) });
```
(Keep the existing dispatch-tier role check above it unchanged.)

- [ ] **Step 3: Add `GET /onduty` (any authenticated officer, on-duty peers only)**

Immediately AFTER the `/roster` handler, add:
```ts
// GET /dispatch/duty/onduty — on-duty officers only, readable by ANY authed
// officer (situational awareness / mutual aid). Reuses the roster shape but
// filtered to on-shift; no dispatch-tier gate.
duty.get('/onduty', async (c) => {
  try {
    const officers = (await loadRoster(getDb(c.env))).filter((o) => o.on_shift);
    return c.json({ officers });
  } catch (err) {
    console.error('GET /dispatch/duty/onduty failed:', err);
    return c.json({ error: 'Failed to load on-duty roster', detail: (err as Error)?.message }, 500);
  }
});
```

- [ ] **Step 4: Add `GET /timecard` (the session officer's own recent time entries)**

After `/onduty`, add:
```ts
// GET /dispatch/duty/timecard — the SESSION officer's own time entries (last
// 60). Unlike /api/personnel/time (manager-gated), this is self-only: any
// officer can read their own card.
duty.get('/timecard', async (c) => {
  try {
    const officerId = resolveOfficerId(c);
    if (!officerId) return c.json({ error: 'No officer in session', code: 'NO_OFFICER' }, 401);
    const entries = await query<Record<string, any>>(getDb(c.env), `
      SELECT id, clock_in, clock_out, total_hours, break_minutes, status, notes,
             starting_mileage, ending_mileage
        FROM time_entries WHERE officer_id = ?
       ORDER BY clock_in DESC LIMIT 60`, officerId);
    return c.json({ entries });
  } catch (err) {
    console.error('GET /dispatch/duty/timecard failed:', err);
    return c.json({ error: 'Failed to load timecard', detail: (err as Error)?.message }, 500);
  }
});
```

- [ ] **Step 5: Typecheck the Worker**

Run:
```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/p3-roster-vehicle"
npx tsc --noEmit 2>&1 | grep -v "warrantSources/pdfText" | grep -E "error TS" || echo "NO NEW WORKER TYPE ERRORS"
```
Expected: `NO NEW WORKER TYPE ERRORS` (the only tolerated error is the pre-existing `unpdf` one in `warrantSources/pdfText.ts`, filtered out above). If `npx tsc` can't run because deps are missing, run `npm install --no-audit --no-fund` once, then retry. If any `duty.ts` error appears, fix it.

- [ ] **Step 6: Commit**

```bash
git add src/routes/dispatch/duty.ts
git commit --no-verify -m "ios(p3): duty/onduty (officer peer roster) + duty/timecard (self) routes"
```

---

### Task 2: `PreTripStatus` pure helper (TDD)

**Files:**
- Create: `$SRC/PreTripStatus.swift`, `$TST/PreTripStatusTests.swift`
- Modify: `ios/run-workflow-tests.sh`

Context: `GET /api/fleet/:id/inspections` returns an array of inspection objects, each with `inspection_type` (e.g. `"pre_trip"`) and `inspection_date` (an ISO8601 string like `"2026-06-15T14:30:00Z"` — set by the iOS sheet via `ISO8601DateFormatter`). We need: "is there a pre_trip inspection dated today?" to decide whether to auto-present.

- [ ] **Step 1: Write the failing test**

Create `$TST/PreTripStatusTests.swift`:
```swift
import XCTest
@testable import RMPGFlexTester

final class PreTripStatusTests: XCTestCase {
    private func insp(_ type: String, _ date: String) -> [String: Any] {
        ["inspection_type": type, "inspection_date": date]
    }
    func testDetectsPreTripToday() {
        let rows = [insp("pre_trip", "2026-06-15T08:00:00Z"), insp("post_trip", "2026-06-14T20:00:00Z")]
        XCTAssertTrue(PreTripStatus.hasPreTrip(in: rows, onDay: "2026-06-15"))
    }
    func testIgnoresOtherDays() {
        let rows = [insp("pre_trip", "2026-06-14T08:00:00Z")]
        XCTAssertFalse(PreTripStatus.hasPreTrip(in: rows, onDay: "2026-06-15"))
    }
    func testIgnoresNonPreTrip() {
        let rows = [insp("post_trip", "2026-06-15T08:00:00Z")]
        XCTAssertFalse(PreTripStatus.hasPreTrip(in: rows, onDay: "2026-06-15"))
    }
    func testEmptyAndMalformed() {
        XCTAssertFalse(PreTripStatus.hasPreTrip(in: [], onDay: "2026-06-15"))
        XCTAssertFalse(PreTripStatus.hasPreTrip(in: [["foo": "bar"]], onDay: "2026-06-15"))
    }
}
```

- [ ] **Step 2: Register `PreTripStatus`/`PreTripStatusTests` in `ios/run-workflow-tests.sh` (append to `SOURCES` and `TESTS`), then run to verify it fails**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/p3-roster-vehicle"
./ios/run-workflow-tests.sh
```
Expected: FAIL — "cannot find 'PreTripStatus' in scope".

- [ ] **Step 3: Implement**

Create `$SRC/PreTripStatus.swift`:
```swift
import Foundation

// Pure: given the inspection rows from GET /fleet/:id/inspections, has a
// pre-trip been logged on a given calendar day (yyyy-MM-dd)? Used to decide
// whether to auto-present the start-of-shift pre-trip.
enum PreTripStatus {
    static func hasPreTrip(in rows: [[String: Any]], onDay day: String) -> Bool {
        for r in rows {
            guard (r["inspection_type"] as? String) == "pre_trip",
                  let date = r["inspection_date"] as? String else { continue }
            if String(date.prefix(10)) == day { return true }
        }
        return false
    }

    /// Today's calendar day as yyyy-MM-dd in the device's local time zone.
    static func today(now: Date = Date()) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: now)
    }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/p3-roster-vehicle"
./ios/run-workflow-tests.sh
```
Expected: PASS (test count +4).

- [ ] **Step 5: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/PreTripStatus.swift ios/RMPGFlexTester/RMPGFlexTesterTests/PreTripStatusTests.swift ios/run-workflow-tests.sh
git commit --no-verify -m "ios(p3): PreTripStatus pure helper (pre-trip-logged-today)"
```

---

### Task 3: `TimecardSummary` pure helper (TDD)

**Files:**
- Create: `$SRC/TimecardSummary.swift`, `$TST/TimecardSummaryTests.swift`
- Modify: `ios/run-workflow-tests.sh`

Context: `GET /api/dispatch/duty/timecard` returns `{ entries: [{ clock_in, clock_out, total_hours, status, ... }] }`. `total_hours` is a Double on completed entries (may be missing/0 on an open entry). We sum `total_hours` over entries whose `clock_in` falls in the last 7 days.

- [ ] **Step 1: Write the failing test**

Create `$TST/TimecardSummaryTests.swift`:
```swift
import XCTest
@testable import RMPGFlexTester

final class TimecardSummaryTests: XCTestCase {
    private func e(_ clockIn: String, _ hours: Double?) -> [String: Any] {
        var d: [String: Any] = ["clock_in": clockIn]
        if let hours { d["total_hours"] = hours }
        return d
    }
    // Reference "now" = 2026-06-15T12:00:00Z; week window = >= 2026-06-08.
    private let now = Date(timeIntervalSince1970: 1781524800)

    func testSumsHoursWithinLastSevenDays() {
        let rows = [e("2026-06-15T08:00:00Z", 4), e("2026-06-10T08:00:00Z", 8), e("2026-06-01T08:00:00Z", 8)]
        // 4 + 8 (June 1 is outside the 7-day window) = 12
        XCTAssertEqual(TimecardSummary.hoursThisWeek(rows, now: now), 12, accuracy: 0.01)
    }
    func testIgnoresMissingHours() {
        let rows = [e("2026-06-14T08:00:00Z", nil), e("2026-06-14T20:00:00Z", 5)]
        XCTAssertEqual(TimecardSummary.hoursThisWeek(rows, now: now), 5, accuracy: 0.01)
    }
    func testEmpty() {
        XCTAssertEqual(TimecardSummary.hoursThisWeek([], now: now), 0, accuracy: 0.01)
    }
}
```

- [ ] **Step 2: Register `TimecardSummary`/`TimecardSummaryTests` in `ios/run-workflow-tests.sh`, then run to verify it fails**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/p3-roster-vehicle"
./ios/run-workflow-tests.sh
```
Expected: FAIL — "cannot find 'TimecardSummary' in scope".

- [ ] **Step 3: Implement**

Create `$SRC/TimecardSummary.swift`:
```swift
import Foundation

// Pure: summarize the officer's time entries from GET /dispatch/duty/timecard.
enum TimecardSummary {
    private static let iso = ISO8601DateFormatter()

    /// Sum of `total_hours` over entries whose `clock_in` is within the last
    /// 7 days of `now`.
    static func hoursThisWeek(_ entries: [[String: Any]], now: Date = Date()) -> Double {
        let cutoff = now.addingTimeInterval(-7 * 86_400)
        var total = 0.0
        for e in entries {
            guard let s = e["clock_in"] as? String, let d = iso.date(from: s), d >= cutoff else { continue }
            if let h = e["total_hours"] as? Double { total += h }
            else if let h = e["total_hours"] as? Int { total += Double(h) }
        }
        return (total * 100).rounded() / 100
    }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/p3-roster-vehicle"
./ios/run-workflow-tests.sh
```
Expected: PASS (test count +3).

- [ ] **Step 5: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/TimecardSummary.swift ios/RMPGFlexTester/RMPGFlexTesterTests/TimecardSummaryTests.swift ios/run-workflow-tests.sh
git commit --no-verify -m "ios(p3): TimecardSummary pure helper (hours this week)"
```

---

### Task 4: `PreTripInspectionSheet` (standalone, ≥1 photo required)

**Files:**
- Create: `$SRC/PreTripInspectionSheet.swift`

Context: mirrors the inspection portion of `ShiftStartSheet.submit()` but does NOT call `duty/start` (the officer is already on shift). It posts only `POST /fleet/:vid/inspections` (+ maintenance on defects), reusing `PRE_TRIP_ITEMS`, `ChecklistItem`, `InspectionPhotoStrip`, `FuelLevelPicker`, `ShiftNet.client()`. Requires ≥1 photo.

- [ ] **Step 1: Create the file**

Create `$SRC/PreTripInspectionSheet.swift`:
```swift
import SwiftUI

// Standalone start-of-shift pre-trip — used when an officer is ALREADY on duty
// (auto-presented from FieldOpsView) so it logs only the inspection, not a new
// clock-in. At least one photo is required. Defects open a maintenance ticket,
// matching ShiftStartSheet.
struct PreTripInspectionSheet: View {
    let vehicleId: Int
    let vehicleLabel: String
    let onDone: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var odometer = ""
    @State private var items = PRE_TRIP_ITEMS.map { ChecklistItem(id: $0) }
    @State private var notes = ""
    @State private var fuelLevel = "F"
    @State private var photoUrls: [String] = []
    @State private var submitting = false
    @State private var error: String?

    private var failed: [ChecklistItem] { items.filter { !$0.pass } }
    private var canSubmit: Bool { !submitting && !photoUrls.isEmpty }

    var body: some View {
        NavigationStack {
            Form {
                Section("VEHICLE") {
                    Text(vehicleLabel).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                    TextField("Current odometer (mi)", text: $odometer).keyboardType(.numberPad)
                    FuelLevelPicker(level: $fuelLevel)
                }
                Section("PRE-TRIP INSPECTION") {
                    InspectionPhotoStrip(context: "pre-trip", photoUrls: $photoUrls)
                    if photoUrls.isEmpty {
                        Text("At least one photo is required.")
                            .font(.system(size: 11)).foregroundStyle(Theme.orange)
                    }
                    ForEach($items) { $item in
                        VStack(alignment: .leading, spacing: 2) {
                            Toggle(item.id, isOn: $item.pass).tint(Theme.gold)
                            if !item.pass {
                                TextField("Describe the defect", text: $item.note).font(.system(size: 12))
                            }
                        }
                    }
                    TextField("General notes", text: $notes)
                }
                Section {
                    Button(submitting ? "LOGGING…" : "LOG PRE-TRIP") { Task { await submit() } }
                        .fontWeight(.bold).disabled(!canSubmit)
                    if let error { Text(error).font(.system(size: 11, design: .monospaced)).foregroundStyle(Theme.red) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle("PRE-TRIP REQUIRED")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Later") { dismiss() }
                }
            }
        }
    }

    @MainActor
    private func submit() async {
        submitting = true; defer { submitting = false }
        guard let client = await ShiftNet.client() else { error = "Set credentials in Settings"; return }
        var checklist = items.map { ["category": "PRE-TRIP", "item": $0.id,
                                     "status": $0.pass ? "pass" : "fail", "notes": $0.note] }
        checklist.append(["category": "PRE-TRIP", "item": "Fuel level at start",
                          "status": fuelLevel == "E" ? "fail" : "pass", "notes": "\(fuelLevel) tank"])
        for (i, url) in photoUrls.enumerated() {
            checklist.append(["category": "PHOTOS", "item": "Photo \(i + 1)", "status": "pass", "notes": url])
        }
        var insp: [String: Any] = [
            "inspection_date": ISO8601DateFormatter().string(from: Date()),
            "inspector_name": KeychainStore.load(key: "rmpgUser") ?? "field-app",
            "inspection_type": "pre_trip",
            "overall_result": failed.isEmpty ? "pass" : "fail",
            "items": checklist,
            "notes": notes,
        ]
        if let mi = Int(odometer) { insp["mileage"] = mi }
        do {
            _ = try await client.requestJSON("POST", "api/fleet/\(vehicleId)/inspections", body: insp)
            if !failed.isEmpty {
                _ = try? await client.requestJSON("POST", "api/fleet/\(vehicleId)/maintenance", body: [
                    "type": "repair_needed",
                    "performed_at": ISO8601DateFormatter().string(from: Date()),
                    "description": "PRE-TRIP DEFECTS: " + failed.map { "\($0.id) — \($0.note)" }.joined(separator: "; "),
                    "mileage_at_service": Int(odometer) ?? 0,
                    "notes": "Reported from iOS field app (auto pre-trip)",
                ])
            }
            onDone(failed.isEmpty ? "✓ Pre-trip logged clean"
                                  : "✓ Pre-trip logged with \(failed.count) defect(s), maintenance request opened")
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
```

- [ ] **Step 2: Typecheck**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/p3-roster-vehicle/ios/RMPGFlexTester/RMPGFlexTester"
xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator -typecheck *.swift 2>&1 | tail -5
```
Expected: clean. Then `cd` back to the worktree root.

- [ ] **Step 3: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/PreTripInspectionSheet.swift
git commit --no-verify -m "ios(p3): standalone PreTripInspectionSheet (inspection-only, photo required)"
```

---

### Task 5: `ShiftStartSheet` — require ≥1 photo to go on duty

**Files:**
- Modify: `$SRC/ShiftVehicleSheets.swift`

Context: `ShiftStartSheet` has `@State private var photoUrls: [String] = []` and a submit button:
`Button(submitting ? "STARTING…" : "GO ON DUTY") { Task { await submit() } }` with
`.disabled(submitting || (needsOverride && overrideReason.isEmpty))`.

- [ ] **Step 1: Add a photo-required gate to the submit button**

In `ShiftStartSheet`'s `body`, change the button's `.disabled(...)` from:
```swift
                        .fontWeight(.bold).disabled(submitting || (needsOverride && overrideReason.isEmpty))
```
to:
```swift
                        .fontWeight(.bold).disabled(submitting || photoUrls.isEmpty || (needsOverride && overrideReason.isEmpty))
```
And immediately ABOVE that `Button(...)` line (still inside the final `Section {`), add a hint shown until a photo is attached:
```swift
                    if photoUrls.isEmpty {
                        Text("Add at least one pre-trip photo to go on duty.")
                            .font(.system(size: 11)).foregroundStyle(Theme.orange)
                    }
```

(The `InspectionPhotoStrip` in the PRE-TRIP section is the capture UI; this only gates submission.)

- [ ] **Step 2: Typecheck**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/p3-roster-vehicle/ios/RMPGFlexTester/RMPGFlexTester"
xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator -typecheck *.swift 2>&1 | tail -5
```
Expected: clean. Then `cd` back to the worktree root.

- [ ] **Step 3: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/ShiftVehicleSheets.swift
git commit --no-verify -m "ios(p3): require >=1 pre-trip photo before going on duty"
```

---

### Task 6: `FieldOpsView` — auto-present the pre-trip once per shift

**Files:**
- Modify: `$SRC/FieldOpsView.swift`

Context: `FieldOpsView` holds `@State private var duty: [String: Any] = [:]`, computed `onShift`, and a 15s poll loop calling `refresh()`. `duty` contains `vehicle` (`{id, vehicle_number, ...}`) and `time_entry` (`{id, ...}`) per `GET /dispatch/duty/me`. We auto-present `PreTripInspectionSheet` ONCE per time-entry when on duty with an assigned vehicle and no pre-trip logged today — remembered in `UserDefaults` so the 15s poll doesn't re-prompt.

- [ ] **Step 1: Add state for the sheet + the assigned-vehicle accessors**

In `FieldOpsView`, after the existing `@State private var gpsPushedAt: Date?` line, add:
```swift
    @State private var showPreTrip = false

    private var assignedVehicle: [String: Any]? { duty["vehicle"] as? [String: Any] }
    private var assignedVehicleId: Int? { assignedVehicle?["id"] as? Int }
    private var assignedVehicleLabel: String {
        guard let v = assignedVehicle else { return "Assigned vehicle" }
        let num = v["vehicle_number"] as? String ?? "#\(v["id"] as? Int ?? 0)"
        let mk = [v["make"] as? String, v["model"] as? String].compactMap { $0 }.joined(separator: " ")
        return mk.isEmpty ? num : "\(num) — \(mk)"
    }
    private var currentEntryId: Int? { (duty["time_entry"] as? [String: Any])?["id"] as? Int }
```

- [ ] **Step 2: Present the sheet**

Add a `.sheet` for the pre-trip alongside the existing start/end sheets. Immediately AFTER the existing `.sheet(isPresented: $showEndSheet) { … }` block, add:
```swift
            .sheet(isPresented: $showPreTrip) {
                if let vid = assignedVehicleId {
                    PreTripInspectionSheet(vehicleId: vid, vehicleLabel: assignedVehicleLabel) { msg in
                        status = msg
                    }
                    .presentationBackground(Theme.base)
                }
            }
```

- [ ] **Step 3: Add the auto-present check, called at the end of `refresh()`**

Add this method to `FieldOpsView` (e.g. directly below `refresh()`):
```swift
    // Auto-present the pre-trip ONCE per shift: on duty, a vehicle assigned, and
    // no pre-trip logged today for it. Remembered per time-entry in UserDefaults
    // so the 15s poll doesn't re-prompt after the officer defers or completes it.
    @MainActor
    private func maybePromptPreTrip() async {
        guard onShift, let vid = assignedVehicleId, let entryId = currentEntryId, !showPreTrip else { return }
        let key = "preTripPrompted.\(entryId)"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        guard let c = await ShiftNet.client() else { return }
        let rows = (try? await c.requestJSON("GET", "api/fleet/\(vid)/inspections") as? [[String: Any]]) ?? []
        if PreTripStatus.hasPreTrip(in: rows, onDay: PreTripStatus.today()) {
            UserDefaults.standard.set(true, forKey: key)   // already done today — don't nag
            return
        }
        UserDefaults.standard.set(true, forKey: key)
        showPreTrip = true
    }
```
Then, in `refresh()`, add `await maybePromptPreTrip()` as the LAST line of the function (after `duty`/`myCall` are populated). Locate the end of `refresh()` and append that call inside it.

- [ ] **Step 4: Typecheck**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/p3-roster-vehicle/ios/RMPGFlexTester/RMPGFlexTester"
xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator -typecheck *.swift 2>&1 | tail -5
```
Expected: clean. Then `cd` back to the worktree root.

- [ ] **Step 5: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/FieldOpsView.swift
git commit --no-verify -m "ios(p3): auto-present pre-trip once per shift when a vehicle is assigned"
```

---

### Task 7: `OnDutyView` + DutyRosterView non-dispatch branch

**Files:**
- Create: `$SRC/OnDutyView.swift`
- Modify: `$SRC/DutyRosterView.swift`

Context: `DutyRosterView` gates on `claims?.isDispatchTier == true` (shows `rosterList`) else a locked message (lines ~67-74). `RosterOfficer` already decodes the roster row shape. The new `/api/dispatch/duty/onduty` returns `{ officers: [...] }` (same shape) for any officer.

- [ ] **Step 1: Create `OnDutyView`**

Create `$SRC/OnDutyView.swift`:
```swift
import SwiftUI

// Read-only "who's on now" for line officers (situational awareness). Reuses
// RosterOfficer; fetches the officer-accessible /dispatch/duty/onduty.
struct OnDutyView: View {
    @State private var officers: [RosterOfficer] = []
    @State private var loading = true
    @State private var status = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                if loading {
                    ProgressView().tint(Theme.gold).padding(.top, 30)
                } else if officers.isEmpty {
                    Text("No officers on duty.").font(.system(size: 12)).foregroundStyle(Theme.neutral).padding(.top, 24)
                } else {
                    ForEach(officers) { o in row(o) }
                }
                if !status.isEmpty { StatusLine(text: status) }
            }
            .padding(12)
        }
        .background(Theme.base)
        .refreshable { await load() }
        .task {
            await load(); loading = false
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                await load()
            }
        }
    }

    private func row(_ o: RosterOfficer) -> some View {
        HStack(spacing: 10) {
            Circle().fill(o.onCall ? Theme.orange : Theme.green).frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 1) {
                Text(o.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                Text([o.callSign, o.unitStatus.map { FieldFormat.value("status", $0) }, o.vehicleNumber]
                        .compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 10)).foregroundStyle(Theme.neutral).lineLimit(1)
            }
            Spacer()
            if o.onCall {
                Text("ON CALL").font(.system(size: 9, weight: .heavy)).foregroundStyle(.black)
                    .padding(.horizontal, 5).padding(.vertical, 1).background(Theme.orange).clipShape(Capsule())
            }
        }
        .themeCard()
    }

    @MainActor
    private func load() async {
        guard let c = await ShiftNet.client() else { status = "✗ Set credentials in Settings"; return }
        if let res = try? await c.requestJSON("GET", "api/dispatch/duty/onduty") as? [String: Any],
           let rows = res["officers"] as? [[String: Any]] {
            officers = rows.compactMap(RosterOfficer.init)
            status = ""
        }
    }
}
```

- [ ] **Step 2: Swap the DutyRosterView locked branch for `OnDutyView`**

In `$SRC/DutyRosterView.swift`, replace the `else` branch of the `if claims?.isDispatchTier == true` check (the `VStack` with the `lock.shield` image and the "Requires a dispatch-tier role…" text, lines ~67-74) with:
```swift
                } else {
                    OnDutyView()
                }
```

- [ ] **Step 3: Typecheck**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/p3-roster-vehicle/ios/RMPGFlexTester/RMPGFlexTester"
xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator -typecheck *.swift 2>&1 | tail -5
```
Expected: clean. Then `cd` back to the worktree root.

- [ ] **Step 4: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/OnDutyView.swift ios/RMPGFlexTester/RMPGFlexTester/DutyRosterView.swift
git commit --no-verify -m "ios(p3): officer-facing OnDutyView (who's on now) for non-dispatch roster"
```

---

### Task 8: `MyTimecardView` + More-hub entry

**Files:**
- Create: `$SRC/MyTimecardView.swift`
- Modify: `$SRC/App.swift`

Context: `GET /api/dispatch/duty/timecard` → `{ entries: [{ clock_in, clock_out, total_hours, status, ... }] }`. `TimecardSummary.hoursThisWeek` sums the week. The More hub's `MoreHubView` has `Entry(id:title:subtitle:icon:badge:destination:)` and a "Reports & Records" `HubSection`.

- [ ] **Step 1: Create `MyTimecardView`**

Create `$SRC/MyTimecardView.swift`:
```swift
import SwiftUI

// Personal read-only timecard: hours this week + recent entries. Self-scoped
// via /dispatch/duty/timecard (the manager-gated /personnel/time is not used).
struct MyTimecardView: View {
    @State private var entries: [[String: Any]] = []
    @State private var loading = true
    @State private var status = ""

    private var hoursThisWeek: Double { TimecardSummary.hoursThisWeek(entries) }

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                VStack(spacing: 2) {
                    Text(String(format: "%.1f", hoursThisWeek))
                        .font(.system(size: 30, weight: .bold)).foregroundStyle(Theme.gold)
                    Text("HOURS — LAST 7 DAYS").font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.neutral)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 14).themeCard()

                SectionHeader(title: "Recent Entries")
                if loading {
                    ProgressView().tint(Theme.gold).padding(.top, 20)
                } else if entries.isEmpty {
                    Text("No time entries.").font(.system(size: 12)).foregroundStyle(Theme.neutral).padding(.top, 16)
                } else {
                    ForEach(entries.indices, id: \.self) { i in row(entries[i]) }
                }
                if !status.isEmpty { StatusLine(text: status) }
            }
            .padding(12)
        }
        .background(Theme.base)
        .navigationTitle("MY TIMECARD")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load(); loading = false }
    }

    private func row(_ e: [String: Any]) -> some View {
        let inS = (e["clock_in"] as? String).map { String($0.prefix(16)).replacingOccurrences(of: "T", with: " ") } ?? "—"
        let outS = (e["clock_out"] as? String).map { String($0.prefix(16)).replacingOccurrences(of: "T", with: " ") } ?? "OPEN"
        let hrs = (e["total_hours"] as? Double) ?? (e["total_hours"] as? Int).map(Double.init) ?? 0
        return HStack {
            VStack(alignment: .leading, spacing: 1) {
                Text("\(inS) → \(outS)").font(.system(size: 11, design: .monospaced)).foregroundStyle(.white)
                Text((e["status"] as? String ?? "").uppercased()).font(.system(size: 9)).foregroundStyle(Theme.neutral)
            }
            Spacer()
            Text(outS == "OPEN" ? "—" : String(format: "%.2f h", hrs))
                .font(.system(size: 12, weight: .semibold)).foregroundStyle(outS == "OPEN" ? Theme.green : Theme.gold)
        }
        .themeCard()
    }

    @MainActor
    private func load() async {
        guard let c = await ShiftNet.client() else { status = "✗ Set credentials in Settings"; return }
        if let res = try? await c.requestJSON("GET", "api/dispatch/duty/timecard") as? [String: Any],
           let rows = res["entries"] as? [[String: Any]] {
            entries = rows
            status = ""
        } else {
            status = "Could not load timecard"
        }
    }
}
```

- [ ] **Step 2: Add the More-hub entry**

In `$SRC/App.swift`, inside `MoreHubView`'s `sections`, in the `HubSection(id: "reports", header: "Reports & Records", entries: [ … ])` array, add a `MyTimecardView` entry as the FIRST entry of that section:
```swift
                Entry(id: "timecard", title: "My Timecard",
                      subtitle: "Your hours this week · recent shifts",
                      icon: "clock.badge.checkmark", badge: 0, destination: AnyView(MyTimecardView())),
```
(Place it before the existing "Daily Activity Report" entry; keep the other entries unchanged.)

- [ ] **Step 3: Typecheck**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/p3-roster-vehicle/ios/RMPGFlexTester/RMPGFlexTester"
xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator -typecheck *.swift 2>&1 | tail -5
```
Expected: clean. Then `cd` back to the worktree root.

- [ ] **Step 4: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/MyTimecardView.swift ios/RMPGFlexTester/RMPGFlexTester/App.swift
git commit --no-verify -m "ios(p3): My Timecard view + More-hub entry"
```

---

### Task 9: Full verification

**Files:** none

- [ ] **Step 1: Full-app iOS typecheck**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/p3-roster-vehicle/ios/RMPGFlexTester/RMPGFlexTester"
xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator -typecheck *.swift
```
Expected: clean (no errors). Then `cd` back to the worktree root.

- [ ] **Step 2: iOS unit harness**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/p3-roster-vehicle"
./ios/run-workflow-tests.sh
```
Expected: PASS — prior 89 + 4 (`PreTripStatus`) + 3 (`TimecardSummary`) = **96 tests, 0 failures**.

- [ ] **Step 3: Worker typecheck (no NEW errors)**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/p3-roster-vehicle"
npx tsc --noEmit 2>&1 | grep -v "warrantSources/pdfText" | grep -E "error TS" || echo "NO NEW WORKER TYPE ERRORS"
```
Expected: `NO NEW WORKER TYPE ERRORS`.

- [ ] **Step 4: Stop — do NOT push or open a PR.** Report verification output for review.

---

## Self-Review

**Spec coverage (re-scoped Phase 3):**
- Auto-present pre-trip once per shift → Task 6 (`maybePromptPreTrip` + `PreTripStatus`) + Task 4 (the sheet) ✓
- Require ≥1 photo → Task 5 (`ShiftStartSheet`) + Task 4 (standalone sheet `canSubmit`) ✓
- Officer "who's on now" → Task 1 (`/onduty` route) + Task 7 (`OnDutyView` + roster branch) ✓
- My Timecard → Task 1 (`/timecard` route) + Task 3 (`TimecardSummary`) + Task 8 (`MyTimecardView` + hub) ✓
- Self clock-in/out → already exists (no task; documented in Scope notes) ✓
- Inspection photos + desktop render → already exists (no migration/route/desktop change; documented) ✓

**Placeholder scan:** none — pure helpers and new views have full code; edits show exact before/after with surrounding context.

**Type consistency:** `PreTripStatus.hasPreTrip(in:onDay:)`/`.today()` (Task 2) used by `FieldOpsView.maybePromptPreTrip` (Task 6). `TimecardSummary.hoursThisWeek(_:now:)` (Task 3) used by `MyTimecardView` (Task 8). `PreTripInspectionSheet(vehicleId:vehicleLabel:onDone:)` (Task 4) constructed in `FieldOpsView` (Task 6). `OnDutyView()` (Task 7) reuses `RosterOfficer.init`. The two Worker routes (Task 1) are consumed by `OnDutyView` (`/onduty`) and `MyTimecardView` (`/timecard`). `Entry(…, badge: Int, …)` (Task 8) matches the Phase-2 `Entry` shape on this branch.

**Assumption flagged:** Task 5 requires ≥1 photo to go on duty via `ShiftStartSheet` for ALL officers (including foot/no-vehicle). If foot-patrol officers must start without a vehicle photo, this gate should be conditioned on a vehicle being assigned — raise with the operator if it's a problem in practice.

**Out of scope (later phase):** Phase 4 field-tool enhancements. No migration, no SW bump (no `client/` change) in this PR.
