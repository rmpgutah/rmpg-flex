import SwiftUI

// Spillman Flex / Motorola pure-black theme tokens (mirrors client design tokens).
enum Theme {
    static let base = Color(hex: 0x0a0a0a)
    static let raised = Color(hex: 0x141414)
    static let sunken = Color(hex: 0x050505)
    static let gold = Color(hex: 0xd4a017)
    static let neutral = Color(hex: 0x888888)
    static let border = Color(hex: 0x222222)
    static let red = Color(hex: 0xcc3333)
    static let orange = Color(hex: 0xcc7a1d)
    static let radius: CGFloat = 2
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
