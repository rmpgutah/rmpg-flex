import SwiftUI
import DesignSystem

/// Modal shown after a Quick Action tap until the M1 handlers land.
public struct PendingActionSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    public let action: QuickAction

    public init(action: QuickAction) {
        self.action = action
    }

    public var body: some View {
        ZStack {
            theme.colors.surfaceBase.ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: action.systemImage)
                    .font(.system(size: 48, weight: .medium))
                    .foregroundStyle(theme.colors.brandGold)
                    .padding(.top, 24)
                Text(action.title.uppercased())
                    .font(.title3.weight(.bold))
                    .tracking(2)
                    .foregroundStyle(theme.colors.brandGold)
                Text("Lands in \(action.milestone)")
                    .font(.callout)
                    .foregroundStyle(theme.colors.textSecondary)
                Text("This action is wired but the handler ships with the \(action.milestone) feature package. The button works; the destination doesn't exist yet.")
                    .font(.caption)
                    .foregroundStyle(theme.colors.textMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)

                Spacer()

                Button {
                    dismiss()
                } label: {
                    Text("CLOSE")
                        .font(.headline)
                        .tracking(1)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(theme.colors.surfaceRaised)
                        .foregroundStyle(theme.colors.textPrimary)
                        .clipShape(RoundedRectangle(cornerRadius: 2))
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 32)
            }
        }
    }
}
