# RMPG Flex Connect — M0 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the skeleton of `RMPG Flex Connect` — a new iPhone app at `ios2/RMPGFlexConnect/` — that compiles, installs on a real iPhone via personal-team signing, presents a login screen, authenticates against `api.rmpgutah.us`, and routes to a role-aware tab shell (5 tabs officer / 4 tabs supervisor). Every tab is intentionally empty in M0; feature content starts in M1.

**Architecture:** SwiftUI app on iOS 17+. Modular Swift Package Manager packages under `Packages/` (`CoreAPI`, `CoreAuth`, `DesignSystem`, `FeatureShell`). Feature packages may import Core/Design; never each other. App target = thin composition root that wires the four packages together. Tests live inside each package and run via `swift test`. The `.xcodeproj` is created with Xcode's GUI from a precise checklist (the only manual step in this plan).

**Tech Stack:** Swift 5.9+, SwiftUI, SwiftData, Keychain Services, `URLSession` + `async/await`, Mapbox iOS SDK (binary xcframework via SPM — added in M1, not M0). iOS 17.0 minimum. No third-party deps in M0.

**Coexistence:** Nothing in `ios/RMPGFlexTester` is touched. Both apps install side-by-side via distinct bundle ids (`us.rmpgutah.flextester` vs `us.rmpgutah.flexconnect`).

**Reference spec:** [2026-06-22-rmpg-flex-connect-ios-design.md](../specs/2026-06-22-rmpg-flex-connect-ios-design.md)

---

## File Structure (what M0 creates)

```
ios2/RMPGFlexConnect/
├── README.md                                # Build + install instructions
├── refresh-device.sh                        # Wrapper script mirroring ios/refresh-device.sh
├── Packages/
│   ├── CoreAPI/
│   │   ├── Package.swift
│   │   ├── Sources/CoreAPI/
│   │   │   ├── APIClient.swift              # URLSession + async/await client
│   │   │   ├── APIError.swift               # Typed error enum (spec §8)
│   │   │   └── Endpoint.swift               # Request value type
│   │   └── Tests/CoreAPITests/
│   │       ├── APIClientTests.swift
│   │       └── APIErrorTests.swift
│   ├── CoreAuth/
│   │   ├── Package.swift
│   │   ├── Sources/CoreAuth/
│   │   │   ├── KeychainStore.swift          # Swiftier wrapper around Security.framework
│   │   │   ├── JWT.swift                    # Header.payload.sig decoder (no verify — server does)
│   │   │   ├── RoleResolver.swift           # Maps JWT role claim to .officer / .supervisor
│   │   │   ├── AuthAPI.swift                # POST /api/auth/login binding
│   │   │   └── AuthSession.swift            # @Observable; current token + role + signOut()
│   │   └── Tests/CoreAuthTests/
│   │       ├── JWTTests.swift
│   │       ├── RoleResolverTests.swift
│   │       └── KeychainStoreTests.swift
│   ├── DesignSystem/
│   │   ├── Package.swift
│   │   ├── Sources/DesignSystem/
│   │   │   ├── Theme.swift                  # ThemeMode (.day / .night), schedule resolver
│   │   │   ├── ThemeColors.swift            # Steel-blue token map (matches web palette)
│   │   │   ├── ThemeProvider.swift          # SwiftUI environment + view modifier
│   │   │   ├── StatusLine.swift             # Reusable status row
│   │   │   └── HeroCard.swift               # Used by Home in M1
│   │   └── Tests/DesignSystemTests/
│   │       └── ThemeScheduleTests.swift
│   └── FeatureShell/
│       ├── Package.swift
│       ├── Sources/FeatureShell/
│       │   ├── LoginView.swift              # Username + password + "Test login" button
│       │   ├── LoginViewModel.swift         # @Observable; state machine
│       │   ├── RoleAwareShell.swift         # switches OfficerShell vs SupervisorShell on role
│       │   ├── OfficerShell.swift           # TabView with 5 empty placeholder screens
│       │   ├── SupervisorShell.swift        # TabView with 4 empty placeholder screens
│       │   └── PlaceholderScreen.swift      # The "coming in M1" view used by every empty tab
│       └── Tests/FeatureShellTests/
│           ├── LoginViewModelTests.swift
│           └── RoleAwareShellTests.swift
├── RMPGFlexConnect/                         # Xcode app target source dir
│   ├── RMPGFlexConnectApp.swift             # @main, composes everything
│   ├── ContentView.swift                    # AuthGate — login OR shell
│   ├── Info.plist                           # Bundle id, version, NS*UsageDescription strings
│   └── Assets.xcassets/                     # AccentColor (Spillman gold), AppIcon placeholders
└── RMPGFlexConnect.xcodeproj                # Created in Task 6 via Xcode GUI
    └── project.pbxproj
```

**Note on `node_modules`:** This worktree may not have npm dependencies installed. The husky pre-commit hook runs the full vitest suite, which fails when `node_modules` is empty. **Before your first commit, run `npm ci` once at repo root.** This is a one-time setup, not a per-task step.

---

## Task 0: CarPlay entitlement request (day 1, async)

CarPlay Navigation entitlement approval is 2–8 weeks. File the request *now* so M5 has the entitlement when we need it.

- [ ] **Step 0.1:** Visit https://developer.apple.com/contact/carplay/ in a browser, log in with the RMPG Apple Developer account.

- [ ] **Step 0.2:** Submit the CarPlay request:
  - **Type:** CarPlay Navigation app
  - **App name:** RMPG Flex Connect
  - **Bundle ID:** `us.rmpgutah.flexconnect`
  - **Use case:** "Law enforcement / private security dispatch and CAD/RMS for Rocky Mountain Protective Group. Officers need hands-free turn-by-turn navigation to dispatched call locations, plus voice-driven status updates ('en-route', 'on-scene', 'clear') while driving. Replaces a separate, distracting paper map and phone-in-hand workflow."
  - **Team ID:** (from your Apple Developer account)

- [ ] **Step 0.3:** Save the confirmation email + ticket number to `ios2/RMPGFlexConnect/docs/carplay-entitlement-request.md` (don't commit the email itself — just the ticket reference, date, and status).

- [ ] **Step 0.4:** Schedule a check-in for 2 weeks out. If no response by then, follow up via the same form.

**This task has no code and does not block subsequent tasks. Continue to Task 1.**

---

## Task 1: Repo scaffold

**Files:**
- Create: `ios2/RMPGFlexConnect/README.md`
- Create: `ios2/RMPGFlexConnect/refresh-device.sh`
- Create: `ios2/.gitignore`
- Modify: root `.gitignore` (add `ios2/RMPGFlexConnect/RMPGFlexConnect.xcodeproj/xcuserdata/`)

- [ ] **Step 1.1: Create directory structure**

```bash
mkdir -p "ios2/RMPGFlexConnect/Packages"
mkdir -p "ios2/RMPGFlexConnect/RMPGFlexConnect/Assets.xcassets"
mkdir -p "ios2/RMPGFlexConnect/docs"
```

- [ ] **Step 1.2: Write `ios2/RMPGFlexConnect/README.md`**

```markdown
# RMPG Flex Connect

Native iPhone CAD/RMS app for Rocky Mountain Protective Group.

**Status:** M0 (Foundation) — login + role-aware shell. Feature content lands in M1+.
See [docs/superpowers/specs/2026-06-22-rmpg-flex-connect-ios-design.md](../../docs/superpowers/specs/2026-06-22-rmpg-flex-connect-ios-design.md).

## Layout

- `Packages/` — Local Swift packages (`CoreAPI`, `CoreAuth`, `DesignSystem`, `FeatureShell`).
- `RMPGFlexConnect/` — App target source (`@main`, `ContentView`, `Assets.xcassets`).
- `RMPGFlexConnect.xcodeproj` — Created by Xcode in M0/Task 6.

## Install on your iPhone

1. Open `RMPGFlexConnect.xcodeproj` in Xcode.
2. Target → Signing & Capabilities → select your personal team (a free Apple ID works; install expires after 7 days — re-run to refresh).
3. Plug in iPhone, pick it as the destination, press ⌘R.
4. On the phone: Settings → General → VPN & Device Management → trust the cert.
5. In Settings inside the app, enter RMPG creds and tap "Test login".

## Test the packages from CLI

```bash
cd Packages/CoreAPI && swift test
cd Packages/CoreAuth && swift test
cd Packages/DesignSystem && swift test
cd Packages/FeatureShell && swift test
```

The Xcode GUI build may take longer; the CLI `swift test` runs in a couple of seconds per package.

## Coexistence with `ios/RMPGFlexTester`

This app has a distinct bundle id (`us.rmpgutah.flexconnect`) and installs alongside `RMPGFlexTester`. We deprecate the old app only after M1 is verified by a real shift.
```

- [ ] **Step 1.3: Write `ios2/RMPGFlexConnect/refresh-device.sh`** (mirrors `ios/refresh-device.sh` pattern)

```bash
#!/usr/bin/env bash
# Reinstall RMPG Flex Connect on the first connected iPhone via Xcode.
# Requires Xcode + the `xcrun` toolchain. CLI builds bypass the Xcode GUI deadlock noted in ios/README.md.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

DEVICE_ID="$(xcrun devicectl list devices --quiet --json-output - 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); [print(dev["identifier"]) for dev in d.get("result",{}).get("devices",[]) if dev.get("connectionProperties",{}).get("pairingState")=="paired"]' | head -n1)"

if [ -z "${DEVICE_ID}" ]; then
    echo "❌ No paired iPhone found. Connect a device and try again."
    exit 1
fi

echo "→ Building for device ${DEVICE_ID}..."
xcodebuild -scheme RMPGFlexConnect \
    -destination "id=${DEVICE_ID}" \
    -configuration Debug \
    -derivedDataPath .build \
    build

APP_PATH="$(find .build -name "RMPGFlexConnect.app" -type d | head -n1)"
echo "→ Installing ${APP_PATH}..."
xcrun devicectl device install app --device "${DEVICE_ID}" "${APP_PATH}"

echo "✅ Installed. Launch from the home screen."
```

```bash
chmod +x "ios2/RMPGFlexConnect/refresh-device.sh"
```

- [ ] **Step 1.4: Write `ios2/.gitignore`**

```gitignore
# Xcode user state — never commit
**/xcuserdata/
**/*.xcuserstate
**/xcshareddata/WorkspaceSettings.xcsettings

# SwiftPM build artifacts
**/.build/
**/.swiftpm/
**/Packages/*/Package.resolved
**/DerivedData/

# Generated
**/.DS_Store
```

- [ ] **Step 1.5: Verify git status shows the new files**

Run: `git status --short ios2/`
Expected: 3 new untracked files (`README.md`, `refresh-device.sh`, `.gitignore`).

- [ ] **Step 1.6: Commit**

```bash
git add ios2/.gitignore ios2/RMPGFlexConnect/README.md ios2/RMPGFlexConnect/refresh-device.sh
git commit -m "feat(ios2): scaffold RMPGFlexConnect M0 foundation directory"
```

---

## Task 2: SPM package — CoreAPI

Network layer with typed errors, JWT injection, async/await. Tests first.

**Files:**
- Create: `ios2/RMPGFlexConnect/Packages/CoreAPI/Package.swift`
- Create: `ios2/RMPGFlexConnect/Packages/CoreAPI/Sources/CoreAPI/APIError.swift`
- Create: `ios2/RMPGFlexConnect/Packages/CoreAPI/Sources/CoreAPI/Endpoint.swift`
- Create: `ios2/RMPGFlexConnect/Packages/CoreAPI/Sources/CoreAPI/APIClient.swift`
- Create: `ios2/RMPGFlexConnect/Packages/CoreAPI/Tests/CoreAPITests/APIErrorTests.swift`
- Create: `ios2/RMPGFlexConnect/Packages/CoreAPI/Tests/CoreAPITests/APIClientTests.swift`

- [ ] **Step 2.1: Write `Package.swift`**

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CoreAPI",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "CoreAPI", targets: ["CoreAPI"]),
    ],
    targets: [
        .target(name: "CoreAPI"),
        .testTarget(name: "CoreAPITests", dependencies: ["CoreAPI"]),
    ]
)
```

- [ ] **Step 2.2: Write the failing tests first — `Tests/CoreAPITests/APIErrorTests.swift`**

```swift
import XCTest
@testable import CoreAPI

final class APIErrorTests: XCTestCase {
    func testNotConfiguredEquality() {
        XCTAssertEqual(
            APIError.notConfigured(code: "fleetio_disabled"),
            APIError.notConfigured(code: "fleetio_disabled")
        )
        XCTAssertNotEqual(
            APIError.notConfigured(code: "a"),
            APIError.notConfigured(code: "b")
        )
    }

    func testServerErrorEquality() {
        XCTAssertEqual(
            APIError.server(status: 500, code: "boom", message: "nope"),
            APIError.server(status: 500, code: "boom", message: "nope")
        )
        XCTAssertNotEqual(
            APIError.server(status: 500, code: nil, message: nil),
            APIError.server(status: 502, code: nil, message: nil)
        )
    }

    func testUnauthorizedAndForbiddenSelfEqual() {
        XCTAssertEqual(APIError.unauthorized, APIError.unauthorized)
        XCTAssertEqual(APIError.forbidden, APIError.forbidden)
        XCTAssertNotEqual(APIError.unauthorized, APIError.forbidden)
    }
}
```

- [ ] **Step 2.3: Run tests — expect compile failure (APIError not yet defined)**

```bash
cd ios2/RMPGFlexConnect/Packages/CoreAPI && swift test
```
Expected: `error: cannot find 'APIError' in scope`.

- [ ] **Step 2.4: Implement `Sources/CoreAPI/APIError.swift`**

```swift
import Foundation

/// Typed errors emitted by `APIClient`.
///
/// The `notConfigured` case represents the
/// `{ ok: false, skipped: true, code: "..." }` envelope the Worker returns for
/// disabled-feature endpoints — it is *not* an outage. UI should map this to a
/// disabled affordance, not an error banner.
public enum APIError: Error, Equatable {
    case network(URLError)
    case unauthorized
    case forbidden
    case notConfigured(code: String)
    case server(status: Int, code: String?, message: String?)
    case decode(String)

    public static func == (lhs: APIError, rhs: APIError) -> Bool {
        switch (lhs, rhs) {
        case (.unauthorized, .unauthorized): return true
        case (.forbidden, .forbidden): return true
        case let (.notConfigured(a), .notConfigured(b)): return a == b
        case let (.server(s1, c1, m1), .server(s2, c2, m2)):
            return s1 == s2 && c1 == c2 && m1 == m2
        case let (.network(a), .network(b)): return a.code == b.code
        case let (.decode(a), .decode(b)): return a == b
        default: return false
        }
    }
}
```

- [ ] **Step 2.5: Re-run tests — expect PASS**

```bash
swift test --filter APIErrorTests
```
Expected: `Test Suite 'APIErrorTests' passed`.

- [ ] **Step 2.6: Write `Sources/CoreAPI/Endpoint.swift`**

```swift
import Foundation

/// Value type describing a single API call.
public struct Endpoint: Sendable {
    public enum Method: String, Sendable {
        case get = "GET"
        case post = "POST"
        case put = "PUT"
        case patch = "PATCH"
        case delete = "DELETE"
    }

    public let method: Method
    public let path: String
    public let headers: [String: String]
    public let body: Data?

    public init(
        method: Method,
        path: String,
        headers: [String: String] = [:],
        body: Data? = nil
    ) {
        self.method = method
        self.path = path
        self.headers = headers
        self.body = body
    }

    /// Convenience for JSON POST.
    public static func jsonPost<E: Encodable>(_ path: String, body: E) throws -> Endpoint {
        let data = try JSONEncoder().encode(body)
        return Endpoint(
            method: .post,
            path: path,
            headers: ["Content-Type": "application/json"],
            body: data
        )
    }
}
```

- [ ] **Step 2.7: Write client tests — `Tests/CoreAPITests/APIClientTests.swift`**

```swift
import XCTest
@testable import CoreAPI

final class APIClientTests: XCTestCase {
    private func makeClient(token: String? = nil, handler: @escaping (URLRequest) -> (HTTPURLResponse, Data)) -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        StubURLProtocol.handler = handler
        return APIClient(
            baseURL: URL(string: "https://api.test.example")!,
            session: URLSession(configuration: config),
            tokenProvider: { token }
        )
    }

    func testBuildsBearerHeaderWhenTokenPresent() async throws {
        var captured: URLRequest?
        let client = makeClient(token: "tok-abc") { req in
            captured = req
            return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data("{}".utf8))
        }
        struct Empty: Decodable {}
        _ = try? await client.request(Endpoint(method: .get, path: "ping"), as: Empty.self)
        XCTAssertEqual(captured?.value(forHTTPHeaderField: "Authorization"), "Bearer tok-abc")
    }

    func testOmitsAuthorizationWhenNoToken() async throws {
        var captured: URLRequest?
        let client = makeClient(token: nil) { req in
            captured = req
            return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data("{}".utf8))
        }
        struct Empty: Decodable {}
        _ = try? await client.request(Endpoint(method: .get, path: "ping"), as: Empty.self)
        XCTAssertNil(captured?.value(forHTTPHeaderField: "Authorization"))
    }

    func test401MapsToUnauthorized() async {
        let client = makeClient(token: "tok") { req in
            (HTTPURLResponse(url: req.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!, Data())
        }
        struct Empty: Decodable {}
        do {
            _ = try await client.request(Endpoint(method: .get, path: "x"), as: Empty.self)
            XCTFail("expected throw")
        } catch let e as APIError {
            XCTAssertEqual(e, .unauthorized)
        } catch { XCTFail("wrong error: \(error)") }
    }

    func test403MapsToForbidden() async {
        let client = makeClient(token: "tok") { req in
            (HTTPURLResponse(url: req.url!, statusCode: 403, httpVersion: nil, headerFields: nil)!, Data())
        }
        struct Empty: Decodable {}
        do {
            _ = try await client.request(Endpoint(method: .get, path: "x"), as: Empty.self)
            XCTFail("expected throw")
        } catch let e as APIError {
            XCTAssertEqual(e, .forbidden)
        } catch { XCTFail("wrong error: \(error)") }
    }

    func testNotConfiguredEnvelopeIsRecognized() async {
        let body = #"{"ok":false,"skipped":true,"code":"fleetio_disabled"}"#
        let client = makeClient(token: "tok") { req in
            (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
        }
        struct Empty: Decodable {}
        do {
            _ = try await client.request(Endpoint(method: .get, path: "x"), as: Empty.self)
            XCTFail("expected throw")
        } catch let e as APIError {
            XCTAssertEqual(e, .notConfigured(code: "fleetio_disabled"))
        } catch { XCTFail("wrong error: \(error)") }
    }

    func test5xxMapsToServerError() async {
        let body = #"{"code":"boom","message":"db is sad"}"#
        let client = makeClient(token: "tok") { req in
            (HTTPURLResponse(url: req.url!, statusCode: 500, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
        }
        struct Empty: Decodable {}
        do {
            _ = try await client.request(Endpoint(method: .get, path: "x"), as: Empty.self)
            XCTFail("expected throw")
        } catch let e as APIError {
            XCTAssertEqual(e, .server(status: 500, code: "boom", message: "db is sad"))
        } catch { XCTFail("wrong error: \(error)") }
    }
}

/// URLProtocol stub for synchronous test injection.
final class StubURLProtocol: URLProtocol {
    static var handler: ((URLRequest) -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let h = Self.handler else { fatalError("no handler") }
        let (resp, data) = h(request)
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
```

- [ ] **Step 2.8: Run tests — expect compile failure on `APIClient`**

```bash
swift test
```
Expected: `cannot find 'APIClient' in scope`.

- [ ] **Step 2.9: Implement `Sources/CoreAPI/APIClient.swift`**

```swift
import Foundation

/// Thin async/await HTTP client.
///
/// Handles auth-header injection, status-code → typed-error mapping, and the
/// `notConfigured` envelope. Retry/backoff is intentionally out of scope here;
/// composition layers add it.
public final class APIClient: Sendable {
    public let baseURL: URL
    public let session: URLSession
    public let tokenProvider: @Sendable () -> String?

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        tokenProvider: @escaping @Sendable () -> String? = { nil }
    ) {
        self.baseURL = baseURL
        self.session = session
        self.tokenProvider = tokenProvider
    }

    public func request<T: Decodable>(
        _ endpoint: Endpoint,
        as type: T.Type,
        decoder: JSONDecoder = JSONDecoder()
    ) async throws -> T {
        let req = buildRequest(for: endpoint)
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch let urlError as URLError {
            throw APIError.network(urlError)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.network(URLError(.badServerResponse))
        }

        switch http.statusCode {
        case 200...299:
            // Recognize the "not configured" envelope before attempting full decode.
            if let env = try? JSONDecoder().decode(NotConfiguredEnvelope.self, from: data),
               env.ok == false, env.skipped == true, let code = env.code {
                throw APIError.notConfigured(code: code)
            }
            do { return try decoder.decode(T.self, from: data) }
            catch { throw APIError.decode(String(describing: error)) }
        case 401: throw APIError.unauthorized
        case 403: throw APIError.forbidden
        default:
            let body = try? JSONDecoder().decode(ServerErrorBody.self, from: data)
            throw APIError.server(status: http.statusCode, code: body?.code, message: body?.message)
        }
    }

    internal func buildRequest(for endpoint: Endpoint) -> URLRequest {
        let url = baseURL.appendingPathComponent(endpoint.path)
        var req = URLRequest(url: url)
        req.httpMethod = endpoint.method.rawValue
        for (k, v) in endpoint.headers { req.setValue(v, forHTTPHeaderField: k) }
        if let token = tokenProvider() {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body = endpoint.body {
            req.httpBody = body
            if req.value(forHTTPHeaderField: "Content-Type") == nil {
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
        }
        return req
    }
}

private struct NotConfiguredEnvelope: Decodable {
    let ok: Bool?
    let skipped: Bool?
    let code: String?
}

private struct ServerErrorBody: Decodable {
    let code: String?
    let message: String?
}
```

- [ ] **Step 2.10: Run all tests — expect all pass**

```bash
swift test
```
Expected: `Test Suite 'CoreAPIPackageTests.xctest' passed` with 7 tests.

- [ ] **Step 2.11: Commit**

```bash
git add ios2/RMPGFlexConnect/Packages/CoreAPI
git commit -m "feat(ios2): CoreAPI package — typed APIClient + APIError (M0)"
```

---

## Task 3: SPM package — CoreAuth

Keychain wrapper, JWT decoder, role resolver, auth session.

**Files:**
- Create: `ios2/RMPGFlexConnect/Packages/CoreAuth/Package.swift`
- Create: `ios2/RMPGFlexConnect/Packages/CoreAuth/Sources/CoreAuth/KeychainStore.swift`
- Create: `ios2/RMPGFlexConnect/Packages/CoreAuth/Sources/CoreAuth/JWT.swift`
- Create: `ios2/RMPGFlexConnect/Packages/CoreAuth/Sources/CoreAuth/RoleResolver.swift`
- Create: `ios2/RMPGFlexConnect/Packages/CoreAuth/Sources/CoreAuth/AuthAPI.swift`
- Create: `ios2/RMPGFlexConnect/Packages/CoreAuth/Sources/CoreAuth/AuthSession.swift`
- Create: `ios2/RMPGFlexConnect/Packages/CoreAuth/Tests/CoreAuthTests/JWTTests.swift`
- Create: `ios2/RMPGFlexConnect/Packages/CoreAuth/Tests/CoreAuthTests/RoleResolverTests.swift`

- [ ] **Step 3.1: Write `Package.swift`**

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CoreAuth",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "CoreAuth", targets: ["CoreAuth"]),
    ],
    dependencies: [
        .package(path: "../CoreAPI"),
    ],
    targets: [
        .target(name: "CoreAuth", dependencies: ["CoreAPI"]),
        .testTarget(name: "CoreAuthTests", dependencies: ["CoreAuth"]),
    ]
)
```

- [ ] **Step 3.2: Write `Sources/CoreAuth/JWT.swift`**

```swift
import Foundation

/// Minimal `header.payload.signature` decoder. We never verify the signature
/// locally — that's the server's job. We only need the payload claims to drive
/// role detection.
public enum JWT {
    public struct Payload: Equatable, Sendable {
        public let role: String?
        public let sub: String?
        public let exp: Date?
        public let raw: [String: AnyJSON]
    }

    public enum DecodeError: Error, Equatable {
        case malformed
        case invalidBase64
        case invalidJSON
    }

    public static func decode(_ token: String) throws -> Payload {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { throw DecodeError.malformed }
        guard let data = Self.base64URLDecode(String(parts[1])) else {
            throw DecodeError.invalidBase64
        }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw DecodeError.invalidJSON
        }
        let role = object["role"] as? String
        let sub = object["sub"] as? String
        let exp: Date? = {
            if let v = object["exp"] as? Double { return Date(timeIntervalSince1970: v) }
            if let v = object["exp"] as? Int { return Date(timeIntervalSince1970: TimeInterval(v)) }
            return nil
        }()
        return Payload(role: role, sub: sub, exp: exp, raw: object.mapValues(AnyJSON.from))
    }

    private static func base64URLDecode(_ s: String) -> Data? {
        var t = s
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let pad = t.count % 4
        if pad > 0 { t += String(repeating: "=", count: 4 - pad) }
        return Data(base64Encoded: t)
    }
}

/// Type-erased JSON value, exposed so callers can inspect claims we don't model.
public enum AnyJSON: Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([AnyJSON])
    case object([String: AnyJSON])

    static func from(_ value: Any) -> AnyJSON {
        if let s = value as? String { return .string(s) }
        if let b = value as? Bool { return .bool(b) }
        if let n = value as? Double { return .number(n) }
        if let n = value as? Int { return .number(Double(n)) }
        if value is NSNull { return .null }
        if let arr = value as? [Any] { return .array(arr.map(from)) }
        if let obj = value as? [String: Any] { return .object(obj.mapValues(from)) }
        return .null
    }
}
```

- [ ] **Step 3.3: Write JWT tests — `Tests/CoreAuthTests/JWTTests.swift`**

```swift
import XCTest
@testable import CoreAuth

final class JWTTests: XCTestCase {
    // A real-shaped JWT (signature ignored on decode): header.payload.signature
    // Payload: {"role":"officer","sub":"219","exp":2000000000}
    private let officerToken = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoib2ZmaWNlciIsInN1YiI6IjIxOSIsImV4cCI6MjAwMDAwMDAwMH0.sig"
    // Payload: {"role":"admin","sub":"42"}
    private let adminToken   = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYWRtaW4iLCJzdWIiOiI0MiJ9.sig"

    func testDecodesRoleAndSub() throws {
        let p = try JWT.decode(officerToken)
        XCTAssertEqual(p.role, "officer")
        XCTAssertEqual(p.sub, "219")
        XCTAssertEqual(p.exp?.timeIntervalSince1970, 2_000_000_000)
    }

    func testDecodesAdminRole() throws {
        let p = try JWT.decode(adminToken)
        XCTAssertEqual(p.role, "admin")
        XCTAssertNil(p.exp)
    }

    func testMalformedThrows() {
        XCTAssertThrowsError(try JWT.decode("not.a.jwt.too.many.parts")) { e in
            XCTAssertEqual(e as? JWT.DecodeError, .malformed)
        }
        XCTAssertThrowsError(try JWT.decode("nodotshere")) { e in
            XCTAssertEqual(e as? JWT.DecodeError, .malformed)
        }
    }

    func testInvalidPayloadThrows() {
        // Header.body.sig but body is not valid base64url JSON.
        let bad = "abc.@@@.sig"
        XCTAssertThrowsError(try JWT.decode(bad))
    }
}
```

- [ ] **Step 3.4: Write `Sources/CoreAuth/RoleResolver.swift`**

```swift
import Foundation

/// Maps the JWT `role` claim to the two app personas. Unknown roles default to officer
/// because every authenticated user gets at least the patrol surface.
public enum AppRole: String, Sendable, CaseIterable, Equatable {
    case officer
    case supervisor
}

public enum RoleResolver {
    /// Roles from the existing D1 schema. Spec §11.3.
    private static let supervisorRoles: Set<String> = [
        "admin", "manager", "supervisor"
    ]

    public static func resolve(jwtRole: String?) -> AppRole {
        guard let role = jwtRole?.lowercased() else { return .officer }
        return supervisorRoles.contains(role) ? .supervisor : .officer
    }
}
```

- [ ] **Step 3.5: Write RoleResolver tests — `Tests/CoreAuthTests/RoleResolverTests.swift`**

```swift
import XCTest
@testable import CoreAuth

final class RoleResolverTests: XCTestCase {
    func testAdminMapsToSupervisor() {
        XCTAssertEqual(RoleResolver.resolve(jwtRole: "admin"), .supervisor)
    }

    func testManagerMapsToSupervisor() {
        XCTAssertEqual(RoleResolver.resolve(jwtRole: "manager"), .supervisor)
    }

    func testSupervisorMapsToSupervisor() {
        XCTAssertEqual(RoleResolver.resolve(jwtRole: "supervisor"), .supervisor)
    }

    func testOfficerMapsToOfficer() {
        XCTAssertEqual(RoleResolver.resolve(jwtRole: "officer"), .officer)
    }

    func testContractManagerMapsToOfficer() {
        // contract_manager is a field role per spec §11.3
        XCTAssertEqual(RoleResolver.resolve(jwtRole: "contract_manager"), .officer)
    }

    func testCaseInsensitive() {
        XCTAssertEqual(RoleResolver.resolve(jwtRole: "ADMIN"), .supervisor)
        XCTAssertEqual(RoleResolver.resolve(jwtRole: "Officer"), .officer)
    }

    func testNilDefaultsToOfficer() {
        XCTAssertEqual(RoleResolver.resolve(jwtRole: nil), .officer)
    }

    func testUnknownDefaultsToOfficer() {
        XCTAssertEqual(RoleResolver.resolve(jwtRole: "fart"), .officer)
    }
}
```

- [ ] **Step 3.6: Write `Sources/CoreAuth/KeychainStore.swift`**

```swift
import Foundation
import Security

/// Thin wrapper around the iOS Keychain Generic Password class.
/// Stores secrets accessible only after first device unlock and bound to this device.
public enum KeychainStore {
    /// Service identifier used to scope all RMPG Flex Connect entries.
    public static let service = "us.rmpgutah.flexconnect"

    public enum KeychainError: Error, Equatable {
        case osStatus(OSStatus)
        case encodingFailed
        case decodingFailed
    }

    @discardableResult
    public static func set(_ value: String, forKey key: String) throws -> Bool {
        guard let data = value.data(using: .utf8) else { throw KeychainError.encodingFailed }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
        if updateStatus == errSecSuccess { return true }
        if updateStatus == errSecItemNotFound {
            let addStatus = SecItemAdd(query.merging(attrs, uniquingKeysWith: { $1 }) as CFDictionary, nil)
            if addStatus == errSecSuccess { return true }
            throw KeychainError.osStatus(addStatus)
        }
        throw KeychainError.osStatus(updateStatus)
    }

    public static func get(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    public static func delete(_ key: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        return SecItemDelete(query as CFDictionary) == errSecSuccess
    }
}
```

- [ ] **Step 3.7: Write `Sources/CoreAuth/AuthAPI.swift`**

```swift
import Foundation
import CoreAPI

/// Login binding. Mirrors `POST /api/auth/login` on the existing Worker.
public struct AuthAPI: Sendable {
    public let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public struct LoginRequest: Encodable, Sendable {
        public let username: String
        public let password: String
        public init(username: String, password: String) {
            self.username = username
            self.password = password
        }
    }

    public struct LoginResponse: Decodable, Sendable {
        public let token: String
        public let userId: Int?
        public let role: String?
        // The Worker may include other fields; we only model what M0 needs.

        enum CodingKeys: String, CodingKey {
            case token, role
            case userId = "user_id"
        }
    }

    public func login(username: String, password: String) async throws -> LoginResponse {
        let endpoint = try Endpoint.jsonPost(
            "api/auth/login",
            body: LoginRequest(username: username, password: password)
        )
        return try await client.request(endpoint, as: LoginResponse.self)
    }
}
```

- [ ] **Step 3.8: Write `Sources/CoreAuth/AuthSession.swift`**

```swift
import Foundation
import CoreAPI
import Observation

/// App-wide auth state. Driven from the Keychain on launch.
///
/// `@Observable` makes this directly SwiftUI-bindable without `@Published`.
@Observable
@MainActor
public final class AuthSession {
    public private(set) var token: String?
    public private(set) var role: AppRole?

    public static let tokenKey = "rmpg_flex_connect_jwt"

    public init() {
        if let stored = KeychainStore.get(Self.tokenKey) {
            self.token = stored
            if let payload = try? JWT.decode(stored) {
                self.role = RoleResolver.resolve(jwtRole: payload.role)
            }
        }
    }

    public var isSignedIn: Bool { token != nil }

    public func signIn(token: String) throws {
        try KeychainStore.set(token, forKey: Self.tokenKey)
        self.token = token
        if let payload = try? JWT.decode(token) {
            self.role = RoleResolver.resolve(jwtRole: payload.role)
        }
    }

    public func signOut() {
        KeychainStore.delete(Self.tokenKey)
        self.token = nil
        self.role = nil
    }
}
```

- [ ] **Step 3.9: Run all CoreAuth tests**

```bash
cd ../CoreAuth && swift test
```
Expected: `Test Suite 'CoreAuthPackageTests' passed` with 12 tests (4 JWT + 8 RoleResolver).
Note: We intentionally skip KeychainStore unit tests — the iOS Keychain isn't available in `swift test`'s host process. We rely on Xcode's iOS-simulator XCTests in Task 7 for that.

- [ ] **Step 3.10: Commit**

```bash
git add ios2/RMPGFlexConnect/Packages/CoreAuth
git commit -m "feat(ios2): CoreAuth package — Keychain + JWT + RoleResolver + AuthSession (M0)"
```

---

## Task 4: SPM package — DesignSystem

Steel-blue theme tokens, day/night schedule, theme provider environment.

**Files:**
- Create: `ios2/RMPGFlexConnect/Packages/DesignSystem/Package.swift`
- Create: `ios2/RMPGFlexConnect/Packages/DesignSystem/Sources/DesignSystem/Theme.swift`
- Create: `ios2/RMPGFlexConnect/Packages/DesignSystem/Sources/DesignSystem/ThemeColors.swift`
- Create: `ios2/RMPGFlexConnect/Packages/DesignSystem/Sources/DesignSystem/ThemeProvider.swift`
- Create: `ios2/RMPGFlexConnect/Packages/DesignSystem/Sources/DesignSystem/HeroCard.swift`
- Create: `ios2/RMPGFlexConnect/Packages/DesignSystem/Sources/DesignSystem/StatusLine.swift`
- Create: `ios2/RMPGFlexConnect/Packages/DesignSystem/Tests/DesignSystemTests/ThemeScheduleTests.swift`

- [ ] **Step 4.1: Write `Package.swift`**

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DesignSystem",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "DesignSystem", targets: ["DesignSystem"]),
    ],
    targets: [
        .target(name: "DesignSystem"),
        .testTarget(name: "DesignSystemTests", dependencies: ["DesignSystem"]),
    ]
)
```

- [ ] **Step 4.2: Write `Sources/DesignSystem/Theme.swift`**

```swift
import Foundation

/// Two discrete theme modes. Picked by `ThemeSchedule.resolve(for:)`.
public enum ThemeMode: String, Sendable, CaseIterable, Equatable {
    case day      // light-grey Spillman
    case night    // dark steel-blue Spillman (default)
}

/// Schedule + manual-override resolver. Mirrors the web behavior in
/// `client/src/utils/themeSchedule.ts`.
public enum ThemeSchedule {
    /// Day hours: 06:00 (inclusive) to 18:00 (exclusive), local time.
    static let dayStartHour = 6
    static let dayEndHour = 18

    public static func resolveScheduled(for date: Date, calendar: Calendar = .current) -> ThemeMode {
        let hour = calendar.component(.hour, from: date)
        return (hour >= dayStartHour && hour < dayEndHour) ? .day : .night
    }

    /// Final resolver: manual override (if `active`) wins; else schedule.
    public static func resolveEffective(
        override: (mode: ThemeMode, active: Bool)?,
        for date: Date = Date(),
        calendar: Calendar = .current
    ) -> ThemeMode {
        if let o = override, o.active { return o.mode }
        return resolveScheduled(for: date, calendar: calendar)
    }
}
```

- [ ] **Step 4.3: Write schedule tests — `Tests/DesignSystemTests/ThemeScheduleTests.swift`**

```swift
import XCTest
@testable import DesignSystem

final class ThemeScheduleTests: XCTestCase {
    private func date(hour: Int) -> Date {
        var c = DateComponents()
        c.year = 2026; c.month = 6; c.day = 22
        c.hour = hour
        c.minute = 0
        c.timeZone = TimeZone(identifier: "America/Denver")
        return Calendar(identifier: .gregorian).date(from: c)!
    }

    func testNightBefore6am() {
        XCTAssertEqual(ThemeSchedule.resolveScheduled(for: date(hour: 5)), .night)
    }

    func testDayAt6amExactly() {
        XCTAssertEqual(ThemeSchedule.resolveScheduled(for: date(hour: 6)), .day)
    }

    func testDayAt12() {
        XCTAssertEqual(ThemeSchedule.resolveScheduled(for: date(hour: 12)), .day)
    }

    func testNightAt6pmExactly() {
        XCTAssertEqual(ThemeSchedule.resolveScheduled(for: date(hour: 18)), .night)
    }

    func testNightAfter6pm() {
        XCTAssertEqual(ThemeSchedule.resolveScheduled(for: date(hour: 22)), .night)
    }

    func testManualOverrideActiveWins() {
        let m = ThemeSchedule.resolveEffective(
            override: (.day, active: true),
            for: date(hour: 22)
        )
        XCTAssertEqual(m, .day)
    }

    func testManualOverrideInactiveDefersToSchedule() {
        let m = ThemeSchedule.resolveEffective(
            override: (.day, active: false),
            for: date(hour: 22)
        )
        XCTAssertEqual(m, .night)
    }

    func testNoOverrideUsesSchedule() {
        let m = ThemeSchedule.resolveEffective(
            override: nil,
            for: date(hour: 10)
        )
        XCTAssertEqual(m, .day)
    }
}
```

- [ ] **Step 4.4: Write `Sources/DesignSystem/ThemeColors.swift`**

```swift
import SwiftUI

/// Color tokens for both day and night modes. Hex values match the web
/// palette in `client/src/styles/theme-palettes.css`.
public struct ThemeColors: Sendable, Equatable {
    public let surfaceBase: Color
    public let surfaceRaised: Color
    public let surfaceMuted: Color
    public let textPrimary: Color
    public let textSecondary: Color
    public let textMuted: Color
    public let brandGold: Color    // #d4a017 — never changes between modes
    public let critical: Color     // #ef4444
    public let success: Color      // #10b981
    public let warning: Color      // #f59e0b

    public static let night = ThemeColors(
        surfaceBase:    Color(hex: 0x0D1722),
        surfaceRaised:  Color(hex: 0x142133),
        surfaceMuted:   Color(hex: 0x1C2C44),
        textPrimary:    Color(hex: 0xCFE0F5),
        textSecondary:  Color(hex: 0x8AA1BB),
        textMuted:      Color(hex: 0x6E8AA8),
        brandGold:      Color(hex: 0xD4A017),
        critical:       Color(hex: 0xEF4444),
        success:        Color(hex: 0x10B981),
        warning:        Color(hex: 0xF59E0B)
    )

    public static let day = ThemeColors(
        surfaceBase:    Color(hex: 0xE9ECF0),
        surfaceRaised:  Color(hex: 0xF4F6F9),
        surfaceMuted:   Color(hex: 0xDDE2EA),
        textPrimary:    Color(hex: 0x1A2530),
        textSecondary:  Color(hex: 0x4B6075),
        textMuted:      Color(hex: 0x7A8FA8),
        brandGold:      Color(hex: 0xD4A017),
        critical:       Color(hex: 0xDC2626),
        success:        Color(hex: 0x059669),
        warning:        Color(hex: 0xD97706)
    )

    public static func tokens(for mode: ThemeMode) -> ThemeColors {
        switch mode {
        case .day: return .day
        case .night: return .night
        }
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8) & 0xFF) / 255
        let b = Double(hex & 0xFF) / 255
        self.init(.sRGB, red: r, green: g, blue: b, opacity: opacity)
    }
}
```

- [ ] **Step 4.5: Write `Sources/DesignSystem/ThemeProvider.swift`**

```swift
import SwiftUI

/// Carries the current `ThemeMode` + resolved `ThemeColors` through the view tree.
public struct ThemeEnvironment: Equatable, Sendable {
    public var mode: ThemeMode
    public var colors: ThemeColors

    public static let nightDefault = ThemeEnvironment(mode: .night, colors: .night)
}

private struct ThemeEnvironmentKey: EnvironmentKey {
    static let defaultValue = ThemeEnvironment.nightDefault
}

public extension EnvironmentValues {
    var theme: ThemeEnvironment {
        get { self[ThemeEnvironmentKey.self] }
        set { self[ThemeEnvironmentKey.self] = newValue }
    }
}

/// Drop into the root of your app. Re-resolves on appear, on scenePhase change,
/// and on a 60-second timer (matches the web UserPreferencesContext ticker).
public struct ThemeProvider<Content: View>: View {
    @State private var env: ThemeEnvironment = .nightDefault
    @Environment(\.scenePhase) private var scenePhase
    private let timer = Timer.publish(every: 60, on: .main, in: .common).autoconnect()
    public let content: () -> Content

    public init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    public var body: some View {
        content()
            .environment(\.theme, env)
            .preferredColorScheme(env.mode == .night ? .dark : .light)
            .onAppear { refresh() }
            .onChange(of: scenePhase) { _, phase in if phase == .active { refresh() } }
            .onReceive(timer) { _ in refresh() }
    }

    private func refresh() {
        // M0: no manual override; pure schedule. Override storage lands in a later milestone.
        let mode = ThemeSchedule.resolveEffective(override: nil)
        env = ThemeEnvironment(mode: mode, colors: ThemeColors.tokens(for: mode))
    }
}
```

- [ ] **Step 4.6: Write `Sources/DesignSystem/StatusLine.swift`**

```swift
import SwiftUI

/// Reusable label/value row. Used heavily in Home (M1) and Settings (M0+).
public struct StatusLine: View {
    @Environment(\.theme) private var theme
    public let label: String
    public let value: String
    public let valueColor: Color?

    public init(label: String, value: String, valueColor: Color? = nil) {
        self.label = label
        self.value = value
        self.valueColor = valueColor
    }

    public var body: some View {
        HStack {
            Text(label.uppercased())
                .font(.caption2)
                .tracking(0.5)
                .foregroundStyle(theme.colors.textSecondary)
            Spacer()
            Text(value)
                .font(.callout.monospacedDigit())
                .foregroundStyle(valueColor ?? theme.colors.textPrimary)
        }
        .padding(.vertical, 4)
    }
}
```

- [ ] **Step 4.7: Write `Sources/DesignSystem/HeroCard.swift`** (used by M1 — included now so the design system ships as one unit)

```swift
import SwiftUI

/// Container for the Home hero. Caller supplies the inner content.
public struct HeroCard<Content: View>: View {
    @Environment(\.theme) private var theme
    public let tint: Color?
    public let content: () -> Content

    public init(tint: Color? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.tint = tint
        self.content = content
    }

    public var body: some View {
        content()
            .padding(16)
            .background(theme.colors.surfaceRaised)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(tint ?? theme.colors.brandGold)
                    .frame(width: 4)
            }
            .clipShape(RoundedRectangle(cornerRadius: 2))
            .shadow(color: .black.opacity(0.3), radius: 8, y: 2)
    }
}
```

- [ ] **Step 4.8: Run all DesignSystem tests**

```bash
cd ../DesignSystem && swift test
```
Expected: `Test Suite 'DesignSystemPackageTests' passed` with 8 tests.

- [ ] **Step 4.9: Commit**

```bash
git add ios2/RMPGFlexConnect/Packages/DesignSystem
git commit -m "feat(ios2): DesignSystem package — steel-blue tokens + day/night schedule (M0)"
```

---

## Task 5: SPM package — FeatureShell

Login view, role-aware tab shell, empty placeholder screens for every tab.

**Files:**
- Create: `ios2/RMPGFlexConnect/Packages/FeatureShell/Package.swift`
- Create: `ios2/RMPGFlexConnect/Packages/FeatureShell/Sources/FeatureShell/LoginViewModel.swift`
- Create: `ios2/RMPGFlexConnect/Packages/FeatureShell/Sources/FeatureShell/LoginView.swift`
- Create: `ios2/RMPGFlexConnect/Packages/FeatureShell/Sources/FeatureShell/RoleAwareShell.swift`
- Create: `ios2/RMPGFlexConnect/Packages/FeatureShell/Sources/FeatureShell/OfficerShell.swift`
- Create: `ios2/RMPGFlexConnect/Packages/FeatureShell/Sources/FeatureShell/SupervisorShell.swift`
- Create: `ios2/RMPGFlexConnect/Packages/FeatureShell/Sources/FeatureShell/PlaceholderScreen.swift`
- Create: `ios2/RMPGFlexConnect/Packages/FeatureShell/Tests/FeatureShellTests/LoginViewModelTests.swift`
- Create: `ios2/RMPGFlexConnect/Packages/FeatureShell/Tests/FeatureShellTests/ShellTabsTests.swift`

- [ ] **Step 5.1: Write `Package.swift`**

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureShell",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "FeatureShell", targets: ["FeatureShell"]),
    ],
    dependencies: [
        .package(path: "../CoreAPI"),
        .package(path: "../CoreAuth"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "FeatureShell",
            dependencies: ["CoreAPI", "CoreAuth", "DesignSystem"]
        ),
        .testTarget(
            name: "FeatureShellTests",
            dependencies: ["FeatureShell"]
        ),
    ]
)
```

- [ ] **Step 5.2: Write `Sources/FeatureShell/LoginViewModel.swift`**

```swift
import Foundation
import CoreAPI
import CoreAuth
import Observation

@Observable
@MainActor
public final class LoginViewModel {
    public enum State: Equatable {
        case idle
        case submitting
        case error(String)
    }

    public var username: String = ""
    public var password: String = ""
    public private(set) var state: State = .idle

    private let authAPI: AuthAPI
    private let session: AuthSession

    public init(authAPI: AuthAPI, session: AuthSession) {
        self.authAPI = authAPI
        self.session = session
    }

    public var canSubmit: Bool {
        !username.isEmpty && !password.isEmpty && state != .submitting
    }

    public func submit() async {
        guard canSubmit else { return }
        state = .submitting
        do {
            let resp = try await authAPI.login(username: username, password: password)
            try session.signIn(token: resp.token)
            state = .idle
        } catch let e as APIError {
            switch e {
            case .unauthorized: state = .error("Invalid username or password.")
            case .network: state = .error("No connection. Check Wi-Fi or LTE.")
            case .forbidden: state = .error("Your account is disabled. Contact admin.")
            case .notConfigured(let code): state = .error("Login disabled (\(code)).")
            case .server(let s, _, let m): state = .error("Server error \(s): \(m ?? "unknown").")
            case .decode: state = .error("Unexpected server response.")
            }
        } catch {
            state = .error("Could not save credentials securely.")
        }
    }
}
```

- [ ] **Step 5.3: Write `Sources/FeatureShell/LoginView.swift`**

```swift
import SwiftUI
import DesignSystem
import CoreAuth

public struct LoginView: View {
    @Environment(\.theme) private var theme
    @Bindable public var vm: LoginViewModel

    public init(vm: LoginViewModel) {
        self.vm = vm
    }

    public var body: some View {
        ZStack {
            theme.colors.surfaceBase.ignoresSafeArea()
            VStack(spacing: 24) {
                Spacer().frame(height: 40)
                VStack(spacing: 4) {
                    Text("RMPG FLEX CONNECT")
                        .font(.title2.weight(.bold))
                        .tracking(2)
                        .foregroundStyle(theme.colors.brandGold)
                    Text("api.rmpgutah.us")
                        .font(.caption)
                        .foregroundStyle(theme.colors.textMuted)
                }

                VStack(spacing: 12) {
                    field(label: "USERNAME", text: $vm.username, isSecure: false)
                    field(label: "PASSWORD", text: $vm.password, isSecure: true)
                }
                .padding(.horizontal, 24)

                if case let .error(msg) = vm.state {
                    Text(msg)
                        .font(.footnote)
                        .foregroundStyle(theme.colors.critical)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }

                Button {
                    Task { await vm.submit() }
                } label: {
                    HStack {
                        if vm.state == .submitting {
                            ProgressView().tint(theme.colors.surfaceBase)
                        }
                        Text("TEST LOGIN")
                            .font(.headline)
                            .tracking(1)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(theme.colors.brandGold)
                    .foregroundStyle(theme.colors.surfaceBase)
                }
                .disabled(!vm.canSubmit)
                .opacity(vm.canSubmit ? 1.0 : 0.5)
                .padding(.horizontal, 24)

                Spacer()
                Text("M0 · Foundation build")
                    .font(.caption2)
                    .foregroundStyle(theme.colors.textMuted)
                    .padding(.bottom, 20)
            }
        }
    }

    @ViewBuilder
    private func field(label: String, text: Binding<String>, isSecure: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption2)
                .tracking(0.5)
                .foregroundStyle(theme.colors.textSecondary)
            Group {
                if isSecure {
                    SecureField("", text: text)
                } else {
                    TextField("", text: text)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.asciiCapable)
                }
            }
            .padding(10)
            .background(theme.colors.surfaceRaised)
            .foregroundStyle(theme.colors.textPrimary)
            .clipShape(RoundedRectangle(cornerRadius: 2))
        }
    }
}
```

- [ ] **Step 5.4: Write `Sources/FeatureShell/PlaceholderScreen.swift`**

```swift
import SwiftUI
import DesignSystem

/// Every tab in M0 renders one of these. Content arrives in the matching feature
/// package (FeatureCFS, FeatureRunPlate, FeatureRunID, ...) during M1+.
public struct PlaceholderScreen: View {
    @Environment(\.theme) private var theme
    public let title: String
    public let milestone: String

    public init(title: String, milestone: String) {
        self.title = title
        self.milestone = milestone
    }

    public var body: some View {
        ZStack {
            theme.colors.surfaceBase.ignoresSafeArea()
            VStack(spacing: 12) {
                Text(title.uppercased())
                    .font(.title2.weight(.bold))
                    .tracking(2)
                    .foregroundStyle(theme.colors.brandGold)
                Text("Lands in \(milestone)")
                    .font(.callout)
                    .foregroundStyle(theme.colors.textSecondary)
                Text("M0 ships the skeleton. Feature content follows.")
                    .font(.caption)
                    .foregroundStyle(theme.colors.textMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }
        }
    }
}
```

- [ ] **Step 5.5: Write `Sources/FeatureShell/OfficerShell.swift`**

```swift
import SwiftUI
import DesignSystem

public struct OfficerShell: View {
    public static let tabs: [TabSpec] = [
        TabSpec(id: "home",    title: "Home",    systemImage: "house.fill",            milestone: "M1"),
        TabSpec(id: "cfs",     title: "CFS",     systemImage: "list.bullet.rectangle", milestone: "M1"),
        TabSpec(id: "scan",    title: "Scan",    systemImage: "camera.viewfinder",     milestone: "M1"),
        TabSpec(id: "reports", title: "Reports", systemImage: "doc.text",              milestone: "M1"),
        TabSpec(id: "more",    title: "More",    systemImage: "ellipsis.circle",       milestone: "M1"),
    ]

    public init() {}

    public var body: some View {
        TabView {
            ForEach(Self.tabs) { tab in
                PlaceholderScreen(title: tab.title, milestone: tab.milestone)
                    .tabItem {
                        Label(tab.title, systemImage: tab.systemImage)
                    }
            }
        }
        .tint(ThemeColors.night.brandGold)
    }
}

public struct TabSpec: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let systemImage: String
    public let milestone: String
}
```

- [ ] **Step 5.6: Write `Sources/FeatureShell/SupervisorShell.swift`**

```swift
import SwiftUI
import DesignSystem

public struct SupervisorShell: View {
    public static let tabs: [TabSpec] = [
        TabSpec(id: "command", title: "Command", systemImage: "shield.lefthalf.filled", milestone: "M2"),
        TabSpec(id: "units",   title: "Units",   systemImage: "mappin.and.ellipse",     milestone: "M2"),
        TabSpec(id: "cfs",     title: "CFS",     systemImage: "list.bullet.rectangle",  milestone: "M2"),
        TabSpec(id: "more",    title: "More",    systemImage: "ellipsis.circle",        milestone: "M2"),
    ]

    public init() {}

    public var body: some View {
        TabView {
            ForEach(Self.tabs) { tab in
                PlaceholderScreen(title: tab.title, milestone: tab.milestone)
                    .tabItem {
                        Label(tab.title, systemImage: tab.systemImage)
                    }
            }
        }
        .tint(ThemeColors.night.brandGold)
    }
}
```

- [ ] **Step 5.7: Write `Sources/FeatureShell/RoleAwareShell.swift`**

```swift
import SwiftUI
import CoreAuth

public struct RoleAwareShell: View {
    public let role: AppRole

    public init(role: AppRole) {
        self.role = role
    }

    public var body: some View {
        switch role {
        case .officer:    OfficerShell()
        case .supervisor: SupervisorShell()
        }
    }
}
```

- [ ] **Step 5.8: Write ViewModel tests — `Tests/FeatureShellTests/LoginViewModelTests.swift`**

```swift
import XCTest
@testable import FeatureShell
@testable import CoreAPI
@testable import CoreAuth

@MainActor
final class LoginViewModelTests: XCTestCase {
    func testCanSubmitRequiresBothFields() {
        let session = AuthSession()
        let client = APIClient(baseURL: URL(string: "https://x")!)
        let vm = LoginViewModel(authAPI: AuthAPI(client: client), session: session)
        XCTAssertFalse(vm.canSubmit)
        vm.username = "user"
        XCTAssertFalse(vm.canSubmit)
        vm.password = "pw"
        XCTAssertTrue(vm.canSubmit)
    }

    func testInitialStateIsIdle() {
        let session = AuthSession()
        let client = APIClient(baseURL: URL(string: "https://x")!)
        let vm = LoginViewModel(authAPI: AuthAPI(client: client), session: session)
        XCTAssertEqual(vm.state, .idle)
    }
}
```

- [ ] **Step 5.9: Write shell-shape tests — `Tests/FeatureShellTests/ShellTabsTests.swift`**

```swift
import XCTest
@testable import FeatureShell

final class ShellTabsTests: XCTestCase {
    func testOfficerHasFiveTabs() {
        XCTAssertEqual(OfficerShell.tabs.count, 5)
        XCTAssertEqual(OfficerShell.tabs.map(\.id), ["home", "cfs", "scan", "reports", "more"])
    }

    func testSupervisorHasFourTabs() {
        XCTAssertEqual(SupervisorShell.tabs.count, 4)
        XCTAssertEqual(SupervisorShell.tabs.map(\.id), ["command", "units", "cfs", "more"])
    }

    func testOfficerAndSupervisorBothHaveCfsAndMore() {
        let officerIDs = Set(OfficerShell.tabs.map(\.id))
        let supIDs     = Set(SupervisorShell.tabs.map(\.id))
        XCTAssertTrue(officerIDs.contains("cfs"))
        XCTAssertTrue(officerIDs.contains("more"))
        XCTAssertTrue(supIDs.contains("cfs"))
        XCTAssertTrue(supIDs.contains("more"))
    }

    func testNoDuplicateTabIDsInEitherShell() {
        XCTAssertEqual(Set(OfficerShell.tabs.map(\.id)).count, OfficerShell.tabs.count)
        XCTAssertEqual(Set(SupervisorShell.tabs.map(\.id)).count, SupervisorShell.tabs.count)
    }
}
```

- [ ] **Step 5.10: Run all FeatureShell tests**

```bash
cd ../FeatureShell && swift test
```
Expected: `Test Suite 'FeatureShellPackageTests' passed` with 6 tests.

- [ ] **Step 5.11: Run all four packages from the workspace root for full validation**

```bash
cd ../..
for pkg in Packages/*/; do (cd "$pkg" && swift test --quiet) || exit 1; done
echo "✅ All four SPM packages green."
```

- [ ] **Step 5.12: Commit**

```bash
git add ios2/RMPGFlexConnect/Packages/FeatureShell
git commit -m "feat(ios2): FeatureShell — Login + RoleAwareShell + Officer/Supervisor tabs (M0)"
```

---

## Task 6: Create the Xcode project

This is the only manual step. Cannot be scripted cleanly without adding a tool dependency (Tuist/XcodeGen) that the existing repo doesn't use.

**Files:**
- Create (via Xcode GUI): `ios2/RMPGFlexConnect/RMPGFlexConnect.xcodeproj/`
- Create (via Xcode GUI, then edit): `ios2/RMPGFlexConnect/RMPGFlexConnect/Info.plist`
- Create (via Xcode GUI): `ios2/RMPGFlexConnect/RMPGFlexConnect/Assets.xcassets/AccentColor.colorset/Contents.json`
- Create (via Xcode GUI): `ios2/RMPGFlexConnect/RMPGFlexConnect/Assets.xcassets/AppIcon.appiconset/Contents.json`

- [ ] **Step 6.1: Open Xcode → File → New → Project**

- [ ] **Step 6.2: Pick the iOS App template**

- iOS tab → App. Click Next.

- [ ] **Step 6.3: Fill in product details**

| Field | Value |
|---|---|
| Product Name | `RMPGFlexConnect` |
| Team | Your personal team (free Apple ID works) |
| Organization Identifier | `us.rmpgutah` |
| Bundle Identifier (computed) | `us.rmpgutah.RMPGFlexConnect` — **change this manually to** `us.rmpgutah.flexconnect` after creation. |
| Interface | SwiftUI |
| Language | Swift |
| Storage | None (we'll add SwiftData manually in M1) |
| Include Tests | **No** (tests live in SPM packages) |

Click Next.

- [ ] **Step 6.4: Save the project at the right location**

When the save dialog appears, navigate to `<repo>/ios2/RMPGFlexConnect/` and click Create.
**Do not** check "Create Git repository on my Mac" — we use the existing repo.

After creation, the on-disk layout becomes:
```
ios2/RMPGFlexConnect/
├── RMPGFlexConnect/                       # ← Xcode created this
│   ├── RMPGFlexConnectApp.swift
│   ├── ContentView.swift
│   ├── Assets.xcassets/
│   └── Preview Content/
├── RMPGFlexConnect.xcodeproj/             # ← Xcode created this
├── Packages/                              # ← Already exists from Tasks 2–5
├── README.md
└── refresh-device.sh
```

- [ ] **Step 6.5: Fix the bundle identifier**

In Xcode, select the project root → RMPGFlexConnect target → General tab → change "Bundle Identifier" to `us.rmpgutah.flexconnect`.

- [ ] **Step 6.6: Set the deployment target to iOS 17.0**

Same General tab → Minimum Deployments → iOS 17.0.

- [ ] **Step 6.7: Add the four local SPM packages**

File → Add Package Dependencies → Add Local → pick each of these in turn:
- `ios2/RMPGFlexConnect/Packages/CoreAPI`
- `ios2/RMPGFlexConnect/Packages/CoreAuth`
- `ios2/RMPGFlexConnect/Packages/DesignSystem`
- `ios2/RMPGFlexConnect/Packages/FeatureShell`

For each, choose "Add to Target → RMPGFlexConnect" and click "Add Package".

- [ ] **Step 6.8: Add usage descriptions to Info.plist**

In Xcode, select the `Info` tab on the RMPGFlexConnect target. Add the following keys (these are required even in M0 because feature packages will need them — declaring early is harmless):

| Key | Value |
|---|---|
| `NSCameraUsageDescription` | "Used to capture license plates, IDs, and scene photos." |
| `NSLocationWhenInUseUsageDescription` | "Used to attach location to events, dispatch, and call response." |
| `NSLocationAlwaysAndWhenInUseUsageDescription` | "Used to broadcast unit location during an active shift." |
| `NSMicrophoneUsageDescription` | "Used to dictate notes and record audio for evidence." |
| `NSFaceIDUsageDescription` | "Used to re-unlock the app during a shift." |

- [ ] **Step 6.9: Configure App Transport Security (optional in dev, required in prod)**

Add ATS configuration to Info.plist:

| Key | Value |
|---|---|
| `NSAppTransportSecurity` → `NSAllowsArbitraryLoads` | NO |

(We talk only to `api.rmpgutah.us` over HTTPS, so default ATS is fine.)

- [ ] **Step 6.10: Quit Xcode and verify the new files**

```bash
cd /Users/rmpgutah/RMPG\ Flex/.claude/worktrees/happy-knuth-677d5b
git status --short ios2/
```
Expected output includes `RMPGFlexConnect.xcodeproj/project.pbxproj`, `RMPGFlexConnect/RMPGFlexConnectApp.swift`, `RMPGFlexConnect/ContentView.swift`, `RMPGFlexConnect/Assets.xcassets/...`.

- [ ] **Step 6.11: Commit the Xcode-generated baseline**

```bash
git add ios2/RMPGFlexConnect/RMPGFlexConnect ios2/RMPGFlexConnect/RMPGFlexConnect.xcodeproj
git commit -m "feat(ios2): Xcode project scaffold + local SPM dep wiring (M0)"
```

---

## Task 7: Wire the app entry, build, run on simulator, run on iPhone

Replace Xcode's default `RMPGFlexConnectApp.swift` + `ContentView.swift` with the real composition root.

**Files:**
- Modify: `ios2/RMPGFlexConnect/RMPGFlexConnect/RMPGFlexConnectApp.swift`
- Modify: `ios2/RMPGFlexConnect/RMPGFlexConnect/ContentView.swift`

- [ ] **Step 7.1: Replace `RMPGFlexConnectApp.swift` with the real composition root**

```swift
import SwiftUI
import CoreAPI
import CoreAuth
import DesignSystem
import FeatureShell

@main
struct RMPGFlexConnectApp: App {
    @State private var session = AuthSession()

    var body: some Scene {
        WindowGroup {
            ThemeProvider {
                ContentView(session: session)
            }
        }
    }
}
```

- [ ] **Step 7.2: Replace `ContentView.swift` with the auth gate**

```swift
import SwiftUI
import CoreAPI
import CoreAuth
import FeatureShell

struct ContentView: View {
    @Bindable var session: AuthSession

    private static let apiClient = APIClient(
        baseURL: URL(string: "https://api.rmpgutah.us")!,
        tokenProvider: { KeychainStore.get(AuthSession.tokenKey) }
    )

    var body: some View {
        if let role = session.role, session.token != nil {
            RoleAwareShell(role: role)
        } else {
            LoginView(vm: LoginViewModel(
                authAPI: AuthAPI(client: Self.apiClient),
                session: session
            ))
        }
    }
}
```

- [ ] **Step 7.3: Build for iOS simulator from CLI**

```bash
cd "ios2/RMPGFlexConnect"
xcodebuild -project RMPGFlexConnect.xcodeproj \
    -scheme RMPGFlexConnect \
    -destination 'platform=iOS Simulator,name=iPhone 15,OS=latest' \
    -configuration Debug \
    -derivedDataPath .build \
    build 2>&1 | tail -20
```
Expected: `** BUILD SUCCEEDED **` at the bottom.

If the build deadlocks (see `ios/README.md` note about SWBBuildService on this Mac), use Xcode's GUI build button instead. The deadlock is a per-machine issue, not a project issue.

- [ ] **Step 7.4: Run in the simulator**

In Xcode, pick "iPhone 15" as the destination and press ⌘R. Verify:
- App launches to the Login screen with the steel-blue palette + brand-gold "TEST LOGIN" button.
- Tapping "TEST LOGIN" with empty fields is disabled.
- With dummy fields, tapping it shows "No connection" or "Server error" (we're hitting real prod; either response is expected if creds are wrong).
- Pasting in real RMPG creds + tap → routes to the role-aware tab shell.
- The 5 (or 4) tabs all render a "Lands in M1" placeholder.

- [ ] **Step 7.5: Install on a real iPhone**

Plug in the iPhone. In Xcode:
- Target → Signing & Capabilities → make sure "Automatically manage signing" is on and your personal team is selected.
- Pick the iPhone as the destination in the top bar.
- Press ⌘R.
- On the phone after install: Settings → General → VPN & Device Management → trust the cert.
- Re-launch the app from the home screen and confirm the login screen appears.

- [ ] **Step 7.6: Verify the existing app still works (regression check)**

Plug into Xcode the older `ios/RMPGFlexTester.xcodeproj`, install it on the same iPhone. Confirm both apps appear on the home screen — distinct icons, distinct bundle ids, both launch independently.

- [ ] **Step 7.7: Commit the app-entry wiring**

```bash
cd ../..
git add ios2/RMPGFlexConnect/RMPGFlexConnect/RMPGFlexConnectApp.swift \
        ios2/RMPGFlexConnect/RMPGFlexConnect/ContentView.swift
git commit -m "feat(ios2): wire AuthGate composition root (M0)"
```

---

## Task 8: CI workflow

**Files:**
- Create: `.github/workflows/ios2-tests.yml`

- [ ] **Step 8.1: Write the workflow**

```yaml
name: ios2 tests (RMPG Flex Connect)

on:
  push:
    branches: [main]
    paths:
      - 'ios2/**'
      - '.github/workflows/ios2-tests.yml'
  pull_request:
    paths:
      - 'ios2/**'
      - '.github/workflows/ios2-tests.yml'

jobs:
  swift-tests:
    runs-on: macos-14
    strategy:
      fail-fast: false
      matrix:
        package: [CoreAPI, CoreAuth, DesignSystem, FeatureShell]
    steps:
      - uses: actions/checkout@v4
      - name: Select Xcode
        run: sudo xcode-select -s /Applications/Xcode_15.4.app
      - name: Show Swift version
        run: swift --version
      - name: Test ${{ matrix.package }}
        working-directory: ios2/RMPGFlexConnect/Packages/${{ matrix.package }}
        run: swift test --enable-test-discovery
```

- [ ] **Step 8.2: Verify the workflow YAML is syntactically valid**

```bash
# Use Python's PyYAML (already on macOS) to confirm parse:
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ios2-tests.yml'))" && echo "✅ YAML valid"
```
Expected: `✅ YAML valid`.

- [ ] **Step 8.3: Commit**

```bash
git add .github/workflows/ios2-tests.yml
git commit -m "ci(ios2): swift test matrix per SPM package on macos-14"
```

---

## Task 9: Open the PR

- [ ] **Step 9.1: Push the branch**

```bash
git push -u origin claude/happy-knuth-677d5b
```

- [ ] **Step 9.2: Open the PR**

```bash
gh pr create --title "feat(ios2): RMPG Flex Connect M0 — Foundation" --body "$(cat <<'EOF'
## Summary
- New iPhone app at `ios2/RMPGFlexConnect/` — modular SwiftUI on iOS 17+.
- Four local SwiftPM packages: `CoreAPI`, `CoreAuth`, `DesignSystem`, `FeatureShell`.
- Login → role-aware tab shell (5 tabs officer / 4 tabs supervisor).
- Every tab is intentionally an empty placeholder — feature content starts in M1.
- New CI workflow `.github/workflows/ios2-tests.yml` runs `swift test` per package on `macos-14`.
- Coexists with `ios/RMPGFlexTester` (distinct bundle id `us.rmpgutah.flexconnect`).

Spec: `docs/superpowers/specs/2026-06-22-rmpg-flex-connect-ios-design.md`
M0 plan: `docs/superpowers/plans/2026-06-22-rmpg-flex-connect-m0-foundation.md`

## Test plan
- [ ] `swift test` passes in each of the 4 SwiftPM packages locally (CoreAPI 7, CoreAuth 12, DesignSystem 8, FeatureShell 6 = 33 tests).
- [ ] `xcodebuild` builds clean for iPhone 15 simulator.
- [ ] App installs on a real iPhone via personal-team signing.
- [ ] Login with valid RMPG creds routes to the officer or supervisor shell based on JWT role.
- [ ] `ios/RMPGFlexTester` still installs and runs alongside the new app.
- [ ] New `ios2-tests` workflow runs and goes green on this PR.

## What's NOT in this PR
Everything from M1 onward — every tab is a `PlaceholderScreen` saying "Lands in M1". Feature work lands in its own PR per the milestone decomposition in the spec.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 9.3: Verify the PR**

```bash
gh pr view --json state,mergeStateStatus,url
```
Expected: `state: "OPEN"`, `mergeStateStatus: "UNSTABLE"` (Workers Builds checks may be cosmetic — that's OK per memory `[[feedback-workers-builds-flake]]`), URL printed.

---

## Self-review checklist

(Run mentally after writing — no need to dispatch a subagent.)

- [ ] Every task's "Files:" list matches the steps below it.
- [ ] No "TBD", "TODO", "implement later" anywhere.
- [ ] Type/method names are consistent across tasks (`AuthSession.tokenKey`, `LoginViewModel.canSubmit`, `OfficerShell.tabs`, etc.).
- [ ] Spec coverage:
  - §6 Architecture (targets, SPM packages) → Tasks 2–6 ✓
  - §7 Auth & roles → Tasks 3 + 7 ✓
  - §8 Network layer → Task 2 ✓
  - §11 UI shell → Task 5 ✓
  - §13 Theme → Task 4 ✓
  - §21 Coexistence → Task 6 (distinct bundle id) + Task 7 (regression check) ✓
  - §22 CarPlay risk → Task 0 (entitlement filed day 1) ✓
- [ ] Frequent commits: one per task, no batched mega-commits.
- [ ] Total expected build: 33 unit tests, 1 PR, M0 closes when PR merges + a real shift hasn't been tried yet (M1 is the shift-verification milestone).
