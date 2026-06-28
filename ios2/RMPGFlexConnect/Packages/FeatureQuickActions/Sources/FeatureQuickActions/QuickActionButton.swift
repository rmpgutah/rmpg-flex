import SwiftUI
import DesignSystem

/// Single tappable tile inside the QuickActionsSheetView grid.
public struct QuickActionButton: View {
    @Environment(\.theme) private var theme
    public let action: QuickAction
    public let onTap: () -> Void

    public init(action: QuickAction, onTap: @escaping () -> Void) {
        self.action = action
        self.onTap = onTap
    }

    public var body: some View {
        Button(action: onTap) {
            VStack(spacing: 8) {
                Image(systemName: action.systemImage)
                    .font(.system(size: 24, weight: .medium))
                    .foregroundStyle(theme.colors.brandGold)
                    .frame(height: 32)
                Text(action.title)
                    .font(.caption)
                    .foregroundStyle(theme.colors.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(theme.colors.surfaceRaised)
            .clipShape(RoundedRectangle(cornerRadius: 2))
            .overlay(
                RoundedRectangle(cornerRadius: 2)
                    .strokeBorder(theme.colors.surfaceMuted, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
    }
}
