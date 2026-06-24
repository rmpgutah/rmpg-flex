import SwiftUI
import DesignSystem
import CoreAPI
import FeatureDuty
import FeatureQuickActions
import FeatureCFS

// MARK: - HomeView

@MainActor
public struct HomeView: View {
    @Environment(\.theme) private var theme
    @Bindable var dutyState: DutyState
    @State private var showQuickActions = false
    @State private var callCount = 0
    @State private var recentCalls: [ActiveCall] = []
    @State private var now = Date()
    @State private var clockingOff = false

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
                    VStack(spacing: 14) {
                        dutyBanner
                        statsGrid
                        if !recentCalls.isEmpty { recentCallsSection }
                        quickActionsSection
                    }
                    .padding(.horizontal, 16).padding(.vertical, 14)
                }
            }
            .navigationTitle("RMPG FLEX")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .toolbar {
                ToolbarItem(placement: RmpgToolbarPlacement.trailing.placement) {
                    Button { showQuickActions = true } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.title3).foregroundStyle(theme.colors.brandGold)
                    }
                    .accessibilityLabel("New Action")
                }
            }
            .sheet(isPresented: $showQuickActions) {
                QuickActionsSheetView(apiClient: apiClient, dutyState: dutyState)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            .onReceive(timer) { now = $0 }
            .task { await loadDashboard() }
        }
    }

    // MARK: Duty Banner

    private var dutyBanner: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(dutyState.isOnDuty ? theme.colors.success.opacity(0.15) : theme.colors.surfaceMuted)
                    .frame(width: 52, height: 52)
                Image(systemName: dutyState.isOnDuty ? "shield.lefthalf.filled" : "shield")
                    .font(.title2)
                    .foregroundStyle(dutyState.isOnDuty ? theme.colors.success : theme.colors.textMuted)
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(dutyState.isOnDuty ? theme.colors.success : theme.colors.textMuted)
                        .frame(width: 7, height: 7)
                    Text(dutyState.isOnDuty ? "ON DUTY" : "OFF DUTY")
                        .font(.subheadline.weight(.black)).tracking(1.5)
                        .foregroundStyle(dutyState.isOnDuty ? theme.colors.success : theme.colors.textMuted)
                }
                if dutyState.isOnDuty {
                    if !dutyState.unitID.isEmpty {
                        Text("Unit \(dutyState.unitID)")
                            .font(.caption.weight(.semibold)).foregroundStyle(theme.colors.textSecondary)
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
                Button {
                    Task {
                        clockingOff = true
                        let api = DutyAPI(client: apiClient)
                        _ = try? await api.clockOff()
                        dutyState.clockOff()
                        clockingOff = false
                    }
                } label: {
                    Group {
                        if clockingOff {
                            ProgressView().scaleEffect(0.7).tint(theme.colors.critical)
                        } else {
                            Text("CLOCK OFF").font(.caption2.weight(.bold)).tracking(0.5)
                        }
                    }
                        .padding(.horizontal, 10).padding(.vertical, 7)
                        .background(theme.colors.critical.opacity(0.12))
                        .foregroundStyle(theme.colors.critical)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                        .overlay(RoundedRectangle(cornerRadius: 4)
                            .strokeBorder(theme.colors.critical.opacity(0.3), lineWidth: 1))
                }
            }
        }
        .padding(14)
        .background(theme.colors.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var elapsedString: String {
        let t = Int(dutyState.elapsedSinceShiftStart(now: now))
        return String(format: "%d:%02d:%02d on shift", t / 3600, (t % 3600) / 60, t % 60)
    }

    // MARK: Stats grid

    private var statsGrid: some View {
        HStack(spacing: 10) {
            StatTile(
                value: "\(callCount)",
                label: "ACTIVE CALLS",
                icon: "phone.badge.waveform",
                color: callCount > 0 ? theme.colors.warning : theme.colors.success
            )
            StatTile(
                value: dutyState.isOnDuty ? "LIVE" : "—",
                label: "STATUS",
                icon: "bolt.fill",
                color: dutyState.isOnDuty ? theme.colors.success : theme.colors.textMuted
            )
            StatTile(
                value: "API",
                label: "CONNECTED",
                icon: "antenna.radiowaves.left.and.right",
                color: theme.colors.brandGold
            )
        }
    }

    // MARK: Recent calls

    private var recentCallsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("RECENT CALLS").font(.caption2.weight(.semibold)).tracking(1.5)
                    .foregroundStyle(theme.colors.textMuted)
                Spacer()
                Text("LIVE").font(.caption2.weight(.bold)).foregroundStyle(theme.colors.success)
            }
            VStack(spacing: 6) {
                ForEach(recentCalls.prefix(4)) { call in
                    recentCallRow(call)
                }
            }
        }
    }

    private func recentCallRow(_ call: ActiveCall) -> some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 3)
                    .fill(priorityColor(call.displayPriority).opacity(0.15))
                    .frame(width: 26, height: 26)
                Text("P\(call.displayPriority)").font(.caption2.weight(.black))
                    .foregroundStyle(priorityColor(call.displayPriority))
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(call.displayIncidentType).font(.caption.weight(.semibold))
                    .foregroundStyle(theme.colors.textPrimary)
                Text(call.location_address).font(.caption2).foregroundStyle(theme.colors.textMuted)
                    .lineLimit(1)
            }
            Spacer()
            statusDot(call.status)
        }
        .padding(10)
        .background(theme.colors.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func priorityColor(_ p: Int) -> Color {
        switch p {
        case 1: return theme.colors.critical
        case 2: return theme.colors.warning
        default: return theme.colors.textMuted
        }
    }

    private func statusDot(_ status: String) -> some View {
        Circle().fill(statusColor(status)).frame(width: 8, height: 8)
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "onscene":    return theme.colors.success
        case "enroute":    return theme.colors.warning
        case "dispatched": return theme.colors.brandGold
        default:           return theme.colors.textMuted
        }
    }

    // MARK: Quick actions

    private var quickActionsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("QUICK ACTIONS").font(.caption2.weight(.semibold)).tracking(1.5)
                .foregroundStyle(theme.colors.textMuted)
            LazyVGrid(
                columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)],
                spacing: 10
            ) {
                ForEach(QuickActionsRegistry.all.prefix(4)) { action in
                    Button { showQuickActions = true } label: {
                        HStack(spacing: 10) {
                            Image(systemName: action.systemImage)
                                .font(.body).foregroundStyle(theme.colors.brandGold).frame(width: 22)
                            Text(action.title).font(.caption.weight(.semibold))
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

    // MARK: Load

    private func loadDashboard() async {
        // Concurrent fetch of call count + recent calls
        async let callsTask: [ActiveCall] = fetchCalls()
        let calls = (try? await callsTask) ?? []
        callCount = calls.count
        recentCalls = Array(calls.sorted { ($0.priority ?? "3") < ($1.priority ?? "3") }.prefix(4))
        // Re-poll every 30s
        try? await Task.sleep(nanoseconds: 30_000_000_000)
        if !Task.isCancelled { await loadDashboard() }
    }

    private func fetchCalls() async throws -> [ActiveCall] {
        let ep = Endpoint(method: .get, path: "api/dispatch/calls/active",
            queryItems: [URLQueryItem(name: "limit", value: "20")])
        return try await apiClient.request(ep, as: [ActiveCall].self)
    }
}

// MARK: - Stat Tile

private struct StatTile: View {
    @Environment(\.theme) private var theme
    let value: String
    let label: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.caption2).foregroundStyle(color)
                Text(value).font(.title3.weight(.black).monospacedDigit())
                    .foregroundStyle(theme.colors.textPrimary)
            }
            Text(label).font(.caption2.weight(.semibold)).tracking(0.4)
                .foregroundStyle(theme.colors.textMuted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 14)
        .background(theme.colors.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8)
            .strokeBorder(color.opacity(0.2), lineWidth: 1))
    }
}
