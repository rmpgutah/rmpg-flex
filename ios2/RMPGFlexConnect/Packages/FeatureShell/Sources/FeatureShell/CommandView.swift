import SwiftUI
import DesignSystem
import CoreAPI
import FeatureCFS

@MainActor
public struct CommandView: View {
    @Environment(\.theme) private var theme
    @State private var calls: [ActiveCall] = []
    @State private var units: [DispatchUnit] = []
    @State private var isLoading = false

    private let apiClient: APIClient
    private let cfsAPI: CFSAPI
    private let unitsAPI: UnitsAPI

    public init(apiClient: APIClient) {
        self.apiClient = apiClient
        self.cfsAPI = CFSAPI(client: apiClient)
        self.unitsAPI = UnitsAPI(client: apiClient)
    }

    public var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 14) {
                        kpiRow
                        if !calls.isEmpty { callsSection }
                        unitsSection
                    }
                    .padding(.horizontal, 16).padding(.vertical, 14)
                }
            }
            .navigationTitle("COMMAND")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .toolbar {
                ToolbarItem(placement: RmpgToolbarPlacement.trailing.placement) {
                    if isLoading {
                        ProgressView().tint(theme.colors.brandGold).scaleEffect(0.8)
                    } else {
                        Button { Task { await load() } } label: {
                            Image(systemName: "arrow.clockwise").foregroundStyle(theme.colors.brandGold)
                        }
                        .accessibilityLabel("Refresh")
                    }
                }
            }
            .task { await load() }
        }
    }

    // MARK: KPI row

    private var kpiRow: some View {
        HStack(spacing: 10) {
            kpiTile(value: "\(calls.count)",          label: "ACTIVE CALLS", color: calls.isEmpty ? theme.colors.success : theme.colors.warning)
            kpiTile(value: "\(units.filter(\.isActive).count)",  label: "UNITS ACTIVE",  color: theme.colors.brandGold)
            kpiTile(value: "\(units.filter(\.isAvailable).count)", label: "AVAILABLE",   color: theme.colors.success)
        }
    }

    private func kpiTile(value: String, label: String, color: Color) -> some View {
        VStack(spacing: 5) {
            Text(value).font(.title2.weight(.black).monospacedDigit()).foregroundStyle(color)
            Text(label).font(.caption2.weight(.semibold)).tracking(0.4).foregroundStyle(theme.colors.textMuted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 14)
        .background(theme.colors.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(color.opacity(0.2), lineWidth: 1))
    }

    // MARK: Active calls

    private var callsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("ACTIVE CALLS", icon: "phone.badge.waveform")
            VStack(spacing: 6) {
                ForEach(calls.prefix(6)) { call in
                    callRow(call)
                }
                if calls.count > 6 {
                    Text("+ \(calls.count - 6) more").font(.caption2)
                        .foregroundStyle(theme.colors.textMuted).frame(maxWidth: .infinity)
                }
            }
        }
    }

    private func callRow(_ call: ActiveCall) -> some View {
        HStack(spacing: 10) {
            priorityBadge(call.displayPriority)
            VStack(alignment: .leading, spacing: 2) {
                Text(call.displayIncidentType).font(.caption.weight(.semibold))
                    .foregroundStyle(theme.colors.textPrimary)
                Text(call.location_address).font(.caption2).foregroundStyle(theme.colors.textMuted)
                    .lineLimit(1)
            }
            Spacer()
            statusChip(call.status)
        }
        .padding(10)
        .background(theme.colors.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func priorityBadge(_ p: Int) -> some View {
        let color: Color = p == 1 ? theme.colors.critical : p == 2 ? theme.colors.warning : theme.colors.textMuted
        return ZStack {
            RoundedRectangle(cornerRadius: 3).fill(color.opacity(0.15)).frame(width: 26, height: 26)
            Text("P\(p)").font(.caption2.weight(.black)).foregroundStyle(color)
        }
    }

    private func statusChip(_ status: String) -> some View {
        Text(status.uppercased())
            .font(.caption2.weight(.semibold)).tracking(0.3)
            .foregroundStyle(statusColor(status))
            .padding(.horizontal, 6).padding(.vertical, 3)
            .background(statusColor(status).opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 3))
    }

    // MARK: Units summary

    private var unitsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("UNITS", icon: "shield.lefthalf.filled")
            VStack(spacing: 6) {
                ForEach(units.filter { !$0.isOffDuty }.prefix(8)) { unit in
                    HStack(spacing: 10) {
                        Circle().fill(unitStatusColor(unit.status)).frame(width: 9, height: 9)
                        Text(unit.call_sign).font(.caption.weight(.bold))
                            .foregroundStyle(theme.colors.textPrimary)
                        if let name = unit.officer_name {
                            Text(name).font(.caption2).foregroundStyle(theme.colors.textMuted).lineLimit(1)
                        }
                        Spacer()
                        Text(unit.displayStatus).font(.caption2.weight(.semibold))
                            .foregroundStyle(unitStatusColor(unit.status))
                    }
                    .padding(9)
                    .background(theme.colors.surfaceRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                }
            }
        }
    }

    // MARK: Helpers

    private func sectionHeader(_ title: String, icon: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.caption2).foregroundStyle(theme.colors.textMuted)
            Text(title).font(.caption2.weight(.semibold)).tracking(1.5).foregroundStyle(theme.colors.textMuted)
        }
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "onscene":    return theme.colors.success
        case "enroute":    return theme.colors.warning
        case "dispatched": return theme.colors.brandGold
        default:           return theme.colors.textMuted
        }
    }

    private func unitStatusColor(_ status: String) -> Color {
        switch status {
        case "available":  return theme.colors.success
        case "dispatched": return theme.colors.brandGold
        case "enroute":    return theme.colors.warning
        case "onscene":    return theme.colors.critical
        default:           return theme.colors.textMuted
        }
    }

    private func load() async {
        isLoading = true
        async let callsTask: [ActiveCall] = { try await cfsAPI.fetchActiveCalls() }()
        async let unitsTask: [DispatchUnit] = { try await unitsAPI.fetchUnits() }()
        calls = (try? await callsTask) ?? []
        units = (try? await unitsTask) ?? []
        isLoading = false
    }
}
