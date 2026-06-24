import SwiftUI
import DesignSystem

@MainActor
public struct CFSTabView: View {
    @Environment(\.theme) private var theme
    @State private var vm: CallsViewModel
    @State private var selected: ActiveCall?

    public init(vm: CallsViewModel) {
        _vm = State(initialValue: vm)
    }

    public var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()

                if vm.isLoading && vm.calls.isEmpty {
                    ProgressView().tint(theme.colors.brandGold)
                } else if let err = vm.error, vm.calls.isEmpty {
                    errorView(err)
                } else if vm.calls.isEmpty {
                    emptyView
                } else {
                    callsList
                }
            }
            .navigationTitle("ACTIVE CALLS")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .toolbar {
                ToolbarItem(placement: RmpgToolbarPlacement.trailing.placement) {
                    Button {
                        Task { await vm.refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .foregroundStyle(theme.colors.brandGold)
                    }
                    .disabled(vm.isLoading)
                }
                ToolbarItem(placement: RmpgToolbarPlacement.leading.placement) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(vm.isLoading ? theme.colors.warning : theme.colors.success)
                            .frame(width: 8, height: 8)
                        Text("\(vm.calls.count) CALLS")
                            .font(.caption2.weight(.semibold))
                            .tracking(0.5)
                            .foregroundStyle(theme.colors.textSecondary)
                    }
                }
            }
            .refreshable { await vm.refresh() }
            .task { await vm.refresh() }
            .sheet(item: $selected) { call in
                CallDetailView(call: call)
            }
        }
    }

    private var callsList: some View {
        List(vm.calls) { call in
            CallRowView(call: call)
                .listRowBackground(theme.colors.surfaceBase)
                .listRowSeparatorTint(theme.colors.surfaceMuted)
                .contentShape(Rectangle())
                .onTapGesture { selected = call }
        }
        .listStyle(.plain)
        .background(theme.colors.surfaceBase)
        .scrollContentBackground(.hidden)
    }

    private var emptyView: some View {
        VStack(spacing: 12) {
            Image(systemName: "checkmark.shield")
                .font(.system(size: 48))
                .foregroundStyle(theme.colors.success)
            Text("No active calls")
                .font(.headline)
                .foregroundStyle(theme.colors.textPrimary)
            Text("All clear in your service area")
                .font(.caption)
                .foregroundStyle(theme.colors.textMuted)
        }
    }

    private func errorView(_ msg: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundStyle(theme.colors.warning)
            Text("Cannot load calls")
                .font(.headline)
                .foregroundStyle(theme.colors.textPrimary)
            Text(msg)
                .font(.caption)
                .foregroundStyle(theme.colors.textMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Retry") { Task { await vm.refresh() } }
                .font(.caption.weight(.semibold))
                .foregroundStyle(theme.colors.brandGold)
        }
    }
}

struct CallRowView: View {
    @Environment(\.theme) private var theme
    let call: ActiveCall

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            priorityPill
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(call.displayIncidentType)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(theme.colors.textPrimary)
                    Spacer()
                    Text(call.statusDisplay)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(statusColor)
                }
                Text(call.location_address)
                    .font(.footnote)
                    .foregroundStyle(theme.colors.textSecondary)
                    .lineLimit(1)
                HStack(spacing: 8) {
                    Text(call.displayCallNumber)
                        .font(.caption2)
                        .foregroundStyle(theme.colors.textMuted)
                    if !call.unitList.isEmpty {
                        Text("· \(call.unitList.joined(separator: ", "))")
                            .font(.caption2)
                            .foregroundStyle(theme.colors.brandGold)
                            .lineLimit(1)
                    }
                }
            }
        }
        .padding(.vertical, 6)
    }

    private var statusColor: Color {
        switch call.status {
        case "onscene":    return theme.colors.success
        case "enroute":    return theme.colors.warning
        case "dispatched": return theme.colors.brandGold
        default:           return theme.colors.textMuted
        }
    }

    private var priorityPill: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 4)
                .fill(priorityBackground)
                .frame(width: 32, height: 32)
            Text("P\(call.displayPriority)")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.white)
        }
    }

    private var priorityBackground: Color {
        switch call.displayPriority {
        case 1: return theme.colors.critical
        case 2: return theme.colors.warning
        default: return theme.colors.textMuted
        }
    }
}
