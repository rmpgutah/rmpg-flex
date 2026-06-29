import SwiftUI
import CoreAPI
import DesignSystem

public struct DispatchView: View {
    @StateObject private var viewModel: DispatchViewModel
    @State private var showNewCallSheet = false
    @State private var searchText = ""

    public init(api: DispatchAPI) {
        _viewModel = StateObject(wrappedValue: DispatchViewModel(api: api))
    }

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()

            VStack(spacing: 0) {
                PanelTitleBar(title: "Dispatch", icon: "antenna.radiowaves.left.and.right")
                RMPGDivider()

                HStack(spacing: 8) {
                    HStack(spacing: 6) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 11))
                            .foregroundColor(RMPGTheme.textMuted)
                        TextField("Search calls...", text: $searchText)
                            .font(.system(size: 11))
                            .foregroundColor(RMPGTheme.textPrimary)
                    }
                    .padding(8)
                    .background(RMPGTheme.sunkenSurface)
                    .cornerRadius(2)

                    statusFilter

                    IconButton(systemName: "plus.circle.fill", label: "New Call") {
                        showNewCallSheet = true
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(RMPGTheme.raisedSurface)

                RMPGDivider()

                if viewModel.isLoading && viewModel.calls.isEmpty {
                    Spacer()
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: RMPGTheme.brandGold))
                    Spacer()
                } else if let error = viewModel.errorMessage {
                    Spacer()
                    VStack(spacing: 8) {
                        Text(error)
                            .font(.system(size: 12))
                            .foregroundColor(RMPGTheme.statusRed)
                        Button("Retry") { viewModel.refresh() }
                            .font(.system(size: 12))
                            .foregroundColor(RMPGTheme.brandGold)
                    }
                    Spacer()
                } else {
                    callsList
                }
            }
        }
        .onAppear { viewModel.refresh() }
        .sheet(isPresented: $showNewCallSheet) {
            NewCallView(api: viewModel.api) { _ in
                showNewCallSheet = false
                viewModel.refresh()
            }
        }
    }

    @ViewBuilder
    private var statusFilter: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(["All", "pending", "active", "en_route", "on_scene", "closed"], id: \.self) { status in
                    Button {
                        viewModel.selectedStatus = status == "All" ? nil : status
                        viewModel.refresh()
                    } label: {
                        Text(status.replacingOccurrences(of: "_", with: " ").uppercased())
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(viewModel.selectedStatus == status || (status == "All" && viewModel.selectedStatus == nil)
                                ? RMPGTheme.brandGold : RMPGTheme.textMuted)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(
                                viewModel.selectedStatus == status || (status == "All" && viewModel.selectedStatus == nil)
                                    ? RMPGTheme.brandGold.opacity(0.1) : Color.clear
                            )
                            .cornerRadius(2)
                    }
                }
            }
        }
    }

    private var callsList: some View {
        let filtered = searchText.isEmpty
            ? viewModel.calls
            : viewModel.calls.filter { call in
                let q = searchText.lowercased()
                return (call.callNumber?.lowercased().contains(q) ?? false)
                    || (call.incidentType?.lowercased().contains(q) ?? false)
                    || (call.location?.lowercased().contains(q) ?? false)
            }

        return List(filtered) { call in
            CallRow(call: call)
                .listRowBackground(RMPGTheme.baseBlack)
                .listRowSeparatorTint(RMPGTheme.borderSubtle)
                .swipeActions(edge: .leading) {
                    Button { Task { try? await viewModel.updateCallStatus(id: call.id, status: "active") } }
                    label: { Label("Active", systemImage: "play.fill") }
                        .tint(RMPGTheme.statusGreen)
                }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .refreshable { viewModel.refresh() }
    }
}

struct CallRow: View {
    let call: CallForService

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                if let priority = call.priority {
                    StatusBadge.priority(priority)
                }
                if let status = call.status {
                    StatusBadge(text: status.replacingOccurrences(of: "_", with: " "), color: RMPGTheme.textSecondary)
                }
                Spacer()
                if let number = call.callNumber {
                    Text("#\(number)")
                        .font(.system(size: 10))
                        .foregroundColor(RMPGTheme.brandGold)
                }
            }
            Text(call.incidentType ?? "Unknown")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(RMPGTheme.textPrimary)
            if let location = call.location {
                HStack(spacing: 4) {
                    Image(systemName: "location.fill")
                        .font(.system(size: 9))
                        .foregroundColor(RMPGTheme.statusRed)
                    Text(location)
                        .font(.system(size: 11))
                        .foregroundColor(RMPGTheme.textSecondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

struct NewCallView: View {
    let api: DispatchAPI
    let onCreated: (CallForService) -> Void

    @State private var incidentType = ""
    @State private var priority = "P3"
    @State private var location = ""
    @State private var narrative = ""
    @State private var isLoading = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                RMPGTheme.baseBlack.ignoresSafeArea()
                Form {
                    Section {
                        Picker("Priority", selection: $priority) {
                            Text("P1 — Critical").tag("P1")
                            Text("P2 — High").tag("P2")
                            Text("P3 — Normal").tag("P3")
                            Text("P4 — Low").tag("P4")
                        }
                        RMPGTextField(placeholder: "Incident Type", text: $incidentType)
                        RMPGTextField(placeholder: "Location", text: $location)
                        RMPGTextField(placeholder: "Narrative (optional)", text: $narrative)
                    }
                    .listRowBackground(RMPGTheme.raisedSurface)

                    Section {
                        RMPGPrimaryButton(title: "CREATE CALL", isLoading: isLoading) {
                            create()
                        }
                    }
                    .listRowBackground(RMPGTheme.baseBlack)
                }
                .scrollContentBackground(.hidden)
                .formStyle(.grouped)
            }
            .navigationTitle("New Call")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(RMPGTheme.textSecondary)
                }
            }
        }
    }

    private func create() {
        guard !incidentType.isEmpty, !location.isEmpty else { return }
        isLoading = true
        Task {
            do {
                let req = CreateCallRequest(
                    incidentType: incidentType,
                    priority: priority,
                    location: location,
                    narrative: narrative.isEmpty ? nil : narrative
                )
                let call = try await api.createCall(req)
                onCreated(call)
                dismiss()
            } catch {
                isLoading = false
            }
        }
    }
}
