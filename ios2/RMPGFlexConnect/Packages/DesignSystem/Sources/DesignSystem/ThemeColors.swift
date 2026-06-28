import SwiftUI

/// Color tokens for both day and night modes. Hex values match the web
/// palette in `client/src/styles/theme-palettes.css`.
public struct ThemeColors: Sendable, Equatable {
    public let surfaceBase: Color
    public let surfaceRaised: Color
    public let surfaceMuted: Color
    public let textPrimary: Color
    public let textSecondary: Color
    public let textMuted: Color
    public let brandGold: Color    // #d4a017 — never changes between modes
    public let critical: Color     // #ef4444
    public let success: Color      // #10b981
    public let warning: Color      // #f59e0b

    public static let night = ThemeColors(
        surfaceBase:    Color(hex: 0x0D1722),
        surfaceRaised:  Color(hex: 0x142133),
        surfaceMuted:   Color(hex: 0x1C2C44),
        textPrimary:    Color(hex: 0xCFE0F5),
        textSecondary:  Color(hex: 0x8AA1BB),
        textMuted:      Color(hex: 0x6E8AA8),
        brandGold:      Color(hex: 0xD4A017),
        critical:       Color(hex: 0xEF4444),
        success:        Color(hex: 0x10B981),
        warning:        Color(hex: 0xF59E0B)
    )

    public static let day = ThemeColors(
        surfaceBase:    Color(hex: 0xE9ECF0),
        surfaceRaised:  Color(hex: 0xF4F6F9),
        surfaceMuted:   Color(hex: 0xDDE2EA),
        textPrimary:    Color(hex: 0x1A2530),
        textSecondary:  Color(hex: 0x4B6075),
        textMuted:      Color(hex: 0x7A8FA8),
        brandGold:      Color(hex: 0xD4A017),
        critical:       Color(hex: 0xDC2626),
        success:        Color(hex: 0x059669),
        warning:        Color(hex: 0xD97706)
    )

    public static func tokens(for mode: ThemeMode) -> ThemeColors {
        switch mode {
        case .day: return .day
        case .night: return .night
        }
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8) & 0xFF) / 255
        let b = Double(hex & 0xFF) / 255
        self.init(.sRGB, red: r, green: g, blue: b, opacity: opacity)
    }
}
