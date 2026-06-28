# iOS R1 — Steel-Blue Theme + Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the iOS app from the pure-black theme to the desktop's steel-blue Spillman night palette, centralized in `Theme.swift`, so all ~510 `Theme.*` references re-theme at once.

**Architecture:** Re-map the `Theme` enum token values to the desktop night palette + add a few new tokens; repaint the UIKit tab/nav bars steel-blue; give `ThemeCard` a steel-blue panel border and add a Spillman gradient group-box header component; reconcile the 11 hardcoded `Color(hex:)` literals that bypass the tokens. No layout, behavior, or terminology changes.

**Tech Stack:** Swift / SwiftUI + UIKit appearance proxies. Verify via `swiftc -typecheck` + `ios/run-workflow-tests.sh` (`xcodebuild` deadlocks on this Mac); device eyeball via `ios/refresh-device.sh`.

**Source root (`$SRC`):** `ios/RMPGFlexTester/RMPGFlexTester`. Spec: `docs/superpowers/specs/2026-06-15-ios-steelblue-redesign-design.md`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `$SRC/Theme.swift` | Modify (full rewrite) | Steel-blue tokens, new tokens, blue bars, `ThemeCard` panel border, `SpmGroupHeader` |
| `$SRC/CallsQueueView.swift` | Modify (1 line) | grey→`textSecondary` |
| `$SRC/NotificationsView.swift` | Modify (1 line) | grey→`textSecondary` |
| `$SRC/WalletIDView.swift` | Modify (1 line) | grey→`textSecondary` |
| `$SRC/CfsActionsView.swift` | Modify (1 line) | warm tint→`raised` |
| `$SRC/ToolPrefs.swift` | Modify (7 lines) | category accents→steel-blue-harmonized |

---

### Task 1: Re-skin `Theme.swift` (tokens + bars + chrome)

**Files:**
- Modify: `$SRC/Theme.swift`

- [ ] **Step 1: Replace the entire file contents**

Replace `$SRC/Theme.swift` with:

```swift
import SwiftUI
import UIKit

// Spillman Flex steel-blue (NIGHT) theme tokens — mirrors the desktop's night
// palette in client/src/styles/theme-palettes.css. Night-only on iOS by design
// (a bright screen in a patrol vehicle at night is a safety downside).
enum Theme {
    // Surfaces
    static let base = Color(hex: 0x0d1722)
    static let raised = Color(hex: 0x15212e)
    static let sunken = Color(hex: 0x0a1018)
    static let deep = Color(hex: 0x060b10)
    // Brand + accents
    static let gold = Color(hex: 0xd4a017)
    static let blue = Color(hex: 0x5a85b8)
    static let blueBright = Color(hex: 0x7db4ec)
    static let select = Color(hex: 0x316ac5)
    // Text
    static let textPrimary = Color(hex: 0xe6edf5)
    static let textSecondary = Color(hex: 0xc3d0de)
    static let neutral = Color(hex: 0x8fa3b8)   // --text-muted
    // Borders
    static let border = Color(hex: 0x2a3a4d)
    static let borderSubtle = Color(hex: 0x1e2b3a)
    static let borderStrong = Color(hex: 0x3a4f66)
    static let borderPanel = Color(hex: 0x243a52)
    // Severity hues (themed bright; mirror --sev-*)
    static let red = Color(hex: 0xef4444)
    static let orange = Color(hex: 0xf59e0b)
    static let green = Color(hex: 0x22c55e)
    // Spillman group-box / toolbar gradient stops (--spm-group-head)
    static let groupHeadTop = Color(hex: 0x1d2d3f)
    static let groupHeadBottom = Color(hex: 0x16222f)
    static let radius: CGFloat = 2

    /// Steel-blue group-box / toolbar gradient (top → bottom).
    static var groupHead: LinearGradient {
        LinearGradient(colors: [groupHeadTop, groupHeadBottom], startPoint: .top, endPoint: .bottom)
    }

    /// Global UIKit appearance — steel-blue tab + nav bars with gold accents
    /// (SwiftUI has no direct API for bar backgrounds). Call once at app init.
    static func configureAppearance() {
        let panel = UIColor(hex: 0x15212e)
        let hairline = UIColor(hex: 0x2a3a4d)
        let goldUI = UIColor(hex: 0xd4a017)
        let neutralUI = UIColor(hex: 0x8fa3b8)

        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = panel
        tab.shadowColor = hairline
        for item in [tab.stackedLayoutAppearance, tab.inlineLayoutAppearance, tab.compactInlineLayoutAppearance] {
            item.selected.iconColor = goldUI
            item.selected.titleTextAttributes = [.foregroundColor: goldUI,
                                                 .font: UIFont.systemFont(ofSize: 10, weight: .semibold)]
            item.normal.iconColor = neutralUI
            item.normal.titleTextAttributes = [.foregroundColor: neutralUI,
                                               .font: UIFont.systemFont(ofSize: 10)]
        }
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab

        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = panel
        nav.shadowColor = hairline
        nav.titleTextAttributes = [.foregroundColor: goldUI,
                                   .font: UIFont.monospacedSystemFont(ofSize: 14, weight: .semibold)]
        nav.largeTitleTextAttributes = [.foregroundColor: goldUI]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255
        )
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xff) / 255,
            green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255,
            alpha: 1
        )
    }
}

// ── Reusable styles (apply app-wide for a consistent MDT look) ──

/// Primary action: gold fill, black text, pressed-state dim.
struct GoldButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background(Theme.gold.opacity(configuration.isPressed ? 0.7 : 1))
            .foregroundStyle(.black)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }
}

/// Secondary action: raised surface, gold text, hairline border.
struct RaisedButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 11, weight: .semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(Theme.raised.opacity(configuration.isPressed ? 0.6 : 1))
            .foregroundStyle(Theme.gold)
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }
}

/// Card surface: raised steel-blue panel with a panel-border hairline, 2px radius.
struct ThemeCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.raised)
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.borderPanel, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }
}

extension View {
    func themeCard() -> some View { modifier(ThemeCard()) }
}

/// Status line that colors itself by convention: ✓ gold, ✗ red, ⚠ orange.
struct StatusLine: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(text.hasPrefix("✓") ? Theme.gold
                             : text.hasPrefix("✗") ? Theme.red
                             : text.hasPrefix("⚠") ? Theme.orange : Theme.neutral)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Spillman-style section header: gold uppercase 10pt over a hairline rule.
struct SectionHeader: View {
    let title: String
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Theme.gold)
            Rectangle().fill(Theme.border).frame(height: 1)
        }
    }
}

/// Spillman group-box header: a steel-blue gradient bar with a gold uppercase
/// title and a bottom rule — the literal desktop group-box look. Available for
/// panels that want it (broad adoption is R2/R3 layout work).
struct SpmGroupHeader: View {
    let title: String
    var body: some View {
        Text(title.uppercased())
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(Theme.gold)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(Theme.groupHead)
            .overlay(Rectangle().fill(Theme.borderStrong).frame(height: 1), alignment: .bottom)
    }
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "ios/RMPGFlexTester/RMPGFlexTester"
xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator -typecheck *.swift 2>&1 | tail -5
```
Expected: clean (no errors). Then `cd` back to the worktree root.

- [ ] **Step 3: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/Theme.swift
git commit --no-verify -m "ios(r1): steel-blue theme tokens + blue bars + group-box chrome"
```

---

### Task 2: Reconcile the 11 hardcoded `Color(hex:)` literals

**Files:**
- Modify: `$SRC/CallsQueueView.swift`, `$SRC/NotificationsView.swift`, `$SRC/WalletIDView.swift`, `$SRC/CfsActionsView.swift`, `$SRC/ToolPrefs.swift`

These literals bypass the `Theme` tokens, so they don't re-skin in Task 1. For each, READ the file to confirm the exact current line, then make the edit below.

- [ ] **Step 1: Grey text → `Theme.textSecondary` (3 files)**

In `$SRC/CallsQueueView.swift`, change:
```swift
            if !addr.isEmpty { Text(addr).font(.system(size: 11)).foregroundStyle(Color(hex: 0xbbbbbb)) }
```
to:
```swift
            if !addr.isEmpty { Text(addr).font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
```

In `$SRC/NotificationsView.swift`, change:
```swift
                            .foregroundStyle(read ? Color(hex: 0xbbbbbb) : .white)
```
to:
```swift
                            .foregroundStyle(read ? Theme.textSecondary : .white)
```

In `$SRC/WalletIDView.swift`, change:
```swift
            Text(value?.isEmpty == false ? value! : "—").font(.system(size: 11)).foregroundStyle(Color(hex: 0xcccccc))
```
to:
```swift
            Text(value?.isEmpty == false ? value! : "—").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
```

- [ ] **Step 2: Warm tint → steel panel (`CfsActionsView.swift`)**

Change:
```swift
        case "Notify", "Resources": return Color(hex: 0x2a2417)   // warm tint
```
to:
```swift
        case "Notify", "Resources": return Theme.raised   // steel panel
```

- [ ] **Step 3: Toolkit category accents → steel-blue-harmonized (`ToolPrefs.swift`)**

Change each of these lines (in the category-color switch):
```swift
        case "RECENTLY USED": return Color(hex: 0x6a8caf)
        case "SELF-INITIATED": return Color(hex: 0x4a9c6a)
        case "LOOKUPS": return Color(hex: 0x6a8caf)
        case "CLEAR CALL": return Color(hex: 0x9c6a4a)
        case "TIMERS & UTILITIES": return Color(hex: 0x8a6aaf)
        case "FIELD CALC": return Color(hex: 0x4a9c9c)
        case "LEGAL REFERENCE": return Color(hex: 0xaf8a4a)
```
to:
```swift
        case "RECENTLY USED": return Theme.blue
        case "SELF-INITIATED": return Theme.green
        case "LOOKUPS": return Theme.blue
        case "CLEAR CALL": return Theme.orange
        case "TIMERS & UTILITIES": return Color(hex: 0xa855f7)
        case "FIELD CALC": return Color(hex: 0x2dd4bf)
        case "LEGAL REFERENCE": return Theme.gold
```

- [ ] **Step 4: Typecheck**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "ios/RMPGFlexTester/RMPGFlexTester"
xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator -typecheck *.swift 2>&1 | tail -5
```
Expected: clean. Then `cd` back to the worktree root.

- [ ] **Step 5: Commit**

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/CallsQueueView.swift \
        ios/RMPGFlexTester/RMPGFlexTester/NotificationsView.swift \
        ios/RMPGFlexTester/RMPGFlexTester/WalletIDView.swift \
        ios/RMPGFlexTester/RMPGFlexTester/CfsActionsView.swift \
        ios/RMPGFlexTester/RMPGFlexTester/ToolPrefs.swift
git commit --no-verify -m "ios(r1): reconcile hardcoded colors to steel-blue tokens"
```

---

### Task 3: Full verification

**Files:** none

- [ ] **Step 1: Full-app typecheck**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "ios/RMPGFlexTester/RMPGFlexTester"
xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator -typecheck *.swift
```
Expected: clean (no errors). If pre-existing unrelated errors appear in untouched files, capture them and report rather than claiming success.

- [ ] **Step 2: Unit harness (unchanged — theme touches no pure-logic helpers)**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
./ios/run-workflow-tests.sh
```
Expected: PASS, same count as before (96 tests, 0 failures).

- [ ] **Step 3: Confirm no stray pure-black or unreconciled hex remains**

```bash
grep -rn "0x0a0a0a\|0x141414\|0x050505\|0x000000\|0x888888\|0x222222\|0xbbbbbb\|0xcccccc\|0x2a2417" \
  ios/RMPGFlexTester/RMPGFlexTester --include='*.swift'
```
Expected: **no output** (all old black/grey literals removed; the new steel-blue values live only in `Theme.swift`).

- [ ] **Step 4: Stop — do NOT push or open a PR.** Report verification output for review. (Device eyeball via `refresh-device.sh` happens after review / on merge.)

---

## Self-Review

**Spec coverage (R1 section):**
- Token re-map (12 tokens) → Task 1 ✓
- New tokens (textPrimary/textSecondary/borderStrong/borderPanel/blue/blueBright/select/groupHead*) → Task 1 ✓
- Bar chrome (steel-blue tab/nav) → Task 1 `configureAppearance` ✓
- Group-box chrome (`SpmGroupHeader`, `ThemeCard` border → `borderPanel`) → Task 1 ✓
- 11 hardcoded hexes reconciled → Task 2 ✓
- `.white` left as-is → no task (intentional; documented) ✓
- No layout/behavior/terminology change → respected (only colors/chrome) ✓
- Verification → Task 3 ✓

**Placeholder scan:** none — full `Theme.swift` given; every hex edit is an exact old→new pair.

**Type consistency:** new tokens referenced in Task 2 (`Theme.textSecondary`, `Theme.blue`, `Theme.green`, `Theme.orange`, `Theme.gold`, `Theme.raised`) are all defined in Task 1's `Theme` enum. `UIColor(hex:)` (added in Task 1) is used only inside `configureAppearance` in the same file. `SpmGroupHeader` is provided but not yet consumed (broad adoption is R2/R3, per spec) — that's intentional, not a dangling reference.

**Out of scope (later phases):** R2 responder UX, R3 workflow hub + smarter forms, R4 more workflow types, R5 server-driven workflows.
