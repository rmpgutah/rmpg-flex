# RMPG Flex iOS D1 Tester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native SwiftUI iPhone app (`ios/RMPGFlexTester/`) for testing live D1 (`rmpg-flex` 785de7ae…) via the Cloudflare REST API, smoke-testing api.rmpgutah.us, and browsing key tables.

**Architecture:** Zero-dependency SwiftUI app, Xcode 26.5 project using `PBXFileSystemSynchronizedRootGroup` (objectVersion 77) so the pbxproj stays tiny and files are picked up from disk. Networking via URLSession async/await; secrets in Keychain. Logic (SQL safety classifier, D1/WAF response parsing) is isolated in plain Swift types covered by XCTest run via `swift test`-style xcodebuild on the simulator destination.

**Tech Stack:** Swift 5.9+, SwiftUI, iOS 17 deployment target, XCTest. Build with `DEVELOPER_DIR=/Applications/Xcode.app xcodebuild`.

---

### Task 1: Project scaffold

**Files:**
- Create: `ios/RMPGFlexTester/RMPGFlexTester.xcodeproj/project.pbxproj` (objectVersion 77, app target `RMPGFlexTester` + test target `RMPGFlexTesterTests`, synchronized groups `RMPGFlexTester/` and `RMPGFlexTesterTests/`, bundle id `us.rmpgutah.flextester`, `GENERATE_INFOPLIST_FILE = YES`, iOS 17.0)
- Create: `ios/RMPGFlexTester/RMPGFlexTester/App.swift` (`@main` App with TabView placeholder)
- Create: `ios/RMPGFlexTester/RMPGFlexTester/Theme.swift` (Spillman tokens: base #0a0a0a, raised #141414, gold #d4a017, neutral #888888, radius 2)

- [ ] Step 1: Write pbxproj + App.swift + Theme.swift
- [ ] Step 2: Verify build: `DEVELOPER_DIR=/Applications/Xcode.app xcodebuild -project ios/RMPGFlexTester/RMPGFlexTester.xcodeproj -scheme RMPGFlexTester -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build` → BUILD SUCCEEDED
- [ ] Step 3: Commit `feat(ios): scaffold RMPGFlexTester Xcode project`

### Task 2: SQLSafety classifier (TDD)

**Files:**
- Create: `ios/RMPGFlexTester/RMPGFlexTester/SQLSafety.swift`
- Test: `ios/RMPGFlexTester/RMPGFlexTesterTests/SQLSafetyTests.swift`

API: `enum SQLSafety { static func isDestructive(_ sql: String) -> Bool }` — strips leading whitespace/comments, splits on `;`, returns true if any statement's first keyword ∉ {SELECT, PRAGMA, EXPLAIN, WITH}. (WITH counts as read-only only if no INSERT/UPDATE/DELETE token appears in that statement.)

- [ ] Step 1: Write failing tests: SELECT → false; `  select` lowercase → false; PRAGMA/EXPLAIN → false; INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/CREATE → true; `WITH x AS (...) SELECT` → false; `WITH x AS (...) DELETE FROM t` → true; multi-statement `SELECT 1; DROP TABLE t` → true; leading `-- comment\nSELECT` → false
- [ ] Step 2: Run tests, verify FAIL (type missing): `xcodebuild test -scheme RMPGFlexTester -destination 'platform=iOS Simulator,name=iPhone 17'`
- [ ] Step 3: Implement; Step 4: tests PASS; Step 5: commit `feat(ios): SQL destructive-statement classifier`

### Task 3: D1Client (TDD on parsing)

**Files:**
- Create: `ios/RMPGFlexTester/RMPGFlexTester/D1Client.swift`
- Test: `ios/RMPGFlexTester/RMPGFlexTesterTests/D1ClientTests.swift`

API:
```swift
struct D1QueryResult { let columns: [String]; let rows: [[String]]; let meta: String? }
struct D1Client {
  var accountId: String; var databaseId: String; var apiToken: String
  func query(_ sql: String) async throws -> D1QueryResult   // POST …/d1/database/{id}/query, raw JSON via JSONSerialization (rows are heterogenous)
  static func parse(_ data: Data) throws -> D1QueryResult   // pure, testable
}
enum D1Error: LocalizedError { case api(String); case http(Int, String) }
```
`parse`: on `success:false` throw `.api(errors[].message joined)`; else take `result[0].results` array of dicts → stable sorted column names from first row, stringify values (NSNull → "NULL").

- [ ] Step 1: Tests with fixture JSON: success-with-rows, success-empty, error payload → throws with message
- [ ] Step 2: FAIL → implement → PASS → commit `feat(ios): D1 REST client`

### Task 4: RMPGAPIClient + WAF detection (TDD on detection)

**Files:**
- Create: `ios/RMPGFlexTester/RMPGFlexTester/RMPGAPIClient.swift`
- Test: `ios/RMPGFlexTester/RMPGFlexTesterTests/WAFDetectionTests.swift`

API:
```swift
enum SmokeOutcome { case pass(Int, ms: Int); case fail(Int, String); case wafChallenge }
struct RMPGAPIClient {
  var baseURL = URL(string: "https://api.rmpgutah.us")!
  var jwt: String?
  static func isWAFChallenge(status: Int, body: String, headers: [AnyHashable: Any]) -> Bool
  func login(username: String, password: String) async throws -> String  // POST /api/auth/login → token
  func probe(_ path: String) async -> SmokeOutcome  // GET with Bearer, 800ms timing
}
```
WAF heuristic: status 403 AND (body contains "Just a moment" OR "cf-chl" OR header `cf-mitigated == challenge`).

- [ ] Tests: 403+challenge body → true; 403 plain JSON → false; 200 → false; cf-mitigated header → true
- [ ] FAIL → implement → PASS → commit `feat(ios): RMPG API client with WAF challenge detection`

### Task 5: KeychainStore

**Files:**
- Create: `ios/RMPGFlexTester/RMPGFlexTester/KeychainStore.swift`

Simple `kSecClassGenericPassword` wrapper: `save(_ value: String, key: String)`, `load(key:) -> String?`, `delete(key:)`; keys: `cfAccountId`, `cfToken`, `rmpgUser`, `rmpgPass`, `rmpgJWT`. (Keychain not unit-testable on simulator-less CI; verified by build + manual use.)

- [ ] Implement, build passes, commit `feat(ios): keychain storage`

### Task 6: Views + wiring

**Files:**
- Create: `D1ConsoleView.swift` (TextEditor SQL, Run, destructive confirm via `SQLSafety`, history last 20 in @AppStorage JSON, `ResultsTable`)
- Create: `ResultsTable.swift` (ScrollView both axes, LazyVStack of rows, monospaced 11pt)
- Create: `SmokeTestView.swift` (routes: `/api/health` public, login, `/api/dispatch/calls?limit=1`, `/api/dispatch/units`, `/api/warrants?limit=1`, `/api/records/persons?limit=1`; sequential run; badges PASS gold / FAIL red / WAF orange + latency)
- Create: `DataViewerView.swift` (table picker: calls_for_service `SELECT id,call_number,call_type,status,created_at FROM calls_for_service ORDER BY id DESC LIMIT 25`, units, persons `SELECT id,first_name,last_name,dob FROM persons ORDER BY id DESC LIMIT 25`, warrants; row tap → `SELECT * … WHERE id = ?` detail sheet)
- Create: `SettingsView.swift` (SecureFields → KeychainStore; "Test login" button; "Test D1" button running `SELECT 1`)
- Modify: `App.swift` (real TabView, dark scheme forced, gold tint)

- [ ] Implement all, full `xcodebuild test` green, commit `feat(ios): console, smoke, viewer, settings UI`

### Task 7: Final verification

- [ ] `xcodebuild test` (all unit tests) and `xcodebuild build` for simulator — both clean
- [ ] Add `ios/README.md` (open project, set personal team, plug iPhone, Run; 7-day free-cert note)
- [ ] Commit `docs(ios): sideload instructions`
