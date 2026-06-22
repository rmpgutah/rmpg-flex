import SwiftUI
import DesignSystem

/// Every tab in M0 renders one of these. Content arrives in the matching feature
/// package (FeatureCFS, FeatureRunPlate, FeatureRunID, ...) during M1+.
public struct PlaceholderScreen: View {
    @Environment(\.theme) private var theme
    public let title: String
    public let milestone: String

    public init(title: String, milestone: String) {
        self.title = title
        self.milestone = milestone
    }

    public var body: some View {
        ZStack {
            theme.colors.surfaceBase.ignoresSafeArea()
            VStack(spacing: 12) {
                Text(title.uppercased())
                    .font(.title2.weight(.bold))
                    .tracking(2)
                    .foregroundStyle(theme.colors.brandGold)
                Text("Lands in \(milestone)")
                    .font(.callout)
                    .foregroundStyle(theme.colors.textSecondary)
                Text("M0 ships the skeleton. Feature content follows.")
                    .font(.caption)
                    .foregroundStyle(theme.colors.textMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }
        }
    }
}
