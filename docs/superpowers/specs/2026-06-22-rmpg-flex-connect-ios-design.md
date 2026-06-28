# RMPG Flex Connect — iOS App Design Spec

| Field | Value |
|---|---|
| **App name** | RMPG Flex Connect |
| **Date** | 2026-06-22 |
| **Status** | Draft — pending user approval |
| **Author** | Claude (in collaboration with Christopher Zamora) |
| **Scope** | iPhone-native CAD/RMS field + command app, modern iOS surfaces (Live Activity, Watch, CarPlay, Widgets), 10-milestone program. |
| **Replaces** | `ios/RMPGFlexTester` (after M1 verified in production). |
| **Backend** | Same Cloudflare Worker at `api.rmpgutah.us`. Minor route additions in M2/M6/M9. |

---

## 1. Goals

- **Officer + supervisor in one app**, role-switched at login.
- **Highly integrated with iOS** — Live Activities, Dynamic Island, Watch, CarPlay, widgets, StandBy, Action Button, AppIntents/Siri, Focus mode, on-device translation.
- **Easy UI** — glance-first home, big tap targets, one-handed in a moving vehicle.
- **Cleaner architecture** — modular SPM packages, SwiftData, `@Observable`, strict concurrency.
- **Zero regression in field functionality** vs the existing `RMPGFlexTester`.

## 2. Non-goals (v1)

- iPad-specific layout (universal binary builds for iPad, but no split-view or sidebar polish).
- Vision Pro / visionOS surface.
- Replacing the **web** app on `rmpgutah.us`.
- Cross-agency interop (FBI / DOJ / county interop is a separate program).
- App Store distribution — install path stays personal-team / TestFlight only.

## 3. App identity

| Field | Value |
|---|---|
| Bundle id (main) | `us.rmpgutah.flexconnect` |
| Bundle id (watch) | `us.rmpgutah.flexconnect.watchkitapp` |
| Bundle id (widgets) | `us.rmpgutah.flexconnect.widgets` |
| Bundle id (intents) | `us.rmpgutah.flexconnect.intents` |
| Min iOS | 17.0 |
| Min watchOS | 10.0 |
| Repo path | `ios2/RMPGFlexConnect/` |
| Workspace | `ios2/RMPGFlexConnect/RMPGFlexConnect.xcworkspace` |
| Coexists with | `ios/RMPGFlexTester` — both installable simultaneously, distinct bundles. |

## 4. Audience

| Role | Default tab | Custom surfaces |
|---|---|---|
| **Officer** (patrol, contract_manager) | Home (A2 hero) | CFS, Scan, Reports, More |
| **Supervisor** (admin, manager, supervisor) | Command | Units (live map), CFS (read-only sup view), More (admin sidebar) |
| Other roles | Officer default | Surfaces gated by JWT `role` claim |

Role resolution: read JWT `role` claim on login. Surface affordances appear/disappear, never error out — feature flags follow [[feedback-503-not-configured-anti-pattern]].

## 5. Milestone decomposition

10 milestones, shipped sequentially in TestFlight. Each closes with internal QA on a real shift before the next opens.

| # | Milestone | Realistic dev time |
|---|---|---|
| **M0** | Foundation: project skeleton, modular SPM, login, role-aware tab shell, theme, Keychain, empty post-login screens, CI green. | 3–5 days |
| **M1** | Officer core: Home (A2), Active CFS, Run Plate, Run ID, offline outbox, FI cards, mileage tracking, pre-trip inspection, Daily Activity Report, BT thermal printer for citations, on-device translation framework. | 3–4 weeks |
| **M2** | Supervisor core: live unit map (Mapbox), CFS board, BOLO push, report approval, audit log, schedule/roster view, push directives. | 2–3 weeks |
| **M3** | Deep iOS integration: Live Activity for active CFS, Dynamic Island timer, home-screen widgets, AppIntents (Siri), StandBy mode dashboard, Action Button = panic, Focus mode integration, TipKit, Live Text, AI dictation → structured CFS narrative. | 2–3 weeks |
| **M4** | Apple Watch: glance complication, panic, time-on-call timer, dictation-to-note, officer-down detection (HR + immobility), standalone cellular fallback. | 2 weeks |
| **M5** | CarPlay + nav: Mapbox turn-by-turn to scene, hands-free status, TTS dispatcher notes. **Requires Apple CarPlay Navigation entitlement (request day 1 of M0).** | 1–2 weeks |
| **M6** | Comms / push-to-talk: WebRTC PTT group channels (Cloudflare Calls), 1:1 DM, team chat, BOLO broadcast with ack. | 3–4 weeks |
| **M7** | Officer safety & wellness: welfare-watch timer binding to `WelfareWatchDO`, geofence hazard alerts, lone-officer auto-check-in, Watch HR-based stress tracker, post-incident wellness check. | 2 weeks |
| **M8** | Reports, court & evidence: universal form engine (server-driven from `workflow_specs`), eSignature on glass, chain-of-custody PDF, in-app body-cam excerpter, CourtListener calendar sync, subpoena reminders. | 3 weeks |
| **M9** | External integrations: ClearPathGPS dashcam pull, Fleet.io reminders, jail roster lookup, NSOPW SOR search, Utah DOC custody, county assessor, Roboflow ALPR full-drive, national warrant pull. | 2–3 weeks |
| **M10** | Field Medical (TECC / BLS / Trauma): protocols, CPR coach, AED guide, bleeding control, Narcan w/ auto-log, MCI triage, GCS / SAMPLE / OPQRST calculators, drug reference, patient handoff voice memo. Offline-first, framed as officer reference (not diagnostic device). | 3 weeks |

**Total: ~5.5 – 7 months** of full-time iOS engineering, shipped in milestones. (Low-end assumes everything goes smoothly; high-end is realistic given Apple-review gates on CarPlay + Critical Alerts and the WebRTC long pole in M6.)

## 6. Architecture

### 6.1 Targets

| Target | Purpose |
|---|---|
| `RMPGFlexConnect` | Main iPhone app. Hosts the CarPlay `CPTemplateApplicationScene`. |
| `RMPGFlexConnectWatch` | watchOS 10 paired app. |
| `RMPGFlexConnectWidgets` | WidgetKit extension. Hosts home-screen widgets and Live Activity attributes. |
| `RMPGFlexConnectIntents` | AppIntents extension for Siri / Shortcuts. |

### 6.2 Local SPM packages

All packages live in-repo at `ios2/RMPGFlexConnect/Packages/`. None are external — each is a Swift package in the workspace.

**Core packages (no UI):**

- `CoreAPI` — typed JWT client for `api.rmpgutah.us`. Codable models per route group. URLSession + async/await. Typed errors.
- `CoreAuth` — login flow, Keychain wrapper, JWT decoding, role detection, biometric unlock.
- `CoreOffline` — SwiftData-backed `OutboxEntry` queue, drain orchestrator, idempotency-key generation.
- `CoreLocation` — GPS provider, geofencing primitives, background-location lifecycle.
- `CoreAudio` — audio recorder (used by note-taking, body-cam handoff, patient handoff in M10).
- `CorePush` — APNs token registration, notification category routing.

**Design system:**

- `DesignSystem` — steel-blue color tokens, typography, day/night schedule, reusable views (`StatusLine`, `SectionHeader`, `IconButton`, `HeroCard`, `MiniTile`, `FormRow`).

**Feature packages (depend on Core + DesignSystem, never each other):**

- `FeatureShell` — role-aware tab host, supervisor variant.
- `FeatureCFS` — active call list, detail, status buttons, queue. Officer & supervisor read views share models.
- `FeatureRunPlate` — plate entry + ALPR camera + result screen.
- `FeatureRunID` — DL barcode + MRZ + Apple ID Verifier (ProximityReader).
- `FeatureMap` — Mapbox unit map (officer = mine, supervisor = all).
- `FeatureReports` — DAR, FI cards, citations (with BT printer support).
- `FeatureCarPlay` — `CPTemplateApplicationScene` factories.
- `FeatureWatch` — watchOS app surfaces; depends on Core only.
- `FeatureLiveActivity` — ActivityKit attributes and lock-screen / Dynamic Island views.
- `FeatureWidgets` — WidgetKit views.
- `FeatureComms` — PTT, DM, channels (M6).
- `FeatureMedical` — TECC / BLS / trauma module (M10), entirely offline data.

### 6.3 Concurrency, data, transport

- **Swift 6 strict concurrency** on (every target).
- **`@Observable`** ViewModels (iOS 17+). No `ObservableObject`.
- **SwiftData** for the offline cache + Outbox table.
- **URLSession + async/await** for transport. No Alamofire. No Combine.

### 6.4 Third-party dependencies

**Exactly one production dependency:** Mapbox Maps iOS SDK (binary xcframework via SPM). Required for the officer/supervisor map + CarPlay nav. Same Mapbox token as web (`VITE_MAPBOX_ACCESS_TOKEN` equivalent in `Info.plist`).

**One test-only dependency:** `pointfreeco/swift-snapshot-testing` for snapshot tests of `DesignSystem` and key feature screens.

Everything else is Apple frameworks: Vision, AVFoundation, CoreLocation, ActivityKit, WidgetKit, ProximityReader, AppIntents, CarPlay, WatchConnectivity, WidgetKit, CryptoKit, BackgroundTasks, BluetoothLE (for M1 printer + future BWC).

## 7. Auth & roles

- **Login**: `POST /api/auth/login` (username + password). JWT returned, stored in iOS Keychain with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.
- **Token refresh**: 5 minutes before expiry. Two consecutive refresh failures → kick to login.
- **Biometric gate**: Face ID / Touch ID on every cold start within session window. Falls back to password.
- **Role detection**: `RoleResolver` reads JWT `role` claim → `.officer` or `.supervisor`. The shell binds to `@Environment(\.role)`.
- **Sign-out**: clears Keychain, clears SwiftData store, unregisters APNs token from server, dismisses any active Live Activity.

## 8. Network layer (`CoreAPI`)

- One `APIClient` struct per route group (`AuthAPI`, `CFSAPI`, `RecordsAPI`, `IntelAPI`, …). Each exposes async-throwing methods.
- Common middleware: auth header injection, retry on 5xx (3 attempts, exponential backoff, no retry on 4xx), idempotency-key on writes, error mapping.
- **Typed errors**:
  - `APIError.network(URLError)` — transport-layer.
  - `APIError.unauthorized` — 401, triggers refresh-then-retry once.
  - `APIError.forbidden` — 403, surfaces as "no permission" banner.
  - `APIError.notConfigured(code)` — 200 + `{ok:false, skipped:true, code:'not_configured'}` body. **Not an error** — surfaces as a disabled affordance with the code in the tooltip. Matches [[feedback-503-not-configured-anti-pattern]].
  - `APIError.server(status, code, message)` — 4xx/5xx with structured body.
  - `APIError.decode(error)` — bug, telemetry-only.
- 503-with-no-body still treated as server error (genuine outage).

## 9. Offline outbox (`CoreOffline`)

- SwiftData entity: `OutboxEntry { id: UUID, endpoint: String, method: String, body: Data, headers: [String:String], attemptCount: Int, lastError: String?, createdAt: Date }`.
- Drain triggers: `NWPathMonitor` "satisfied", every app foreground, manual pull-to-refresh on a sync banner.
- Each entry has an `Idempotency-Key` header set to the entry's UUID — Worker dedups via existing patterns.
- Retry policy: exponential backoff with jitter, max 24h, then mark `failed` and surface in Settings for manual review.
- Photos / audio: large payloads spool to disk in `Caches/Outbox/`, the `OutboxEntry.body` holds a reference path. Spool files are evicted on drain success.

## 10. Push notifications (`CorePush`)

- Token registration: `POST /api/devices/push-token` (new endpoint, trivial). Server stores `{user_id, device_token, app_version, registered_at}`.
- Notification categories:
  - `critical_alert` — panic, officer-down, use-of-force. Requires **iOS Critical Alerts entitlement** (request alongside CarPlay). Bypasses DND, audible.
  - `bolo_push` — new BOLO in agency.
  - `cfs_dispatch_to_me` — dispatcher assigned me a CFS.
  - `welfare_check_timeout` — welfare timer expired.
  - `roster_change` — supervisor moved my shift.
  - `comms_dm` — direct message (M6).
  - `comms_ptt_invite` — PTT channel invite (M6).
- **Live Activity push token**: registered when an activity starts; server pushes status updates so the Dynamic Island stays current without polling.

## 11. UI shell

### 11.1 Officer shell (5 tabs)

```
┌───────────────────────────────┐
│           [Home tab]          │
│                               │
├───────────────────────────────┤
│ ⌂Home │📋CFS│📷Scan│📝Report│⋯ │
└───────────────────────────────┘
```

| Tab | Contents |
|---|---|
| Home | A2 hero + mini-tiles (see §12). |
| CFS | Active call list, my queue, history. Pull-to-refresh. |
| Scan | Universal camera: plate / DL / passport / FI photo / ALPR. Mode selector top bar. |
| Reports | DAR, FI cards, citations, forms. |
| More | Toolkit, medical (M10), comms (M6), watchlist, settings, account, sign-out. |

### 11.2 Supervisor shell (4 tabs)

```
┌───────────────────────────────┐
│         [Command tab]         │
│                               │
├───────────────────────────────┤
│ ⌂Command │📍Units │📋CFS │ ⋯  │
└───────────────────────────────┘
```

| Tab | Contents |
|---|---|
| Command | Watch-commander dashboard: on-duty count, active criticals, response time medians, approval queue. |
| Units | Live unit map (Mapbox), unit-by-unit drilldown. |
| CFS | Read-only all-active-CFS board, with filter chips and BOLO push affordance. |
| More | Roster, approvals, audit log, BOLO push composer, settings. |

### 11.3 Role switch

- Initial role from JWT. Settings allows manual switch for users with both roles (`admin` users may need to test officer view).
- Switch tears down and re-creates the `FeatureShell` root view.

## 12. Home tab (A2 — hero + mini-tiles)

Officer home is a stateful hero card on top, two rows of mini-tiles below.

### 12.1 Hero state machine

`HomeViewModel.state` is an enum; each case renders a different hero:

| State | Trigger | Hero contents | Buttons |
|---|---|---|---|
| `.panicInAgency` | Any agency officer's panic active | RED card, unit + location, ETA backup countdown | Acknowledge · Backup · Map |
| `.dispatchedToMe` | New CFS pushed and not yet accepted | GOLD card, CFS#, type, address, dispatcher note | Accept · Decline · Map |
| `.activeCFS` | I'm en-route or on-scene | GOLD bordered card, CFS#, type, on-scene timer | 🎤 Note · Clear · Backup |
| `.welfareDue` | Welfare timer < 2 min from expiry | YELLOW card, countdown | Check in · Snooze |
| `.shiftSummary` | None of the above (between calls) | NEUTRAL card, shift duration, mileage, call count | Start FI · Run plate · Run ID |
| `.offDuty` | Not on duty | NEUTRAL card, "Press to clock on" | Clock on · Roster · DAR review |

### 12.2 Mini-tile rows

**Row 1 — status** (always 4 tiles):

| Tile | Source | Color cue |
|---|---|---|
| In queue | CFS API · queue count | Gold if > 0 |
| BOLO | Intel API · agency BOLOs | Red if any critical |
| Shift | Local · `OnDuty.startedAt` | Steel-blue |
| Welfare | `WelfareWatchDO` · remaining | Green > 5m, yellow 2–5m, red < 2m |

**Row 2 — quick actions** (always 4 tiles):

| Tile | Action |
|---|---|
| Plate | Push Run Plate scanner |
| ID | Push Run ID scanner |
| FI | Push new FI card |
| Medical | Push M10 medical hub (gated until M10) |

### 12.3 Live data

`HomeViewModel` subscribes to a small set of SwiftData fetches + the existing WebSocket on `wss://api.rmpgutah.us/ws` (CFS dispatch, panic, BOLO push). No polling.

## 13. Theme & DesignSystem

- Port the existing steel-blue Spillman tokens from web ([[project-systemwide-daynight-theme]]) into Swift constants on `DesignSystem.Color`.
- Day/night schedule: 06:00–18:00 local = day (light grey), else night (dark steel-blue). Manual override + legacy black kill-switch mirror the web behavior.
- `Theme.swift` from the existing `RMPGFlexTester` is the reference — port idioms (`GoldButtonStyle`, `.themeCard()`, etc.) into `DesignSystem` view modifiers.
- Brand gold stays `#d4a017`. Critical red `#ef4444`. Go green `#10b981`. Steel-blue surfaces from web palette.
- Map / dashcam / nav surfaces stay dark regardless of day/night (matches web `.tactical-dark` rule).

## 14. Modern iOS surfaces (M3+)

### 14.1 Live Activity (M3)

- `ActivityAttributes`: `ActiveCFSAttributes { cfsNumber, type, address, dispatchedAt }`.
- `ContentState`: `{ elapsed, status, unitsResponding }`.
- Lock screen: full hero with elapsed timer + status pills.
- Dynamic Island compact: ⏱ + CFS# / status icon.
- Dynamic Island expanded: hero + 1-tap "Note" intent button.
- Server pushes `ContentState` updates via Live Activity push token.

### 14.2 Widgets (M3)

- Home-screen widgets in 3 sizes:
  - Small: shift status (on-duty + active CFS).
  - Medium: shift + last 3 alerts.
  - Large: shift + active CFS + last 3 alerts + 2 quick actions.
- Lock-screen widgets (iOS 16+): inline (shift duration) and circular (welfare countdown).

### 14.3 AppIntents / Siri (M3)

- `RunPlateIntent(plate: String)` — opens app to plate result.
- `RunIDIntent` — opens app to ID scanner.
- `ClockOnIntent(vehicle: String?)` — clocks on (validates pre-trip inspection).
- `StartFIIntent` — opens new FI card.
- `PanicIntent` — broadcasts panic (with confirmation step, requires unlock).
- `DictateNoteIntent` — dictates into the active CFS (M3 AI dictation).

### 14.4 StandBy mode (M3)

- iOS 17+ MagSafe-docked dashboard. Same A2 layout scaled up. No tab bar. Auto-engages when phone is charging + horizontal + locked.

### 14.5 Action Button (iPhone 15 Pro+) (M3)

- Single press = panic broadcast with 3-second cancel banner. Double press = clock on/off toggle.
- Configured via Shortcuts (system limitation; we ship the Shortcut definitions, user picks them).

### 14.6 Focus mode (M3)

- "On Duty" Focus filter ships in M3. When engaged, system silences non-RMPG notifications and routes our critical alerts through. Auto-engages when `OnDuty.isOn` toggles true.

### 14.7 Live Text + Translation (M1 / M3)

- M1: Vision Live Text on the universal camera (auto-detect plate text on still photos).
- M1: iOS 18 on-device Translation framework on subject contact (~14 languages, no network).

## 15. Apple Watch (M4)

- watchOS 10 paired app.
- Watch faces / complications:
  - Modular Large: shift duration + active CFS #.
  - Modular Small: panic / on-duty pill.
  - Corner: welfare countdown.
- Standalone surfaces:
  - Glance: same data as Home mini-tiles.
  - Panic: large red button, 3-second hold + cancel.
  - Time-on-call timer with status update buttons.
  - Dictation-to-note (sends back to iPhone via WatchConnectivity).
- Officer-down detection (M7 integration):
  - HealthKit HR anomaly + CoreMotion immobility ≥ 30s → broadcast w/ GPS. 10-second cancel banner. Falsifiable in settings (off-shift only).
- Standalone cellular fallback: critical comms (panic + status) work without paired iPhone.

## 16. CarPlay (M5)

- `CPTemplateApplicationScene` hosted in main app, gated by entitlement.
- Templates:
  - `CPMapTemplate` with Mapbox map provider.
  - `CPListTemplate` (CFS queue).
  - `CPInformationTemplate` (call detail).
  - `CPAlertTemplate` (panic / BOLO alerts).
- Turn-by-turn to scene via Mapbox iOS SDK's CarPlay support.
- Hands-free status buttons: En-route, On-scene, Clear, Backup.
- TTS dispatcher notes via AVSpeechSynthesizer.
- **Apple CarPlay Navigation entitlement** must be requested via the developer.apple.com/contact/carplay form on day 1 of M0. Approval is 2–8 weeks. Until then M5 development uses Xcode's CarPlay simulator with a temporary local entitlement.

## 17. Comms / PTT (M6)

- WebRTC backbone via Cloudflare Calls (beta). New worker route group `/api/rtc/*`.
- Channels: agency-wide, per-shift, per-unit, ad-hoc.
- Direct messages with end-to-end encryption (libsodium NaCl boxes, key per device).
- BOLO broadcast composer (supervisor only) with photo attachment + 1-tap ack.
- Push categories `comms_dm` and `comms_ptt_invite` route to the comms tab.

## 18. Field Medical (M10)

- Entirely offline. Bundle (~10 MB compressed) of static reference + interactive walkthroughs.
- Hosted in More → Medical.
- Modules:
  - TECC (MARCH algorithm walkthrough).
  - CPR coach (metronome, depth cue, switch-compressor at 2 min, voice prompt).
  - AED step-through (pad placement, shock cycle).
  - Bleeding control (tourniquet, wound packing, pressure dressing).
  - Narcan walkthrough + auto-log to incident.
  - MCI triage (START / JumpSTART) — tag subjects, generate handoff sheet.
  - Calculators: GCS, SAMPLE, OPQRST.
  - Drug reference: Narcan, oral glucose, EpiPen — dosing + contra-indications.
  - Patient handoff: voice memo + photo of vitals card.
- **Liability framing**: prominent on-screen on first launch — "Officer reference and training aid. Not a substitute for medical protocol training. Not a diagnostic device. In doubt → call EMS."
- Auto-log of all administered interventions into the bound CFS.

## 19. Add-ons integrated

| Add-on | Lands in |
|---|---|
| Bluetooth thermal printer (citations) | M1 — `FeatureReports`. ESC/POS over CoreBluetooth; abstracted behind a `PrinterAdapter` protocol so we can add vendors later. |
| On-device Translation (~14 languages) | M1 — `FeatureRunID` for subject contact. iOS 18 Translation framework. |
| AI dictation → structured CFS narrative | M3 — uses existing Workers AI endpoint. Pipeline: AVAudioRecorder → upload → Worker transcribes (Whisper) → Worker structures (LLM) → returns form-ready JSON → user reviews → saves. |
| BT body-worn camera trigger | Deferred — not selected. Door left open via `BWCAdapter` protocol in `CoreAudio`. |

## 20. Cross-cutting

- **Accessibility**: Dynamic Type to XXL, VoiceOver labels on every interactive element, high-contrast mode toggle (police often work in bright sun), reduced motion respected.
- **Localization-ready**: String Catalog (.xcstrings). Ship English; add Spanish in v1.x.
- **Crash + telemetry**: PostHog iOS SDK. Crash reports, feature-use analytics, session replay opt-in only.
- **Feature flags**: existing `/api/feature-flags` endpoint; client-side `FeatureFlagsService` in `CoreAPI`.
- **Audit logging**: every state-mutating action emits an audit entry via the existing `recordAudit` seam ([[project-r2-data-catalog-analytics]] central audit pattern).
- **Testing**:
  - Unit (`swift test`) per package. CI on every PR.
  - Snapshot tests for `DesignSystem` + key feature screens.
  - XCUITest happy-path tour per milestone. Run nightly on iPhone 15 simulator.
  - TestFlight beta at end of every milestone, internal-only group.

## 21. Coexistence with `RMPGFlexTester`

- Both apps installable simultaneously (distinct bundle ids).
- Same Cloudflare Worker, same D1.
- New device-token endpoint differentiates by bundle id so APNs goes to the right app.
- Deprecation: only after M1 verified by a real shift. Once deprecated, old repo path `ios/` is moved to `legacy/ios-rmpgflextester/` and a `legacy/README.md` entry mirrors the VPS quarantine pattern.

## 22. Risks & gates

| Risk | Mitigation |
|---|---|
| **CarPlay entitlement denied / delayed** | M5 is last on purpose. Request on day 1 of M0. If denied, fall back to Apple Maps deep link from CFS detail. |
| **Critical Alerts entitlement denied** | Falls back to high-priority interruption-level notifications. Less disruptive but still works. |
| **Cloudflare Calls (WebRTC) GA timing** | M6 is mid-program. If still beta, ship M6 as opt-in feature flag. |
| **Mapbox iOS token leak** | Token stored in `Info.plist` with URL scheme allow-list. Same scope as web. |
| **SwiftData migration pain** | Conservative schema: 1.0 schema cast in concrete. Migrations land via the framework's auto-migration where additive only. |
| **Free-Apple-ID 7-day sideload still works at iOS 17** | Verified. M0 ships with a build configuration that targets personal team for sideload. |
| **`RMPGFlexTester` users on M0 day** | Both apps installable. We do not break the old app's bundle until M1 is verified. |
| **App Store review** | Out of scope for v1 — install path is personal team / TestFlight only. |

## 23. Open questions

- **iPad universal binary** — build iPad-capable from M0 for "fits on iPad as enlarged iPhone" (no extra work), or set `TARGETED_DEVICE_FAMILY = 1` (iPhone-only)? Recommendation: universal, but no iPad-specific layout in v1.
- **Apple Push for testing** — pay for an APNs dev cert vs use TestFlight's auth-key model? Recommendation: auth-key (no expiry headache).
- **Audit logging on Watch** — does an action taken on the Watch log to the same audit trail with `client=watch`? Recommendation: yes; add `client` enum to `recordAudit` if not already there.

## 24. What ships this session

- This spec (committed).
- After user approval, an M0 implementation plan via the `writing-plans` skill.
- If approved further, M0 itself: new Xcode project + SPM packages + login + role-aware tab shell + theme + Keychain + empty post-login screens. Buildable + installable on iPhone via personal team. **Zero feature screens** — M1 starts next session.

---

## Decision log (for traceability)

1. **Audience** — Officer + supervisor in one app, role-switched at login. *(2026-06-22 user choice.)*
2. **Driver** — All of the above: modern iOS surfaces + easier UI + cleaner architecture. *(2026-06-22 user choice.)*
3. **App name** — RMPG Flex Connect. *(2026-06-22 user choice.)*
4. **Lane scope** — All 9 original milestones kept; M10 Field Medical added on user request. *(2026-06-22.)*
5. **Add-ons** — BT printer (M1), on-device translation (M1), AI dictation (M3), Field Medical module (M10). Body-worn camera trigger deferred. *(2026-06-22 user choice.)*
6. **Shell** — A · 5-tab classic (officer Home/CFS/Scan/Reports/More; supervisor swaps Reports → Command). *(2026-06-22 user choice via browser.)*
7. **Home layout** — A2 · Hero card + mini-tiles. *(2026-06-22 user choice via browser.)*
