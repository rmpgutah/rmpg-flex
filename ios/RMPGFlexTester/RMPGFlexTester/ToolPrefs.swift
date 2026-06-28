import SwiftUI
import UIKit

// Persisted toolkit preferences (favorites + recents) and a haptics helper.
// Backs the workflow upgrades: pinned FAVORITES, RECENTLY USED, and tactile
// feedback so the officer can run tools without looking.
enum ToolPrefs {
    private static let favKey = "rmpg-tool-favorites"
    private static let recentKey = "rmpg-tool-recents"
    private static let collapseKey = "rmpg-tool-collapsed"
    private static let maxRecents = 8

    // ── Favorites ───────────────────────────────────────────
    static var favorites: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: favKey) ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: favKey) }
    }
    static func isFavorite(_ id: String) -> Bool { favorites.contains(id) }
    static func toggleFavorite(_ id: String) {
        var f = favorites
        if f.contains(id) { f.remove(id) } else { f.insert(id) }
        favorites = f
    }

    // ── Recents (most-recent first, capped) ─────────────────
    static var recents: [String] {
        get { UserDefaults.standard.stringArray(forKey: recentKey) ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: recentKey) }
    }
    static func recordUse(_ id: String) {
        var r = recents.filter { $0 != id }
        r.insert(id, at: 0)
        recents = Array(r.prefix(maxRecents))
    }

    // ── Collapsed categories ────────────────────────────────
    static var collapsed: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: collapseKey) ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: collapseKey) }
    }
    static func toggleCollapsed(_ category: String) {
        var c = collapsed
        if c.contains(category) { c.remove(category) } else { c.insert(category) }
        collapsed = c
    }
}

// Tactile + audible feedback. Distinct patterns so an officer can tell success
// from failure by feel alone — eyes stay on the subject, not the phone.
enum Haptics {
    static func tap() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
    static func warning() {
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }
    static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
    /// Strongest pattern — reserved for PANIC: error notification + a heavy thud.
    static func panic() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
    }
    /// Route a status string to the right feedback by its ✓/✗/⚠/⏳ prefix.
    static func forStatus(_ s: String) {
        if s.hasPrefix("✓") { success() }
        else if s.hasPrefix("✗") { error() }
        else if s.hasPrefix("⚠") || s.hasPrefix("⏳") { warning() }
        else { tap() }
    }
}

// Per-category accent color for the toolkit grid — fast visual grouping.
enum CategoryStyle {
    static func color(_ category: String) -> Color {
        switch category {
        case "FAVORITES": return Theme.gold
        case "RECENTLY USED": return Theme.blue
        case "SELF-INITIATED": return Theme.green
        case "LOOKUPS": return Theme.blue
        case "UNIT STATUS": return Theme.gold
        case "CLEAR CALL": return Theme.orange
        case "TIMERS & UTILITIES": return Color(hex: 0xa855f7)
        case "FIELD CALC": return Color(hex: 0x2dd4bf)
        case "MEDICAL & RESCUE": return Theme.red
        case "LEGAL REFERENCE": return Theme.gold
        case "CODES & REFERENCE": return Theme.neutral
        default: return Theme.neutral
        }
    }
}
