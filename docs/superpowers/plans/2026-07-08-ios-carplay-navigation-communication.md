# CarPlay Navigation + Communication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CarPlay scene to RMPGFlexConnect — a list of active calls, turn-by-turn navigation to a selected call via MapKit, and a canned-message quick-reply screen posting to the existing MDT link.

**Architecture:** A new local Swift package `CoreCarPlay` holds three pure, unit-testable helpers (call display text, destination-coordinate extraction, quick-reply payload building) plus the actual `CPTemplateApplicationSceneDelegate` that wires them into CarPlay's `CPListTemplate`/`CPMapTemplate`/`CPGridTemplate`. The scene delegate is registered via `App/Info.plist`'s scene manifest and requires two Apple-restricted entitlements before it will actually launch on a real head unit.

**Tech Stack:** Swift 6, SwiftPM local package (matching the existing `ios2/RMPGFlexConnect` root-`Package.swift` pattern — targets under `Sources/<Name>`), CarPlay framework, MapKit, the existing `CoreAPI`/`FeatureDispatch` modules.

---

## Design reference

See `docs/superpowers/specs/2026-07-08-ios-carplay-navigation-communication-design.md` for the approved design and the platform-constraint discussion (Apple's CarPlay entitlement categories).

## Important constraint on verification

The CarPlay framework does not exist outside iOS/CarPlay-Simulator — none of `CPListTemplate`, `CPMapTemplate`, `CPGridTemplate`, `CPTrip`, `CPManeuver`, `CPTravelEstimates` can be compiled or run via plain `swift build`/`swift test` on macOS, and `xcodebuild` hangs in this sandboxed session (documented pre-existing issue, see prior PRs #2668/#2674/#2685). This plan therefore splits work into:
- **Tasks 2–4**: pure Foundation/CoreLocation logic with no CarPlay-framework dependency — fully TDD-able and verified with `swift test` in this session.
- **Task 5**: the actual `CPTemplateApplicationSceneDelegate` — written to the best of documented CarPlay API knowledge, but **must be built and iterated on in real Xcode**, since this session cannot compile-check it. Treat Task 5's code as a correct starting point, not a verified-working final state.

---

## File Structure

- Create: `ios2/RMPGFlexConnect/Packages/CoreCarPlay/Package.swift` — standalone package manifest (matches the `Packages/<Name>/Package.swift` convention used by `FeatureDuty`/`FeatureCFS`/etc.)
- Create: `ios2/RMPGFlexConnect/Packages/CoreCarPlay/Sources/CoreCarPlay/CarPlayQuickReplyPayload.swift` — canned messages + `/api/mdt/send` payload builder (pure)
- Create: `ios2/RMPGFlexConnect/Packages/CoreCarPlay/Sources/CoreCarPlay/CarPlayCallListBuilder.swift` — call → display text (pure)
- Create: `ios2/RMPGFlexConnect/Packages/CoreCarPlay/Sources/CoreCarPlay/CarPlayNavigationCoordinator.swift` — call → destination coordinate (pure)
- Create: `ios2/RMPGFlexConnect/Packages/CoreCarPlay/Sources/CoreCarPlay/CarPlaySceneDelegate.swift` — the actual CarPlay UI glue (UIKit/CarPlay/MapKit, not unit-testable here)
- Create: `ios2/RMPGFlexConnect/Packages/CoreCarPlay/Tests/CoreCarPlayTests/CarPlayQuickReplyPayloadTests.swift`
- Create: `ios2/RMPGFlexConnect/Packages/CoreCarPlay/Tests/CoreCarPlayTests/CarPlayCallListBuilderTests.swift`
- Create: `ios2/RMPGFlexConnect/Packages/CoreCarPlay/Tests/CoreCarPlayTests/CarPlayNavigationCoordinatorTests.swift`
- Modify: `ios2/RMPGFlexConnect/Package.swift` — add `CoreCarPlay` product/target/test-target, referencing the `Packages/CoreCarPlay` sources by explicit `path:` (same pattern used for `FeatureDuty`/`FeatureCFS`/etc. in the prior PR)
- Modify: `ios2/RMPGFlexConnect/project.yml` — add `CoreCarPlay` as a dependency of the `RMPGFlexConnect` app target
- Modify: `ios2/RMPGFlexConnect/App/Info.plist` — add the `CPTemplateApplicationSceneSessionRoleApplication` scene configuration
- Modify: `ios2/RMPGFlexConnect/App/RMPGFlexConnect.entitlements` — add `com.apple.developer.carplay-maps` and `com.apple.developer.carplay-communication`

---

### Task 1: Create the CoreCarPlay package skeleton

**Files:**
- Create: `ios2/RMPGFlexConnect/Packages/CoreCarPlay/Package.swift`
- Modify: `ios2/RMPGFlexConnect/Package.swift`

- [ ] **Step 1: Create the standalone package manifest**

`FeatureDispatch` (which owns `CallForService`) lives under `Sources/FeatureDispatch` in the *root* package, not under `Packages/` — a standalone `Packages/CoreCarPlay/Package.swift` has no way to `.package(path:)` a sibling that isn't under `Packages/`. So `CoreCarPlay`'s pure helpers take **no** dependency on `FeatureDispatch`: they operate on a small local `CarPlayCall` struct (defined in Task 3) with just the fields the CarPlay code needs, and `CarPlaySceneDelegate.swift` (Task 5 — compiled only as part of the root package, where `FeatureDispatch` *is* a real sibling target) is responsible for mapping real API data into that local struct.

```swift
// ios2/RMPGFlexConnect/Packages/CoreCarPlay/Package.swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CoreCarPlay",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "CoreCarPlay", targets: ["CoreCarPlay"]),
    ],
    dependencies: [],
    targets: [
        .target(name: "CoreCarPlay", dependencies: []),
        .testTarget(name: "CoreCarPlayTests", dependencies: ["CoreCarPlay"]),
    ]
)
```

- [ ] **Step 2: Wire it into the root Package.swift**

Add to the `products` array (after the `FeatureMap` line):

```swift
        .library(name: "CoreCarPlay", targets: ["CoreCarPlay"]),
```

Add to the `targets` array (after the `FeatureMapTests` line):

```swift
        .target(name: "CoreCarPlay", dependencies: [], path: "Packages/CoreCarPlay/Sources/CoreCarPlay"),
        .testTarget(name: "CoreCarPlayTests", dependencies: ["CoreCarPlay"], path: "Packages/CoreCarPlay/Tests/CoreCarPlayTests"),
```

Add `"CoreCarPlay"` to `FeatureShell`'s dependency list (it's the module that will actually reference `CarPlaySceneDelegate` indirectly via the app target — see Task 6):

```swift
        .target(name: "FeatureShell", dependencies: ["CoreAPI", "CoreAuth", "DesignSystem", "CorePush", "FeatureDispatch", "FeatureRecords", "FeatureIncidents", "FeatureCases", "FeaturePatrol", "FeatureFleet", "FeatureServe", "FeatureWarrants", "FeatureQuickActions", "FeatureCFS", "FeatureDuty", "FeatureRunID", "FeatureRunPlate", "FeatureReports", "FeatureMap", "CoreCarPlay"]),
```

- [ ] **Step 3: Create empty source/test files so the package resolves**

```swift
// ios2/RMPGFlexConnect/Packages/CoreCarPlay/Sources/CoreCarPlay/CoreCarPlay.swift
// Placeholder — replaced by real files in Tasks 2-5.
```

```swift
// ios2/RMPGFlexConnect/Packages/CoreCarPlay/Tests/CoreCarPlayTests/PlaceholderTests.swift
import XCTest
@testable import CoreCarPlay

final class PlaceholderTests: XCTestCase {
    func testPackageResolves() {
        XCTAssertTrue(true)
    }
}
```

- [ ] **Step 4: Verify the manifest resolves**

Run: `cd ios2/RMPGFlexConnect && swift package resolve && swift package describe --type json | grep -A2 '"name" : "CoreCarPlay"'`
Expected: no errors; `CoreCarPlay` appears as both a library and a target.

- [ ] **Step 5: Commit**

```bash
git add ios2/RMPGFlexConnect/Package.swift ios2/RMPGFlexConnect/Packages/CoreCarPlay
git commit -m "feat(ios2): scaffold the CoreCarPlay package"
```

---

### Task 2: Canned messages + MDT send payload (TDD)

**Files:**
- Create: `ios2/RMPGFlexConnect/Packages/CoreCarPlay/Sources/CoreCarPlay/CarPlayQuickReplyPayload.swift`
- Test: `ios2/RMPGFlexConnect/Packages/CoreCarPlay/Tests/CoreCarPlayTests/CarPlayQuickReplyPayloadTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
// ios2/RMPGFlexConnect/Packages/CoreCarPlay/Tests/CoreCarPlayTests/CarPlayQuickReplyPayloadTests.swift
import XCTest
@testable import CoreCarPlay

final class CarPlayQuickReplyPayloadTests: XCTestCase {
    func testCannedMessageText() {
        XCTAssertEqual(CannedMessage.enRoute.text, "En Route")
        XCTAssertEqual(CannedMessage.onScene.text, "On Scene")
        XCTAssertEqual(CannedMessage.clear.text, "Clear")
        XCTAssertEqual(CannedMessage.needBackup.text, "Need Backup")
    }

    func testAllCasesOrder() {
        XCTAssertEqual(CannedMessage.allCases, [.enRoute, .onScene, .clear, .needBackup])
    }

    func testMdtSendPayloadShape() {
        let payload = CarPlayQuickReplyPayload.mdtSendPayload(text: "En Route")
        XCTAssertEqual(payload["to"] as? String, "mdt")
        XCTAssertEqual(payload["type"] as? String, "text")
        let inner = payload["payload"] as? [String: String]
        XCTAssertEqual(inner?["text"], "En Route")
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ios2/RMPGFlexConnect/Packages/CoreCarPlay && swift test --filter CarPlayQuickReplyPayloadTests`
Expected: FAIL — `CannedMessage`/`CarPlayQuickReplyPayload` not defined.

- [ ] **Step 3: Write the implementation**

```swift
// ios2/RMPGFlexConnect/Packages/CoreCarPlay/Sources/CoreCarPlay/CarPlayQuickReplyPayload.swift
import Foundation

/// Canned status updates an officer can send to the vehicle MDT without
/// typing while driving — the CarPlay Grid template's four buttons.
public enum CannedMessage: String, CaseIterable, Sendable {
    case enRoute
    case onScene
    case clear
    case needBackup

    public var text: String {
        switch self {
        case .enRoute: return "En Route"
        case .onScene: return "On Scene"
        case .clear: return "Clear"
        case .needBackup: return "Need Backup"
        }
    }
}

/// Builds the exact `/api/mdt/send` body MDTLinkView (Quick Actions) already
/// posts — `{to: 'mdt', type: 'text', payload: {text: "..."}}` — so the
/// vehicle MDT displays a CarPlay quick reply exactly like any other
/// phone-to-MDT text message.
public enum CarPlayQuickReplyPayload {
    public static func mdtSendPayload(text: String) -> [String: Any] {
        ["to": "mdt", "type": "text", "payload": ["text": text]]
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ios2/RMPGFlexConnect/Packages/CoreCarPlay && swift test --filter CarPlayQuickReplyPayloadTests`
Expected: PASS (3 tests)

- [ ] **Step 5: Delete the placeholder test/source file from Task 1**

```bash
rm ios2/RMPGFlexConnect/Packages/CoreCarPlay/Sources/CoreCarPlay/CoreCarPlay.swift
rm ios2/RMPGFlexConnect/Packages/CoreCarPlay/Tests/CoreCarPlayTests/PlaceholderTests.swift
```

- [ ] **Step 6: Commit**

```bash
git add ios2/RMPGFlexConnect/Packages/CoreCarPlay
git commit -m "feat(ios2): CarPlay canned messages + MDT send payload builder"
```

---

### Task 3: Call display text (TDD)

**Files:**
- Create: `ios2/RMPGFlexConnect/Packages/CoreCarPlay/Sources/CoreCarPlay/CarPlayCallListBuilder.swift`
- Test: `ios2/RMPGFlexConnect/Packages/CoreCarPlay/Tests/CoreCarPlayTests/CarPlayCallListBuilderTests.swift`

The real `CallForService` (`Sources/FeatureDispatch/DispatchModels.swift`) lives in the root package and can't be a compile-time dependency of the standalone `Packages/CoreCarPlay` package (see Task 1's note). `CoreCarPlay` defines its own minimal `CarPlayCall` struct with just the fields this module needs; `CarPlaySceneDelegate.swift` (Task 5, compiled as part of the root package where both modules are siblings) maps `CallForService` → `CarPlayCall`.

- [ ] **Step 1: Write the failing test**

```swift
// ios2/RMPGFlexConnect/Packages/CoreCarPlay/Tests/CoreCarPlayTests/CarPlayCallListBuilderTests.swift
import XCTest
@testable import CoreCarPlay

final class CarPlayCallListBuilderTests: XCTestCase {
    func testDisplayTextWithAllFields() {
        let call = CarPlayCall(id: 1, callNumber: "24-001234", incidentType: "Domestic Disturbance", priority: "P1", status: "dispatched", latitude: 40.7, longitude: -111.9)
        let (title, detail) = CarPlayCallListBuilder.displayText(for: call)
        XCTAssertEqual(title, "P1 · Domestic Disturbance")
        XCTAssertEqual(detail, "Call 24-001234")
    }

    func testDisplayTextWithMissingFields() {
        let call = CarPlayCall(id: 2, callNumber: nil, incidentType: nil, priority: nil, status: "dispatched", latitude: nil, longitude: nil)
        let (title, detail) = CarPlayCallListBuilder.displayText(for: call)
        XCTAssertEqual(title, "Call for Service")
        XCTAssertEqual(detail, "")
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ios2/RMPGFlexConnect/Packages/CoreCarPlay && swift test --filter CarPlayCallListBuilderTests`
Expected: FAIL — `CarPlayCall`/`CarPlayCallListBuilder` not defined.

- [ ] **Step 3: Write the implementation**

```swift
// ios2/RMPGFlexConnect/Packages/CoreCarPlay/Sources/CoreCarPlay/CarPlayCallListBuilder.swift
import Foundation

/// The subset of FeatureDispatch's `CallForService` the CarPlay scene
/// actually needs — kept local (not a dependency on FeatureDispatch) since
/// this standalone package can't path-depend on a root-package-only target.
/// `CarPlaySceneDelegate` maps the real `CallForService` into this.
public struct CarPlayCall: Sendable {
    public let id: Int
    public let callNumber: String?
    public let incidentType: String?
    public let priority: String?
    public let status: String?
    public let latitude: Double?
    public let longitude: Double?

    public init(id: Int, callNumber: String?, incidentType: String?, priority: String?, status: String?, latitude: Double?, longitude: Double?) {
        self.id = id
        self.callNumber = callNumber
        self.incidentType = incidentType
        self.priority = priority
        self.status = status
        self.latitude = latitude
        self.longitude = longitude
    }
}

public enum CarPlayCallListBuilder {
    /// (title, detail) for a CPListItem — kept as plain strings so this is
    /// testable without the CarPlay framework, which doesn't exist outside
    /// iOS/CarPlay Simulator.
    public static func displayText(for call: CarPlayCall) -> (title: String, detail: String) {
        let title: String
        if let priority = call.priority, let type = call.incidentType {
            title = "\(priority) · \(type)"
        } else if let type = call.incidentType {
            title = type
        } else {
            title = "Call for Service"
        }
        let detail = call.callNumber.map { "Call \($0)" } ?? ""
        return (title, detail)
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ios2/RMPGFlexConnect/Packages/CoreCarPlay && swift test --filter CarPlayCallListBuilderTests`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add ios2/RMPGFlexConnect/Packages/CoreCarPlay
git commit -m "feat(ios2): CarPlay call list display-text builder"
```

---

### Task 4: Destination coordinate extraction (TDD)

**Files:**
- Create: `ios2/RMPGFlexConnect/Packages/CoreCarPlay/Sources/CoreCarPlay/CarPlayNavigationCoordinator.swift`
- Test: `ios2/RMPGFlexConnect/Packages/CoreCarPlay/Tests/CoreCarPlayTests/CarPlayNavigationCoordinatorTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
// ios2/RMPGFlexConnect/Packages/CoreCarPlay/Tests/CoreCarPlayTests/CarPlayNavigationCoordinatorTests.swift
import XCTest
import CoreLocation
@testable import CoreCarPlay

final class CarPlayNavigationCoordinatorTests: XCTestCase {
    func testReturnsCoordinateWhenBothPresent() {
        let call = CarPlayCall(id: 1, callNumber: nil, incidentType: nil, priority: nil, status: nil, latitude: 40.7608, longitude: -111.8910)
        let coordinate = CarPlayNavigationCoordinator.destinationCoordinate(for: call)
        XCTAssertEqual(coordinate?.latitude, 40.7608)
        XCTAssertEqual(coordinate?.longitude, -111.8910)
    }

    func testReturnsNilWhenLatitudeMissing() {
        let call = CarPlayCall(id: 1, callNumber: nil, incidentType: nil, priority: nil, status: nil, latitude: nil, longitude: -111.8910)
        XCTAssertNil(CarPlayNavigationCoordinator.destinationCoordinate(for: call))
    }

    func testReturnsNilWhenLongitudeMissing() {
        let call = CarPlayCall(id: 1, callNumber: nil, incidentType: nil, priority: nil, status: nil, latitude: 40.7608, longitude: nil)
        XCTAssertNil(CarPlayNavigationCoordinator.destinationCoordinate(for: call))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ios2/RMPGFlexConnect/Packages/CoreCarPlay && swift test --filter CarPlayNavigationCoordinatorTests`
Expected: FAIL — `CarPlayNavigationCoordinator` not defined.

- [ ] **Step 3: Write the implementation**

```swift
// ios2/RMPGFlexConnect/Packages/CoreCarPlay/Sources/CoreCarPlay/CarPlayNavigationCoordinator.swift
import CoreLocation

/// CLLocationCoordinate2D itself is available on macOS (unlike CLLocationManager's
/// authorization APIs — see FeatureDuty/LocationTracker.swift's #if os(iOS) guards
/// from the prior PR), so this stays plain-testable with no platform guard needed.
public enum CarPlayNavigationCoordinator {
    public static func destinationCoordinate(for call: CarPlayCall) -> CLLocationCoordinate2D? {
        guard let latitude = call.latitude, let longitude = call.longitude else { return nil }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ios2/RMPGFlexConnect/Packages/CoreCarPlay && swift test --filter CarPlayNavigationCoordinatorTests`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full CoreCarPlay suite**

Run: `cd ios2/RMPGFlexConnect/Packages/CoreCarPlay && swift test`
Expected: PASS (8 tests total across all three test files)

- [ ] **Step 6: Commit**

```bash
git add ios2/RMPGFlexConnect/Packages/CoreCarPlay
git commit -m "feat(ios2): CarPlay destination-coordinate extraction"
```

---

### Task 5: The CarPlay scene delegate (UIKit/CarPlay glue — Xcode-verified, not swift-test-verified)

**Files:**
- Create: `ios2/RMPGFlexConnect/Packages/CoreCarPlay/Sources/CoreCarPlay/CarPlaySceneDelegate.swift`

This file imports `CarPlay`, `MapKit`, and `CoreAPI` (a root-package sibling target — fine, since this file only exists as part of the unified root `Package.swift`, not the standalone one; `CoreCarPlay`'s own standalone `Packages/CoreCarPlay/Package.swift` from Task 1 is only used for isolated `swift test` runs of the pure pieces and never needs to resolve this file's `CoreAPI` import — that import only has to resolve when built as part of the root package, which does declare `CoreAPI` as a sibling target). Because of that split, this file **will fail** a standalone `swift build`/`swift test` inside `Packages/CoreCarPlay/` alone (no `CoreAPI` dependency there) — that's expected and matches the constraint in the plan header. It only needs to compile as part of the root package build, which requires Xcode's iOS SDK (unavailable in this session).

- [ ] **Step 1: Write the scene delegate**

```swift
// ios2/RMPGFlexConnect/Packages/CoreCarPlay/Sources/CoreCarPlay/CarPlaySceneDelegate.swift
import CarPlay
import UIKit
import MapKit
import CoreAPI

/// CarPlay entry point. Registered by Info.plist's UIApplicationSceneManifest
/// (see App/Info.plist) under the CPTemplateApplicationSceneSessionRoleApplication
/// role — UIKit instantiates this by class name, so it must be `public` and
/// inherit from an NSObject-rooted type (UIResponder) for the Objective-C
/// runtime name lookup Info.plist's string reference depends on.
///
/// NOTE: written against documented CarPlay APIs but not compile-verified in
/// this session (the CarPlay framework doesn't exist outside iOS/CarPlay
/// Simulator, and xcodebuild hangs in this sandboxed session — see the plan's
/// "Important constraint on verification" section). Expect to iterate on
/// exact CPTrip/CPManeuver/CPTravelEstimates argument labels against the real
/// SDK in Xcode.
public final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interfaceController: CPInterfaceController?
    private let apiClient = APIClient(baseURL: Endpoint.productionBaseURL)
    private var navigationSession: CPNavigationSession?

    public override init() {
        super.init()
    }

    public func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = interfaceController
        Task { await showRootTemplates() }
    }

    public func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = nil
        navigationSession = nil
    }

    @MainActor
    private func showRootTemplates() async {
        let listTemplate = await buildCallListTemplate()
        listTemplate.tabTitle = "Calls"
        listTemplate.tabImage = UIImage(systemName: "list.bullet")

        let quickReplyTemplate = buildQuickReplyTemplate()
        quickReplyTemplate.tabTitle = "Updates"
        quickReplyTemplate.tabImage = UIImage(systemName: "bubble.left.and.bubble.right")

        let tabBar = CPTabBarTemplate(templates: [listTemplate, quickReplyTemplate])
        interfaceController?.setRootTemplate(tabBar, animated: true, completion: nil)
    }

    /// Fetches active calls directly via a raw request rather than importing
    /// FeatureDispatch (see Task 3's note — CoreCarPlay's standalone package
    /// can't path-depend on a root-package-only target; this file is only
    /// ever compiled as part of the root package, where a direct
    /// FeatureDispatch import would actually be legal — but keeping the HTTP
    /// call local avoids a one-off exception to Packages/-only dependencies
    /// and keeps this file self-contained).
    @MainActor
    private func fetchActiveCalls() async -> [CarPlayCall] {
        struct RawCall: Decodable {
            let id: Int
            let callNumber: String?
            let incidentType: String?
            let priority: String?
            let status: String?
            let latitude: Double?
            let longitude: Double?
        }
        struct Response: Decodable { let data: [RawCall] }

        guard let response: Response = try? await apiClient.request(
            Endpoint(path: "/api/dispatch/calls")
        ) else { return [] }

        return response.data
            .filter { ["dispatched", "enroute", "onscene"].contains($0.status ?? "") }
            .map { CarPlayCall(id: $0.id, callNumber: $0.callNumber, incidentType: $0.incidentType, priority: $0.priority, status: $0.status, latitude: $0.latitude, longitude: $0.longitude) }
    }

    @MainActor
    private func buildCallListTemplate() async -> CPListTemplate {
        let calls = await fetchActiveCalls()
        let items = calls.map { call -> CPListItem in
            let (title, detail) = CarPlayCallListBuilder.displayText(for: call)
            let item = CPListItem(text: title, detailText: detail)
            item.handler = { [weak self] _, completion in
                Task { await self?.startNavigation(to: call) }
                completion()
            }
            return item
        }
        return CPListTemplate(title: "Active Calls", sections: [CPListSection(items: items)])
    }

    private func buildQuickReplyTemplate() -> CPGridTemplate {
        let buttons = CannedMessage.allCases.map { message -> CPGridButton in
            CPGridButton(titleVariants: [message.text], image: UIImage(systemName: "checkmark.circle.fill") ?? UIImage()) { [weak self] _ in
                Task { await self?.sendQuickReply(message) }
            }
        }
        return CPGridTemplate(title: "Send Update", gridButtons: buttons)
    }

    private func sendQuickReply(_ message: CannedMessage) async {
        let payload = CarPlayQuickReplyPayload.mdtSendPayload(text: message.text)
        guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return }
        try? await apiClient.requestVoid(Endpoint(path: "/api/mdt/send", method: .post, body: body))
    }

    @MainActor
    private func startNavigation(to call: CarPlayCall) async {
        guard let coordinate = CarPlayNavigationCoordinator.destinationCoordinate(for: call) else { return }

        let request = MKDirections.Request()
        request.source = MKMapItem.forCurrentLocation()
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: coordinate))
        request.transportType = .automobile

        guard let route = try? await MKDirections(request: request).calculate().routes.first,
              let destination = request.destination else { return }

        let mapTemplate = CPMapTemplate()
        let routeChoice = CPRouteChoice(
            summaryVariants: [route.name],
            additionalInformationVariants: [],
            selectionSummaryVariants: []
        )
        let trip = CPTrip(origin: MKMapItem.forCurrentLocation(), destination: destination, routeChoices: [routeChoice])
        let session = mapTemplate.startNavigationSession(for: trip)
        navigationSession = session

        session.upcomingManeuvers = route.steps.dropFirst().map { step in
            let maneuver = CPManeuver()
            maneuver.instructionVariants = [step.instructions]
            maneuver.initialTravelEstimates = CPTravelEstimates(
                distanceRemaining: Measurement(value: step.distance, unit: .meters),
                timeRemaining: -1
            )
            return maneuver
        }

        interfaceController?.pushTemplate(mapTemplate, animated: true, completion: nil)
    }
}
```

- [ ] **Step 2: Note the verification gap explicitly**

This step has no command to run — record in the PR description (Task 8) that Task 5's file has not been compiled in this session and must be built in Xcode before relying on it, same caveat as every other CarPlay-framework file this plan touches.

- [ ] **Step 3: Commit**

```bash
git add ios2/RMPGFlexConnect/Packages/CoreCarPlay/Sources/CoreCarPlay/CarPlaySceneDelegate.swift
git commit -m "feat(ios2): CarPlay scene delegate (call list, navigation, quick replies)"
```

---

### Task 6: Wire CoreCarPlay into the app target

**Files:**
- Modify: `ios2/RMPGFlexConnect/project.yml`

- [ ] **Step 1: Add CoreCarPlay to the RMPGFlexConnect target's dependencies**

In `project.yml`, under `targets: RMPGFlexConnect: dependencies:`, add:

```yaml
      - package: RMPGFlexModules
        product: CoreCarPlay
```

(alongside the existing `FeatureShell`/`CoreAuth`/`DesignSystem`/`CoreIDScan` entries)

- [ ] **Step 2: Regenerate the Xcode project**

Run (in Xcode, since `xcodegen` + `xcodebuild` both require the toolchain unavailable in this session): `cd ios2/RMPGFlexConnect && xcodegen generate`
Expected: `RMPGFlexConnect.xcodeproj` regenerates without error, now linking `CoreCarPlay`.

- [ ] **Step 3: Commit**

```bash
git add ios2/RMPGFlexConnect/project.yml
git commit -m "feat(ios2): link CoreCarPlay into the app target"
```

---

### Task 7: Register the CarPlay scene in Info.plist

**Files:**
- Modify: `ios2/RMPGFlexConnect/App/Info.plist`

- [ ] **Step 1: Add the CarPlay scene configuration**

Current `UIApplicationSceneManifest` (around line 58):

```xml
	<key>UIApplicationSceneManifest</key>
	<dict>
		<key>UIApplicationSupportsMultipleScenes</key>
		<false/>
		<key>UISceneConfigurations</key>
		<dict/>
	</dict>
```

Replace the empty `<dict/>` for `UISceneConfigurations` with:

```xml
	<key>UIApplicationSceneManifest</key>
	<dict>
		<key>UIApplicationSupportsMultipleScenes</key>
		<false/>
		<key>UISceneConfigurations</key>
		<dict>
			<key>CPTemplateApplicationSceneSessionRoleApplication</key>
			<array>
				<dict>
					<key>UISceneConfigurationName</key>
					<string>CarPlay Configuration</string>
					<key>UISceneDelegateClassName</key>
					<string>CoreCarPlay.CarPlaySceneDelegate</string>
				</dict>
			</array>
		</dict>
	</dict>
```

- [ ] **Step 2: Commit**

```bash
git add ios2/RMPGFlexConnect/App/Info.plist
git commit -m "feat(ios2): register the CarPlay scene configuration"
```

---

### Task 8: Add the CarPlay entitlements

**Files:**
- Modify: `ios2/RMPGFlexConnect/App/RMPGFlexConnect.entitlements`

- [ ] **Step 1: Add both CarPlay entitlement keys**

Current file:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>aps-environment</key>
	<string>production</string>
	<key>com.apple.developer.associated-domains</key>
	<array>
		<string>applinks:rmpgutah.us</string>
		<string>webcredentials:rmpgutah.us</string>
	</array>
	<key>com.apple.developer.nfc.readersession.formats</key>
	<array>
		<string>TAG</string>
	</array>
	<key>com.apple.security.application-groups</key>
	<array/>
	<key>keychain-access-groups</key>
	<array>
		<string>$(AppIdentifierPrefix)com.rmpg.flex.connect</string>
		<string>$(AppIdentifierPrefix)group.com.rmpg.flex</string>
	</array>
</dict>
</plist>
```

Add these two keys anywhere inside the top-level `<dict>` (both confirmed against Apple's own entitlement documentation — `com.apple.developer.carplay-maps` for Navigation, `com.apple.developer.carplay-communication` for Communication):

```xml
	<key>com.apple.developer.carplay-maps</key>
	<true/>
	<key>com.apple.developer.carplay-communication</key>
	<true/>
```

- [ ] **Step 2: Understand what this does and doesn't do**

Adding these keys to the local entitlements file lets the project *build* with them, but **code signing will fail** until Apple has actually granted both restricted CarPlay capabilities to this app's provisioning profile — that's a separate, manual request process at `developer.apple.com/contact/carplay/` (see the design doc), entirely outside this repo. Until approved: either remove these two keys locally to keep signing working for everything else, or expect `CODE_SIGN_STYLE: Automatic` to fail specifically on these entitlements and address that when it happens.

- [ ] **Step 3: Commit**

```bash
git add ios2/RMPGFlexConnect/App/RMPGFlexConnect.entitlements
git commit -m "feat(ios2): add CarPlay entitlement keys (pending Apple approval)"
```

---

### Task 9: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full CoreCarPlay test suite one more time**

Run: `cd ios2/RMPGFlexConnect/Packages/CoreCarPlay && swift test`
Expected: PASS (8 tests: 3 quick-reply + 2 call-list + 3 navigation-coordinator)

- [ ] **Step 2: Validate the root package manifest still resolves**

Run: `cd ios2/RMPGFlexConnect && swift package dump-package && swift package describe --type json | grep -A2 '"name" : "CoreCarPlay"'`
Expected: no errors, `CoreCarPlay` present.

- [ ] **Step 3: Open in Xcode and build for the CarPlay Simulator**

This step cannot be run in this sandboxed session (`xcodebuild` hangs; CarPlay framework doesn't exist on macOS). In your own Xcode:
1. `File > Packages > Reset Package Caches` if the new package doesn't show up immediately.
2. Build for a simulator destination.
3. Install "Additional Tools for Xcode" from developer.apple.com if the CarPlay Simulator app isn't already present, launch it, and pair it with the running app simulator to see the CarPlay scene render.
4. Fix any `CPTrip`/`CPManeuver`/`CPTravelEstimates` argument-label mismatches the real SDK's compiler surfaces — Task 5's code is a best-effort, not a compiled-and-confirmed final state (see the plan header).

- [ ] **Step 4: Push and open a PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat(ios2): CarPlay navigation + communication scene" --body "See docs/superpowers/specs/2026-07-08-ios-carplay-navigation-communication-design.md. Pure logic (call display text, destination coordinate, MDT quick-reply payload) is unit-tested in this PR. The CarPlay scene delegate itself (CPListTemplate/CPMapTemplate/CPGridTemplate wiring) could not be compiled in this sandboxed session — CarPlay framework doesn't exist outside iOS, and xcodebuild hangs here (same pre-existing issue as PRs #2668/#2674/#2685). Needs a real Xcode build + CarPlay Simulator pass before merging with confidence. Also needs Apple's CarPlay entitlement approval (com.apple.developer.carplay-maps, com.apple.developer.carplay-communication) before it can run on a real head unit."
```

---

## Plan self-review notes

- **Spec coverage**: root template (`CPListTemplate` of active calls) — Task 5; navigation (`CPMapTemplate`/`MKDirections`) — Task 5/`CarPlayNavigationCoordinator`; communication (`CPGridTemplate` → `/api/mdt/send`) — Task 2/Task 5; entitlements — Task 8; scene registration — Task 7. All spec sections have a task.
- **The `Packages/CoreCarPlay` standalone-package-vs-root-package dependency mismatch** (Task 1) is called out explicitly rather than glossed over — it's the reason `CarPlayCall` is a local struct instead of directly reusing `FeatureDispatch.CallForService`, and the reason Task 5 fetches calls via a raw `Endpoint` request instead of importing `FeatureDispatch`.
- **No placeholder verification claims**: every task that touches CarPlay-framework code says explicitly it's unverified in this session, rather than silently asserting success.
