import SwiftUI
import DesignSystem

@MainActor
public struct CFSTabView: View {
    @Environment(\.theme) private var theme
    @State private var vm: CallsViewModel
    @State private var selected: ActiveCall?
    @State private var priorityFilter: Int?   // nil = all
    @State private var statusFilter: String?  // nil = all

    public init(vm: CallsViewModel) {
        _vm = State(initialValue: vm)
    }

    private var filtered: [ActiveCall] {
        vm.calls.filter { call in
            (priorityFilter == nil || call.displayPriority == priorityFilter) &&
            (statusFilter  == nil || call.status == statusFilter)
        }
    }

    public var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                filterBar
                Divider().background(theme.colors.surfaceMuted)
                ZStack {
                    theme.colors.surfaceBase.ignoresSafeArea()
                    if vm.isLoading && vm.calls.isEmpty {
                        ProgressView().tint(theme.colors.brandGold)
                    } else if let err = vm.error, vm.calls.isEmpty {
                        errorView(err)
                    } else if filtered.isEmpty {
                        emptyView
                    } else {
                        callsList
                    }
                }
            }
            .background(theme.colors.surfaceBase.ignoresSafeArea())
            .navigationTitle("ACTIVE CALLS")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .toolbar {
                ToolbarItem(placement: RmpgToolbarPlacement.trailing.placement) {
                    Button { Task { await vm.refresh() } } label: {
                        Image(systemName: "arrow.clockwise")
                            .foregroundStyle(vm.isLoading ? theme.colors.textMuted : theme.colors.brandGold)
                    }
                    .disabled(vm.isLoading)
                }
                ToolbarItem(placement: RmpgToolbarPlacement.leading.placement) {
                    HStack(spacing: 5) {
                        Circle()
                            .fill(vm.isLoading ? theme.colors.warning : theme.colors.success)
                            .frame(width: 7, height: 7)
                        Text("\(vm.calls.count) CALLS")
                            .font(.caption2.weight(.semibold)).tracking(0.5)
                            .foregroundStyle(theme.colors.textSecondary)
                    }
                }
            }
            .refreshable { await vm.refresh() }
            .task { await vm.refresh() }
            .sheet(item: $selected) { call in CallDetailView(call: call) }
        }
    }

    // MARK: Filter bar

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                chip("ALL", selected: priorityFilter == nil && statusFilter == nil) {
                    priorityFilter = nil; statusFilter = nil
                }
                Divider().frame(height: 16).padding(.horizontal, 2)
                chip("P1", selected: priorityFilter == 1, accent: theme.colors.critical) {
                    priorityFilter = priorityFilter == 1 ? nil : 1
                }
                chip("P2", selected: priorityFilter == 2, accent: theme.colors.warning) {
                    priorityFilter = priorityFilter == 2 ? nil : 2
                }
                chip("P3", selected: priorityFilter == 3) {
                    priorityFilter = priorityFilter == 3 ? nil : 3
                }
                Divider().frame(height: 16).padding(.horizontal, 2)
                chip("ONSCENE",    selected: statusFilter == "onscene",    accent: theme.colors.success) {
                    statusFilter = statusFilter == "onscene"    ? nil : "onscene"
                }
                chip("ENROUTE",    selected: statusFilter == "enroute",    accent: theme.colors.warning) {
                    statusFilter = statusFilter == "enroute"    ? nil : "enroute"
                }
                chip("DISPATCHED", selected: statusFilter == "dispatched") {
                    statusFilter = statusFilter == "dispatched" ? nil : "dispatched"
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 8)
        }
        .background(theme.colors.surfaceBase)
    }

    private func chip(_ label: String, selected: Bool, accent: Color? = nil, action: @escaping () -> Void) -> some View {
        let color = accent ?? theme.colors.brandGold
        return Button(action: action) {
            Text(label).font(.caption2.weight(.bold)).tracking(0.4)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(selected ? color.opacity(0.18) : theme.colors.surfaceMuted.opacity(0.6))
                .foregroundStyle(selected ? color : theme.colors.textMuted)
                .clipShape(Capsule())
                .overlay(Capsule().strokeBorder(selected ? color.opacity(0.6) : Color.clear, lineWidth: 1))
        }
    }

    // MARK: Content

    private var callsList: some View {
        List(filtered) { call in
            CallRowView(call: call)
                .listRowBackground(priorityBackground(call))
                .listRowSeparatorTint(theme.colors.surfaceMuted)
                .contentShape(Rectangle())
                .onTapGesture { selected = call }
        }
        .listStyle(.plain).background(theme.colors.surfaceBase).scrollContentBackground(.hidden)
    }

    private func priorityBackground(_ call: ActiveCall) -> Color {
        switch call.displayPriority {
        case 1: return theme.colors.critical.opacity(0.06)
        default: return theme.colors.surfaceBase
        }
    }

    private var emptyView: some View {
        VStack(spacing: 12) {
            if vm.calls.isEmpty {
                Image(systemName: "checkmark.shield").font(.system(size: 48)).foregroundStyle(theme.colors.success)
                Text("No active calls").font(.headline).foregroundStyle(theme.colors.textPrimary)
                Text("All clear in your service area").font(.caption).foregroundStyle(theme.colors.textMuted)
            } else {
                Image(systemName: "line.3.horizontal.decrease.circle").font(.system(size: 48))
                    .foregroundStyle(theme.colors.textMuted)
                Text("No calls match filters").font(.headline).foregroundStyle(theme.colors.textPrimary)
                Button("Clear filters") { priorityFilter = nil; statusFilter = nil }
                    .font(.caption.weight(.semibold)).foregroundStyle(theme.colors.brandGold)
            }
        }
    }

    private func errorView(_ msg: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle").font(.system(size: 48)).foregroundStyle(theme.colors.warning)
            Text("Cannot load calls").font(.headline).foregroundStyle(theme.colors.textPrimary)
            Text(msg).font(.caption).foregroundStyle(theme.colors.textMuted)
                .multilineTextAlignment(.center).padding(.horizontal, 32)
            Button("Retry") { Task { await vm.refresh() } }
                .font(.caption.weight(.semibold)).foregroundStyle(theme.colors.brandGold)
        }
    }
}

// MARK: - Call Row

struct CallRowView: View {
    @Environment(\.theme) private var theme
    let call: ActiveCall

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            priorityBadge
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(call.displayIncidentType).font(.caption.weight(.bold))
                        .foregroundStyle(theme.colors.textPrimary)
                    Spacer()
                    Text(call.statusDisplay).font(.caption2.weight(.semibold))
                        .foregroundStyle(statusColor)
                }
                Text(call.location_address).font(.footnote).foregroundStyle(theme.colors.textSecondary)
                    .lineLimit(1)
                HStack(spacing: 8) {
                    Text(call.displayCallNumber).font(.caption2).foregroundStyle(theme.colors.textMuted)
                    if !call.unitList.isEmpty {
                        Text("· \(call.unitList.joined(separator: ", "))").font(.caption2)
                            .foregroundStyle(theme.colors.brandGold).lineLimit(1)
                    }
                }
            }
            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(theme.colors.surfaceMuted)
                .padding(.top, 3)
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

    private var priorityBadge: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 4).fill(priorityColor).frame(width: 30, height: 30)
            Text("P\(call.displayPriority)").font(.caption2.weight(.black)).foregroundStyle(.white)
        }
    }

    private var priorityColor: Color {
        switch call.displayPriority {
        case 1: return theme.colors.critical
        case 2: return theme.colors.warning
        default: return theme.colors.textMuted.opacity(0.6)
        }
    }
}
