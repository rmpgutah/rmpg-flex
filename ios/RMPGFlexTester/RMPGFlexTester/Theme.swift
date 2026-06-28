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
    // Severity hues (themed bright; mirror --sev-*). `red` is the deeper red-600
    // (desktop --stat-accent-red) not red-500, so white text on red fills (PANIC,
    // hazard) clears WCAG AA — critical for glanceability under stress.
    static let red = Color(hex: 0xdc2626)
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

    /// Named type roles at the Responder scale. Each is scaled by Dynamic Type
    /// relative to a system text style, so it honors the officer's text-size +
    /// accessibility settings while keeping our exact base size + weight (and
    /// the monospaced Spillman feel where it matters). SwiftUI's plain
    /// `.system(size:)` does NOT auto-scale — this layer is why the scale honors
    /// Dynamic Type instead of being fixed pt values.
    enum Typography {
        static func scaled(_ size: CGFloat, _ weight: Font.Weight,
                           relativeTo style: UIFont.TextStyle,
                           monospaced: Bool = false) -> Font {
            let s = UIFontMetrics(forTextStyle: style).scaledValue(for: size)
            return .system(size: s, weight: weight, design: monospaced ? .monospaced : .default)
        }
        static var display: Font   { scaled(28, .heavy,    relativeTo: .largeTitle) }
        static var title: Font     { scaled(22, .heavy,    relativeTo: .title1) }
        static var headline: Font  { scaled(17, .semibold, relativeTo: .title3) }
        static var body: Font      { scaled(16, .regular,  relativeTo: .body) }
        static var label: Font     { scaled(13, .semibold, relativeTo: .subheadline) }
        static var caption: Font   { scaled(12, .regular,  relativeTo: .caption1) }
        static var mono: Font      { scaled(16, .regular,  relativeTo: .body, monospaced: true) }
        static var monoLarge: Font { scaled(18, .semibold, relativeTo: .title3, monospaced: true) }
    }

    /// Layout spacing scale, replacing the scattered 6/8/9/10/12/14pt literals.
    enum Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 6
        static let md: CGFloat = 8
        static let lg: CGFloat = 12
        static let xl: CGFloat = 16
        static let xxl: CGFloat = 20
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

/// Size variants for the shared button styles. `.large` is for primary field
/// actions that must be hit one-handed; both enforce a 44pt minimum height.
enum ButtonSize { case regular, large }

/// Primary action: gold fill, black text, pressed-state dim.
struct GoldButtonStyle: ButtonStyle {
    var size: ButtonSize = .regular
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(size == .large ? Theme.Typography.headline : .system(size: 12, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.vertical, size == .large ? 14 : 9)
            .background(Theme.gold.opacity(configuration.isPressed ? 0.7 : 1))
            .foregroundStyle(.black)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// Secondary action: raised surface, gold text, hairline border.
struct RaisedButtonStyle: ButtonStyle {
    var size: ButtonSize = .regular
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(size == .large ? Theme.Typography.headline : .system(size: 11, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.vertical, size == .large ? 13 : 8)
            .background(Theme.raised.opacity(configuration.isPressed ? 0.6 : 1))
            .foregroundStyle(Theme.gold)
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
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

    /// Guarantee at least a 44×44pt hit area (Apple HIG minimum) for compact /
    /// icon-only controls.
    func minTouchTarget(_ side: CGFloat = 44) -> some View {
        frame(minWidth: side, minHeight: side).contentShape(Rectangle())
    }
}

/// Status line that colors itself by convention: ✓ gold, ✗ red, ⚠ orange.
struct StatusLine: View {
    let text: String
    var body: some View {
        Text(text)
            .font(Theme.Typography.mono)
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
                .font(Theme.Typography.label)
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

/// Wraps content in a literal Spillman group-box: a gold gradient header bar over
/// a steel-blue panel body with a panel-border hairline. The drop-in chrome for
/// detail panels / cards that want the desktop group-box look.
struct SpmGroupBox<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(spacing: 0) {
            SpmGroupHeader(title: title)
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Theme.Spacing.lg)
                .background(Theme.raised)
        }
        .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.borderPanel, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }
}

/// Standard empty / zero-state: a muted icon, a title, and an optional subtitle.
/// Replaces the one-off "No …" Text lines scattered across the list screens.
struct EmptyState: View {
    let icon: String
    let title: String
    var subtitle: String? = nil
    var body: some View {
        VStack(spacing: Theme.Spacing.md) {
            Image(systemName: icon)
                .font(.system(size: 34))
                .foregroundStyle(Theme.neutral)
            Text(title)
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.textSecondary)
            if let subtitle {
                Text(subtitle)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.neutral)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.Spacing.xxl * 2)
    }
}
