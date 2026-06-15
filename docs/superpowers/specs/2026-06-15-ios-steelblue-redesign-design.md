# iOS Steel-Blue Redesign — Design Spec (Program + R1)

**Date:** 2026-06-15
**Target:** `ios/RMPGFlexTester` (native SwiftUI iPhone field app)
**Author:** brainstormed with operator (Christopher Zamora)

## Summary

Redesign the iOS app's visual identity to match the **desktop's steel-blue Spillman night theme**, then layer emergency-responder UX and a workflow upgrade on top. Delivered as a sequence of independently-shippable PRs (R1–R5), brainstormed/spec'd one at a time. **This spec covers the program decomposition + R1 (the steel-blue theme + chrome) in full.** R2–R5 get their own specs when reached.

The iOS app currently uses a **pure-black** Spillman theme (`Theme.swift`: base `#0a0a0a`, gold `#d4a017`, zero blue). The desktop moved to a **steel-blue night theme** (`client/src/styles/theme-palettes.css`: surface `#0d1722`, panels `#15212e`, steel accent `#5a85b8`, gold kept). R1 brings iOS to that identity.

## Decisions (locked)

- **Steel-blue, night-only.** No day/light theme on iOS (a bright screen in a patrol vehicle at night is a safety downside; the desktop itself keeps tactical surfaces always-dark for the same reason).
- **Plain-language rewrite: dropped.** The operator retracted the "no LEO verbal terms" request — existing terminology (ten-codes, acronyms) stays.
- **Workflow upgrade scope (later phases):** smarter forms, more workflow types, redesigned hub, AND server-driven workflows.
- **Responder UX scope (later phases):** glanceable/high-contrast, big touch targets/one-handed, faster critical actions, hands-free/voice.

## Program Decomposition (PR sequence)

| # | PR | Stack | Notes |
|---|----|-------|-------|
| **R1** | **Steel-blue theme + chrome** | iOS | Foundational — re-map `Theme.swift` tokens; everything inherits it. **This spec.** |
| **R2** | Emergency-responder UX (type scale, touch targets, faster panic/status, hands-free voice) | iOS | Builds on R1. |
| **R3** | Workflow hub redesign + smarter forms (conditional/validation/prefill/resume) | iOS | Builds on R1 + the existing declarative engine. |
| **R4** | More workflow types (incident, use-of-force, medical, evidence, citation, FI, crash) | iOS | Content on R3's engine. |
| **R5** | Server-driven workflows (desktop admin defines → app renders live) | iOS + Worker + desktop | Largest; last. |

Each PR ships independently and installs to the device via `ios/refresh-device.sh`.

---

## R1 — Steel-Blue Theme + Chrome (this PR)

### Why this is high-leverage
`Theme.swift` is the single color source: **510 `Theme.*` token references across the views re-skin automatically** when the token values change. Only **11 hardcoded `Color(hex:)`** literals (in 5 files) need individual attention, and the **45 `.white` text usages stay** — white on `#0d1722` is *higher* contrast than the desktop's `#e6edf5`, which serves emergency-responder glanceability. So R1 is mostly a centralized token re-map plus the bar/group-box chrome.

### 1. `Theme` enum token re-map (`Theme.swift`)
Re-map the existing tokens to the desktop **night** palette and add a few new ones:

| Token | Now (black) | → Steel-blue | Desktop source |
|---|---|---|---|
| `base` | `#0a0a0a` | `#0d1722` | `--surface-base` |
| `raised` | `#141414` | `#15212e` | `--surface-raised` |
| `sunken` | `#050505` | `#0a1018` | `--surface-sunken` |
| `deep` | `#000000` | `#060b10` | `--surface-deep` |
| `border` | `#222222` | `#2a3a4d` | `--border-default` |
| `borderSubtle` | `#1a1a1a` | `#1e2b3a` | `--border-subtle` |
| `neutral` | `#888888` | `#8fa3b8` | `--text-muted` |
| `red` | `#cc3333` | `#ef4444` | `--sev-critical` |
| `orange` | `#cc7a1d` | `#f59e0b` | `--sev-warn` |
| `green` | `#3a9c4a` | `#22c55e` | `--sev-ok` |
| `gold` | `#d4a017` | **unchanged** | `--brand-gold` |
| `radius` | `2` | **unchanged** | — |

**New tokens** (additive — used by chrome + the hardcoded-hex reconciliation):
- `textPrimary = #e6edf5` (`--text-primary`)
- `textSecondary = #c3d0de` (`--text-secondary`)
- `borderStrong = #3a4f66` (`--border-strong`)
- `borderPanel = #243a52` (`--border-panel`)
- `blue = #5a85b8` (`--brand-blue` / `--spm-accent`)
- `blueBright = #7db4ec` (`--record-tile-fg`)
- `select = #316ac5` (`--spm-select`)
- `groupHeadTop = #1d2d3f`, `groupHeadBottom = #16222f` (the Spillman group-box / toolbar gradient stops)

### 2. Bar chrome (`Theme.configureAppearance()`)
Repaint the global UIKit bars steel-blue:
- **Tab bar** background → `#15212e` (panel), top hairline `#2a3a4d`; selected icon/label gold `#d4a017`, normal `#8fa3b8`.
- **Nav bar** background → `#15212e`, shadow/hairline `#2a3a4d`, title gold `#d4a017` (monospaced, unchanged), large-title gold.

(UIKit appearance can't render a gradient simply; a solid `#15212e` panel matches the desktop chrome closely. The gradient is reserved for the SwiftUI group-box header below.)

### 3. Spillman group-box chrome (shared components)
- **`SectionHeader`** — keep the gold uppercase label, but set the underline rule to `Theme.border` (`#2a3a4d`) and add an optional gradient "group-box header" variant for panel titles.
- Add **`SpmGroupHeader`** (new small component): a steel-blue **gradient bar** (`groupHeadTop → groupHeadBottom`) with a gold uppercase title and a bottom `borderStrong` rule — mirrors the desktop's `--spm-group-head`. Available for panels/cards that want the literal Spillman group-box look. (Adopting it across screens is R2/R3 layout work; R1 just provides it + uses it where `SectionHeader` already appears in shared chrome.)
- **`ThemeCard`** — change the border from `borderSubtle` to `borderPanel` (`#243a52`) so cards read as steel-blue panels.

### 4. Reconcile the 11 hardcoded hexes (5 files)
| File:line | Current | → |
|---|---|---|
| `CallsQueueView.swift:93` | `#bbbbbb` (address) | `Theme.textSecondary` |
| `NotificationsView.swift:69` | `#bbbbbb` (read) | `Theme.textSecondary` |
| `WalletIDView.swift:123` | `#cccccc` (value) | `Theme.textSecondary` |
| `CfsActionsView.swift:79` | `#2a2417` (warm tint bg) | `Theme.raised` (steel panel) |
| `ToolPrefs.swift:82–90` | 7 category accents | re-tune to steel-blue-harmonized hues (see below) |

Toolkit category accents (`ToolPrefs`) re-tuned to read on `#0d1722` while staying distinct:
- `RECENTLY USED`/`LOOKUPS` `#6a8caf` → `Theme.blue` (`#5a85b8`)
- `SELF-INITIATED` `#4a9c6a` → `#22c55e` (`green`)
- `CLEAR CALL` `#9c6a4a` → `#f59e0b` (`orange`)
- `TIMERS & UTILITIES` `#8a6aaf` → `#a855f7` (desktop `--sev-special`)
- `FIELD CALC` `#4a9c9c` → `#2dd4bf` (teal, legible on steel-blue)
- `LEGAL REFERENCE` `#af8a4a` → `Theme.gold` (`#d4a017`)

### 5. Out of scope for R1
- **No layout restructure** — screens keep their structure; only colors/chrome change. (Layout for responder UX is R2; workflow hub is R3.)
- **No day/light theme**, no theme toggle, no plain-language rewrite.
- **No functional changes** — behavior, endpoints, and data flow are untouched.
- The 45 `.white` text usages are left as-is (high-contrast, legible on steel-blue).

### 6. Verification
- `swiftc -typecheck *.swift` clean (after `export DEVELOPER_DIR=…`).
- `ios/run-workflow-tests.sh` green (theme change touches no pure-logic helpers; count unchanged).
- Grep confirms **zero** remaining `Color(hex: 0x…)` in the 5 reconciled files except intentional ones; `Theme` enum compiles with the new tokens.
- Visual: build + install to the iPhone via `refresh-device.sh --force`; eyeball Home / Field Ops / More against the approved steel-blue mockup.

### 7. Delivery
One PR off `main` (`claude/ios-r1-steelblue-theme`), feature-branch → `gh pr create` → review → merge → deploy. iOS-only: **no migration, no SW bump.** Installs to device via `refresh-device.sh`.

## Risks & mitigations
- **`Theme.swift` is the load-bearing file** — a wrong value mis-skins everything. Mitigation: the token table above is exact (sourced from `theme-palettes.css`); a device eyeball is the final gate.
- **UIKit bar gradient** isn't trivial — R1 uses a solid panel color for bars (close match) rather than fighting `UITabBarAppearance` for a gradient. Acceptable; revisit in R2 if needed.
- **Toolkit category hue re-tune is subjective** — values chosen for contrast on `#0d1722`; adjustable on review.
