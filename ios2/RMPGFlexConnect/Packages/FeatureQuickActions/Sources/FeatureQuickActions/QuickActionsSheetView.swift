import SwiftUI
import DesignSystem
import CoreAPI
import FeatureDuty
import FeatureCFS

/// Half-sheet grid of all `QuickActionsRegistry.all`. Tap a tile → for the two
/// implemented actions, presents a real screen. The other six show
/// `PendingActionSheet` until their handlers ship.
public struct QuickActionsSheetView: View {
    @Environment(\.theme) private var theme
    @State private var tapped: QuickAction?

    /// The shared duty state lives at the app level; pass it down via the env.
    /// For now we hold one locally so the Quick Actions sheet can demo end-to-end.
    @State private var dutyState = DutyState()
    private let apiClient: APIClient

    public init(apiClient: APIClient = APIClient(baseURL: URL(string: "https://api.rmpgutah.us")!)) {
        self.apiClient = apiClient
    }

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
                                tapped = action
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 32)
                }
            }
        }
        .sheet(item: $tapped) { action in
            switch action.id {
            case "start_patrol":
                StartPatrolView(dutyState: dutyState)
            case "new_call":
                NewCallForm(vm: NewCallViewModel(api: CFSAPI(client: apiClient)))
            default:
                PendingActionSheet(action: action)
                    .presentationDetents([.medium])
            }
        }
    }
}
