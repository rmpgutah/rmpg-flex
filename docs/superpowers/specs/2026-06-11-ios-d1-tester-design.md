# RMPG Flex iOS D1 Tester — Design Spec (2026-06-11)

## Purpose

A native iPhone app (dev-signed, sideloaded via Xcode — not App Store) for testing the
live RMPG Flex Cloudflare stack from a phone:

1. Run SQL against the live D1 database `rmpg-flex` (`785de7ae-3e7a-4e01-93bb-d24ddd813f6b`).
2. Smoke-test the production API at `https://api.rmpgutah.us`.
3. Browse key tables (calls, units, persons, warrants).

## Non-goals

- No App Store distribution, no push, no offline sync, no write-heavy CAD features.
- No changes to the Worker, client, proxy, or CI.

## Architecture

- **Location**: `ios/RMPGFlexTester/` — standalone Xcode project, hand-authored
  `project.pbxproj`, zero third-party dependencies.
- **Stack**: Swift 5.9+, SwiftUI, iOS 17+ deployment target, URLSession, Keychain
  Services. Builds with Xcode 26.5 (`DEVELOPER_DIR=/Applications/Xcode.app`).
- **Signing**: personal team / free Apple ID; bundle id `us.rmpgutah.flextester`.

### Modules

| Unit | Responsibility |
|------|----------------|
| `D1Client` | POST `/client/v4/accounts/{acct}/d1/database/{db}/query` with bearer token; parse `result[].results` rows + `errors[]`. |
| `RMPGAPIClient` | Login (`POST /api/auth/login` → JWT), authenticated GETs; detects WAF challenge HTML (403 + "Just a moment") and reports it as `wafChallenge`, not a parse error. |
| `KeychainStore` | Save/load CF account id, CF API token, RMPG username/password, cached JWT. |
| `SQLSafety` | Classifies a statement as read-only vs destructive (`DROP/DELETE/UPDATE/ALTER/TRUNCATE/INSERT` outside SELECT/PRAGMA/EXPLAIN). Destructive → confirm dialog. |
| Views | `D1ConsoleView`, `SmokeTestView`, `DataViewerView`, `SettingsView`, shared `ResultsTable`, theme tokens. |

### Tabs

1. **D1 Console** — SQL editor, Run button, query history (last 20, UserDefaults),
   results in a horizontally scrollable table, error banner with Cloudflare error text.
2. **Smoke Tests** — fixed route list run sequentially with status code, latency,
   pass/fail/WAF badge: `/api/health` (public), `/api/auth/login`, then authed GETs
   (`/api/dispatch/calls?limit=1`, `/api/dispatch/units`, `/api/warrants?limit=1`,
   `/api/records/persons?limit=1`).
3. **Data Viewer** — canned D1 SELECTs (latest 25 rows) for `calls_for_service`,
   `units`, `persons`, `warrants`; tap a row → detail sheet of all columns.
4. **Settings** — CF account id (prefilled `5caa95c5cd97d5b86dcf6a31a72cd4b0`-style;
   editable), CF API token (secure field), RMPG username/password + "Test login";
   stored in Keychain only.

## Theme

Spillman pure-black: `#0a0a0a` base / `#141414` raised surfaces, `#d4a017` gold accent,
`#888888` neutral text, 2 pt corner radius, no blue.

## Error handling

- All network errors surface HTTP status + body excerpt.
- Cloudflare `success:false` → join `errors[].message`.
- WAF challenge detection on rmpgutah.us responses (expected; labeled, not a failure of the app).
- Destructive SQL requires explicit confirmation.

## Testing

XCTest target covering: `SQLSafety` classification, `D1Client` response parsing
(success, error, empty), WAF-challenge detection. Build verification via
`xcodebuild build` (iphonesimulator) before handoff. Device install done manually by
the user in Xcode (signing is interactive).

## Risks

- Managed challenge may 403 the Smoke Tests tab from native clients — by design the
  tab reports this distinctly; D1 tabs are unaffected (api.cloudflare.com has no WAF challenge).
- Free Apple ID provisioning expires every 7 days; re-run from Xcode to refresh.
