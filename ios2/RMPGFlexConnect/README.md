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
5. On first launch, enter your RMPG credentials on the login screen and tap **TEST LOGIN**.

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
