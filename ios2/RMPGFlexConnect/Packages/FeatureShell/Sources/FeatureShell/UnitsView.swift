import SwiftUI
import DesignSystem
import CoreAPI

@MainActor
public struct UnitsView: View {
    @Environment(\.theme) private var theme
    @State private var units: [DispatchUnit] = []
    @State private var isLoading = false
    @State private var error: String?

    private let api: UnitsAPI

    public init(apiClient: APIClient) {
        self.api = UnitsAPI(client: apiClient)
    }

    public var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()
                if isLoading && units.isEmpty {
                    ProgressView().tint(theme.colors.brandGold)
                } else if let error {
                    errorView(error)
                } else {
                    unitList
                }
            }
            .navigationTitle("UNITS")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .toolbar {
                ToolbarItem(placement: RmpgToolbarPlacement.trailing.placement) {
                    Button { Task { await load() } } label: {
                        Image(systemName: "arrow.clockwise")
                            .foregroundStyle(theme.colors.brandGold)
                    }
                    .accessibilityLabel("Refresh")
                }
            }
            .task { await load() }
        }
    }

    private var unitList: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                summaryBar
                    .padding(.horizontal, 16)
                    .padding(.top, 12)

                ForEach(units) { unit in
                    unitRow(unit)
                        .padding(.horizontal, 16)
                }
            }
            .padding(.bottom, 16)
        }
    }

    private var summaryBar: some View {
        HStack(spacing: 10) {
            countBadge(count: units.filter(\.isAvailable).count, label: "AVAILABLE", color: theme.colors.success)
            countBadge(count: units.filter(\.isActive).count,    label: "ACTIVE",    color: theme.colors.warning)
            countBadge(count: units.filter(\.isOffDuty).count,   label: "OFF DUTY",  color: theme.colors.textMuted)
        }
    }

    private func countBadge(count: Int, label: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Text("\(count)").font(.title2.weight(.black)).foregroundStyle(color)
            Text(label).font(.caption2.weight(.semibold)).tracking(0.5).foregroundStyle(theme.colors.textMuted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 12)
        .background(theme.colors.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(color.opacity(0.2), lineWidth: 1))
    }

    private func unitRow(_ unit: DispatchUnit) -> some View {
        HStack(spacing: 12) {
            statusIndicator(unit.status)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(unit.call_sign)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(theme.colors.textPrimary)
                    if let badge = unit.badge_number {
                        Text("#\(badge)").font(.caption2).foregroundStyle(theme.colors.textMuted)
                    }
                }
                if let name = unit.officer_name {
                    Text(name).font(.caption).foregroundStyle(theme.colors.textSecondary)
                }
                if let loc = unit.current_call_location {
                    Label(loc, systemImage: "mappin").font(.caption2)
                        .foregroundStyle(theme.colors.brandGold).lineLimit(1)
                }
            }

            Spacer()

            Text(unit.displayStatus)
                .font(.caption2.weight(.semibold)).tracking(0.4)
                .foregroundStyle(statusColor(unit.status))
                .padding(.horizontal, 7).padding(.vertical, 4)
                .background(statusColor(unit.status).opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 4))
        }
        .padding(12)
        .background(theme.colors.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func statusIndicator(_ status: String) -> some View {
        Circle()
            .fill(statusColor(status))
            .frame(width: 10, height: 10)
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "available":       return theme.colors.success
        case "dispatched":      return theme.colors.brandGold
        case "enroute":         return theme.colors.warning
        case "onscene":         return theme.colors.critical
        default:                return theme.colors.textMuted
        }
    }

    private func errorView(_ msg: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle").font(.largeTitle).foregroundStyle(theme.colors.warning)
            Text(msg).font(.caption).foregroundStyle(theme.colors.textMuted).multilineTextAlignment(.center)
            Button("Retry") { Task { await load() } }
                .font(.caption.weight(.semibold)).foregroundStyle(theme.colors.brandGold)
        }
        .padding(32)
    }

    private func load() async {
        isLoading = true
        error = nil
        do {
            units = try await api.fetchUnits()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
