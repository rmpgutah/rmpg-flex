import SwiftUI
import DesignSystem
import CoreAPI
import FeatureDuty
import FeatureQuickActions

@MainActor
public struct HomeView: View {
    @Environment(\.theme) private var theme
    @Bindable var dutyState: DutyState
    @State private var showQuickActions = false
    @State private var callCount: Int = 0
    @State private var now = Date()

    private let apiClient: APIClient
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    public init(dutyState: DutyState, apiClient: APIClient) {
        self.dutyState = dutyState
        self.apiClient = apiClient
    }

    public var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 16) {
                        dutyBanner
                        statsRow
                        quickActionsGrid
                    }
                    .padding()
                }
            }
            .navigationTitle("RMPG FLEX")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .toolbar {
                ToolbarItem(placement: RmpgToolbarPlacement.trailing.placement) {
                    Button {
                        showQuickActions = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.title3)
                            .foregroundStyle(theme.colors.brandGold)
                    }
                    .accessibilityLabel("Quick Actions")
                }
            }
            .sheet(isPresented: $showQuickActions) {
                QuickActionsSheetView(apiClient: apiClient, dutyState: dutyState)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            .onReceive(timer) { now = $0 }
            .task { await fetchCallCount() }
        }
    }

    private var dutyBanner: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(dutyState.isOnDuty ? theme.colors.success : theme.colors.surfaceMuted)
                    .frame(width: 48, height: 48)
                Image(systemName: dutyState.isOnDuty ? "shield.fill" : "shield")
                    .font(.title3)
                    .foregroundStyle(dutyState.isOnDuty ? .white : theme.colors.textMuted)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(dutyState.isOnDuty ? "ON DUTY" : "OFF DUTY")
                    .font(.headline.weight(.black))
                    .tracking(1)
                    .foregroundStyle(dutyState.isOnDuty ? theme.colors.success : theme.colors.textMuted)
                if dutyState.isOnDuty {
                    if !dutyState.unitID.isEmpty {
                        Text("Unit \(dutyState.unitID)")
                            .font(.caption).foregroundStyle(theme.colors.textSecondary)
                    }
                    Text(elapsedString)
                        .font(.caption.monospacedDigit()).foregroundStyle(theme.colors.textMuted)
                } else {
                    Text("Tap + to start patrol")
                        .font(.caption).foregroundStyle(theme.colors.textMuted)
                }
            }
            Spacer()
            if dutyState.isOnDuty {
                Button { dutyState.clockOff() } label: {
                    Text("CLOCK OFF")
                        .font(.caption2.weight(.bold)).tracking(0.5)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(theme.colors.critical.opacity(0.15))
                        .foregroundStyle(theme.colors.critical)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
            }
        }
        .padding()
        .background(theme.colors.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var elapsedString: String {
        let t = Int(dutyState.elapsedSinceShiftStart(now: now))
        return String(format: "%d:%02d:%02d elapsed", t / 3600, (t % 3600) / 60, t % 60)
    }

    private var statsRow: some View {
        HStack(spacing: 12) {
            statTile(value: "\(callCount)", label: "ACTIVE CALLS",
                     icon: "phone.badge.waveform",
                     color: callCount > 0 ? theme.colors.warning : theme.colors.success)
            statTile(value: "LIVE", label: "API STATUS",
                     icon: "bolt.fill", color: theme.colors.success)
        }
    }

    private func statTile(value: String, label: String, icon: String, color: Color) -> some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.caption).foregroundStyle(color)
                Text(value).font(.title2.weight(.black).monospacedDigit())
                    .foregroundStyle(theme.colors.textPrimary)
            }
            Text(label).font(.caption2.weight(.semibold)).tracking(0.5)
                .foregroundStyle(theme.colors.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(theme.colors.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var quickActionsGrid: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("QUICK ACTIONS")
                .font(.caption2.weight(.semibold)).tracking(1.5)
                .foregroundStyle(theme.colors.textMuted)
            LazyVGrid(
                columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)],
                spacing: 10
            ) {
                ForEach(QuickActionsRegistry.all.prefix(4)) { action in
                    Button { showQuickActions = true } label: {
                        HStack(spacing: 10) {
                            Image(systemName: action.systemImage)
                                .font(.body).foregroundStyle(theme.colors.brandGold).frame(width: 24)
                            Text(action.title)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(theme.colors.textPrimary)
                                .multilineTextAlignment(.leading).lineLimit(2)
                            Spacer()
                        }
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(theme.colors.surfaceRaised)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                }
            }
        }
    }

    private func fetchCallCount() async {
        let endpoint = Endpoint(
            method: .get, path: "api/dispatch/calls/active",
            queryItems: [URLQueryItem(name: "limit", value: "1")]
        )
        if let calls = try? await apiClient.request(endpoint, as: [ActiveCallStub].self) {
            callCount = calls.count
        }
        try? await Task.sleep(nanoseconds: 30_000_000_000)
        if !Task.isCancelled { await fetchCallCount() }
    }
}

private struct ActiveCallStub: Decodable, Sendable { let id: Int }
