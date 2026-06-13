import SwiftUI
import UIKit

// Spillman Flex / Motorola pure-black theme tokens (mirrors client design tokens).
enum Theme {
    static let base = Color(hex: 0x0a0a0a)
    static let raised = Color(hex: 0x141414)
    static let sunken = Color(hex: 0x050505)
    static let deep = Color(hex: 0x000000)
    static let gold = Color(hex: 0xd4a017)
    static let neutral = Color(hex: 0x888888)
    static let border = Color(hex: 0x222222)
    static let borderSubtle = Color(hex: 0x1a1a1a)
    static let red = Color(hex: 0xcc3333)
    static let orange = Color(hex: 0xcc7a1d)
    static let green = Color(hex: 0x3a9c4a)
    static let radius: CGFloat = 2

    /// Global UIKit appearance — tab bar + nav bar in pure black with gold
    /// accents (SwiftUI has no direct API for bar backgrounds). Call once
    /// at app init.
    static func configureAppearance() {
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = UIColor(red: 0, green: 0, blue: 0, alpha: 1)
        let goldUI = UIColor(red: 0xd4 / 255, green: 0xa0 / 255, blue: 0x17 / 255, alpha: 1)
        let neutralUI = UIColor(red: 0x88 / 255, green: 0x88 / 255, blue: 0x88 / 255, alpha: 1)
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
        nav.backgroundColor = UIColor(red: 0x0a / 255, green: 0x0a / 255, blue: 0x0a / 255, alpha: 1)
        nav.shadowColor = UIColor(red: 0x22 / 255, green: 0x22 / 255, blue: 0x22 / 255, alpha: 1)
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

/// Card surface: raised panel with hairline border, 2px radius.
struct ThemeCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.raised)
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.borderSubtle, lineWidth: 1))
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
