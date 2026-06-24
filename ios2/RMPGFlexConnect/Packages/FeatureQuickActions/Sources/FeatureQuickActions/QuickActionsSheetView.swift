import SwiftUI
import DesignSystem
import CoreAPI
import FeatureDuty
import FeatureCFS

@MainActor
public struct QuickActionsSheetView: View {
    @Environment(\.theme) private var theme
    @State private var tapped: QuickAction?

    @Bindable private var dutyState: DutyState
    private let apiClient: APIClient

    public init(apiClient: APIClient = APIClient(baseURL: URL(string: "https://api.rmpgutah.us")!),
                dutyState: DutyState? = nil) {
        self.apiClient = apiClient
        _dutyState = Bindable(wrappedValue: dutyState ?? DutyState())
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
                StartPatrolView(dutyState: dutyState, apiClient: apiClient)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            case "new_call":
                NewCallForm(vm: NewCallViewModel(api: CFSAPI(client: apiClient)))
            case "new_incident":
                NewIncidentForm(apiClient: apiClient)
            case "new_citation":
                NewCitationForm(apiClient: apiClient)
            case "tasks":
                TasksView(apiClient: apiClient)
            case "process_server", "quick_capture", "field_camera":
                PendingActionSheet(action: action)
                    .presentationDetents([.medium])
            default:
                PendingActionSheet(action: action)
                    .presentationDetents([.medium])
            }
        }
    }
}
