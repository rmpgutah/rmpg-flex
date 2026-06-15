# iOS Steel-Blue Redesign — R2: Emergency-Responder UX (Design Spec)

**Date:** 2026-06-15
**Target:** `ios/RMPGFlexTester` (native SwiftUI iPhone field app)
**Author:** brainstormed with operator (Christopher Zamora)
**Program spec:** [`2026-06-15-ios-steelblue-redesign-design.md`](2026-06-15-ios-steelblue-redesign-design.md) (R1 merged as #1338)

## Summary

R2 is the **emergency-responder UX** pass in the steel-blue redesign program. R1 re-skinned the
app's color identity from one load-bearing file (`Theme.swift`). R2 does the *interaction*-layer
equivalent: it introduces the typography / spacing / touch-target primitives the app has never had
(font sizes are hardcoded 9–14pt across every view), makes the two most time-critical controls —
**PANIC and unit status** — always reachable one-handed, adds **hardware-button panic** triggers, and
gives the officer **eyes-free spoken readback** of incoming priority calls.

R2 is sequenced **before** R3 (workflow hub + smarter forms) deliberately: R3 builds the most
touch-heavy, glanceability-critical surfaces in the app (the hub tiles and multi-step forms), and
should inherit R2's primitives rather than be re-touched later.

iOS-only — **no migration, no service-worker bump**. Merging is a no-op for live web prod; the visible
result is on the phone via `ios/refresh-device.sh`.

## Decisions (locked in brainstorming)

- **Type scale = "Responder" (option B) + Dynamic Type.** Critical values (call type, call#, status)
  go large; supporting text stays moderate. The scale **honors iOS Dynamic Type** (system +
  accessibility text size), so it is a *token layer*, not a find-replace of pt values.
- **Critical-action surface = persistent action bar (option B).** A bar pinned above the tab bar on
  Field Ops, scroll-proof: current status (tap → big-target picker) on the left, PANIC on the right.
  Replaces today's mid-scroll status grid + bottom-of-scroll panic button.
- **Hardware panic = Back Tap (triple-tap back) + Action Button.** Both bind to the **existing**
  `PanicIntent`. *"Three presses of the power button" is not buildable* — no iOS API lets a third-party
  app observe the side/power button; the rapid-side-button panic is Apple's system Emergency SOS
  (dials 911), which cannot be repointed at RMPG dispatch. Back Tap + Action Button are the supported
  hands-free hardware triggers on the operator's iPhone 17 Pro. **Volume rapid-press: rejected**
  (fragile; foreground-only).
- **Voice = spoken call/alert readback only (net-new TTS).** Siri-phrase surfacing and
  dictation-on-all-fields were **not** selected (dictation-everywhere belongs to R3's form rework).
- **Defaults:** spoken readback **ON while on-shift** (toggle in Settings); status picker is a
  **slide-up big-target sheet** (not a tap-to-cycle); PANIC keeps its **tap-then-confirm** guard.

## Out of scope for R2

- The workflow hub redesign and smarter forms (R3). R2 touches the workflow engine **not at all**.
- A day/light theme, theme toggle, or plain-language rewrite (program-level decisions, already settled).
- A big-bang re-font of every screen. R2 lands the type/spacing system and adopts it on the
  **responder-critical surfaces** + shared chrome; the long tail follows the house rule ("migrate hex /
  sizes when you touch the page").
- Siri voice commands, dictation on non-narrative fields, Live Activities, lock-screen widgets.
- Any Worker / desktop / D1 change.

---

## Components

### A. Type system — `Theme.Typography` + `Theme.Spacing` (foundational)

Add a named typographic role layer to `Theme.swift`. Each role is a `Font` declared **relative to** a
built-in text style so it scales with Dynamic Type, preserving our base size + weight (and monospace
where it matters).

| Role | Base size / weight | Relative to | Used for |
|---|---|---|---|
| `display` | 28 / heavy | `.largeTitle` | the single hero value on a screen (call type on detail) |
| `title` | 22 / heavy | `.title` | primary card value (call type in a card, subject name) |
| `headline` | 17 / semibold | `.title3` | secondary headers, call number |
| `body` | 16 / regular | `.body` | addresses, descriptions, list rows |
| `label` | 13 / semibold (uppercased at call site) | `.subheadline` | gold section labels |
| `caption` | 12 / regular | `.caption` | timestamps, muted meta |
| `mono` / `monoLarge` | 16 / 18, monospaced | `.body` / `.title3` | call numbers, call signs, addresses |

`★ Why a token layer:` SwiftUI's `Font.system(size:)` does **not** auto-scale with Dynamic Type — only
semantic styles and `Font.custom(_, size:, relativeTo:)` / `@ScaledMetric` do. So each role uses
`Font.system(size:weight:design:)` wrapped to scale via `UIFontMetrics(forTextStyle:).scaledValue` /
`@ScaledMetric`, or `.custom`-style `relativeTo:`. This is the whole reason the type scale is a layer,
not a pt-value swap.

Add a parallel `Theme.Spacing` scale to replace the scattered 6/8/9/10/12/14pt:
`xs=4, sm=6, md=8, lg=12, xl=16, xxl=20`. (Pure constants; typecheck-only.)

**Files:** `Theme.swift` (add `Typography`, `Spacing`).

### B. Touch targets / one-handed

- Add size variants to the existing button styles: `GoldButtonStyle(size:)` / `RaisedButtonStyle(size:)`
  with `.regular` (today's padding) and `.large` (≈14pt vertical, for primary field actions).
- Add a `.minTouchTarget()` view modifier enforcing a **≥44pt** hit area (`frame(minWidth:44,
  minHeight:44)`), applied to icon-only / compact controls.
- Critical controls live in the **bottom thumb zone** (the action bar, C).

**Files:** `Theme.swift` (button-style size param + `minTouchTarget` modifier).

### C. Persistent critical-action bar (Field Ops)

A new `ResponderActionBar` component attached to `FieldOpsView` via `.safeAreaInset(edge: .bottom)`
so it pins above the scroll content and sits above the tab bar (scroll-proof).

- **Left — status chip:** shows current unit status (e.g. `10-8 AVAILABLE`, green). Tap → a slide-up
  **big-target status picker** (`.sheet` with `presentationDetents([.height(...)])`, ~50pt rows for the
  four statuses `available / enroute / on_scene / busy`). One tap sets status (reusing
  `setStatus` → `sendOrQueue`) + `Haptics.tap()`, sheet dismisses. Replaces the mid-scroll `statusCard`.
- **Right — PANIC:** reuses the existing `confirmPanic` `.alert` guard + `panic()` flow
  (`Haptics.panic()`, vibrate, `sendOrQueue` so a dead-zone panic queues and fires on reconnect).
  Replaces the bottom-of-scroll `panicButton`.
- The bar only renders when relevant (on-shift / authenticated); off-duty it can collapse to PANIC-only.

`FieldOpsView` loses its inline `statusCard` and trailing `panicButton`; that logic moves into / is
driven by the bar. The assigned-call card, nav links, and pills row stay in the scroll body.

**Files:** new `ResponderActionBar.swift`; edits to `FieldOpsView.swift`.

### D. Hardware panic (Back Tap + Action Button)

- **Harden `PanicIntent`** (`AppIntents.swift`): add
  `static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed` so it fires **while the
  phone is locked** (a panic must not require Face ID). Keep `openAppWhenRun = false` and the existing
  offline-queue fallback.
- The existing `RMPGShortcuts` App Shortcut already exposes `PanicIntent` to the system, which is what
  Back Tap and the Action Button bind to. No new intent needed.
- **In-app setup helper** — a `HardwarePanicSetupView` reached from `SettingsView`: step-by-step
  instructions for *Settings → Accessibility → Touch → Back Tap → Triple Tap → RMPG Panic* and
  *Settings → Action Button → Shortcut → RMPG Panic*, with an "Open Settings" button
  (`UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString))`).
  **Honest limitation:** iOS provides **no deep link** to the Back Tap or Action Button panes — the
  helper can open Settings and instruct, but cannot pre-fill the binding. State this in the UI.
- **Discoverability caveat (carried from #1208):** App Shortcuts only appear once the app is built
  through **Xcode's "Extract App Intents Metadata" phase**. `swiftc` / `refresh-device.sh` install the
  code but **not** the metadata bundle — so the hardware triggers stay invisible until a one-time
  **Xcode GUI build**. Documented in the helper screen and the PR body; not automatable here.

**Files:** `AppIntents.swift` (auth policy); new `HardwarePanicSetupView.swift`; `SettingsView.swift`
(entry point).

### E. Spoken call/alert readback (TTS)

A net-new, eyes-free announcer. **No TTS exists today** (only `Dictation`/SFSpeech speech-to-text).

- **`SpokenAlert`** (pure, unit-tested):
  - `static func phrase(for call: [String: Any]) -> String` → e.g.
    `"New Priority 1. Disturbance. Weapons involved. 1450 South State Street."` (expands priority,
    incident type, hazard flags via the same `hazardFlags` vocabulary as `FieldOpsView`, and address).
  - `static func shouldSpeak(callId: Int, isP1: Bool, hazards: [String], lastSpokenId: Int?) -> Bool`
    → dedup by id; speak only for **P1 or hazard-bearing** calls (mirrors the existing alert-once
    threshold at `FieldOpsView.refresh()`).
- **`SpeechAnnouncer`** (impure, not unit-tested): wraps `AVSpeechSynthesizer`; `speak(_ text:)`
  configures an audio session that **ducks** other audio briefly so the readback is heard over
  music/nav; respects the Settings toggle.
- **Wiring:** in `FieldOpsView.refresh()`, where the new-call haptic/vibrate already fires, also call
  `SpeechAnnouncer` when `SpokenAlert.shouldSpeak(...)`. Extend to intel hits in `NotificationsView`
  if cheap.
- **Setting:** `spokenAlertsEnabled` (Settings), **default ON while on-shift**.

**Files:** new `SpokenAlert.swift` (pure) + `SpeechAnnouncer.swift` (AV); edits to `FieldOpsView.swift`,
`SettingsView.swift`, and `run-workflow-tests.sh` (add `SpokenAlert.swift` to the pure-logic sources).

### F. Adoption strategy

Land A + B foundations, then adopt the Typography/Spacing/button tokens on the **responder-critical
surfaces**: `FieldOpsView`, `CallsQueueView`, `NotificationsView`, `DashboardView`, plus the shared
chrome (`ThemeCard`, `SectionHeader`, button styles, the new action bar). The long tail of hardcoded
sizes is migrated opportunistically; R3 picks up the hub + forms. This mirrors R1's "foundation + where
it matters" pattern and the repo's "migrate when you touch the page" rule.

---

## Testing & build

- `swiftc -typecheck *.swift` clean (after `export DEVELOPER_DIR=…`).
- New pure helpers added to `ios/run-workflow-tests.sh` source list with XCTest:
  - `SpokenAlertTests` — `phrase(for:)` formatting (priority, hazards, address expansion) and
    `shouldSpeak(...)` (dedup, P1/hazard threshold).
- Existing 32 test files / 143 tests stay green (R2 changes no existing pure-logic helper).
- Device gate: build + install via `ios/refresh-device.sh --force`; eyeball Field Ops (action bar,
  status picker, panic), a new P1 call's spoken readback, and Dynamic Type at a larger system size.

## Risks & mitigations

- **Dynamic Type overflow** — larger accessibility sizes can break tight rows. Mitigation: roles wrap /
  truncate gracefully; eyeball at one large size on-device; don't pin heights on text.
- **Action bar eats vertical space** — scoped to Field Ops only; off-duty collapses to PANIC-only.
- **Hardware triggers need user setup + an Xcode metadata build** — cannot be fully automated; the
  setup helper + PR body document the manual steps honestly.
- **TTS over the silent switch / radio traffic** — ducking audio session, on/off toggle, and the
  P1/hazard-only threshold keep it from being chatty; default-on only while on-shift.
- **PanicIntent `alwaysAllowed` while locked** — intentional (panic must not require unlock); the
  guarded confirm exists only for the *in-app* button, not the hardware/intent path (a hardware panic is
  deliberate by construction).

## Delivery

One PR off `main` (`claude/ios-r2-responder-ux`), feature-branch → `gh pr create` → review → merge →
deploy. iOS-only: **no migration, no SW bump.** Installs to the device via `refresh-device.sh`.
