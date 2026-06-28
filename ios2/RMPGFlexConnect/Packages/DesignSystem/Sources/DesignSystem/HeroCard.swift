import SwiftUI

/// Container for the Home hero. Caller supplies the inner content.
public struct HeroCard<Content: View>: View {
    @Environment(\.theme) private var theme
    public let tint: Color?
    public let content: () -> Content

    public init(tint: Color? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.tint = tint
        self.content = content
    }

    public var body: some View {
        content()
            .padding(16)
            .background(theme.colors.surfaceRaised)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(tint ?? theme.colors.brandGold)
                    .frame(width: 4)
            }
            .clipShape(RoundedRectangle(cornerRadius: 2))
            .shadow(color: .black.opacity(0.3), radius: 8, y: 2)
    }
}
