# RMPGFlexTester (iOS)

Native iPhone test console for the live RMPG Flex Cloudflare stack:

- **D1 Console** — run SQL against live `rmpg-flex` D1 via the Cloudflare REST API
  (no WAF in the way). Destructive statements require confirmation.
- **Smoke** — hits api.rmpgutah.us routes with your RMPG login; a 403 managed
  challenge is reported as `WAF CHALLENGE`, not an app failure.
- **Data** — quick browse of calls_for_service / units / persons / warrants.
- **Settings** — Cloudflare account ID + API token (D1 read/write scope) and
  RMPG credentials; everything stored in the iOS Keychain.

## Install on your iPhone (no App Store)

1. Open `RMPGFlexTester/RMPGFlexTester.xcodeproj` in Xcode.
2. Target → Signing & Capabilities → select your personal team (a free Apple ID
   works; the install expires after 7 days — just Run again to refresh).
3. Plug in the iPhone, pick it as the destination, press Run.
4. On the phone: Settings → General → VPN & Device Management → trust your cert.
5. In the app's Settings tab, paste the Cloudflare account ID + API token and
   tap "Test D1".

## Known machine issue (2026-06-11)

CLI `xcodebuild` on this Mac deadlocks during build-description creation
(SWBBuildService's clang probe blocks writing to an undrained pipe) — for every
project, not just this one. Workarounds used for verification, all green:

- Unit tests: `cd /tmp/FlexTesterPkg && swift test` style SwiftPM harness (11/11 pass).
- App: compiled with `xcrun -sdk iphonesimulator swiftc`, bundled manually,
  installed + launched in the iPhone 17 simulator.

The Xcode GUI may build fine; if it also hangs, reboot or reinstall Xcode.
