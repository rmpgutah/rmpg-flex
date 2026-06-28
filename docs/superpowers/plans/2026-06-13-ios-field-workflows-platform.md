# iOS Field Workflows Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a declarative field-workflows engine to the `RMPGFlexTester` iOS app so officers can author ~13 reports/actions (incident, citation, patrol-tour scan, etc.) against existing live APIs, with dictation, evidence photos, prefill, and honest validation.

**Architecture:** One pure-logic core (`WorkflowDefinition` model + body encoder + validation→readiness mapper, all UIKit-free and `swift test`-able) drives one SwiftUI `WorkflowRenderer`. A `WorkflowRegistry` of definitions is rendered by a categorized `WorkflowHubView`. Adding a workflow = adding a definition. The only server change is `field_photos.incident_id`.

**Tech Stack:** Swift 5.9 / SwiftUI / `SFSpeechRecognizer` + `AVAudioEngine` (on-device dictation) / existing `RMPGAPIClient` (JWT, `api.rmpgutah.us`) / Cloudflare Worker (Hono/TS) for the one server change / D1.

**Spec:** `docs/superpowers/specs/2026-06-13-ios-field-reports-citations-design.md`

**Shipping:** **PR1** = Tasks 1–18 (engine + field-type library + hub + `MultipartUpload` refactor + `field_photos.incident_id` + 3 proving workflows: incident, citation, patrol scan). **PR2** = Tasks 19–29 (the remaining ~10 workflow definitions). Both via feature branch → `gh pr create` off `origin/main` (never direct push to main).

---

## Verification reality (read first)

This Mac's `xcodebuild` **deadlocks** (see `ios/README.md`), so:
- **Pure-logic units** (everything UIKit/SwiftUI-free) are tested with **SwiftPM `swift test`** via the harness script built in Task 1: `./ios/run-workflow-tests.sh`.
- **SwiftUI views** can't run under `swift test` — they are verified by **`swiftc` compile** (`xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator <files> -o /dev/null` … in practice the whole app compile via `ios/refresh-device.sh --force`) and **on-device** via `ios/refresh-device.sh`.
- **Server change** is verified by `npm run typecheck` + the existing `vitest` suite + a live D1 `pragma_table_info`.

**Module rule that makes the harness work:** every file in the "pure-logic core" must NOT `import SwiftUI` or `import UIKit`. Only `import Foundation`. If a type needs a SwiftUI view, that view lives in a *separate* `*View.swift` file that is NOT copied into the test harness.

---

## File structure

### PR1 — engine + proving slice

Pure-logic core (`ios/RMPGFlexTester/RMPGFlexTester/`, `import Foundation` only):
- `WorkflowModels.swift` — `FieldType`, `FieldValue`, `WorkflowField`, `WorkflowStep`, `WorkflowCategory`, `PrefillSource`, `SubmitSpec`, `BodyEncoding`, `SuccessSpec`, `WorkflowDefinition`, `ReadinessItem`.
- `WorkflowBody.swift` — `WorkflowBody.json(_:)` / `.multipartFields(_:)` encoders.
- `WorkflowValidation.swift` — `readiness(from serverError:requiredKeys:labels:) -> [ReadinessItem]`.
- `FieldValidation.swift` — `isValidDate(_:)`, `isNonNegativeNumber(_:)`, etc.
- `MultipartBody.swift` — `buildMultipartBody(boundary:fields:fileField:filename:mime:fileData:) -> Data` (extracted).
- `DictationState.swift` — pure `enum DictationState` + transition logic.
- `WorkflowRegistry.swift` — `static let all: [WorkflowDefinition]` (3 in PR1, +10 in PR2).

UI / networking (SwiftUI or Speech; NOT in the harness):
- `Dictation.swift` — `SFSpeechRecognizer`/`AVAudioEngine` `ObservableObject` wrapping `DictationState`.
- `MultipartUpload.swift` — thin `URLSession` POST using `MultipartBody`.
- `AuthedClient.swift` — shared `authedClient()` + `authed { }` re-login-on-401 helper (factored from `FieldOpsView`/`BackgroundDuty`/`FieldPhotoView`).
- `WorkflowFieldViews.swift` — the field-type views (`DictationBar`, `ChipRow`, `SegmentedRow`, `TextFieldRow`, `DateRow`, `TimeRow`, `NumberRow`, `ToggleRow`, `PhotoStrip`, `ScanSubjectCard`, `ScanVehicleCard`, `GPSLocationField`, `StatuteSearchField`, `PickerRow`, `SignaturePad`).
- `WorkflowRenderer.swift` — the stepped renderer.
- `WorkflowHubView.swift` — the categorized hub.

Tests (`ios/RMPGFlexTester/RMPGFlexTesterTests/`):
- `WorkflowModelsTests.swift`, `WorkflowBodyTests.swift`, `WorkflowValidationTests.swift`, `FieldValidationTests.swift`, `MultipartBodyTests.swift`, `WorkflowRegistryTests.swift`.

Modified:
- `ios/RMPGFlexTester/RMPGFlexTester/FieldPhotoView.swift` — use `MultipartBody`.
- `ios/RMPGFlexTester/RMPGFlexTester/FuelAndPhotos.swift` — use `MultipartBody`.
- `ios/RMPGFlexTester/RMPGFlexTester/App.swift` — surface the hub.
- `src/routes/fieldPhotos.ts` — add `incident_id`.
- `ios/run-workflow-tests.sh` — new harness (Task 1).

### PR2 — remaining definitions
- `WorkflowRegistry.swift` — append 10 definitions.
- `WorkflowRegistryTests.swift` — assert count/well-formedness.

---

## PR1

### Task 1: SwiftPM test harness script

**Files:**
- Create: `ios/run-workflow-tests.sh`

- [ ] **Step 1: Write the harness script**

```bash
#!/bin/bash
# Assemble a throwaway SwiftPM package from the pure-logic workflow sources +
# their tests and run `swift test`. Needed because xcodebuild deadlocks on this
# Mac (see ios/README.md). Pure-logic files import Foundation only.
set -euo pipefail
IOS="$(cd "$(dirname "$0")" && pwd)"
SRC="$IOS/RMPGFlexTester/RMPGFlexTester"
TST="$IOS/RMPGFlexTester/RMPGFlexTesterTests"
PKG="$(mktemp -d)/WorkflowKit"
mkdir -p "$PKG/Sources/WorkflowKit" "$PKG/Tests/WorkflowKitTests"

SOURCES=(WorkflowModels WorkflowBody WorkflowValidation FieldValidation MultipartBody DictationState WorkflowRegistry)
TESTS=(WorkflowModelsTests WorkflowBodyTests WorkflowValidationTests FieldValidationTests MultipartBodyTests WorkflowRegistryTests)

for f in "${SOURCES[@]}"; do cp "$SRC/$f.swift" "$PKG/Sources/WorkflowKit/"; done
for f in "${TESTS[@]}"; do
  sed 's/@testable import RMPGFlexTester/@testable import WorkflowKit/' "$TST/$f.swift" > "$PKG/Tests/WorkflowKitTests/$f.swift"
done

cat > "$PKG/Package.swift" <<'EOF'
// swift-tools-version:5.9
import PackageDescription
let package = Package(
  name: "WorkflowKit",
  targets: [
    .target(name: "WorkflowKit"),
    .testTarget(name: "WorkflowKitTests", dependencies: ["WorkflowKit"]),
  ])
EOF

cd "$PKG" && swift test
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x ios/run-workflow-tests.sh`

- [ ] **Step 3: Commit**

```bash
git add ios/run-workflow-tests.sh
git commit -m "test(ios): SwiftPM harness for pure-logic workflow units"
```

> The harness fails until the referenced source/test files exist — that's expected; it goes green at Task 8.

---

### Task 2: Workflow model (pure)

**Files:**
- Create: `ios/RMPGFlexTester/RMPGFlexTester/WorkflowModels.swift`
- Test: `ios/RMPGFlexTester/RMPGFlexTesterTests/WorkflowModelsTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import RMPGFlexTester

final class WorkflowModelsTests: XCTestCase {
    func testMissingRequiredKeys() {
        let step = WorkflowStep(title: "Detail", fields: [
            WorkflowField(key: "incident_type", type: .chips, label: "Type", required: true),
            WorkflowField(key: "narrative", type: .dictatableNarrative, label: "Narrative", required: true),
            WorkflowField(key: "notes", type: .text, label: "Notes", required: false),
        ])
        let def = WorkflowDefinition(
            id: "incident", title: "Incident report", icon: "doc.text",
            category: .reports, roles: ["officer"],
            submit: .lifecycle(create: "api/incidents", update: "api/incidents/{id}", finalize: "api/incidents/{id}/submit"),
            encoding: .json, steps: [step], prefill: [.call],
            success: SuccessSpec(numberKey: "incident_number", message: "Filed {incident_number}"))

        let values: [String: FieldValue] = ["incident_type": .string("theft")]
        XCTAssertEqual(def.missingRequiredKeys(in: values), ["narrative"])

        let complete: [String: FieldValue] = ["incident_type": .string("theft"), "narrative": .string("…")]
        XCTAssertEqual(def.missingRequiredKeys(in: complete), [])
    }

    func testFieldValueIsEmpty() {
        XCTAssertTrue(FieldValue.string("   ").isEmpty)
        XCTAssertTrue(FieldValue.none.isEmpty)
        XCTAssertFalse(FieldValue.string("x").isEmpty)
        XCTAssertFalse(FieldValue.number(0).isEmpty)
        XCTAssertFalse(FieldValue.bool(false).isEmpty)
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./ios/run-workflow-tests.sh`
Expected: FAIL — `cannot find 'WorkflowField' in scope` (and harness can't copy missing source).

- [ ] **Step 3: Write the model**

```swift
import Foundation

enum WorkflowCategory: String, CaseIterable, Codable { case reports, patrol, people, civil }

enum FieldType: String, Codable {
    case text, dictatableNarrative, chips, segmented, date, time, number, toggle
    case photo, scanSubject, scanVehicle, statuteSearch, signature, gpsLocation, picker
}

enum FieldValue: Equatable {
    case string(String), number(Double), bool(Bool), none
    var isEmpty: Bool {
        switch self {
        case .string(let s): return s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .none: return true
        case .number, .bool: return false
        }
    }
}

struct FieldOption: Equatable { let value: String; let label: String }

struct WorkflowField {
    let key: String
    let type: FieldType
    let label: String
    var required: Bool = false
    var options: [FieldOption]? = nil
    var defaultValue: FieldValue? = nil
}

struct WorkflowStep { let title: String; let fields: [WorkflowField] }

enum SubmitSpec {
    case single(post: String)
    case lifecycle(create: String, update: String, finalize: String)
}
enum BodyEncoding { case json, multipart }
enum PrefillSource { case call, scanSubject, scanVehicle, gps }
struct SuccessSpec { let numberKey: String; let message: String }

struct ReadinessItem: Equatable { let label: String; let satisfied: Bool }

struct WorkflowDefinition {
    let id: String
    let title: String
    let icon: String
    let category: WorkflowCategory
    let roles: [String]
    let submit: SubmitSpec
    let encoding: BodyEncoding
    let steps: [WorkflowStep]
    let prefill: [PrefillSource]
    let success: SuccessSpec

    var allFields: [WorkflowField] { steps.flatMap(\.fields) }

    func missingRequiredKeys(in values: [String: FieldValue]) -> [String] {
        allFields.filter { $0.required && (values[$0.key]?.isEmpty ?? true) }.map(\.key)
    }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `./ios/run-workflow-tests.sh`
Expected: PASS (`WorkflowModelsTests`).

- [ ] **Step 5: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/WorkflowModels.swift ios/RMPGFlexTester/RMPGFlexTesterTests/WorkflowModelsTests.swift
git commit -m "feat(ios): workflow definition model (pure)"
```

---

### Task 3: Multipart body builder (extracted, pure)

**Files:**
- Create: `ios/RMPGFlexTester/RMPGFlexTester/MultipartBody.swift`
- Test: `ios/RMPGFlexTester/RMPGFlexTesterTests/MultipartBodyTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import RMPGFlexTester

final class MultipartBodyTests: XCTestCase {
    func testFramesFieldsAndFile() {
        let data = buildMultipartBody(
            boundary: "B",
            fields: ["notes": "hello", "empty": ""],
            fileField: "photo", filename: "field.jpg", mime: "image/jpeg",
            fileData: Data([0x01, 0x02]))
        let s = String(data: data, encoding: .utf8) ?? ""
        XCTAssertTrue(s.contains("--B\r\nContent-Disposition: form-data; name=\"notes\"\r\n\r\nhello\r\n"))
        XCTAssertFalse(s.contains("name=\"empty\""))  // empty values dropped
        XCTAssertTrue(s.contains("name=\"photo\"; filename=\"field.jpg\""))
        XCTAssertTrue(s.contains("Content-Type: image/jpeg"))
        XCTAssertTrue(s.hasSuffix("--B--\r\n"))
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./ios/run-workflow-tests.sh`
Expected: FAIL — `cannot find 'buildMultipartBody'`.

- [ ] **Step 3: Write the builder**

```swift
import Foundation

/// Build a multipart/form-data body. Empty string values are skipped (matches
/// the prior inline behaviour in FieldPhotoView). The file part is always last.
func buildMultipartBody(boundary: String,
                        fields: [String: String],
                        fileField: String,
                        filename: String,
                        mime: String,
                        fileData: Data) -> Data {
    var body = Data()
    for (key, value) in fields where !value.isEmpty {
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(key)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
    }
    body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(fileField)\"; filename=\"\(filename)\"\r\nContent-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
    body.append(fileData)
    body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
    return body
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `./ios/run-workflow-tests.sh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/MultipartBody.swift ios/RMPGFlexTester/RMPGFlexTesterTests/MultipartBodyTests.swift
git commit -m "feat(ios): extract multipart body builder (pure, tested)"
```

---

### Task 4: Shared authed client + multipart upload (networking, compile-only)

**Files:**
- Create: `ios/RMPGFlexTester/RMPGFlexTester/AuthedClient.swift`
- Create: `ios/RMPGFlexTester/RMPGFlexTester/MultipartUpload.swift`

- [ ] **Step 1: Write `AuthedClient.swift`** (factors the duplicated login-then-call pattern)

```swift
import Foundation

/// Returns a client with a valid JWT, logging in from Keychain creds if needed.
func authedClient() async -> RMPGAPIClient? {
    var client = AppConfig.apiClient()
    if client.jwt == nil,
       let u = KeychainStore.load(key: "rmpgUser"),
       let p = KeychainStore.load(key: "rmpgPass"), !u.isEmpty,
       let t = try? await client.login(username: u, password: p) {
        KeychainStore.save(t, key: "rmpgJWT"); client.jwt = t
    }
    return client.jwt == nil ? nil : client
}

/// Run authed work; on a 401 re-login once and retry. Returns the thrown error
/// (nil on success) so callers can branch on `RMPGAPIClient.apiBody`.
@discardableResult
func authedRetrying(_ work: (RMPGAPIClient) async throws -> Void) async -> Error? {
    guard var c = await authedClient() else {
        return NSError(domain: "RMPG", code: 401, userInfo: [NSLocalizedDescriptionKey: "Set RMPG credentials in Settings"])
    }
    do { try await work(c); return nil }
    catch {
        if (error as NSError).code == 401,
           let u = KeychainStore.load(key: "rmpgUser"),
           let p = KeychainStore.load(key: "rmpgPass"),
           let t = try? await c.login(username: u, password: p) {
            KeychainStore.save(t, key: "rmpgJWT"); c.jwt = t
            do { try await work(c); return nil } catch { return error }
        }
        return error
    }
}
```

- [ ] **Step 2: Write `MultipartUpload.swift`** (thin POST using the builder)

```swift
import Foundation

enum MultipartUpload {
    /// POST a jpeg + string fields as multipart/form-data. Returns parsed JSON.
    @discardableResult
    static func upload(_ client: RMPGAPIClient, path: String,
                       fields: [String: String], jpeg: Data) async throws -> Any {
        let boundary = "rmpg-\(UUID().uuidString)"
        let body = buildMultipartBody(boundary: boundary, fields: fields,
                                      fileField: "photo", filename: "field.jpg",
                                      mime: "image/jpeg", fileData: jpeg)
        var req = URLRequest(url: URL(string: client.baseURL.absoluteString + "/" + path)!)
        req.httpMethod = "POST"
        if let jwt = client.jwt { req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization") }
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw NSError(domain: "RMPG", code: status,
                          userInfo: [NSLocalizedDescriptionKey: "HTTP \(status): \(String(data: data, encoding: .utf8)?.prefix(150) ?? "")"])
        }
        return (try? JSONSerialization.jsonObject(with: data)) ?? [:]
    }
}
```

- [ ] **Step 3: Compile-check the app**

Run: `ios/refresh-device.sh --force`
Expected: `swiftc` compiles (no device required → it prints "iPhone not connected, skipping" *after* a successful compile, or installs if connected). No compile errors.

- [ ] **Step 4: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/AuthedClient.swift ios/RMPGFlexTester/RMPGFlexTester/MultipartUpload.swift
git commit -m "feat(ios): shared authed-client + multipart upload helpers"
```

---

### Task 5: Refactor existing photo uploads onto the helper

**Files:**
- Modify: `ios/RMPGFlexTester/RMPGFlexTester/FieldPhotoView.swift:109-123`
- Modify: `ios/RMPGFlexTester/RMPGFlexTester/FuelAndPhotos.swift:19-32`

- [ ] **Step 1: Replace the inline multipart in `FieldPhotoView.upload`**

Replace the block that builds `boundary`/`body` and the `URLRequest` (lines ~109–135) with:

```swift
        do {
            let result = try await MultipartUpload.upload(client, path: "api/field-photos",
                                                          fields: fields, jpeg: jpeg)
            let attached = fields["call_id"] != nil
            _ = result
            status = "✓ Photo uploaded\(attached ? " + attached to call" : "") — visible on desktop"
        } catch {
            status = "✗ \(error.localizedDescription)"
        }
```

- [ ] **Step 2: Replace the inline multipart in `FuelAndPhotos`** the same way

In `FuelAndPhotos.swift`, replace the hand-built `boundary`/`body`/`URLRequest` (lines ~19–32) with a call to `MultipartUpload.upload(client, path: "api/field-photos", fields: fields, jpeg: jpeg)`, preserving its existing `fields`/`photoUrls` handling.

- [ ] **Step 3: Compile-check**

Run: `ios/refresh-device.sh --force`
Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/FieldPhotoView.swift ios/RMPGFlexTester/RMPGFlexTester/FuelAndPhotos.swift
git commit -m "refactor(ios): field-photo + fuel uploads use shared MultipartUpload"
```

---

### Task 6: Body encoder (pure)

**Files:**
- Create: `ios/RMPGFlexTester/RMPGFlexTester/WorkflowBody.swift`
- Test: `ios/RMPGFlexTester/RMPGFlexTesterTests/WorkflowBodyTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import RMPGFlexTester

final class WorkflowBodyTests: XCTestCase {
    func testJSONOmitsEmptyAndEncodesTypes() {
        let values: [String: FieldValue] = [
            "violation_description": .string("speeding"),
            "fine_amount": .number(120),
            "is_warning": .bool(false),
            "blank": .string("   "),
            "missing": FieldValue.none,
        ]
        let json = WorkflowBody.json(values)
        XCTAssertEqual(json["violation_description"] as? String, "speeding")
        XCTAssertEqual(json["fine_amount"] as? Double, 120)
        XCTAssertEqual(json["is_warning"] as? Bool, false)
        XCTAssertNil(json["blank"])
        XCTAssertNil(json["missing"])
    }

    func testMultipartFieldsAreStrings() {
        let f = WorkflowBody.multipartFields([
            "notes": .string("x"), "lat": .number(40.7), "skip": .string(""),
        ])
        XCTAssertEqual(f["notes"], "x")
        XCTAssertEqual(f["lat"], "40.7")
        XCTAssertNil(f["skip"])
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./ios/run-workflow-tests.sh`
Expected: FAIL — `cannot find 'WorkflowBody'`.

- [ ] **Step 3: Write the encoder**

```swift
import Foundation

enum WorkflowBody {
    static func json(_ values: [String: FieldValue]) -> [String: Any] {
        var out: [String: Any] = [:]
        for (k, v) in values where !v.isEmpty {
            switch v {
            case .string(let s): out[k] = s
            case .number(let n): out[k] = n
            case .bool(let b): out[k] = b
            case .none: break
            }
        }
        return out
    }

    static func multipartFields(_ values: [String: FieldValue]) -> [String: String] {
        var out: [String: String] = [:]
        for (k, v) in values where !v.isEmpty {
            switch v {
            case .string(let s): out[k] = s
            case .number(let n): out[k] = n == n.rounded() ? String(Int(n)) : String(n)
            case .bool(let b): out[k] = b ? "1" : "0"
            case .none: break
            }
        }
        return out
    }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `./ios/run-workflow-tests.sh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/WorkflowBody.swift ios/RMPGFlexTester/RMPGFlexTesterTests/WorkflowBodyTests.swift
git commit -m "feat(ios): workflow body encoder (json + multipart, pure)"
```

---

### Task 7: Validation → readiness mapper (pure)

**Files:**
- Create: `ios/RMPGFlexTester/RMPGFlexTester/WorkflowValidation.swift`
- Test: `ios/RMPGFlexTester/RMPGFlexTesterTests/WorkflowValidationTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import RMPGFlexTester

final class WorkflowValidationTests: XCTestCase {
    // Local-readiness from required keys (shown BEFORE submit).
    func testLocalReadiness() {
        let items = WorkflowValidation.readiness(
            requiredKeys: ["incident_type", "narrative"],
            present: ["incident_type"],
            labels: ["incident_type": "Incident type", "narrative": "Narrative"])
        XCTAssertEqual(items, [
            ReadinessItem(label: "Incident type", satisfied: true),
            ReadinessItem(label: "Narrative", satisfied: false),
        ])
    }

    // Server NIBRS 422 shape → unsatisfied items appended.
    func testServerValidationErrors() {
        let body: [String: Any] = ["code": "NIBRS_VALIDATION_FAILED",
            "validation": ["errors": ["Victim relationship required", "Offense code missing"]]]
        let items = WorkflowValidation.serverErrors(from: body)
        XCTAssertEqual(items, [
            ReadinessItem(label: "Victim relationship required", satisfied: false),
            ReadinessItem(label: "Offense code missing", satisfied: false),
        ])
    }

    func testServerValidationGenericMessage() {
        let body: [String: Any] = ["error": "violation_date must be YYYY-MM-DD"]
        let items = WorkflowValidation.serverErrors(from: body)
        XCTAssertEqual(items, [ReadinessItem(label: "violation_date must be YYYY-MM-DD", satisfied: false)])
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./ios/run-workflow-tests.sh`
Expected: FAIL — `cannot find 'WorkflowValidation'`.

- [ ] **Step 3: Write the mapper**

```swift
import Foundation

enum WorkflowValidation {
    static func readiness(requiredKeys: [String], present: Set<String>,
                          labels: [String: String]) -> [ReadinessItem] {
        requiredKeys.map { ReadinessItem(label: labels[$0] ?? $0, satisfied: present.contains($0)) }
    }

    /// Map a server error body into unsatisfied readiness rows. Handles the
    /// incidents NIBRS shape ({validation:{errors:[…]}}) and a generic {error:"…"}.
    static func serverErrors(from body: [String: Any]) -> [ReadinessItem] {
        if let v = body["validation"] as? [String: Any],
           let errs = v["errors"] as? [Any] {
            return errs.compactMap { $0 as? String }.map { ReadinessItem(label: $0, satisfied: false) }
        }
        if let e = body["error"] as? String {
            return [ReadinessItem(label: e, satisfied: false)]
        }
        return []
    }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `./ios/run-workflow-tests.sh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/WorkflowValidation.swift ios/RMPGFlexTester/RMPGFlexTesterTests/WorkflowValidationTests.swift
git commit -m "feat(ios): validation->readiness mapper (NIBRS + generic, pure)"
```

---

### Task 8: Field validation + dictation state (pure)

**Files:**
- Create: `ios/RMPGFlexTester/RMPGFlexTester/FieldValidation.swift`
- Create: `ios/RMPGFlexTester/RMPGFlexTester/DictationState.swift`
- Test: `ios/RMPGFlexTester/RMPGFlexTesterTests/FieldValidationTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import RMPGFlexTester

final class FieldValidationTests: XCTestCase {
    func testDate() {
        XCTAssertTrue(FieldValidation.isValidDate("2026-06-13"))
        XCTAssertFalse(FieldValidation.isValidDate("06/13/2026"))
        XCTAssertFalse(FieldValidation.isValidDate(""))
    }
    func testNonNegative() {
        XCTAssertTrue(FieldValidation.isNonNegativeNumber("0"))
        XCTAssertTrue(FieldValidation.isNonNegativeNumber("120.50"))
        XCTAssertFalse(FieldValidation.isNonNegativeNumber("-5"))
        XCTAssertFalse(FieldValidation.isNonNegativeNumber("abc"))
    }
    func testDictationTransitions() {
        var s = DictationState.idle
        s = s.next(.start); XCTAssertEqual(s, .listening)
        s = s.next(.stop);  XCTAssertEqual(s, .idle)
        XCTAssertEqual(DictationState.idle.next(.denied), .denied)
        XCTAssertEqual(DictationState.denied.next(.start), .denied) // denied is terminal until re-auth
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./ios/run-workflow-tests.sh`
Expected: FAIL — `cannot find 'FieldValidation'`.

- [ ] **Step 3: Write both files**

`FieldValidation.swift`:
```swift
import Foundation

enum FieldValidation {
    static func isValidDate(_ s: String) -> Bool {
        s.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
    }
    static func isNonNegativeNumber(_ s: String) -> Bool {
        guard let n = Double(s) else { return false }
        return n >= 0
    }
}
```

`DictationState.swift`:
```swift
import Foundation

enum DictationState: Equatable {
    case idle, listening, denied
    enum Event { case start, stop, denied }
    func next(_ e: Event) -> DictationState {
        switch (self, e) {
        case (_, .denied): return .denied
        case (.denied, _): return .denied
        case (.idle, .start): return .listening
        case (.listening, .stop): return .idle
        default: return self
        }
    }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `./ios/run-workflow-tests.sh`
Expected: PASS (all 6 test files green now).

- [ ] **Step 5: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/FieldValidation.swift ios/RMPGFlexTester/RMPGFlexTester/DictationState.swift ios/RMPGFlexTester/RMPGFlexTesterTests/FieldValidationTests.swift
git commit -m "feat(ios): field validation + dictation state machine (pure)"
```

---

### Task 9: Server change — `field_photos.incident_id`

**Files:**
- Modify: `src/routes/fieldPhotos.ts:35-49` (ensureTable), `:67-88` (POST), `:96-116` (GET)

- [ ] **Step 1: Add the column to `ensureTable` + a guarded ALTER**

In `ensureTable()`, add `incident_id INTEGER,` after the `call_id INTEGER,` line in the `CREATE TABLE`, then after the `CREATE TABLE` execute add:

```ts
  // D1 has no IF NOT EXISTS on ADD COLUMN — swallow the re-apply error.
  try { await execute(db, `ALTER TABLE field_photos ADD COLUMN incident_id INTEGER`); } catch { /* exists */ }
```

- [ ] **Step 2: Parse + insert `incident_id` in the POST handler**

After the `callId` parse line, add:
```ts
  const incidentIdRaw = form.get('incident_id');
  const incidentId = incidentIdRaw != null && incidentIdRaw !== '' ? parseInt(String(incidentIdRaw), 10) : null;
```
Change the INSERT to include the column + value:
```ts
  const r = await execute(db,
    `INSERT INTO field_photos (officer_id, call_id, incident_id, r2_key, content_type, size_bytes, latitude, longitude, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    user.id, Number.isFinite(callId as number) ? callId : null,
    Number.isFinite(incidentId as number) ? incidentId : null,
    key, file.type, file.size,
    Number.isFinite(lat as number) ? lat : null, Number.isFinite(lng as number) ? lng : null, notes,
  );
```

- [ ] **Step 3: Add `incident_id` to the GET filter**

In `GET /`, after the `call_id` filter block add:
```ts
  if (c.req.query('incident_id')) { where.push('p.incident_id = ?'); p.push(parseInt(c.req.query('incident_id')!, 10)); }
```
and add `p.incident_id,` to the SELECT column list.

- [ ] **Step 4: Typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; 411 vitest tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/fieldPhotos.ts
git commit -m "feat(field-photos): incident_id linkage for report evidence"
```

- [ ] **Step 6: Apply to live D1 (post-merge, documented for the executor)**

After the PR merges, apply directly to live `rmpg-flex` (`785de7ae-…`) via the Cloudflare D1 API:
`ALTER TABLE field_photos ADD COLUMN incident_id INTEGER;`
then verify: `SELECT name FROM pragma_table_info('field_photos') WHERE name='incident_id';` (expect one row). The boot-time guarded ALTER also self-heals on first write.

---

### Task 10: Dictation engine (Speech, compile-only)

**Files:**
- Create: `ios/RMPGFlexTester/RMPGFlexTester/Dictation.swift`

- [ ] **Step 1: Write the engine** (wraps `DictationState`; Speech framework)

```swift
import Foundation
import Speech
import AVFoundation

@MainActor
final class Dictation: ObservableObject {
    @Published private(set) var state: DictationState = .idle
    @Published var transcript = ""

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    func requestAuth() {
        SFSpeechRecognizer.requestAuthorization { [weak self] auth in
            Task { @MainActor in
                if auth != .authorized { self?.state = self?.state.next(.denied) ?? .denied }
            }
        }
    }

    func start(seed: String) {
        guard state == .idle, let recognizer, recognizer.isAvailable else { return }
        transcript = seed
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        request = req
        let node = engine.inputNode
        node.installTap(onBus: 0, bufferSize: 1024, format: node.outputFormat(forBus: 0)) { buf, _ in
            req.append(buf)
        }
        try? AVAudioSession.sharedInstance().setCategory(.record, mode: .measurement, options: .duckOthers)
        try? AVAudioSession.sharedInstance().setActive(true, options: .notifyOthersOnDeactivation)
        engine.prepare(); try? engine.start()
        let base = seed.isEmpty ? "" : seed + " "
        task = recognizer.recognitionTask(with: req) { [weak self] result, _ in
            if let result { Task { @MainActor in self?.transcript = base + result.bestTranscription.formattedString } }
        }
        state = state.next(.start)
    }

    func stop() {
        engine.stop(); engine.inputNode.removeTap(onBus: 0)
        request?.endAudio(); task?.cancel(); task = nil; request = nil
        state = state.next(.stop)
    }
}
```

- [ ] **Step 2: Compile-check**

Run: `ios/refresh-device.sh --force`
Expected: compiles clean.

- [ ] **Step 3: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/Dictation.swift
git commit -m "feat(ios): on-device dictation engine (Speech)"
```

---

### Task 11: Info.plist usage strings (build settings)

**Files:**
- Modify: `ios/RMPGFlexTester/RMPGFlexTester.xcodeproj/project.pbxproj`
- Modify: `ios/refresh-device.sh` (the generated Info.plist block)

- [ ] **Step 1: Add the speech key to `refresh-device.sh`'s Info.plist** (the device build uses this plist)

In the `cat > "$APP/Info.plist"` heredoc, after the `NSMicrophoneUsageDescription` line add:
```xml
<key>NSSpeechRecognitionUsageDescription</key><string>RMPG Flex transcribes your dictation on-device to fill report and workflow narratives.</string>
```

- [ ] **Step 2: Add the same keys to the Xcode build settings** (for GUI builds)

In `project.pbxproj`, in both `buildSettings` blocks for the app target, add:
```
INFOPLIST_KEY_NSSpeechRecognitionUsageDescription = "RMPG Flex transcribes your dictation on-device to fill report and workflow narratives.";
```
(`NSMicrophoneUsageDescription` is already present via the recorder feature.)

- [ ] **Step 3: Compile-check**

Run: `ios/refresh-device.sh --force`
Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester.xcodeproj/project.pbxproj ios/refresh-device.sh
git commit -m "chore(ios): speech-recognition usage string"
```

---

### Task 12: Field-type views

**Files:**
- Create: `ios/RMPGFlexTester/RMPGFlexTester/WorkflowFieldViews.swift`

> These are SwiftUI (not unit-tested); verified by compile + device. Each binds to a
> `FieldValue` through a shared `@Binding`. Build them on `Theme` tokens.

- [ ] **Step 1: Write the field-type views**

```swift
import SwiftUI

// Shared small helpers ------------------------------------------------------

private func binding(_ values: Binding<[String: FieldValue]>, _ key: String) -> Binding<String> {
    Binding(
        get: { if case .string(let s)? = values.wrappedValue[key] { return s } ; return "" },
        set: { values.wrappedValue[key] = .string($0) })
}

struct FieldLabel: View {
    let text: String; var required = false
    var body: some View {
        HStack(spacing: 3) {
            Text(text.uppercased()).font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.neutral)
            if required { Text("•").foregroundStyle(Theme.gold) }
        }
    }
}

// text -----------------------------------------------------------------------
struct TextFieldRow: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: field.label, required: field.required)
            TextField(field.label, text: binding($values, field.key), axis: .vertical)
                .lineLimit(1...4).padding(8).background(Theme.raised)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
    }
}

// dictatableNarrative --------------------------------------------------------
struct DictationBar: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    @StateObject private var dictation = Dictation()
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            FieldLabel(text: field.label, required: field.required)
            TextEditor(text: binding($values, field.key))
                .frame(minHeight: 96).scrollContentBackground(.hidden)
                .padding(6).background(Theme.raised)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            HStack {
                Button {
                    if dictation.state == .listening { dictation.stop() }
                    else { dictation.start(seed: currentText) }
                } label: {
                    Image(systemName: dictation.state == .listening ? "stop.circle.fill" : "mic.circle.fill")
                        .font(.system(size: 34)).foregroundStyle(Theme.gold)
                }
                Text(dictation.state == .listening ? "Listening · tap to stop"
                     : dictation.state == .denied ? "Enable speech in Settings" : "Tap to dictate")
                    .font(.system(size: 11)).foregroundStyle(Theme.neutral)
                Spacer()
            }
        }
        .onAppear { dictation.requestAuth() }
        .onChange(of: dictation.transcript) { _, new in values[field.key] = .string(new) }
    }
    private var currentText: String { if case .string(let s)? = values[field.key] { return s }; return "" }
}

// chips / segmented / picker -------------------------------------------------
struct ChipRow: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            FieldLabel(text: field.label, required: field.required)
            FlexWrap(field.options ?? []) { opt in
                let selected = currentValue == opt.value
                Button(opt.label) { values[field.key] = .string(opt.value) }
                    .font(.system(size: 11, weight: .semibold))
                    .padding(.horizontal, 9).padding(.vertical, 6)
                    .background(selected ? Theme.gold : Theme.raised)
                    .foregroundStyle(selected ? .black : .white)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            }
        }
    }
    private var currentValue: String { if case .string(let s)? = values[field.key] { return s }; return "" }
}

struct SegmentedRow: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            FieldLabel(text: field.label, required: field.required)
            HStack(spacing: 0) {
                ForEach(field.options ?? [], id: \.value) { opt in
                    let selected = currentValue == opt.value
                    Text(opt.label).font(.system(size: 12, weight: .semibold))
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                        .background(selected ? Theme.gold : Theme.raised)
                        .foregroundStyle(selected ? .black : .white)
                        .onTapGesture { values[field.key] = .string(opt.value) }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
        }
    }
    private var currentValue: String { if case .string(let s)? = values[field.key] { return s }; return "" }
}

struct PickerRow: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: field.label, required: field.required)
            Picker(field.label, selection: binding($values, field.key)) {
                Text("—").tag("")
                ForEach(field.options ?? [], id: \.value) { Text($0.label).tag($0.value) }
            }.pickerStyle(.menu).tint(Theme.gold)
        }
    }
}

// date / time / number / toggle ---------------------------------------------
struct DateRow: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    @State private var date = Date()
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: field.label, required: field.required)
            DatePicker("", selection: $date, displayedComponents: .date)
                .labelsHidden().tint(Theme.gold)
                .onChange(of: date) { _, d in values[field.key] = .string(Self.fmt.string(from: d)) }
                .onAppear { values[field.key] = .string(Self.fmt.string(from: date)) }
        }
    }
    static let fmt: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f }()
}

struct NumberRow: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: field.label, required: field.required)
            TextField("0", text: binding($values, field.key)).keyboardType(.decimalPad)
                .padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
    }
}

struct ToggleRow: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        Toggle(isOn: Binding(
            get: { if case .bool(let b)? = values[field.key] { return b }; return false },
            set: { values[field.key] = .bool($0) })) {
            Text(field.label).font(.system(size: 12)).foregroundStyle(.white)
        }.tint(Theme.gold)
    }
}

// Minimal flow-wrap layout for chips.
struct FlexWrap<Data: RandomAccessCollection, Content: View>: View where Data.Element == FieldOption {
    let data: Data; let content: (FieldOption) -> Content
    init(_ data: Data, @ViewBuilder content: @escaping (FieldOption) -> Content) { self.data = data; self.content = content }
    var body: some View {
        // Simple 3-column grid is adequate for our short option lists.
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 90), spacing: 6)], spacing: 6) {
            ForEach(Array(data), id: \.value) { content($0) }
        }
    }
}
```

- [ ] **Step 2: Add the photo / scan / gps / statute / signature field views** (append to the same file)

```swift
import PhotosUI

// photo ----------------------------------------------------------------------
struct PhotoStrip: View {
    let field: WorkflowField
    @Binding var pendingPhotos: [UIImage]
    @State private var showCamera = false
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            FieldLabel(text: field.label)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(pendingPhotos.indices, id: \.self) { i in
                        Image(uiImage: pendingPhotos[i]).resizable().scaledToFill()
                            .frame(width: 56, height: 56).clipped()
                            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    }
                    Button { showCamera = true } label: {
                        Image(systemName: "plus").font(.system(size: 18)).foregroundStyle(Theme.gold)
                            .frame(width: 56, height: 56)
                            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, style: .init(dash: [3])))
                    }
                }
            }
        }
        .sheet(isPresented: $showCamera) { CameraPicker { pendingPhotos.append($0) }.ignoresSafeArea() }
    }
}

// gpsLocation ----------------------------------------------------------------
struct GPSLocationField: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: field.label, required: field.required)
            HStack {
                TextField("Address", text: binding($values, field.key))
                    .padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                Button { tagGPS() } label: { Image(systemName: "location.fill").foregroundStyle(Theme.gold) }
            }
        }
    }
    private func tagGPS() {
        guard let loc = LocationManager.shared.last else { return }
        values["latitude"] = .number(loc.coordinate.latitude)
        values["longitude"] = .number(loc.coordinate.longitude)
    }
}

// scanSubject / scanVehicle (prefill-confirm cards) --------------------------
struct ScanSubjectCard: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: field.label)
            TextField("Name", text: binding($values, "person_name"))
                .padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            HStack {
                TextField("DOB", text: binding($values, "person_dob"))
                TextField("DL #", text: binding($values, "person_dl"))
            }.font(.system(size: 12)).padding(8).background(Theme.raised)
             .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
    }
}

struct ScanVehicleCard: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: field.label)
            HStack {
                TextField("Plate", text: binding($values, "vehicle_plate"))
                TextField("State", text: binding($values, "vehicle_state"))
            }.padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            TextField("Make / model / color", text: binding($values, "vehicle_description"))
                .padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
    }
}

// statuteSearch (debounced GET /api/statutes) --------------------------------
struct StatuteSearchField: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {  // v1: free-text statute citation; live search is a fast-follow.
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: field.label, required: field.required)
            TextField("e.g. 41-6a-601 Speeding", text: binding($values, "statute_citation"))
                .padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
    }
}

// signature (v1 placeholder: deferred to civil-notice fast-follow) -----------
struct SignaturePad: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View { EmptyView() }  // not used by any PR1/PR2 definition
}
```

- [ ] **Step 3: Compile-check**

Run: `ios/refresh-device.sh --force`
Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/WorkflowFieldViews.swift
git commit -m "feat(ios): workflow field-type views"
```

---

### Task 13: Workflow renderer

**Files:**
- Create: `ios/RMPGFlexTester/RMPGFlexTester/WorkflowRenderer.swift`

- [ ] **Step 1: Write the renderer**

```swift
import SwiftUI

struct WorkflowRenderer: View {
    let def: WorkflowDefinition
    var prefill: [String: FieldValue] = [:]

    @Environment(\.dismiss) private var dismiss
    @State private var values: [String: FieldValue] = [:]
    @State private var step = 0
    @State private var pendingPhotos: [UIImage] = []
    @State private var draftId: Int?
    @State private var readiness: [ReadinessItem] = []
    @State private var status: String?
    @State private var busy = false

    private var isLastStep: Bool { step >= def.steps.count }   // step == count → review

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    stepPills
                    if isLastStep { reviewStep } else { fieldStep(def.steps[step]) }
                    if let status { StatusLine(text: status) }
                }.padding(12)
            }
            .background(Theme.base)
            .navigationTitle(def.title.uppercased())
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) { primaryBar }
            .onAppear { values.merge(prefill) { _, new in new }; applyDefaults() }
        }
    }

    private var stepPills: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 5) {
                ForEach(def.steps.indices, id: \.self) { i in
                    Text(def.steps[i].title)
                        .font(.system(size: 10, weight: .semibold))
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(i == step ? Theme.gold : Theme.raised)
                        .foregroundStyle(i == step ? .black : Theme.neutral)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                }
                Text("REVIEW").font(.system(size: 10, weight: .semibold))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(isLastStep ? Theme.gold : Theme.raised)
                    .foregroundStyle(isLastStep ? .black : Theme.neutral)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            }
        }
    }

    @ViewBuilder private func fieldStep(_ s: WorkflowStep) -> some View {
        ForEach(s.fields, id: \.key) { f in fieldView(f) }
    }

    @ViewBuilder private func fieldView(_ f: WorkflowField) -> some View {
        switch f.type {
        case .text: TextFieldRow(field: f, values: $values)
        case .dictatableNarrative: DictationBar(field: f, values: $values)
        case .chips: ChipRow(field: f, values: $values)
        case .segmented: SegmentedRow(field: f, values: $values)
        case .picker: PickerRow(field: f, values: $values)
        case .date, .time: DateRow(field: f, values: $values)
        case .number: NumberRow(field: f, values: $values)
        case .toggle: ToggleRow(field: f, values: $values)
        case .photo: PhotoStrip(field: f, pendingPhotos: $pendingPhotos)
        case .gpsLocation: GPSLocationField(field: f, values: $values)
        case .scanSubject: ScanSubjectCard(field: f, values: $values)
        case .scanVehicle: ScanVehicleCard(field: f, values: $values)
        case .statuteSearch: StatuteSearchField(field: f, values: $values)
        case .signature: SignaturePad(field: f, values: $values)
        }
    }

    private var reviewStep: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Readiness")
            ForEach(localReadiness() + readiness, id: \.label) { item in
                HStack(spacing: 7) {
                    Image(systemName: item.satisfied ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(item.satisfied ? Theme.green : Theme.orange)
                    Text(item.label).font(.system(size: 12)).foregroundStyle(.white)
                }
            }
        }.themeCard()
    }

    private func localReadiness() -> [ReadinessItem] {
        let required = def.allFields.filter(\.required)
        let present = Set(required.map(\.key).filter { !(values[$0]?.isEmpty ?? true) })
        return WorkflowValidation.readiness(
            requiredKeys: required.map(\.key), present: present,
            labels: Dictionary(uniqueKeysWithValues: required.map { ($0.key, $0.label) }))
    }

    private var primaryBar: some View {
        Button(isLastStep ? (busy ? "SUBMITTING…" : "SUBMIT") : "NEXT") {
            Task { isLastStep ? await submit() : advance() }
        }
        .buttonStyle(GoldButtonStyle()).disabled(busy).padding(12).background(Theme.base)
    }

    private func advance() { if step < def.steps.count { step += 1 } }
    private func applyDefaults() { for f in def.allFields where values[f.key] == nil { if let d = f.defaultValue { values[f.key] = d } } }

    // Submit: single POST or lifecycle finalize, with generic validation mapping.
    @MainActor private func submit() async {
        busy = true; defer { busy = false }
        let missing = def.missingRequiredKeys(in: values)
        guard missing.isEmpty else { status = "⚠ Fill required fields first"; return }
        let err = await authedRetrying { c in
            let id = try await postOrCreate(c)
            try await uploadPhotos(c, recordId: id)
            try await finalizeIfNeeded(c, id: id)
            status = "✓ " + def.success.message.replacingOccurrences(of: "{\(def.success.numberKey)}", with: "submitted")
        }
        if let err {
            let body = RMPGAPIClient.apiBody(err) ?? [:]
            let mapped = WorkflowValidation.serverErrors(from: body)
            if !mapped.isEmpty { readiness = mapped; status = "⚠ \(mapped.count) to fix before submit" }
            else { status = "✗ \(err.localizedDescription)" }
        }
    }

    private func postOrCreate(_ c: RMPGAPIClient) async throws -> Int? {
        let body = WorkflowBody.json(values)
        switch def.submit {
        case .single(let post):
            let res = try await c.requestJSON("POST", post, body: body)
            return extractId(res)
        case .lifecycle(let create, _, _):
            if let draftId { return draftId }
            let res = try await c.requestJSON("POST", create, body: body)
            let id = extractId(res); draftId = id; return id
        }
    }

    private func finalizeIfNeeded(_ c: RMPGAPIClient, id: Int?) async throws {
        if case .lifecycle(_, let update, let finalize) = def.submit, let id {
            try await c.requestJSON("PUT", update.replacingOccurrences(of: "{id}", with: "\(id)"), body: WorkflowBody.json(values))
            try await c.requestJSON("PUT", finalize.replacingOccurrences(of: "{id}", with: "\(id)"), body: [:])
        }
    }

    private func uploadPhotos(_ c: RMPGAPIClient, recordId: Int?) async throws {
        guard !pendingPhotos.isEmpty else { return }
        var fields = WorkflowBody.multipartFields(values.filter { ["latitude", "longitude"].contains($0.key) })
        if def.id == "incident", let recordId { fields["incident_id"] = "\(recordId)" }
        if let cid = values["call_id"], case .number(let n) = cid { fields["call_id"] = "\(Int(n))" }
        for img in pendingPhotos {
            if let jpeg = img.jpegData(compressionQuality: 0.8) {
                _ = try await MultipartUpload.upload(c, path: "api/field-photos", fields: fields, jpeg: jpeg)
            }
        }
    }

    private func extractId(_ res: Any) -> Int? {
        if let o = res as? [String: Any] {
            if let id = o["id"] as? Int { return id }
            if let d = o["data"] as? [String: Any], let id = d["id"] as? Int { return id }
        }
        return nil
    }
}
```

- [ ] **Step 2: Compile-check**

Run: `ios/refresh-device.sh --force`
Expected: compiles clean (fix any switch-exhaustiveness warnings the compiler flags).

- [ ] **Step 3: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/WorkflowRenderer.swift
git commit -m "feat(ios): stepped workflow renderer (single + lifecycle submit)"
```

---

### Task 14: Registry with 3 proving workflows (pure)

**Files:**
- Create: `ios/RMPGFlexTester/RMPGFlexTester/WorkflowRegistry.swift`
- Test: `ios/RMPGFlexTester/RMPGFlexTesterTests/WorkflowRegistryTests.swift`

> Before writing the citation/patrol definitions, the executor reads the exact body
> allow-lists: `src/routes/citations.ts:279-295` (optional keys) and `src/routes/patrol.ts`
> (`POST /scan` body). The field keys below match those contracts.

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import RMPGFlexTester

final class WorkflowRegistryTests: XCTestCase {
    func testWellFormed() {
        XCTAssertGreaterThanOrEqual(WorkflowRegistry.all.count, 3)
        for d in WorkflowRegistry.all {
            XCTAssertFalse(d.id.isEmpty)
            XCTAssertFalse(d.roles.isEmpty)
            XCTAssertFalse(d.steps.isEmpty)
            for f in d.allFields { XCTAssertFalse(f.key.isEmpty, "\(d.id) has an empty field key") }
        }
        XCTAssertEqual(Set(WorkflowRegistry.all.map(\.id)).count, WorkflowRegistry.all.count, "ids unique")
    }
    func testProvingSlicePresent() {
        let ids = Set(WorkflowRegistry.all.map(\.id))
        XCTAssertTrue(ids.isSuperset(of: ["incident", "citation", "patrol_scan"]))
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./ios/run-workflow-tests.sh`
Expected: FAIL — `cannot find 'WorkflowRegistry'`.

- [ ] **Step 3: Write the registry**

```swift
import Foundation

enum WorkflowRegistry {
    static let all: [WorkflowDefinition] = [incident, citation, patrolScan]

    static let incident = WorkflowDefinition(
        id: "incident", title: "Incident report", icon: "doc.text.fill",
        category: .reports, roles: ["admin", "manager", "supervisor", "officer"],
        submit: .lifecycle(create: "api/incidents", update: "api/incidents/{id}", finalize: "api/incidents/{id}/submit"),
        encoding: .json,
        steps: [
            WorkflowStep(title: "Type", fields: [
                WorkflowField(key: "incident_type", type: .chips, label: "Incident type", required: true, options: [
                    FieldOption(value: "theft", label: "Theft"), FieldOption(value: "disturbance", label: "Disturbance"),
                    FieldOption(value: "trespass", label: "Trespass"), FieldOption(value: "suspicious", label: "Suspicious"),
                    FieldOption(value: "alarm", label: "Alarm"), FieldOption(value: "assist", label: "Assist")]),
                WorkflowField(key: "priority", type: .segmented, label: "Priority", options: [
                    FieldOption(value: "P1", label: "P1"), FieldOption(value: "P2", label: "P2"),
                    FieldOption(value: "P3", label: "P3")], defaultValue: .string("P3")),
            ]),
            WorkflowStep(title: "Location", fields: [
                WorkflowField(key: "location_address", type: .gpsLocation, label: "Location", required: true),
            ]),
            WorkflowStep(title: "Narrative", fields: [
                WorkflowField(key: "narrative", type: .dictatableNarrative, label: "Narrative", required: true),
            ]),
            WorkflowStep(title: "Photos", fields: [
                WorkflowField(key: "photos", type: .photo, label: "Evidence photos"),
            ]),
        ],
        prefill: [.call, .gps],
        success: SuccessSpec(numberKey: "incident_number", message: "Filed {incident_number}"))

    static let citation = WorkflowDefinition(
        id: "citation", title: "Citation / warning", icon: "doc.plaintext.fill",
        category: .reports, roles: ["admin", "manager", "supervisor", "officer"],
        submit: .single(post: "api/citations"), encoding: .json,
        steps: [
            WorkflowStep(title: "Type", fields: [
                WorkflowField(key: "is_warning", type: .segmented, label: "Disposition", options: [
                    FieldOption(value: "0", label: "Citation"), FieldOption(value: "1", label: "Warning")], defaultValue: .string("0")),
                WorkflowField(key: "violation_date", type: .date, label: "Violation date", required: true),
            ]),
            WorkflowStep(title: "Subject", fields: [
                WorkflowField(key: "subject", type: .scanSubject, label: "Subject"),
                WorkflowField(key: "vehicle", type: .scanVehicle, label: "Vehicle"),
            ]),
            WorkflowStep(title: "Violation", fields: [
                WorkflowField(key: "statute", type: .statuteSearch, label: "Statute"),
                WorkflowField(key: "violation_description", type: .dictatableNarrative, label: "Violation", required: true),
                WorkflowField(key: "fine_amount", type: .number, label: "Fine ($)"),
                WorkflowField(key: "location", type: .gpsLocation, label: "Location"),
            ]),
        ],
        prefill: [.scanSubject, .scanVehicle, .gps],
        success: SuccessSpec(numberKey: "citation_number", message: "Issued {citation_number}"))

    static let patrolScan = WorkflowDefinition(
        id: "patrol_scan", title: "Tour checkpoint scan", icon: "qrcode.viewfinder",
        category: .patrol, roles: ["admin", "manager", "supervisor", "officer"],
        submit: .single(post: "api/patrol/scan"), encoding: .json,
        steps: [
            WorkflowStep(title: "Scan", fields: [
                WorkflowField(key: "checkpoint_id", type: .picker, label: "Checkpoint", required: true),
                WorkflowField(key: "notes", type: .dictatableNarrative, label: "Notes"),
                WorkflowField(key: "location", type: .gpsLocation, label: "Location"),
            ]),
        ],
        prefill: [.gps],
        success: SuccessSpec(numberKey: "id", message: "Checkpoint logged"))
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `./ios/run-workflow-tests.sh`
Expected: PASS (registry tests).

- [ ] **Step 5: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/WorkflowRegistry.swift ios/RMPGFlexTester/RMPGFlexTesterTests/WorkflowRegistryTests.swift
git commit -m "feat(ios): workflow registry + 3 proving definitions"
```

> NOTE for executor: `checkpoint_id` `picker` options are populated at render time from
> `GET /api/patrol/checkpoints` — wire that in Task 15's hub `onAppear` or leave the picker
> empty-but-typable for v1 and fast-follow the live checkpoint list. Document whichever you choose in the PR.

---

### Task 15: Workflow hub + app integration

**Files:**
- Create: `ios/RMPGFlexTester/RMPGFlexTester/WorkflowHubView.swift`
- Modify: `ios/RMPGFlexTester/RMPGFlexTester/FieldOpsView.swift` (add a "Workflows" card)

- [ ] **Step 1: Write the hub**

```swift
import SwiftUI

struct WorkflowHubView: View {
    @EnvironmentObject var session: AuthSession
    var prefill: [String: FieldValue] = [:]
    private var role: String { session.role ?? "officer" }

    private var visible: [WorkflowDefinition] { WorkflowRegistry.all.filter { $0.roles.contains(role) } }
    private func grouped(_ c: WorkflowCategory) -> [WorkflowDefinition] { visible.filter { $0.category == c } }

    private let catTitles: [(WorkflowCategory, String)] = [
        (.reports, "FIELD REPORTS"), (.patrol, "PATROL & SECURITY"),
        (.people, "PEOPLE & CASES"), (.civil, "CIVIL / ADMIN")]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(catTitles, id: \.0) { cat, title in
                        let items = grouped(cat)
                        if !items.isEmpty {
                            SectionHeader(title: title)
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                                ForEach(items, id: \.id) { def in
                                    NavigationLink { WorkflowRenderer(def: def, prefill: prefill) } label: { tile(def) }
                                }
                            }
                        }
                    }
                }.padding(12)
            }
            .background(Theme.base)
            .navigationTitle("WORKFLOWS")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func tile(_ def: WorkflowDefinition) -> some View {
        VStack(spacing: 6) {
            Image(systemName: def.icon).font(.system(size: 24)).foregroundStyle(Theme.gold)
            Text(def.title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                .multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity).padding(.vertical, 14).themeCard()
    }
}
```

- [ ] **Step 2: Verify `AuthSession` exposes `role`**

Read `ios/RMPGFlexTester/RMPGFlexTester/AuthSession.swift`. If it has no `role`, add a computed `var role: String?` decoding the JWT claim via the existing `JWTClaims` helper. (If `JWTClaims` already exposes role, use it.) Show the exact addition you make in the commit.

- [ ] **Step 3: Add the hub entry to `FieldOpsView`** (after the NOTIFICATIONS NavigationLink, mirror its card style)

```swift
                    NavigationLink { WorkflowHubView() } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "square.stack.3d.up.fill")
                                .foregroundStyle(Theme.gold).frame(width: 24)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("WORKFLOWS").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                                Text("Reports · citations · patrol · more").font(.system(size: 10)).foregroundStyle(Theme.neutral)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.neutral)
                        }.themeCard()
                    }
```

- [ ] **Step 4: Compile + bump the marker**

Run: `ios/refresh-device.sh --force`
Expected: compiles clean (installs on device if connected).

- [ ] **Step 5: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/WorkflowHubView.swift ios/RMPGFlexTester/RMPGFlexTester/FieldOpsView.swift ios/RMPGFlexTester/RMPGFlexTester/AuthSession.swift
git commit -m "feat(ios): workflow hub + Field Ops entry"
```

---

### Task 16: "On this call" + scan prefill wiring

**Files:**
- Modify: `ios/RMPGFlexTester/RMPGFlexTester/FieldOpsView.swift` (call card → report prefill)
- Modify: `ios/RMPGFlexTester/RMPGFlexTester/IDScanView.swift` (scan → citation prefill)

- [ ] **Step 1: Add a "Write report on this call" action to `FieldOpsView.callCard`**

Inside `callCard`, append a button that pushes `WorkflowRenderer(def: WorkflowRegistry.incident, prefill: callPrefill(call))` where:
```swift
    private func callPrefill(_ call: [String: Any]) -> [String: FieldValue] {
        var p: [String: FieldValue] = [:]
        if let id = call["id"] as? Int { p["call_id"] = .number(Double(id)) }
        if let addr = (call["location_address"] as? String) ?? (call["address"] as? String) { p["location_address"] = .string(addr) }
        if let t = (call["incident_type"] as? String) ?? (call["call_type"] as? String) { p["incident_type"] = .string(t) }
        return p
    }
```

- [ ] **Step 2: Add a "Cite this subject" action after a successful scan in `IDScanView`**

Where the scan result is shown, add a NavigationLink to `WorkflowRenderer(def: WorkflowRegistry.citation, prefill: scanPrefill)` mapping the parsed AAMVA/MRZ fields → `person_name`, `person_dob`, `person_dl` (and any vehicle fields from a plate run).

- [ ] **Step 3: Compile-check**

Run: `ios/refresh-device.sh --force`
Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/FieldOpsView.swift ios/RMPGFlexTester/RMPGFlexTester/IDScanView.swift
git commit -m "feat(ios): prefill reports from call + citations from scan"
```

---

### Task 17: PR1 full verification

- [ ] **Step 1: Run the pure-logic suite**

Run: `./ios/run-workflow-tests.sh`
Expected: all 6 test files pass.

- [ ] **Step 2: Full app compile + install**

Run: `ios/refresh-device.sh --force`
Expected: clean compile; app installs/launches if the iPhone is connected.

- [ ] **Step 3: Server suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; 411 vitest pass.

- [ ] **Step 4: Live smoke (device + D1 Console tab)**

On the connected iPhone (signed in): open Field Ops → Workflows → file an Incident (dictate a sentence, attach a photo, Submit; observe NIBRS readiness if it 422s), issue a Citation, and log a Patrol scan. Then in System → D1 Console run `SELECT id, incident_id, call_id FROM field_photos ORDER BY id DESC LIMIT 3;` and confirm the incident photo carries `incident_id`.

- [ ] **Step 5: Bump the service worker?** N/A — this is the native app, not the web client; no `sw.js` bump.

---

### Task 18: Open PR1

- [ ] **Step 1: Push the branch and open the PR**

```bash
git push -u origin HEAD
gh pr create --base main --title "feat(ios): field workflows platform — engine + reports/citations/patrol scan" \
  --body "Declarative workflow engine (model+encoder+validation, swift test), field-type views, renderer, hub, MultipartUpload refactor, and field_photos.incident_id. First 3 of ~13 workflows. Spec: docs/superpowers/specs/2026-06-13-ios-field-reports-citations-design.md. Apply the live-D1 ALTER per the spec §7 after merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: Note the live-D1 follow-up in the PR body** (already included above) so the merger applies `ALTER TABLE field_photos ADD COLUMN incident_id INTEGER` to `785de7ae` and verifies via `pragma_table_info`.

---

## PR2 — remaining ~10 workflow definitions

> Each task: (a) read the route's body allow-list to lock field keys, (b) append a
> `WorkflowDefinition` to `WorkflowRegistry.all`, (c) extend `WorkflowRegistryTests` count,
> (d) `./ios/run-workflow-tests.sh`, (e) device smoke, (f) commit. The renderer/field views
> already handle every field type — no new UI unless a new `FieldType` is genuinely needed.

Branch off the merged PR1 main: `git checkout main && git pull && git checkout -b claude/ios-workflows-pr2`.

### Task 19: Field interview
Read `src/routes/fieldInterviews.ts:365` (POST body). Append:
```swift
static let fieldInterview = WorkflowDefinition(
    id: "field_interview", title: "Field interview", icon: "person.text.rectangle.fill",
    category: .reports, roles: ["admin","manager","supervisor","officer"],
    submit: .single(post: "api/field-interviews"), encoding: .json,
    steps: [
        WorkflowStep(title: "Subject", fields: [
            WorkflowField(key: "subject", type: .scanSubject, label: "Subject"),
            WorkflowField(key: "location", type: .gpsLocation, label: "Location", required: true)]),
        WorkflowStep(title: "Detail", fields: [
            WorkflowField(key: "reason", type: .chips, label: "Reason", required: true, options: [
                FieldOption(value: "suspicious", label: "Suspicious"), FieldOption(value: "consensual", label: "Consensual"),
                FieldOption(value: "trespass", label: "Trespass"), FieldOption(value: "welfare", label: "Welfare")]),
            WorkflowField(key: "narrative", type: .dictatableNarrative, label: "Narrative", required: true),
            WorkflowField(key: "photos", type: .photo, label: "Photos")]),
    ], prefill: [.scanSubject, .gps], success: SuccessSpec(numberKey: "id", message: "FI card saved"))
```
Add to `all`. Bump the registry test count to `>= 4`. Commit `feat(ios): field interview workflow`.

### Task 20: Use of force
Read `src/routes/useOfForce.ts` POST body. Append a `use_of_force` definition (`.reports`) with `subject(scanSubject)`, `force_type(chips: hands/taser/baton/firearm/canine)`, `narrative(dictatableNarrative, required)`, `injuries(toggle)`, `photos(photo)`, `submit: .single(post: "api/use-of-force")`, `success: SuccessSpec(numberKey:"id", message:"UoF report saved")`. Commit.

### Task 21: Property / evidence
Read `src/routes/properties.ts` POST body. Append `property` (`.patrol`): `type(chips)`, `description(dictatableNarrative, required)`, `location(gpsLocation)`, `photos(photo)`, `submit: .single(post:"api/properties")`, `success(numberKey:"id", message:"Property logged")`. Commit.

### Task 22: Welfare check
Read `src/routes/welfare.ts` `/start` body. Append `welfare` (`.patrol`): `location(gpsLocation, required)`, `notes(dictatableNarrative)`, `submit: .single(post:"api/dispatch/welfare/start")`, `success(numberKey:"id", message:"Welfare check started")`. Commit.

### Task 23: Arrest / booking (custom sub-steps)
Read `src/routes/arrests.ts` `/manual`, `/manual/:id/miranda`, `/manual/:id/property`. Append `arrest` (`.people`) as `.lifecycle(create:"api/arrests/manual", update:"api/arrests/manual/{id}", finalize:"api/arrests/manual/{id}/miranda")` with steps `subject(scanSubject)`, `charges(chips)`, `narrative(dictatableNarrative, required)`. (Property list + full Miranda UI are a documented fast-follow; v1 records the arrest + a Miranda ack via finalize.) Commit.

### Task 24: Case open + note
Read `src/routes/cases.ts` POST `/`. Append `case` (`.people`): `title(text, required)`, `type(chips)`, `summary(dictatableNarrative)`, `submit: .single(post:"api/cases")`, `success(numberKey:"id", message:"Case opened")`. Commit.

### Task 25: Task / follow-up
Read `src/routes/tasks.ts` POST `/`. Append `task` (`.people`): `title(text, required)`, `priority(segmented P1..P3)`, `due(date)`, `notes(dictatableNarrative)`, `submit: .single(post:"api/tasks")`, `success(numberKey:"id", message:"Task created")`. Commit.

### Task 26: Community tip / event
Read `src/routes/community.ts` `/tips`,`/events`. Append `community` (`.civil`): `kind(segmented: tip/event)` — note this drives the path; since the engine posts one path, ship two definitions (`community_tip`, `community_event`) OR add a `pathByField` capability. Simplest: two definitions, `submit: .single(post:"api/community/tips")` and `.../events`. Commit.

### Task 27: Code enforcement / tow
Read `src/routes/codeEnforcement.ts` `/violations`,`/tows`. Append `code_violation` (`.civil`): `type(chips)`, `location(gpsLocation, required)`, `description(dictatableNarrative)`, `photos(photo)`, `submit: .single(post:"api/code-enforcement/violations")`. (Tow as a second definition if needed.) Commit.

### Task 28: Crisis / special-ops callout
Read `src/routes/crisisResponse.ts` `/incidents`. Append `crisis` (`.civil`): `type(chips)`, `location(gpsLocation, required)`, `narrative(dictatableNarrative, required)`, `submit: .single(post:"api/crisis-response/incidents")`. Commit.

### Task 29: PR2 verification + open
- [ ] Run `./ios/run-workflow-tests.sh` (registry count now ≥ 13; all green).
- [ ] Run `ios/refresh-device.sh --force` (clean compile).
- [ ] Device smoke: open the hub, confirm all categories populate and one workflow per new category submits.
- [ ] `git push -u origin HEAD && gh pr create --base main --title "feat(ios): field workflows platform — remaining 10 workflows" --body "Appends field interview, use-of-force, property, welfare, arrest, case, task, community, code-enforcement, crisis definitions to the registry. No new UI. 🤖 Generated with [Claude Code](https://claude.com/claude-code)"`

---

## Self-review notes (spec coverage)

- Engine (§3) → Tasks 2,6,7,8,13,14. Field-type library (§4) → Tasks 12. Hub (§3.4) → Task 15.
- Catalog first-batch (§5) → Tasks 14 (3 proving) + 19–28 (rest). Roadmap items correctly excluded.
- Server change (§7) → Task 9 (+ live-D1 step). Voice dictation (§9) → Tasks 8,10,11.
- Error handling/readiness (§8,§10) → Tasks 7,13. Roles (§11) → Task 15 (`visible` filter).
- Offline/autosave (§12): **partial** — drafts (lifecycle) covered; the local single-POST autosave is intentionally deferred to keep PR1 lean (note in PR body; full autosave is a small fast-follow or folds into sub-project C). Acceptance criterion 4 still met.
- Testing (§13) → harness Task 1 + per-task `swift test`/compile. Acceptance (§14) → Tasks 17/29.
