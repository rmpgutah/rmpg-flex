import SwiftUI
import DesignSystem

/// Half-sheet grid of all `QuickActionsRegistry.all`. Tap a tile → presents
/// `PendingActionSheet` until M1 handlers land.
public struct QuickActionsSheetView: View {
    @Environment(\.theme) private var theme
    @State private var pending: QuickAction?

    public init() {}

    /// 2-column grid. With 8 actions = 4 rows.
    private let columns = [
        GridItem(.flexible(), spacing: 8),
        GridItem(.flexible(), spacing: 8),
    ]

    public var body: some View {
        ZStack {
            theme.colors.surfaceBase.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("QUICK ACTIONS")
                        .font(.caption.weight(.semibold))
                        .tracking(2)
                        .foregroundStyle(theme.colors.brandGold)
                        .padding(.top, 20)
                        .padding(.horizontal, 20)

                    LazyVGrid(columns: columns, spacing: 8) {
                        ForEach(QuickActionsRegistry.all) { action in
                            QuickActionButton(action: action) {
                                pending = action
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 32)
                }
            }
        }
        .sheet(item: $pending) { action in
            PendingActionSheet(action: action)
                .presentationDetents([.medium])
        }
    }
}
