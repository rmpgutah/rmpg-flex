import SwiftUI

public struct RMPGTheme {
    public static let baseBlack = Color(hex: "0a0a0a")
    public static let raisedSurface = Color(hex: "141414")
    public static let sunkenSurface = Color(hex: "050505")
    public static let deepBlack = Color(hex: "000000")
    public static let brandGold = Color(hex: "d4a017")
    public static let neutralGray = Color(hex: "888888")
    public static let borderDefault = Color(hex: "222222")
    public static let borderSubtle = Color(hex: "1a1a1a")
    public static let borderStrong = Color(hex: "2e2e2e")
    public static let textPrimary = Color.white
    public static let textSecondary = Color(hex: "aaaaaa")
    public static let textMuted = Color(hex: "666666")
    public static let statusGreen = Color(hex: "22c55e")
    public static let statusRed = Color(hex: "ef4444")
    public static let statusYellow = Color(hex: "eab308")
    public static let statusBlue = Color(hex: "3b82f6")
    public static let statusOrange = Color(hex: "f97316")

    private init() {}
}

public extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r, g, b: UInt64
        switch hex.count {
        case 6:
            (r, g, b) = (int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (r, g, b) = (0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: 1
        )
    }
}
