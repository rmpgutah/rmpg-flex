# iOS R2 — Emergency-Responder UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the iOS field app responder-grade UX — a Dynamic-Type-aware type scale, always-reachable PANIC + status, hardware-button panic, and spoken readback of priority calls — without touching the workflow engine (that's R3).

**Architecture:** A new token layer in `Theme.swift` (`Typography`, `Spacing`, button size variants, a `minTouchTarget` modifier) is the foundation everything inherits. A reusable `ResponderActionBar` is pinned via `.safeAreaInset(edge:.bottom)` on Field Ops (status + PANIC) and Dashboard (PANIC-only), replacing the buried mid-scroll controls. A pure `SpokenAlert` helper (unit-tested) + an `AVSpeechSynthesizer`-backed `SpeechAnnouncer` read priority calls aloud. The existing `PanicIntent` is hardened to fire while locked and surfaced by an in-app setup helper for Back Tap / Action Button.

**Tech Stack:** SwiftUI, UIKit (`UIFontMetrics`), AVFoundation (`AVSpeechSynthesizer`), AppIntents. Build via `swiftc` (xcodebuild deadlocks on this Mac); pure-logic tests via the SwiftPM harness `ios/run-workflow-tests.sh`.

**Spec:** [`docs/superpowers/specs/2026-06-15-ios-steelblue-r2-responder-ux-design.md`](../specs/2026-06-15-ios-steelblue-r2-responder-ux-design.md)

**Scope note (extension of spec §C):** The spec scoped the action bar to Field Ops. The same buried-panic problem exists on the home Dashboard (`DashboardView.swift:192`). Because the component already needs a PANIC-only mode, Task 8 also mounts it on Dashboard. This is a deliberate, flagged extension.

**Conventions used by every task:**
- iOS source dir: `ios/RMPGFlexTester/RMPGFlexTester/` (referred to below as `SRC/`).
- Test dir: `ios/RMPGFlexTester/RMPGFlexTesterTests/`.
- **Whole-module typecheck (no device):**
  ```bash
  cd "ios" && export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer && \
    xcrun -sdk iphoneos swiftc -target arm64-apple-ios17.0 -typecheck RMPGFlexTester/RMPGFlexTester/*.swift
  ```
  Expected: exits 0, no output. (A single-file `swiftc` fails — SwiftUI views need the whole module + SDK.)
- **Pure-logic tests:** `./ios/run-workflow-tests.sh` (expects `DEVELOPER_DIR` set as above).
- **Device build/install:** `./ios/refresh-device.sh --force` (skips quietly if the iPhone isn't connected).
- iOS-only: **no migration, no service-worker bump.** Commit after every task.

---

### Task 1: Type system — `Theme.Typography` + `Theme.Spacing`

**Files:**
- Modify: `SRC/Theme.swift` (add two nested enums inside `enum Theme`, after `radius`/`groupHead`)

- [ ] **Step 1: Add the Typography + Spacing token layer**

In `SRC/Theme.swift`, insert the following **after** the `static var groupHead: LinearGradient { … }` computed property (around line 41) and **before** `static func configureAppearance()`:

```swift
    /// Named type roles at the Responder scale. Each is scaled by Dynamic Type
    /// relative to a system text style, so it honors the officer's text-size +
    /// accessibility settings while keeping our exact base size + weight (and
    /// the monospaced Spillman feel where it matters). SwiftUI's plain
    /// `.system(size:)` does NOT auto-scale — this layer is why the scale honors
    /// Dynamic Type instead of being fixed pt values.
    enum Typography {
        static func scaled(_ size: CGFloat, _ weight: Font.Weight,
                           relativeTo style: UIFont.TextStyle,
                           monospaced: Bool = false) -> Font {
            let s = UIFontMetrics(forTextStyle: style).scaledValue(for: size)
            return .system(size: s, weight: weight, design: monospaced ? .monospaced : .default)
        }
        static var display: Font   { scaled(28, .heavy,    relativeTo: .largeTitle) }
        static var title: Font     { scaled(22, .heavy,    relativeTo: .title1) }
        static var headline: Font  { scaled(17, .semibold, relativeTo: .title3) }
        static var body: Font      { scaled(16, .regular,  relativeTo: .body) }
        static var label: Font     { scaled(13, .semibold, relativeTo: .subheadline) }
        static var caption: Font   { scaled(12, .regular,  relativeTo: .caption1) }
        static var mono: Font      { scaled(16, .regular,  relativeTo: .body, monospaced: true) }
        static var monoLarge: Font { scaled(18, .semibold, relativeTo: .title3, monospaced: true) }
    }

    /// Layout spacing scale, replacing the scattered 6/8/9/10/12/14pt literals.
    enum Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 6
        static let md: CGFloat = 8
        static let lg: CGFloat = 12
        static let xl: CGFloat = 16
        static let xxl: CGFloat = 20
    }
```

- [ ] **Step 2: Typecheck**

Run the whole-module typecheck command (see Conventions).
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add "ios/RMPGFlexTester/RMPGFlexTester/Theme.swift"
git commit -m "feat(ios): add Theme.Typography (Dynamic Type) + Theme.Spacing tokens"
```

---

### Task 2: Touch targets — button size variants + `minTouchTarget`

**Files:**
- Modify: `SRC/Theme.swift` (`GoldButtonStyle`, `RaisedButtonStyle`, add `ButtonSize` enum + `minTouchTarget` modifier)

- [ ] **Step 1: Add a `ButtonSize` enum + size param, enforce 44pt min height**

In `SRC/Theme.swift`, replace the entire `GoldButtonStyle` struct (lines ~103–113) and `RaisedButtonStyle` struct (lines ~116–127) with:

```swift
/// Size variants for the shared button styles. `.large` is for primary field
/// actions that must be hit one-handed; both enforce a 44pt minimum height.
enum ButtonSize { case regular, large }

/// Primary action: gold fill, black text, pressed-state dim.
struct GoldButtonStyle: ButtonStyle {
    var size: ButtonSize = .regular
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(size == .large ? Theme.Typography.headline : .system(size: 12, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.vertical, size == .large ? 14 : 9)
            .background(Theme.gold.opacity(configuration.isPressed ? 0.7 : 1))
            .foregroundStyle(.black)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }
}

/// Secondary action: raised surface, gold text, hairline border.
struct RaisedButtonStyle: ButtonStyle {
    var size: ButtonSize = .regular
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(size == .large ? Theme.Typography.headline : .system(size: 11, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.vertical, size == .large ? 13 : 8)
            .background(Theme.raised.opacity(configuration.isPressed ? 0.6 : 1))
            .foregroundStyle(Theme.gold)
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }
}
```

- [ ] **Step 2: Add the `minTouchTarget` modifier**

In `SRC/Theme.swift`, add to the existing `extension View { … }` block (the one with `themeCard()`, ~lines 141–143):

```swift
    /// Guarantee at least a 44×44pt hit area (Apple HIG minimum) for compact /
    /// icon-only controls.
    func minTouchTarget(_ side: CGFloat = 44) -> some View {
        frame(minWidth: side, minHeight: side).contentShape(Rectangle())
    }
```

- [ ] **Step 3: Typecheck**

Run the whole-module typecheck command.
Expected: exits 0. (All existing `GoldButtonStyle()` / `RaisedButtonStyle()` call sites still compile — the new `size` param defaults to `.regular`.)

- [ ] **Step 4: Commit**

```bash
git add "ios/RMPGFlexTester/RMPGFlexTester/Theme.swift"
git commit -m "feat(ios): button size variants + 44pt minTouchTarget modifier"
```

---

### Task 3: `SpokenAlert` pure helper (TDD)

**Files:**
- Create: `SRC/SpokenAlert.swift`
- Test: `ios/RMPGFlexTester/RMPGFlexTesterTests/SpokenAlertTests.swift`
- Modify: `ios/run-workflow-tests.sh` (register the new source + test)

- [ ] **Step 1: Write the failing test**

Create `ios/RMPGFlexTester/RMPGFlexTesterTests/SpokenAlertTests.swift`:

```swift
import XCTest
@testable import RMPGFlexTester

final class SpokenAlertTests: XCTestCase {
    func testPhraseFullCall() {
        let call: [String: Any] = [
            "priority": "P1",
            "incident_type": "disturbance",
            "weapons_involved": 1,
            "location_address": "1450 S State St",
        ]
        XCTAssertEqual(
            SpokenAlert.phrase(for: call),
            "New Priority 1. Disturbance. Weapons involved. 1450 South State Street.")
    }

    func testPhraseNoPriorityNoHazards() {
        let call: [String: Any] = ["incident_type": "welfare_check", "address": "200 E Center"]
        XCTAssertEqual(SpokenAlert.phrase(for: call), "New call. Welfare Check. 200 East Center.")
    }

    func testShouldSpeakThreshold() {
        XCTAssertTrue(SpokenAlert.shouldSpeak(callId: 5, isP1: true,  hasHazards: false, lastSpokenId: nil))
        XCTAssertTrue(SpokenAlert.shouldSpeak(callId: 5, isP1: false, hasHazards: true,  lastSpokenId: nil))
        XCTAssertFalse(SpokenAlert.shouldSpeak(callId: 5, isP1: false, hasHazards: false, lastSpokenId: nil))
        XCTAssertFalse(SpokenAlert.shouldSpeak(callId: 5, isP1: true,  hasHazards: true,  lastSpokenId: 5)) // dedup
    }

    func testSpokenAddressExpansion() {
        XCTAssertEqual(SpokenAlert.spokenAddress("1450 S State St"), "1450 South State Street")
        XCTAssertEqual(SpokenAlert.spokenAddress("88 W Temple Ave"), "88 West Temple Avenue")
    }

    func testPriorityParsing() {
        XCTAssertEqual(SpokenAlert.priorityNumber(["priority": "P2"]), 2)
        XCTAssertEqual(SpokenAlert.priorityNumber(["priority": 3]), 3)
        XCTAssertNil(SpokenAlert.priorityNumber([:]))
    }
}
```

- [ ] **Step 2: Register the source + test in the harness, run to verify it fails**

In `ios/run-workflow-tests.sh`, add `SpokenAlert` to the `SOURCES=(…)` array and `SpokenAlertTests` to the `TESTS=(…)` array (append to each list, line 15 and line 16):

```bash
SOURCES=(WorkflowModels WorkflowBody WorkflowValidation FieldValidation MultipartBody DictationState WorkflowRegistry MDTMessage OfflineSyncLogic NavStepFormat PhotoBurnLines CommandSearch AlertsFeed AlprResultParse EvidenceManifest CfsActionLibrary FleetReadiness AlprScanLog ShiftSummary VehicleInspection CountParse ElapsedClock PreTripStatus TimecardSummary SpokenAlert)
TESTS=(WorkflowModelsTests WorkflowBodyTests WorkflowValidationTests FieldValidationTests MultipartBodyTests WorkflowRegistryTests MDTMessageTests OfflineSyncLogicTests NavStepFormatTests PhotoBurnLinesTests CommandSearchTests AlertsFeedTests AlprResultParseTests EvidenceManifestTests CfsActionLibraryTests FleetReadinessTests AlprScanLogTests ShiftSummaryTests VehicleInspectionTests CountParseTests ElapsedClockTests PreTripStatusTests TimecardSummaryTests SpokenAlertTests)
```

Run: `./ios/run-workflow-tests.sh`
Expected: FAIL — `cannot find 'SpokenAlert' in scope` (source doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `SRC/SpokenAlert.swift` (Foundation-only — **must not** import SwiftUI/UIKit/AVFoundation, so the SwiftPM harness can build it):

```swift
import Foundation

/// Pure helpers that turn a CAD call dict into an eyes-free spoken phrase and
/// decide whether it's worth speaking. Kept Foundation-only so it unit-tests in
/// the SwiftPM harness; the AVSpeechSynthesizer wrapper lives in SpeechAnnouncer.
enum SpokenAlert {
    /// "New Priority 1. Disturbance. Weapons involved. 1450 South State Street."
    static func phrase(for call: [String: Any]) -> String {
        var parts: [String] = []
        if let p = priorityNumber(call) { parts.append("New Priority \(p).") }
        else { parts.append("New call.") }
        if let t = callType(call) { parts.append("\(t).") }
        for hz in hazardPhrases(call) { parts.append("\(hz).") }
        if let addr = address(call) { parts.append("\(spokenAddress(addr)).") }
        return parts.joined(separator: " ")
    }

    /// Speak only for Priority-1 or hazard-bearing calls, and only once per id.
    static func shouldSpeak(callId: Int, isP1: Bool, hasHazards: Bool, lastSpokenId: Int?) -> Bool {
        guard callId != lastSpokenId else { return false }
        return isP1 || hasHazards
    }

    static func priorityNumber(_ call: [String: Any]) -> Int? {
        if let i = call["priority"] as? Int { return i }
        if let s = call["priority"] as? String {
            let digits = s.filter(\.isNumber)
            return digits.isEmpty ? nil : Int(digits)
        }
        return nil
    }

    static func callType(_ call: [String: Any]) -> String? {
        guard let raw = (call["incident_type"] as? String) ?? (call["call_type"] as? String),
              !raw.isEmpty else { return nil }
        return raw.replacingOccurrences(of: "_", with: " ").capitalized
    }

    static func address(_ call: [String: Any]) -> String? {
        (call["location_address"] as? String) ?? (call["address"] as? String)
    }

    /// Expand common street abbreviations so TTS reads naturally.
    static func spokenAddress(_ raw: String) -> String {
        let map: [String: String] = [
            "N": "North", "S": "South", "E": "East", "W": "West",
            "NE": "Northeast", "NW": "Northwest", "SE": "Southeast", "SW": "Southwest",
            "St": "Street", "Ave": "Avenue", "Blvd": "Boulevard", "Dr": "Drive",
            "Ln": "Lane", "Rd": "Road", "Ct": "Court", "Pl": "Place",
            "Hwy": "Highway", "Cir": "Circle",
        ]
        return raw.split(separator: " ").map { token -> String in
            let cleaned = token.trimmingCharacters(in: CharacterSet(charactersIn: ".,"))
            return map[cleaned] ?? map[cleaned.capitalized] ?? String(token)
        }.joined(separator: " ")
    }

    private static let hazardFlags: [(key: String, phrase: String)] = [
        ("officer_safety_caution", "Officer safety caution"),
        ("weapons_involved", "Weapons involved"),
        ("felony_in_progress", "Felony in progress"),
        ("domestic_violence", "Domestic violence"),
        ("injuries_reported", "Injuries reported"),
        ("mental_health_crisis", "Mental health crisis"),
        ("drugs_involved", "Drugs involved"),
        ("alcohol_involved", "Alcohol involved"),
        ("juvenile_involved", "Juvenile involved"),
    ]

    static func hazardPhrases(_ call: [String: Any]) -> [String] {
        hazardFlags.compactMap { isTruthy(call[$0.key]) ? $0.phrase : nil }
    }

    static func isTruthy(_ v: Any?) -> Bool {
        if let i = v as? Int { return i != 0 }
        if let b = v as? Bool { return b }
        if let s = v as? String { return s == "1" || s.lowercased() == "true" }
        return false
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./ios/run-workflow-tests.sh`
Expected: PASS — `SpokenAlertTests` green, all other suites still green.

- [ ] **Step 5: Commit**

```bash
git add "ios/RMPGFlexTester/RMPGFlexTester/SpokenAlert.swift" \
        "ios/RMPGFlexTester/RMPGFlexTesterTests/SpokenAlertTests.swift" \
        "ios/run-workflow-tests.sh"
git commit -m "feat(ios): SpokenAlert pure helper for eyes-free call readback (TDD)"
```

---

### Task 4: `SpeechAnnouncer` (AVFoundation) + Settings toggle

**Files:**
- Create: `SRC/SpeechAnnouncer.swift`
- Modify: `SRC/SettingsView.swift`

- [ ] **Step 1: Create the announcer**

Create `SRC/SpeechAnnouncer.swift`:

```swift
import AVFoundation

/// Speaks a phrase aloud, ducking other audio (music / nav) briefly so it's
/// heard, then un-ducks when done. Not unit-tested (AV side effects); the
/// decision logic + phrasing live in the pure `SpokenAlert`.
final class SpeechAnnouncer: NSObject, AVSpeechSynthesizerDelegate {
    static let shared = SpeechAnnouncer()
    private let synth = AVSpeechSynthesizer()

    private override init() {
        super.init()
        synth.delegate = self
    }

    func speak(_ text: String) {
        guard !text.isEmpty else { return }
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        try? session.setActive(true)
        let u = AVSpeechUtterance(string: text)
        u.rate = AVSpeechUtteranceDefaultSpeechRate
        u.voice = AVSpeechSynthesisVoice(language: "en-US")
        synth.speak(u)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
```

- [ ] **Step 2: Add the Settings toggle (default ON)**

In `SRC/SettingsView.swift`, add an `@AppStorage` property after the existing `@State` properties (after line 8):

```swift
    @AppStorage("spokenAlertsEnabled") private var spokenAlertsEnabled = true
```

Then add a new `Section` in the `Form` immediately **after** the `WIRELESS ID (APPLE VERIFIER API)` section (after its closing `}` near line 24):

```swift
                Section("FIELD ALERTS") {
                    Toggle("Speak incoming priority calls", isOn: $spokenAlertsEnabled)
                    Text("Reads new Priority-1 and hazard calls aloud while you're on shift, so you can keep your eyes on the road.")
                        .font(Theme.Typography.caption).foregroundStyle(Theme.neutral)
                }
```

- [ ] **Step 3: Typecheck**

Run the whole-module typecheck command.
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add "ios/RMPGFlexTester/RMPGFlexTester/SpeechAnnouncer.swift" \
        "ios/RMPGFlexTester/RMPGFlexTester/SettingsView.swift"
git commit -m "feat(ios): SpeechAnnouncer (ducking TTS) + spoken-alerts Settings toggle"
```

---

### Task 5: Wire spoken readback into Field Ops

**Files:**
- Modify: `SRC/FieldOpsView.swift`

- [ ] **Step 1: Add a `spokenAlertsEnabled` reader**

In `SRC/FieldOpsView.swift`, add this computed property next to the other private computed vars (e.g. after `private var unitStatus: String { … }`, ~line 36):

```swift
    private var spokenAlertsEnabled: Bool {
        UserDefaults.standard.object(forKey: "spokenAlertsEnabled") as? Bool ?? true
    }
```

- [ ] **Step 2: Speak on a new priority/hazard call**

In `SRC/FieldOpsView.swift`, replace the new-call alert block inside `refresh()` (currently lines ~360–368):

```swift
                if callId != lastAlertedCallId, let call = myCall {
                    let p1 = ((call["priority"] as? String)?.contains("1") ?? false)
                        || ((call["priority"] as? Int) == 1)
                    if p1 || !hazards(call).isEmpty {
                        AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
                        Haptics.warning()
                    }
                    lastAlertedCallId = callId
                }
```

with:

```swift
                if callId != lastAlertedCallId, let call = myCall {
                    let p1 = ((call["priority"] as? String)?.contains("1") ?? false)
                        || ((call["priority"] as? Int) == 1)
                    let hasHazards = !hazards(call).isEmpty
                    if p1 || hasHazards {
                        AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
                        Haptics.warning()
                    }
                    if spokenAlertsEnabled, onShift,
                       SpokenAlert.shouldSpeak(callId: callId, isP1: p1,
                                               hasHazards: hasHazards, lastSpokenId: lastAlertedCallId) {
                        SpeechAnnouncer.shared.speak(SpokenAlert.phrase(for: call))
                    }
                    lastAlertedCallId = callId
                }
```

- [ ] **Step 3: Typecheck**

Run the whole-module typecheck command.
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add "ios/RMPGFlexTester/RMPGFlexTester/FieldOpsView.swift"
git commit -m "feat(ios): speak new priority/hazard calls aloud in Field Ops"
```

---

### Task 6: `ResponderActionBar` component

**Files:**
- Create: `SRC/ResponderActionBar.swift`

- [ ] **Step 1: Create the component**

Create `SRC/ResponderActionBar.swift`:

```swift
import SwiftUI

/// Persistent, scroll-proof critical-action bar for the responder surfaces.
/// Left: current unit status (tap → big-target slide-up picker). Right: PANIC.
/// `showStatus == false` collapses to a PANIC-only bar (off-duty / home).
struct ResponderActionBar: View {
    let currentStatus: String
    let statuses: [(String, String)]   // (value, label) — matches FieldOpsView.statuses
    var showStatus: Bool = true
    let onSelectStatus: (String) -> Void
    let onPanic: () -> Void

    @State private var showPicker = false

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            if showStatus {
                Button { Haptics.tap(); showPicker = true } label: {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(statusLabel(currentStatus))
                            .font(Theme.Typography.headline).foregroundStyle(Theme.green)
                        Text("tap to change ▾")
                            .font(Theme.Typography.caption).foregroundStyle(Theme.neutral)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Theme.Spacing.lg).padding(.vertical, Theme.Spacing.md)
                    .frame(minHeight: 52)
                    .background(Theme.raised)
                    .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                }
                .buttonStyle(.plain)
            }
            Button { onPanic() } label: {
                Text("⚠ PANIC")
                    .font(.system(size: 16, weight: .heavy))
                    .frame(maxWidth: showStatus ? 120 : .infinity, minHeight: 52)
                    .background(Theme.red).foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, Theme.Spacing.lg).padding(.vertical, Theme.Spacing.md)
        .background(Theme.sunken)
        .overlay(Rectangle().fill(Theme.borderStrong).frame(height: 1), alignment: .top)
        .sheet(isPresented: $showPicker) {
            statusPicker
                .presentationDetents([.height(CGFloat(statuses.count * 62 + 96))])
                .presentationBackground(Theme.base)
        }
    }

    private var statusPicker: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("SET UNIT STATUS")
                .font(Theme.Typography.label).foregroundStyle(Theme.neutral)
                .padding(.top, Theme.Spacing.xl)
            ForEach(statuses, id: \.0) { value, label in
                Button {
                    Haptics.tap(); onSelectStatus(value); showPicker = false
                } label: {
                    HStack {
                        Text(label).font(Theme.Typography.headline)
                        Spacer()
                        if value == currentStatus { Image(systemName: "checkmark") }
                    }
                    .foregroundStyle(value == currentStatus ? Color.black : Color.white)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Theme.Spacing.lg).frame(minHeight: 50)
                    .background(value == currentStatus ? Theme.gold : Theme.raised)
                    .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .padding(.horizontal, Theme.Spacing.lg)
    }

    private func statusLabel(_ value: String) -> String {
        statuses.first { $0.0 == value }?.1 ?? value.uppercased()
    }
}
```

- [ ] **Step 2: Typecheck**

Run the whole-module typecheck command.
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add "ios/RMPGFlexTester/RMPGFlexTester/ResponderActionBar.swift"
git commit -m "feat(ios): ResponderActionBar — pinned status + PANIC component"
```

---

### Task 7: Integrate the action bar into Field Ops

**Files:**
- Modify: `SRC/FieldOpsView.swift`

- [ ] **Step 1: Remove the mid-scroll status card from the body**

In `SRC/FieldOpsView.swift`, in `body`, delete this line (~line 49):

```swift
                    if onShift { statusCard }
```

- [ ] **Step 2: Remove the bottom-of-scroll panic button from the body**

In the same `VStack`, delete this line (~line 105):

```swift
                    panicButton
```

- [ ] **Step 3: Pin the action bar via safeAreaInset**

Attach a bottom safe-area inset to the `ScrollView`. Add this modifier immediately **after** `.background(Theme.base)` (~line 118) and before `.navigationTitle("FIELD OPS")`:

```swift
            .safeAreaInset(edge: .bottom) {
                ResponderActionBar(
                    currentStatus: unitStatus,
                    statuses: statuses,
                    showStatus: onShift,
                    onSelectStatus: { value in Task { await setStatus(value) } },
                    onPanic: { confirmPanic = true })
            }
```

- [ ] **Step 4: Delete the now-unused `statusCard` and `panicButton` definitions**

Delete the entire `private var statusCard: some View { … }` computed property (~lines 189–205) and the entire `private var panicButton: some View { … }` computed property (~lines 302–310). (`statuses`, `setStatus`, `confirmPanic`, the `.alert`, and `panic()` all stay — the bar drives them.)

- [ ] **Step 5: Typecheck**

Run the whole-module typecheck command.
Expected: exits 0, with no "unused"/"not found" errors (confirms `statusCard`/`panicButton` had no other references).

- [ ] **Step 6: Commit**

```bash
git add "ios/RMPGFlexTester/RMPGFlexTester/FieldOpsView.swift"
git commit -m "feat(ios): pin status + PANIC on Field Ops via ResponderActionBar"
```

---

### Task 8: Mount a PANIC-only bar on the home Dashboard (spec §C extension)

**Files:**
- Modify: `SRC/DashboardView.swift`

- [ ] **Step 1: Remove the bottom-of-scroll panic button from the body**

In `SRC/DashboardView.swift`, in `body`'s `VStack`, delete this line (~line 35):

```swift
                    panicButton
```

- [ ] **Step 2: Pin a PANIC-only action bar via safeAreaInset**

Add this modifier immediately **after** `.background(Theme.base)` (~line 40) and before `.navigationTitle("HOME")`:

```swift
            .safeAreaInset(edge: .bottom) {
                ResponderActionBar(
                    currentStatus: "",
                    statuses: [],
                    showStatus: false,
                    onSelectStatus: { _ in },
                    onPanic: { confirmPanic = true })
            }
```

- [ ] **Step 3: Delete the now-unused `panicButton` definition**

Delete the entire `private var panicButton: some View { … }` computed property (~lines 192–201). (`confirmPanic`, the `.alert`, and `panic()` stay.)

- [ ] **Step 4: Typecheck**

Run the whole-module typecheck command.
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add "ios/RMPGFlexTester/RMPGFlexTester/DashboardView.swift"
git commit -m "feat(ios): pin PANIC on home Dashboard via ResponderActionBar"
```

---

### Task 9: Hardware panic — lock-screen intent + setup helper

**Files:**
- Modify: `SRC/AppIntents.swift`
- Create: `SRC/HardwarePanicSetupView.swift`
- Modify: `SRC/SettingsView.swift`

- [ ] **Step 1: Let `PanicIntent` fire while the phone is locked**

In `SRC/AppIntents.swift`, in `struct PanicIntent`, add this line immediately after `static var openAppWhenRun = false` (~line 32):

```swift
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
```

- [ ] **Step 2: Create the in-app setup helper**

Create `SRC/HardwarePanicSetupView.swift`:

```swift
import SwiftUI
import UIKit

/// Walks the officer through binding a hardware panic trigger to the RMPG
/// "Panic" App Shortcut. iOS provides no deep link to the Back Tap / Action
/// Button panes, so this instructs + opens Settings; the officer sets the bind.
struct HardwarePanicSetupView: View {
    var body: some View {
        Form {
            Section("TRIPLE-TAP THE BACK") {
                step("1", "Settings → Accessibility → Touch → Back Tap")
                step("2", "Tap “Triple Tap”")
                step("3", "Choose Shortcuts → the “Panic” (RMPG) shortcut")
                Text("Triple-tap the back of the phone to fire a Priority-1 officer-assist — no screen, works in a pocket, even when the phone is locked.")
                    .font(Theme.Typography.caption).foregroundStyle(Theme.neutral)
            }
            Section("ACTION BUTTON") {
                step("1", "Settings → Action Button")
                step("2", "Swipe to “Shortcut”")
                step("3", "Pick the “Panic” (RMPG) shortcut")
                Text("One firm press of the Action button fires panic.")
                    .font(Theme.Typography.caption).foregroundStyle(Theme.neutral)
            }
            Section {
                Button("Open iOS Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
                .font(Theme.Typography.body).fontWeight(.semibold)
                Text("The “Panic” shortcut appears after the app has been installed through Xcode once (App Intents metadata extraction). If you don’t see it, ask the admin to run that build.")
                    .font(Theme.Typography.caption).foregroundStyle(Theme.neutral)
            }
        }
        .scrollContentBackground(.hidden).background(Theme.base)
        .navigationTitle("HARDWARE PANIC").navigationBarTitleDisplayMode(.inline)
    }

    private func step(_ n: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: Theme.Spacing.md) {
            Text(n).font(Theme.Typography.label).foregroundStyle(Theme.gold)
            Text(text).font(Theme.Typography.body).foregroundStyle(Theme.textPrimary)
        }
    }
}
```

- [ ] **Step 3: Add a Settings entry point**

In `SRC/SettingsView.swift`, add a new `Section` immediately **after** the `FIELD ALERTS` section added in Task 4:

```swift
                Section("EMERGENCY") {
                    NavigationLink("Set up hardware panic (Back Tap / Action Button)") {
                        HardwarePanicSetupView()
                    }
                }
```

- [ ] **Step 4: Typecheck**

Run the whole-module typecheck command.
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add "ios/RMPGFlexTester/RMPGFlexTester/AppIntents.swift" \
        "ios/RMPGFlexTester/RMPGFlexTester/HardwarePanicSetupView.swift" \
        "ios/RMPGFlexTester/RMPGFlexTester/SettingsView.swift"
git commit -m "feat(ios): lock-screen PanicIntent + hardware-panic setup helper"
```

---

### Task 10: Typography adoption — shared chrome + responder surfaces

**Files:**
- Modify: `SRC/Theme.swift`, `SRC/CallsQueueView.swift`, `SRC/NotificationsView.swift`, `SRC/DashboardView.swift`

- [ ] **Step 1: Route shared chrome through Typography**

In `SRC/Theme.swift`:

In `struct StatusLine`, replace `.font(.system(size: 11, design: .monospaced))` (~line 150) with:

```swift
            .font(Theme.Typography.mono)
```

In `struct SectionHeader`, replace `.font(.system(size: 10, weight: .semibold))` (~line 164) with:

```swift
                .font(Theme.Typography.label)
```

- [ ] **Step 2: Bump the glanceable values on Calls Queue**

In `SRC/CallsQueueView.swift`, in `callRow`:

Replace the call-type line (~line 92):

```swift
            Text(type).font(.system(size: 13, weight: .semibold)).foregroundStyle(mine ? Theme.gold : .white)
```

with:

```swift
            Text(type).font(Theme.Typography.headline).foregroundStyle(mine ? Theme.gold : .white)
```

Replace the address line (~line 93):

```swift
            if !addr.isEmpty { Text(addr).font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
```

with:

```swift
            if !addr.isEmpty { Text(addr).font(Theme.Typography.body).foregroundStyle(Theme.textSecondary) }
```

Give the ellipsis "Call actions" button a guaranteed hit area — replace its label block (~lines 107–110):

```swift
                Button { actionTarget = ActionTarget(id: id, number: callNo) } label: {
                    Image(systemName: "ellipsis.circle.fill")
                        .font(.system(size: 22)).foregroundStyle(Theme.gold)
                }
```

with:

```swift
                Button { actionTarget = ActionTarget(id: id, number: callNo) } label: {
                    Image(systemName: "ellipsis.circle.fill")
                        .font(.system(size: 22)).foregroundStyle(Theme.gold)
                        .minTouchTarget()
                }
```

- [ ] **Step 3: Bump the notification title**

In `SRC/NotificationsView.swift`, replace the title line (~line 67–68):

```swift
                        Text(title)
                            .font(.system(size: 13, weight: read ? .regular : .semibold))
```

with:

```swift
                        Text(title)
                            .font(Theme.Typography.headline).fontWeight(read ? .regular : .semibold)
```

- [ ] **Step 4: Bump the Dashboard greeting + stat values**

In `SRC/DashboardView.swift`:

Replace the greeting line (~line 81–82):

```swift
            Text(greetingPrefix + ", \(officerName)")
                .font(.system(size: 18, weight: .semibold)).foregroundStyle(.white)
```

with:

```swift
            Text(greetingPrefix + ", \(officerName)")
                .font(Theme.Typography.title).fontWeight(.semibold).foregroundStyle(.white)
```

Replace the stat value line in `stat(_:_:_:)` (~line 152):

```swift
            Text(value).font(.system(size: 20, weight: .bold)).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.5)
```

with:

```swift
            Text(value).font(Theme.Typography.title).fontWeight(.bold).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.5)
```

- [ ] **Step 5: Typecheck**

Run the whole-module typecheck command.
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add "ios/RMPGFlexTester/RMPGFlexTester/Theme.swift" \
        "ios/RMPGFlexTester/RMPGFlexTester/CallsQueueView.swift" \
        "ios/RMPGFlexTester/RMPGFlexTester/NotificationsView.swift" \
        "ios/RMPGFlexTester/RMPGFlexTester/DashboardView.swift"
git commit -m "feat(ios): adopt Typography on shared chrome + responder surfaces"
```

---

### Task 11: Full verification + device install

**Files:** none (verification only); optional bump in `ios/refresh-device.sh`.

- [ ] **Step 1: Pure-logic tests green**

Run: `./ios/run-workflow-tests.sh`
Expected: all suites pass, including `SpokenAlertTests` (5 tests). Prior 32 test files still green.

- [ ] **Step 2: Whole-module typecheck clean**

Run the whole-module typecheck command.
Expected: exits 0, no warnings about unused `statusCard`/`panicButton`.

- [ ] **Step 3: (Optional) bump the dev app version**

In `ios/refresh-device.sh`, change `<key>CFBundleShortVersionString</key><string>1.3</string>` to `1.4` (cosmetic; tracks the R2 build on-device).

- [ ] **Step 4: Build + install to the iPhone**

Run: `./ios/refresh-device.sh --force`
Expected: `swiftc` compiles the whole app, re-signs, installs, and launches on the connected iPhone 17 Pro. (If the phone isn't connected the script exits quietly — re-run when it is.)

- [ ] **Step 5: On-device eyeball checklist**

- Field Ops: action bar pinned above the tab bar; tap status → big-target picker slides up, selecting changes status + haptic; PANIC → confirm dialog.
- Home: PANIC pinned at the bottom, always visible.
- Settings → Field Alerts toggle present (on); Settings → Emergency → "Set up hardware panic" opens the helper and "Open iOS Settings" launches Settings.
- Spoken readback: with a live P1/hazard call assigned (or simulate), the phone speaks the call.
- Dynamic Type: in iOS Settings raise the text size; relaunch — call type / status / titles scale up.

- [ ] **Step 6: Commit any version bump**

```bash
git add "ios/refresh-device.sh"
git commit -m "chore(ios): bump dev build to 1.4 for R2"
```

---

## Self-Review

**Spec coverage:**
- §A type scale + Dynamic Type → Task 1. ✅
- §B touch targets / one-handed → Task 2 (button variants + minTouchTarget), applied Tasks 6/10. ✅
- §C persistent action bar (Field Ops) → Tasks 6–7; Dashboard PANIC-only → Task 8 (flagged extension). ✅
- §D hardware panic (auth policy, setup helper, Xcode-metadata caveat) → Task 9. ✅
- §E spoken readback (pure `SpokenAlert` + `SpeechAnnouncer` + toggle + wiring) → Tasks 3–5. ✅
- §F adoption (shared chrome + responder surfaces) → Task 10. ✅
- §G testing/build/device → Tasks 3 + 11. ✅
- §H delivery (PR, no mig/SW) → handled at PR time after Task 11.

**Placeholder scan:** No TBD/TODO; every code step has complete code; line numbers are "~" approximations because earlier tasks shift them, but each anchor quotes exact current text to find.

**Type consistency:** `ResponderActionBar(currentStatus:statuses:showStatus:onSelectStatus:onPanic:)` is identical in Tasks 6/7/8; `statuses` is `[(String, String)]` matching `FieldOpsView.statuses`; `SpokenAlert.shouldSpeak`/`phrase`/`spokenAddress`/`priorityNumber` signatures match between Task 3's tests, implementation, and the Task 5 call site; `Theme.Typography.*` / `Theme.Spacing.*` names are consistent across Tasks 1, 6, 9, 10.
