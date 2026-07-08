import SwiftUI
import CoreAPI
import DesignSystem
import FeatureDuty
import FeatureCFS
import FeatureReports

@MainActor
public struct QuickActionsSheetView: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    let apiClient: APIClient
    @Bindable var dutyState: DutyState
    @State private var showStartPatrol = false
    @State private var showNewCall = false
    @State private var showFI = false
    @State private var showCitation = false
    @State private var showInspection = false
    @State private var showFieldCamera = false

    public init(apiClient: APIClient, dutyState: DutyState) {
        self.apiClient = apiClient
        self.dutyState = dutyState
    }

    public var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    Text("Quick Actions").font(.headline).foregroundColor(theme.colors.brandGold)
                    Spacer()
                }
                .padding()

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(QuickActionsRegistry.all) { action in
                        QuickActionButton(action: action) { handleAction(action) }
                    }
                }
                .padding(.horizontal)
                Spacer()
            }
            .background(theme.colors.surfaceBase)
        }
        .presentationDetents([.fraction(0.6), .large])
        .sheet(isPresented: $showStartPatrol) {
            StartPatrolView(dutyState: dutyState, apiClient: apiClient)
        }
        .sheet(isPresented: $showNewCall) {
            NewCallForm(vm: NewCallViewModel(api: CFSAPI(client: apiClient)))
        }
        .sheet(isPresented: $showFI) {
            FieldInterviewCardView()
        }
        .sheet(isPresented: $showCitation) {
            CitationView()
        }
    }

    private func handleAction(_ action: QuickAction) {
        switch action.id {
        case "start_patrol": showStartPatrol = true
        case "new_call": showNewCall = true
        case "new_incident": showNewCall = true
        case "new_citation": showCitation = true
        case "quick_capture", "field_camera": showFieldCamera = true
        case "process_server", "tasks": break
        default: break
        }
    }
}
