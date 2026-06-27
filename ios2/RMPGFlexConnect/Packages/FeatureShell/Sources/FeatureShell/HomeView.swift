import SwiftUI
import DesignSystem
import CoreAPI
import FeatureDuty
import FeatureQuickActions
import FeatureCFS
import FeatureReports

@MainActor
public struct HomeView: View {
    @Environment(\.theme) private var theme
    @Bindable var dutyState: DutyState
    @State private var heroState: HeroState = .offDuty
    @State private var callCount = 0
    @State private var boloCount = 0
    @State private var welfareMinutes = 15
    @State private var recentCalls: [ActiveCall] = []
    @State private var now = Date()
    @State private var showQuickActions = false
    @State private var showDAR = false
    @State private var showInspection = false

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
                        heroCard
                        miniTileRow1
                        miniTileRow2
                        if !recentCalls.isEmpty { recentCallsSection }
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
            .sheet(isPresented: $showDAR) {
                DailyActivityReportView()
            }
            .onReceive(timer) { now = $0 }
            .task { await loadDashboard() }
        }
    }

    // MARK: - A2 Hero State Machine

    private var heroCard: some View {
        Group {
            switch heroState {
            case .panicInAgency(let unit, let location, let eta):
                panicHero(unit: unit, location: location, eta: eta)
            case .dispatchedToMe(let cfs):
                dispatchedHero(cfs: cfs)
            case .activeCFS(let cfs):
                activeCFSHero(cfs: cfs)
            case .welfareDue(let minutes):
                welfareHero(minutes: minutes)
            case .shiftSummary:
                shiftSummaryHero
            case .offDuty:
                offDutyHero
            }
        }
    }

    private func panicHero(unit: String, location: String, eta: Int) -> some View {
        HeroCard(theme: theme, color: theme.colors.critical) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: "exclamationmark.shield.fill").foregroundColor(.red)
                    Text("PANIC IN AGENCY").font(.headline).bold()
                    Spacer()
                    Text("ETA \(eta)s").font(.caption).monospacedDigit()
                }
                Text("Unit \(unit)").font(.subheadline)
                Text(location).font(.caption).foregroundColor(theme.colors.textSecondary)
                HStack(spacing: 8) {
                    Button("ACKNOWLEDGE") {}.buttonStyle(.bordered).tint(.red).font(.caption)
                    Button("BACKUP") {}.buttonStyle(.borderedProminent).tint(.red).font(.caption)
                    Button("MAP") {}.buttonStyle(.bordered).font(.caption)
                }
            }
        }
    }

    private func dispatchedHero(cfs: ActiveCall) -> some View {
        HeroCard(theme: theme, color: theme.colors.brandGold) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: "phone.badge.waveform").foregroundColor(theme.colors.brandGold)
                    Text(cfs.displayCallNumber).font(.headline).bold()
                    Spacer()
                    Text(cfs.displayIncidentType).font(.caption)
                }
                Text(cfs.location_address).font(.subheadline)
                if let note = cfs.notes {
                    Text(note).font(.caption).foregroundColor(theme.colors.textSecondary)
                }
                HStack(spacing: 8) {
                    Button("ACCEPT") {}.buttonStyle(.borderedProminent).tint(.green).font(.caption)
                    Button("DECLINE") {}.buttonStyle(.bordered).tint(.red).font(.caption)
                    Button("MAP") {}.buttonStyle(.bordered).font(.caption)
                }
            }
        }
    }

    private func activeCFSHero(cfs: ActiveCall) -> some View {
        HeroCard(theme: theme, color: theme.colors.brandGold) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: "clock.fill").foregroundColor(theme.colors.brandGold)
                    Text(cfs.displayCallNumber).font(.headline).bold()
                    Spacer()
                    Text(cfs.displayIncidentType).font(.caption)
                }
                Text(cfs.location_address).font(.subheadline)
                Text("ONS: \(elapsedOnScene)").font(.system(.caption, design: .monospaced))
                    .foregroundColor(theme.colors.textMuted)
                HStack(spacing: 8) {
                    Button { showQuickActions = true } label: {
                        Image(systemName: "mic.fill").font(.caption)
                        Text("NOTE").font(.caption)
                    }.buttonStyle(.bordered).font(.caption)
                    Button("CLEAR") {}.buttonStyle(.borderedProminent).tint(theme.colors.critical).font(.caption)
                    Button("BACKUP") {}.buttonStyle(.bordered).font(.caption)
                }
            }
        }
    }

    private func welfareHero(minutes: Int) -> some View {
        HeroCard(theme: theme, color: minutes <= 2 ? .red : .yellow) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: "person.fill.questionmark").foregroundColor(minutes <= 2 ? .red : .yellow)
                    Text("WELFARE CHECK DUE").font(.headline).bold()
                    Spacer()
                    Text("\(minutes)m").font(.title).monospacedDigit().bold()
                        .foregroundColor(minutes <= 2 ? .red : .yellow)
                }
                Text("Check-in timer expiring").font(.subheadline)
                HStack(spacing: 8) {
                    Button("CHECK IN") {}.buttonStyle(.borderedProminent).tint(.green).font(.caption)
                    Button("SNOOZE 2m") {}.buttonStyle(.bordered).font(.caption)
                }
            }
        }
    }

    private var shiftSummaryHero: some View {
        HeroCard(theme: theme, color: theme.colors.textMuted) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("ON DUTY").font(.caption).foregroundColor(theme.colors.textMuted)
                    Text(elapsedString).font(.system(.title2, design: .monospaced)).bold()
                    Text("\(callCount) calls · 142 mi").font(.caption).foregroundColor(theme.colors.textSecondary)
                }
                Spacer()
                VStack(spacing: 8) {
                    Button("FI") { showQuickActions = true }.buttonStyle(.bordered).font(.caption)
                    Button("DAR") { showDAR = true }.buttonStyle(.bordered).font(.caption)
                }
            }
        }
    }

    private var offDutyHero: some View {
        HeroCard(theme: theme, color: theme.colors.textMuted) {
            VStack(spacing: 12) {
                Image(systemName: "shield").font(.system(size: 40)).foregroundColor(theme.colors.textMuted)
                Text("OFF DUTY").font(.title2).bold()
                Text("Press to clock on").font(.subheadline).foregroundColor(theme.colors.textSecondary)
                Button("CLOCK ON") {
                    showQuickActions = true
                }.buttonStyle(.borderedProminent).tint(theme.colors.brandGold)
            }.frame(maxWidth: .infinity).padding(.vertical, 8)
        }
    }

    private var elapsedOnScene: String {
        let t = Int(dutyState.elapsedSinceShiftStart(now: now))
        return String(format: "%02d:%02d", (t % 3600) / 60, t % 60)
    }

    private var elapsedString: String {
        let t = Int(dutyState.elapsedSinceShiftStart(now: now))
        return String(format: "%d:%02d:%02d", t / 3600, (t % 3600) / 60, t % 60)
    }

    // MARK: - Mini Tile Row 1 (Status)

    private var miniTileRow1: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4), spacing: 10) {
            MiniTile(value: "\(callCount)", label: "IN QUEUE", icon: "phone.badge.waveform",
                     color: callCount > 0 ? theme.colors.brandGold : theme.colors.success)
            MiniTile(value: "\(boloCount)", label: "BOLO", icon: "eye",
                     color: boloCount > 0 ? .red : theme.colors.success)
            MiniTile(value: dutyState.isOnDuty ? "LIVE" : "—", label: "SHIFT", icon: "bolt.fill",
                     color: dutyState.isOnDuty ? theme.colors.success : theme.colors.textMuted)
            MiniTile(value: "\(welfareMinutes)m", label: "WELFARE", icon: "clock",
                     color: welfareMinutes > 5 ? .green : welfareMinutes > 2 ? .yellow : .red)
        }
    }

    // MARK: - Mini Tile Row 2 (Quick Actions)

    private var miniTileRow2: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4), spacing: 10) {
            MiniTileButton(value: "PLATE", icon: "camera.viewfinder", color: theme.colors.brandGold) {
                showQuickActions = true
            }
            MiniTileButton(value: "ID", icon: "person.text.rectangle", color: theme.colors.brandGold) {
                showQuickActions = true
            }
            MiniTileButton(value: "FI", icon: "doc.badge.plus", color: theme.colors.brandGold) {
                showQuickActions = true
            }
            MiniTileButton(value: "MED", icon: "cross.case", color: .red) {
                showQuickActions = true
            }
        }
    }

    // MARK: Recent Calls

    private var recentCallsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("RECENT CALLS").font(.caption2.weight(.semibold)).tracking(1.5)
                    .foregroundStyle(theme.colors.textMuted)
                Spacer()
                Text("LIVE").font(.caption2.weight(.bold)).foregroundStyle(theme.colors.success)
            }
            VStack(spacing: 6) {
                ForEach(recentCalls.prefix(3)) { call in
                    recentCallRow(call)
                }
            }
        }
    }

    private func recentCallRow(_ call: ActiveCall) -> some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 2)
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
        .cornerRadius(2)
    }

    private func priorityColor(_ p: Int) -> Color {
        switch p { case 1: return theme.colors.critical; case 2: return theme.colors.warning; default: return theme.colors.textMuted }
    }

    private func statusDot(_ status: String) -> some View {
        Circle().fill(statusColor(status)).frame(width: 8, height: 8)
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "onscene": return theme.colors.success
        case "enroute": return theme.colors.warning
        case "dispatched": return theme.colors.brandGold
        default: return theme.colors.textMuted
        }
    }

    // MARK: Load

    private func loadDashboard() async {
        async let callsTask: [ActiveCall] = fetchCalls()
        let calls = (try? await callsTask) ?? []
        callCount = calls.count
        boloCount = Int.random(in: 0...2)
        recentCalls = Array(calls.sorted { ($0.priority ?? "3") < ($1.priority ?? "3") }.prefix(3))
        if dutyState.isOnDuty {
            if callCount > 0 {
                heroState = .activeCFS(cfs: recentCalls[0])
            } else if welfareMinutes <= 2 {
                heroState = .welfareDue(minutes: welfareMinutes)
            } else {
                heroState = .shiftSummary
            }
        } else {
            heroState = .offDuty
        }
        try? await Task.sleep(nanoseconds: 30_000_000_000)
        if !Task.isCancelled { await loadDashboard() }
    }

    private func fetchCalls() async throws -> [ActiveCall] {
        let ep = Endpoint(method: .get, path: "api/dispatch/calls/active",
            queryItems: [URLQueryItem(name: "limit", value: "20")])
        return try await apiClient.request(ep, as: [ActiveCall].self)
    }
}

// MARK: - Supporting Types

@MainActor
public enum HeroState: Equatable {
    case panicInAgency(unit: String, location: String, eta: Int)
    case dispatchedToMe(cfs: ActiveCall)
    case activeCFS(cfs: ActiveCall)
    case welfareDue(minutes: Int)
    case shiftSummary
    case offDuty
}

public struct HeroCard<Content: View>: View {
    @Environment(\.theme) private var theme
    let color: Color
    let content: Content

    public init(theme: ThemeEnvironment, color: Color, @ViewBuilder content: () -> Content) {
        self.color = color
        self.content = content()
    }

    public var body: some View {
        VStack { content }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.colors.surfaceRaised)
            .overlay(alignment: .leading) { Rectangle().fill(color).frame(width: 4) }
            .cornerRadius(2)
    }
}

public struct MiniTile: View {
    @Environment(\.theme) private var theme
    let value: String
    let label: String
    let icon: String
    let color: Color

    public init(value: String, label: String, icon: String, color: Color) {
        self.value = value; self.label = label; self.icon = icon; self.color = color
    }

    public var body: some View {
        VStack(spacing: 4) {
            Image(systemName: icon).font(.caption).foregroundStyle(color)
            Text(value).font(.callout.weight(.black).monospacedDigit()).foregroundStyle(theme.colors.textPrimary)
            Text(label).font(.system(size: 8)).foregroundStyle(theme.colors.textMuted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 10)
        .background(theme.colors.surfaceRaised).cornerRadius(2)
        .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(color.opacity(0.2), lineWidth: 1))
    }
}

public struct MiniTileButton: View {
    @Environment(\.theme) private var theme
    let value: String
    let icon: String
    let color: Color
    let action: () -> Void

    public init(value: String, icon: String, color: Color, action: @escaping () -> Void) {
        self.value = value; self.icon = icon; self.color = color; self.action = action
    }

    public var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.caption).foregroundStyle(color)
                Text(value).font(.system(size: 8, weight: .black)).foregroundStyle(theme.colors.textPrimary)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 10)
            .background(theme.colors.surfaceRaised).cornerRadius(2)
            .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(color.opacity(0.2), lineWidth: 1))
        }
        .accessibilityLabel(value)
    }
}
