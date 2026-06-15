# RMPGFlexTester (iOS)

Native iPhone field app + test console for the live RMPG Flex Cloudflare stack.

**Shell**: 5 tabs — **Home**, **Field Ops**, **ID Scan**, **Toolkit**, and **More**.
The **More** hub groups the secondary officer surfaces into labeled sections:

- **Patrol** — Duty Roster, Live Alerts, Watchlist, Fleet Readiness
- **Reports & Records** — Daily Activity Report, Recorder
- **Account** — My Officer ID, Settings

The pure-black Spillman theme is enforced app-wide via `Theme.configureAppearance()`
(black tab + nav bars, gold accents) and shared components in `Theme.swift`
(`GoldButtonStyle`, `RaisedButtonStyle`, `.themeCard()`, `StatusLine`,
`SectionHeader`) — use those instead of hand-rolling button/status styling.

**Settings** — RMPG credentials + the Apple Verifier reader token; everything
stored in the iOS Keychain.

## ID Scan modes

- **LICENSE** — DL PDF417 barcode (AAMVA), as before.
- **PASSPORT** — Vision OCR reads the MRZ (passport TD3 + ID-card TD1),
  `MrzParser` validates ICAO 9303 check digits (failed integrity is surfaced
  as an officer alert, the bad field is dropped). Same relay / warrant-check /
  FI-card pipeline as license scans (`mrz_raw` instead of `aamva_raw`).
- **WIRELESS** — Apple ID Verifier (ProximityReader, iOS 17+): subject taps
  their iPhone/Watch Wallet ID to the phone; iOS displays verified name + age
  in a system sheet (display request — identity data never enters the app).
  Prerequisites: Apple Business Connect enrollment, the "Verifier API"
  capability on the bundle id in Xcode, and a reader token (~48 h validity)
  pasted into Settings. The button explains exactly which prerequisite is
  missing until then.

## FIELD CALC (toolkit)

Pure on-device calculators — they work with zero coverage, no login:

- **Phonetic Speller** — any plate/name → APCO ("Adam Boy Charles…") + NATO
- **Skid Marks → Speed** — skid length in feet → minimum-speed table across
  7 surface drag factors (S = √(30·d·f); labeled as minimum, court caveat)
- **Sunrise / Sunset (here)** — civil dawn/dusk + sunrise/sunset at the
  phone's GPS (UT 41-6a-1603 headlights note)
- **Distance to Coordinates** — haversine distance + compass bearing from me
- **Mark Point / Measure** — tap to mark Point A, walk, tap again for
  distance/bearing with both fixes' accuracy (scene measurement)
- **Unit Converter** — `180cm` / `75kg` / `100kmh` / `5'11` (passport MRZ
  docs are metric)

## RECORDS integrations (scan flow)

After any license/passport scan:

- **Subject auto-resolution** — the scan is matched against existing persons
  (DL number, then exact name+DOB); a known subject lights up a
  **VIEW SUBJECT RECORDS** button without creating anything.
- **Subject dossier** — full RMS pull on one screen: intel cross-hit screen
  (watchlist / jail bookings / warrants, critical hits bannered red and
  pushed as dispatcher notifications), summary chips, plus the subject's
  warrants, incidents, CAD calls, and citations from system-history.
- **Run plate** — one tap fans out to registered-owner lookup, local
  stolen-flag + active-BOLO check, and the intel vehicle screen; a CLEAR is
  labeled honestly as local-records-only (never a live NCIC clear).
  **LINK VEHICLE TO SUBJECT** creates/links the vehicle to the scanned
  person through the same `from-dl-scan` endpoint the desktop uses.

## Install on your iPhone (no App Store)

1. Open `RMPGFlexTester/RMPGFlexTester.xcodeproj` in Xcode.
2. Target → Signing & Capabilities → select your personal team (a free Apple ID
   works; the install expires after 7 days — just Run again to refresh).
3. Plug in the iPhone, pick it as the destination, press Run.
4. On the phone: Settings → General → VPN & Device Management → trust your cert.
5. In the app's Settings tab, enter your RMPG username + password and tap
   "Test login".

## Known machine issue (2026-06-11)

CLI `xcodebuild` on this Mac deadlocks during build-description creation
(SWBBuildService's clang probe blocks writing to an undrained pipe) — for every
project, not just this one. Workarounds used for verification, all green:

- Unit tests: `cd /tmp/FlexTesterPkg && swift test` style SwiftPM harness (11/11 pass).
- App: compiled with `xcrun -sdk iphonesimulator swiftc`, bundled manually,
  installed + launched in the iPhone 17 simulator.

The Xcode GUI may build fine; if it also hangs, reboot or reinstall Xcode.
