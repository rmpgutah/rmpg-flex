# iOS Phase 2 — Dynamic Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the iOS shell feel live — numeric tab badges, a state-aware Home with running shift/active-call timers and a GPS pill, and contextual one-tap navigation based on duty state.

**Architecture:** A single `@MainActor` observable `LiveCounts.shared` polls the two cheap counts (active calls, unread) on a 15s cadence independent of which screen is visible; `MainTabView` observes it (plus the already-observable `MDTLink`/`OfflineSync`) to drive tab badges. Pure, unit-tested helpers (`CountParse`, `ElapsedClock`) hold all the parsing/formatting logic so it runs in the SwiftPM test harness. `DashboardView` is enriched (timers via `TimelineView`, active-call card, contextual action banner, GPS pill) and switched to read counts from `LiveCounts` so the badge and the dashboard never disagree.

**Tech Stack:** Swift / SwiftUI; `TimelineView(.periodic)` for live timers; verification via `swiftc -typecheck` + `ios/run-workflow-tests.sh` (SwiftPM harness — `xcodebuild` deadlocks on this Mac).

**Source root (`$SRC`):** `ios/RMPGFlexTester/RMPGFlexTester`
**Test root (`$TST`):** `ios/RMPGFlexTester/RMPGFlexTesterTests`

---

## Scope notes (honest, grounded in the current code)

- **Pull-to-refresh is already implemented on all 11 list surfaces** (`.refreshable { await … }` + 8–15s poll loops). This plan does NOT re-add it. The only related addition is refresh-on-foreground on `DashboardView` (Task 6).
- **Swipe-actions on call rows are descoped.** `CallsQueueView` is a themed `ScrollView`+`VStack` (not a `List`); `.swipeActions` require a `List`, and converting would discard the custom card styling for marginal gain — the rows already have inline En Route / On Scene / Clear / Assign buttons. Contextual-action value is delivered via the state-aware Home instead. (`DutyRosterView` already has swipe actions; left as-is.)
- **More-hub row chips** are scoped to the count we already poll cheaply (Live Alerts → unread). Watchlist-hit / Fleet-not-ready chips would each need a dedicated poll and are deferred.

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `$SRC/CountParse.swift` | Create | Pure: count rows / read int field from a JSON-ish `Any?` |
| `$TST/CountParseTests.swift` | Create | Tests for `CountParse` |
| `$SRC/ElapsedClock.swift` | Create | Pure: parse UTC timestamp, format elapsed duration |
| `$TST/ElapsedClockTests.swift` | Create | Tests for `ElapsedClock` |
| `$SRC/LiveCounts.swift` | Create | `ObservableObject` polling active-calls + unread |
| `$SRC/GPSStatusPill.swift` | Create | Compact GPS-fix-quality pill |
| `$SRC/App.swift` | Modify | Tab badges + start `LiveCounts`; More-hub Alerts chip |
| `$SRC/DashboardView.swift` | Modify | Timers, active-call card, contextual banner, GPS pill, read counts from `LiveCounts`, scenePhase refresh |
| `$SRC/FieldOpsView.swift` | Modify | Add `GPSStatusPill` to its header status row |
| `ios/run-workflow-tests.sh` | Modify | Register `CountParse`/`ElapsedClock` (+ tests) in the harness arrays |

---

### Task 1: `CountParse` pure helper (TDD)

**Files:**
- Create: `$SRC/CountParse.swift`
- Create: `$TST/CountParseTests.swift`
- Modify: `ios/run-workflow-tests.sh`

- [ ] **Step 1: Write the failing test**

Create `$TST/CountParseTests.swift`:
```swift
import XCTest
@testable import RMPGFlexTester

final class CountParseTests: XCTestCase {
    func testRowCountFromArray() {
        XCTAssertEqual(CountParse.rowCount([["id": 1], ["id": 2]]), 2)
    }
    func testRowCountFromWrappedKeys() {
        XCTAssertEqual(CountParse.rowCount(["results": [["a": 1]]]), 1)
        XCTAssertEqual(CountParse.rowCount(["calls": [["a": 1], ["b": 2], ["c": 3]]]), 3)
    }
    func testRowCountFallsBackToZero() {
        XCTAssertEqual(CountParse.rowCount(nil), 0)
        XCTAssertEqual(CountParse.rowCount("nope"), 0)
        XCTAssertEqual(CountParse.rowCount(["other": 5]), 0)
    }
    func testIntFieldDirectAndWrapped() {
        XCTAssertEqual(CountParse.intField(7, ["count"]), 7)
        XCTAssertEqual(CountParse.intField(["unread_count": 4], ["count", "unread_count"]), 4)
    }
    func testIntFieldFallsBackToZero() {
        XCTAssertEqual(CountParse.intField(nil, ["count"]), 0)
        XCTAssertEqual(CountParse.intField(["x": 1], ["count"]), 0)
    }
}
```

- [ ] **Step 2: Register the new files in the SwiftPM harness, then run to verify it fails**

In `ios/run-workflow-tests.sh`, add `CountParse` to the `SOURCES=(...)` array and `CountParseTests` to the `TESTS=(...)` array (append to each list, preserving the existing entries).

Run:
```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
./ios/run-workflow-tests.sh
```
Expected: FAIL — compile error "cannot find 'CountParse' in scope" (impl not written yet).

- [ ] **Step 3: Write the implementation**

Create `$SRC/CountParse.swift`:
```swift
import Foundation

// Pure helpers for reading counts out of the app's loosely-typed JSON responses
// (`[String: Any]` / `[[String: Any]]`). Extracted from DashboardView so both it
// and LiveCounts share one tested implementation.
enum CountParse {
    /// Number of rows in a response that is either a bare array or an object
    /// wrapping the array under a common key.
    static func rowCount(_ any: Any?) -> Int {
        if let arr = any as? [[String: Any]] { return arr.count }
        if let obj = any as? [String: Any] {
            for k in ["results", "calls", "data", "rows"] {
                if let arr = obj[k] as? [[String: Any]] { return arr.count }
            }
        }
        return 0
    }

    /// First integer found either directly or under one of `keys` in an object.
    static func intField(_ any: Any?, _ keys: [String]) -> Int {
        if let n = any as? Int { return n }
        if let obj = any as? [String: Any] {
            for k in keys { if let n = obj[k] as? Int { return n } }
        }
        return 0
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
./ios/run-workflow-tests.sh
```
Expected: PASS (test count increased by 5, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/CountParse.swift ios/RMPGFlexTester/RMPGFlexTesterTests/CountParseTests.swift ios/run-workflow-tests.sh
git commit --no-verify -m "ios(p2): CountParse pure helper for response row/int counts"
```

---

### Task 2: `ElapsedClock` pure helper (TDD)

**Files:**
- Create: `$SRC/ElapsedClock.swift`
- Create: `$TST/ElapsedClockTests.swift`
- Modify: `ios/run-workflow-tests.sh`

- [ ] **Step 1: Write the failing test**

Create `$TST/ElapsedClockTests.swift`:
```swift
import XCTest
@testable import RMPGFlexTester

final class ElapsedClockTests: XCTestCase {
    func testParsesD1UTCTimestamp() {
        // D1 datetime('now') format, no timezone suffix → treated as UTC.
        let d = ElapsedClock.parseUTC("2026-06-15 14:30:00")
        XCTAssertNotNil(d)
        XCTAssertEqual(d!.timeIntervalSince1970, 1781274600, accuracy: 1)
    }
    func testParsesISO8601() {
        let d = ElapsedClock.parseUTC("2026-06-15T14:30:00Z")
        XCTAssertNotNil(d)
        XCTAssertEqual(d!.timeIntervalSince1970, 1781274600, accuracy: 1)
    }
    func testParseNilAndGarbage() {
        XCTAssertNil(ElapsedClock.parseUTC(nil))
        XCTAssertNil(ElapsedClock.parseUTC(""))
        XCTAssertNil(ElapsedClock.parseUTC("not a date"))
    }
    func testElapsedUnderOneHourIsMinutesSeconds() {
        let start = Date(timeIntervalSince1970: 1000)
        XCTAssertEqual(ElapsedClock.elapsed(since: start, now: Date(timeIntervalSince1970: 1000 + 5)), "0m 05s")
        XCTAssertEqual(ElapsedClock.elapsed(since: start, now: Date(timeIntervalSince1970: 1000 + 12 * 60 + 4)), "12m 04s")
    }
    func testElapsedOverOneHourIsHoursMinutes() {
        let start = Date(timeIntervalSince1970: 1000)
        XCTAssertEqual(ElapsedClock.elapsed(since: start, now: Date(timeIntervalSince1970: 1000 + 3600 + 23 * 60)), "1h 23m")
    }
    func testElapsedNeverNegative() {
        let start = Date(timeIntervalSince1970: 2000)
        XCTAssertEqual(ElapsedClock.elapsed(since: start, now: Date(timeIntervalSince1970: 1000)), "0m 00s")
    }
}
```

- [ ] **Step 2: Register in the harness, then run to verify it fails**

In `ios/run-workflow-tests.sh`, add `ElapsedClock` to `SOURCES=(...)` and `ElapsedClockTests` to `TESTS=(...)`.

Run:
```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
./ios/run-workflow-tests.sh
```
Expected: FAIL — "cannot find 'ElapsedClock' in scope".

- [ ] **Step 3: Write the implementation**

Create `$SRC/ElapsedClock.swift`:
```swift
import Foundation

// Pure parsing + formatting for live duration displays (shift timer, active-call
// timer). Server timestamps are UTC: either D1's "YYYY-MM-DD HH:MM:SS" (no zone)
// or ISO8601 with a zone. SwiftUI drives the `now` via TimelineView.
enum ElapsedClock {
    private static let d1: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f
    }()
    private static let iso = ISO8601DateFormatter()

    /// Parse a UTC server timestamp in either supported format. nil on failure.
    static func parseUTC(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        if let d = d1.date(from: s) { return d }
        return iso.date(from: s)
    }

    /// "1h 23m" once an hour has passed, otherwise "12m 04s". Clamped at zero.
    static func elapsed(since start: Date, now: Date) -> String {
        let secs = max(0, Int(now.timeIntervalSince(start)))
        let h = secs / 3600, m = (secs % 3600) / 60, s = secs % 60
        if h > 0 { return "\(h)h \(String(format: "%02d", m))m" }
        return "\(m)m \(String(format: "%02d", s))s"
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
./ios/run-workflow-tests.sh
```
Expected: PASS (test count +6, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/ElapsedClock.swift ios/RMPGFlexTester/RMPGFlexTesterTests/ElapsedClockTests.swift ios/run-workflow-tests.sh
git commit --no-verify -m "ios(p2): ElapsedClock pure helper (parse UTC + format elapsed)"
```

---

### Task 3: `LiveCounts` observable poller

**Files:**
- Create: `$SRC/LiveCounts.swift`

- [ ] **Step 1: Write the implementation**

Create `$SRC/LiveCounts.swift`:
```swift
import Foundation

// App-wide live counts for tab badges + the Home dashboard. Polls the two cheap
// counts every 15s independent of which screen is visible, so the badge is fresh
// even when Home isn't on top. Reuses the shared authedClient() and CountParse.
@MainActor
final class LiveCounts: ObservableObject {
    static let shared = LiveCounts()

    @Published private(set) var activeCalls = 0
    @Published private(set) var unread = 0

    private var polling = false
    private init() {}

    func startPolling() {
        guard !polling else { return }
        polling = true
        Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(15))
            }
        }
    }

    func refresh() async {
        guard let c = await authedClient() else { return }
        if let calls = try? await c.requestJSON("GET", "api/dispatch/calls?status=active") {
            activeCalls = CountParse.rowCount(calls)
        }
        if let u = try? await c.requestJSON("GET", "api/notifications/unread-count") {
            unread = CountParse.intField(u, ["count", "unread", "unread_count", "total"])
        }
    }
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "ios/RMPGFlexTester/RMPGFlexTester"
xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator -typecheck *.swift
```
Expected: clean (no errors). Then `cd` back to repo root.

- [ ] **Step 3: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/LiveCounts.swift
git commit --no-verify -m "ios(p2): LiveCounts observable polling active-calls + unread"
```

---

### Task 4: `GPSStatusPill`

**Files:**
- Create: `$SRC/GPSStatusPill.swift`

- [ ] **Step 1: Write the implementation**

Create `$SRC/GPSStatusPill.swift` (mirrors the compact pill style of `MDTStatusPill`):
```swift
import SwiftUI
import CoreLocation

// Compact GPS-fix indicator: green when accuracy is tight, gold when coarse,
// neutral when there's no fix yet. Observes the shared LocationManager.
struct GPSStatusPill: View {
    @ObservedObject private var location = LocationManager.shared

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 7, height: 7)
            Image(systemName: "location.fill")
                .font(.system(size: 10)).foregroundStyle(color)
            Text(label).font(.system(size: 10, weight: .semibold)).foregroundStyle(color)
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(Theme.raised)
        .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }

    private var accuracy: CLLocationAccuracy? {
        guard let acc = location.last?.horizontalAccuracy, acc >= 0 else { return nil }
        return acc
    }
    private var color: Color {
        guard let acc = accuracy else { return Theme.neutral }
        return acc <= 15 ? Theme.green : Theme.gold
    }
    private var label: String {
        guard let acc = accuracy else { return "NO GPS" }
        return "GPS ±\(Int(acc))m"
    }
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "ios/RMPGFlexTester/RMPGFlexTester"
xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator -typecheck *.swift
```
Expected: clean. Then `cd` back to repo root.

- [ ] **Step 3: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/GPSStatusPill.swift
git commit --no-verify -m "ios(p2): GPSStatusPill fix-quality indicator"
```

---

### Task 5: `App.swift` — tab badges + start LiveCounts + More-hub Alerts chip

**Files:**
- Modify: `$SRC/App.swift`

- [ ] **Step 1: Replace the entire file contents**

Replace `$SRC/App.swift` with:
```swift
import SwiftUI

@main
struct RMPGFlexTesterApp: App {
    @StateObject private var session = AuthSession()
    init() { Theme.configureAppearance() }

    var body: some Scene {
        WindowGroup {
            Group {
                if session.isAuthenticated {
                    MainTabView()
                } else {
                    LoginView()
                }
            }
            .environmentObject(session)
            .tint(Theme.gold)
            .preferredColorScheme(.dark)
            .background(Theme.base)
        }
    }
}

// The signed-in app shell: 5 tabs with live badges. Field Ops badges the active
// call count; More badges unread notifications. Counts come from LiveCounts
// (polled app-wide) so badges stay fresh regardless of the visible tab.
struct MainTabView: View {
    @ObservedObject private var counts = LiveCounts.shared

    var body: some View {
        TabView {
            DashboardView()
                .tabItem { Label("Home", systemImage: "house.fill") }
            FieldOpsView()
                .tabItem { Label("Field Ops", systemImage: "shield.lefthalf.filled") }
                .badge(counts.activeCalls)
            IDScanView()
                .tabItem { Label("ID Scan", systemImage: "person.text.rectangle") }
            FieldToolkitView()
                .tabItem { Label("Toolkit", systemImage: "square.grid.3x3.fill") }
            MoreHubView()
                .tabItem { Label("More", systemImage: "ellipsis.circle.fill") }
                .badge(counts.unread)
        }
        .tint(Theme.gold)
        .task {
            MDTLink.shared.startPolling()
            LiveCounts.shared.startPolling()
            _ = OfflineSync.shared
        }
    }
}

// Themed hub for the non-primary officer surfaces, grouped into labeled sections.
struct MoreHubView: View {
    @EnvironmentObject var session: AuthSession
    @ObservedObject private var counts = LiveCounts.shared

    private struct Entry: Identifiable {
        let id: String
        let title: String
        let subtitle: String
        let icon: String
        let badge: Int
        let destination: AnyView
    }
    private struct HubSection: Identifiable {
        let id: String
        let header: String
        let entries: [Entry]
    }

    // Built per-render so the Live Alerts row can carry the current unread count.
    private var sections: [HubSection] {
        [
            HubSection(id: "patrol", header: "Patrol", entries: [
                Entry(id: "roster", title: "Duty Roster",
                      subtitle: "On/off duty · time entries",
                      icon: "person.3.fill", badge: 0, destination: AnyView(DutyRosterView())),
                Entry(id: "alerts", title: "Live Alerts",
                      subtitle: "Calls · BOLOs · watchlist hits — one ranked feed",
                      icon: "bell.badge.waveform.fill", badge: counts.unread, destination: AnyView(AlertsFeedView())),
                Entry(id: "watchlist", title: "Watchlist",
                      subtitle: "Subjects you're watching · alerts on new activity",
                      icon: "binoculars.fill", badge: 0, destination: AnyView(WatchlistView())),
                Entry(id: "fleet", title: "Fleet Readiness",
                      subtitle: "Out-of-service · maintenance · inspection-overdue · ready",
                      icon: "car.2.fill", badge: 0, destination: AnyView(FleetReadinessView())),
            ]),
            HubSection(id: "reports", header: "Reports & Records", entries: [
                Entry(id: "dar", title: "Daily Activity Report",
                      subtitle: "Auto-compiled shift report · review + sign",
                      icon: "doc.text.below.ecg.fill", badge: 0, destination: AnyView(DailyActivityReportView())),
                Entry(id: "recorder", title: "Recorder",
                      subtitle: "Record interaction audio for evidence",
                      icon: "mic.fill", badge: 0, destination: AnyView(RecorderView())),
            ]),
            HubSection(id: "account", header: "Account", entries: [
                Entry(id: "myid", title: "My Officer ID",
                      subtitle: "Your digital badge + live verification QR",
                      icon: "person.text.rectangle.fill", badge: 0, destination: AnyView(WalletIDView())),
                Entry(id: "settings", title: "Settings",
                      subtitle: "RMPG login · Verifier token",
                      icon: "gearshape", badge: 0, destination: AnyView(SettingsView())),
            ]),
        ]
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    ForEach(sections) { section in
                        VStack(spacing: 6) {
                            SectionHeader(title: section.header)
                            ForEach(section.entries) { e in
                                NavigationLink {
                                    e.destination
                                        .navigationBarTitleDisplayMode(.inline)
                                } label: {
                                    HStack(spacing: 10) {
                                        Image(systemName: e.icon)
                                            .font(.system(size: 16))
                                            .foregroundStyle(Theme.gold)
                                            .frame(width: 28)
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(e.title)
                                                .font(.system(size: 13, weight: .semibold))
                                                .foregroundStyle(.white)
                                            Text(e.subtitle)
                                                .font(.system(size: 10))
                                                .foregroundStyle(Theme.neutral)
                                                .lineLimit(1)
                                        }
                                        Spacer()
                                        if e.badge > 0 {
                                            Text("\(e.badge)")
                                                .font(.system(size: 9, weight: .heavy)).foregroundStyle(.black)
                                                .padding(.horizontal, 5).padding(.vertical, 1)
                                                .background(Theme.red).clipShape(Capsule())
                                        }
                                        Image(systemName: "chevron.right")
                                            .font(.system(size: 11, weight: .semibold))
                                            .foregroundStyle(Theme.neutral)
                                    }
                                    .themeCard()
                                }
                            }
                        }
                    }

                    VStack(spacing: 6) {
                        Button { session.lock() } label: {
                            Label("Lock", systemImage: "lock.fill")
                        }.buttonStyle(RaisedButtonStyle())
                        Button(role: .destructive) { session.signOut() } label: {
                            Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                                .frame(maxWidth: .infinity)
                                .font(.system(size: 11, weight: .semibold))
                        }
                        .foregroundStyle(Theme.red)
                        .padding(.vertical, 8)
                    }
                    .padding(.top, 8)

                    Text("RMPG FLEX FIELD · \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev") · api.rmpgutah.us")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(Theme.neutral)
                        .padding(.top, 12)
                }
                .padding(12)
            }
            .background(Theme.base)
            .navigationTitle("MORE")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
```

Note vs Phase 1: `MainTabView` now `@ObservedObject`s `LiveCounts.shared`, badges Field Ops + More, and starts `LiveCounts.shared.startPolling()`; `Entry` gains a `badge: Int` field; `sections` reverts from `let` to a computed `var` (it now depends on `counts.unread`); the Live Alerts row renders a red count chip when `badge > 0`.

- [ ] **Step 2: Typecheck**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "ios/RMPGFlexTester/RMPGFlexTester"
xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator -typecheck *.swift
```
Expected: clean. Then `cd` back to repo root.

- [ ] **Step 3: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/App.swift
git commit --no-verify -m "ios(p2): live tab badges + More-hub Alerts chip via LiveCounts"
```

---

### Task 6: `DashboardView` — timers, active-call card, contextual banner, GPS pill

**Files:**
- Modify: `$SRC/DashboardView.swift`

- [ ] **Step 1: Replace the entire file contents**

Replace `$SRC/DashboardView.swift` with:
```swift
import SwiftUI
import AudioToolbox

// DashboardView — the post-login home. State-aware: shows a running shift timer
// when on duty, a live-timer active-call card when on a call, a contextual
// primary action (Start Shift / Open Call), connectivity + GPS pills, and quick
// tiles. Counts come from the app-wide LiveCounts so they match the tab badges.
struct DashboardView: View {
    @ObservedObject private var counts = LiveCounts.shared
    @Environment(\.scenePhase) private var scenePhase

    @State private var onShift = false
    @State private var callSign: String?
    @State private var unitStatus = ""
    @State private var myCallNumber: String?
    @State private var shiftClockIn: Date?
    @State private var activeCallStartedAt: Date?
    @State private var loading = true
    @State private var status: String?
    @State private var confirmPanic = false
    @State private var showCommand = false

    private var officerName: String { JWTClaims.current()?.name ?? "Officer" }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    HStack(spacing: 6) { OfflineStatusPill(); MDTStatusPill(); GPSStatusPill(); Spacer() }
                    commandBar
                    greeting
                    contextualBanner
                    statRow
                    quickActions
                    panicButton
                    if let status { StatusLine(text: status) }
                }
                .padding(12)
            }
            .background(Theme.base)
            .navigationTitle("HOME")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await refresh() }
            .task {
                await refresh(); loading = false
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(15))
                    await refresh()
                }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await refresh() } }
            }
            .alert("SEND PANIC ALARM?", isPresented: $confirmPanic) {
                Button("SEND PANIC", role: .destructive) { Task { await panic() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This creates a Priority-1 OFFICER ASSIST call on the dispatch board.")
            }
            .sheet(isPresented: $showCommand) { CommandSearchView() }
        }
    }

    private var commandBar: some View {
        Button { showCommand = true } label: {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundStyle(Theme.gold)
                Text("Search anyone · plate · call · warrant…")
                    .font(.system(size: 12)).foregroundStyle(Theme.neutral)
                Spacer()
                Image(systemName: "command").font(.system(size: 12)).foregroundStyle(Theme.neutral)
            }
            .padding(10).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(greetingPrefix + ", \(officerName)")
                .font(.system(size: 18, weight: .semibold)).foregroundStyle(.white)
            HStack(spacing: 6) {
                Circle().fill(onShift ? Theme.green : Theme.neutral).frame(width: 8, height: 8)
                Text(onShift
                     ? "ON DUTY · \(callSign ?? "—") · \(FieldFormat.value("status", unitStatus))"
                     : "OFF DUTY")
                    .font(.system(size: 11)).foregroundStyle(Theme.neutral)
                if onShift, let start = shiftClockIn {
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        Text("· ⏱ \(ElapsedClock.elapsed(since: start, now: ctx.date))")
                            .font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.gold)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeCard()
    }

    // State-aware primary action: off duty → Start Shift (→ Field Ops); on a call
    // → a live-timer active-call card (→ Calls Queue). Idle on duty → nothing.
    @ViewBuilder private var contextualBanner: some View {
        if !onShift {
            NavigationLink { FieldOpsView() } label: {
                HStack(spacing: 8) {
                    Image(systemName: "play.circle.fill").font(.system(size: 18)).foregroundStyle(.black)
                    Text("START SHIFT").font(.system(size: 14, weight: .heavy)).foregroundStyle(.black)
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(.black)
                }
                .padding(.horizontal, 12).padding(.vertical, 12)
                .background(Theme.gold).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            }
            .buttonStyle(.plain)
        } else if let call = myCallNumber {
            NavigationLink { CallsQueueView() } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("MY ACTIVE CALL").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.neutral)
                        Spacer()
                        if let s = activeCallStartedAt {
                            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                                Text("⏱ \(ElapsedClock.elapsed(since: s, now: ctx.date))")
                                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.green)
                            }
                        }
                    }
                    HStack {
                        Text(call).font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                        Spacer()
                        Text("OPEN").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.gold)
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.neutral)
                    }
                }
                .themeCard()
            }
            .buttonStyle(.plain)
        }
    }

    private var statRow: some View {
        HStack(spacing: 8) {
            stat("\(counts.activeCalls)", "Active Calls", Theme.gold)
            stat("\(counts.unread)", "Unread", counts.unread > 0 ? Theme.orange : Theme.neutral)
            stat(myCallNumber ?? "—", "My Call", myCallNumber != nil ? Theme.green : Theme.neutral)
        }
    }

    private func stat(_ value: String, _ label: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.system(size: 20, weight: .bold)).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.5)
            Text(label.uppercased()).font(.system(size: 8, weight: .semibold)).foregroundStyle(Theme.neutral)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 10).themeCard()
    }

    private var quickActions: some View {
        VStack(spacing: 8) {
            SectionHeader(title: "Quick Actions")
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                tile("Workflows", "square.stack.3d.up.fill") { WorkflowHubView() }
                tile("Calls", "list.bullet.rectangle.fill", badge: counts.activeCalls) { CallsQueueView() }
                tile("Alerts", "bell.badge.fill", badge: counts.unread) { NotificationsView() }
                tile("Scan ID", "qrcode.viewfinder") { IDScanView() }
                tile("Lookup", "magnifyingglass") { PersonSearchView() }
                tile("Units Map", "map.fill") { UnitsMapView() }
                tile("My ID", "person.text.rectangle.fill") { WalletIDView() }
            }
        }
    }

    private func tile<D: View>(_ title: String, _ icon: String, badge: Int = 0,
                               @ViewBuilder _ dest: @escaping () -> D) -> some View {
        NavigationLink { dest() } label: {
            VStack(spacing: 6) {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: icon).font(.system(size: 22)).foregroundStyle(Theme.gold)
                        .frame(maxWidth: .infinity)
                    if badge > 0 {
                        Text("\(badge)").font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
                            .padding(4).background(Theme.red).clipShape(Circle()).offset(x: 6, y: -6)
                    }
                }
                Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 16).themeCard()
        }
        .buttonStyle(.plain)
    }

    private var panicButton: some View {
        Button { confirmPanic = true } label: {
            Text("⚠ PANIC")
                .font(.system(size: 16, weight: .heavy))
                .frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(Theme.red).foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
        .padding(.top, 4)
    }

    private var greetingPrefix: String {
        let h = Calendar.current.component(.hour, from: Date())
        switch h { case 5..<12: return "Good morning"; case 12..<17: return "Good afternoon"; default: return "Good evening" }
    }

    // ── Networking ──────────────────────────────────────────
    private func authed(_ work: (RMPGAPIClient) async throws -> Void) async {
        guard let c = await authedClient() else { status = "✗ Set RMPG credentials in Settings"; return }
        do { try await work(c) } catch { status = "✗ \(error.localizedDescription)" }
    }

    @MainActor
    private func refresh() async {
        await authed { c in
            if let duty = try await c.requestJSON("GET", "api/dispatch/duty/me") as? [String: Any] {
                onShift = duty["on_shift"] as? Bool ?? false
                shiftClockIn = ElapsedClock.parseUTC((duty["time_entry"] as? [String: Any])?["clock_in"] as? String)
                if let unit = duty["unit"] as? [String: Any] {
                    callSign = unit["call_sign"] as? String
                    unitStatus = unit["status"] as? String ?? ""
                    if let cid = unit["current_call_id"] as? Int {
                        let call = try? await c.requestJSON("GET", "api/dispatch/calls/\(cid)") as? [String: Any]
                        myCallNumber = (call?["call_number"] as? String) ?? "#\(cid)"
                        activeCallStartedAt = ElapsedClock.parseUTC(
                            (call?["created_at"] as? String) ?? (call?["received_at"] as? String) ?? (call?["dispatched_at"] as? String))
                    } else { myCallNumber = nil; activeCallStartedAt = nil }
                } else { callSign = nil; unitStatus = ""; myCallNumber = nil; activeCallStartedAt = nil }
            }
        }
        await counts.refresh()
    }

    @MainActor
    private func panic() async {
        Haptics.error()
        AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
        await authed { c in
            try await c.requestJSON("POST", "api/dispatch/panic", body: ["trigger_method": "ios_dashboard"])
            status = "✓ PANIC SENT — P1 officer assist on the board"
        }
    }
}
```

Key changes vs Phase 1: removed local `activeCalls`/`unread` state, `client()`, `rowCount()`, `intField()` (counts now come from `LiveCounts` + `CountParse`); added `shiftClockIn`/`activeCallStartedAt`, `GPSStatusPill` in the pill row, a `contextualBanner`, live `TimelineView` timers in `greeting` + the active-call card, and `.onChange(of: scenePhase)` refresh-on-foreground. `refresh()` now also parses the timestamps and calls `counts.refresh()` so pull-to-refresh updates the counts immediately.

- [ ] **Step 2: Typecheck**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "ios/RMPGFlexTester/RMPGFlexTester"
xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator -typecheck *.swift
```
Expected: clean. Then `cd` back to repo root.

- [ ] **Step 3: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/DashboardView.swift
git commit --no-verify -m "ios(p2): state-aware Home — live timers, active-call card, contextual action, GPS pill"
```

---

### Task 7: `FieldOpsView` — add the GPS pill to its header

**Files:**
- Modify: `$SRC/FieldOpsView.swift`

- [ ] **Step 1: Find the existing status-pill row**

Read `$SRC/FieldOpsView.swift` and locate where it renders `OfflineStatusPill()` and/or `MDTStatusPill()` (the header status row, near the top of `body`). FieldOps already holds `@StateObject private var location = LocationManager.shared`.

- [ ] **Step 2: Add `GPSStatusPill()` to that row**

In the `HStack` that renders the existing pills, add `GPSStatusPill()` immediately after the existing pill(s) and before any `Spacer()`. Concretely, if the row reads:
```swift
HStack(spacing: 6) { OfflineStatusPill(); MDTStatusPill(); Spacer() }
```
change it to:
```swift
HStack(spacing: 6) { OfflineStatusPill(); MDTStatusPill(); GPSStatusPill(); Spacer() }
```
If FieldOps' pill row differs (e.g. only `OfflineStatusPill()`), insert `GPSStatusPill()` adjacent to the existing pill(s) in the same `HStack`, matching the surrounding style. If there is no pill row at all, add `HStack(spacing: 6) { GPSStatusPill(); Spacer() }` as the first child of the top-level `VStack` inside `body`. Make the minimal edit; do not restructure the view.

- [ ] **Step 3: Typecheck**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "ios/RMPGFlexTester/RMPGFlexTester"
xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator -typecheck *.swift
```
Expected: clean. Then `cd` back to repo root.

- [ ] **Step 4: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/FieldOpsView.swift
git commit --no-verify -m "ios(p2): GPS pill on Field Ops header"
```

---

### Task 8: Full verification

**Files:** none (verification + delivery)

- [ ] **Step 1: Full-app typecheck**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "ios/RMPGFlexTester/RMPGFlexTester"
xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator -typecheck *.swift
```
Expected: clean (no errors). If unrelated pre-existing errors appear in files this plan did not touch, capture them and report rather than claiming success.

- [ ] **Step 2: Unit harness**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
./ios/run-workflow-tests.sh
```
Expected: PASS — prior 78 tests + 5 (`CountParse`) + 6 (`ElapsedClock`) = **89 tests, 0 failures**.

- [ ] **Step 3: Confirm no leftover `client()`/`rowCount`/`intField` in DashboardView**

```bash
grep -n "private func client()\|func rowCount\|func intField" ios/RMPGFlexTester/RMPGFlexTester/DashboardView.swift
```
Expected: no output (they were removed; logic moved to `authedClient()`/`CountParse`).

- [ ] **Step 4: Stop here — do NOT push or open a PR.** Report the verification output for review.

---

## Self-Review

**Spec coverage (Phase 2 real-gaps scope):**
- Live tab badges → Task 5 (Field Ops = activeCalls, More = unread) ✓
- Shared `LiveCounts` source → Task 3 ✓
- More-hub row chip (Alerts) → Task 5 ✓
- Live shift timer → Task 6 (`greeting` TimelineView) ✓
- Active-call card with live timer → Task 6 (`contextualBanner`) ✓
- GPS pill → Tasks 4 (component), 6 (Home), 7 (Field Ops) ✓
- State-aware quick actions → Task 6 (`contextualBanner`: Start Shift / Open Call) ✓
- Refresh-on-foreground → Task 6 (`.onChange(of: scenePhase)`) ✓
- Pull-to-refresh → already done (no task; documented in Scope notes) ✓
- Swipe-on-calls → descoped (documented in Scope notes) ✓

**Placeholder scan:** none — pure helpers have full test + impl; SwiftUI files have full replacement code; the one targeted edit (Task 7) shows the exact before/after with a fallback for layout variation.

**Type consistency:** `LiveCounts.shared.activeCalls`/`.unread` (Task 3) are what `MainTabView` and `MoreHubView` (Task 5) and `DashboardView` (Task 6) read. `CountParse.rowCount`/`.intField` (Task 1) used by `LiveCounts` (Task 3). `ElapsedClock.parseUTC`/`.elapsed` (Task 2) used by `DashboardView` (Task 6). `GPSStatusPill` (Task 4) used by Tasks 6 + 7. `Entry.badge: Int` added in Task 5 is set on every `Entry` initializer in that same file. `authedClient()` is the existing shared global (grounded in `AuthedClient.swift`).

**Out of scope (later phases):** advanced roster + vehicle automation (Phase 3); field-tool enhancements (Phase 4); watchlist-hit / fleet-not-ready hub chips (deferred — need dedicated polls).
