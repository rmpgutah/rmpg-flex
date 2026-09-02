import SwiftUI



public struct DispatchView: View {
    @StateObject private var viewModel: DispatchViewModel
    @State private var showNewCallSheet = false
    @State private var searchText = ""
    @State private var showPanicConfirm = false
    @State private var panicMessage: String?
    @State private var showMap = false

    public init(api: DispatchAPI) {
        _viewModel = StateObject(wrappedValue: DispatchViewModel(api: api))
    }

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()

            VStack(spacing: 0) {
                PanelTitleBar(title: "Dispatch", icon: "antenna.radiowaves.left.and.right")
                RMPGDivider()

                statsBanner
                welfareBanner

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

                    IconButton(systemName: showMap ? "list.bullet" : "map.fill", label: showMap ? "List" : "Map") {
                        showMap.toggle()
                    }

                    IconButton(systemName: "exclamationmark.triangle.fill", label: "Panic") {
                        showPanicConfirm = true
                    }

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
                } else if showMap {
                    DispatchMapView(viewModel: viewModel)
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
        .alert("Trigger Panic Alert?", isPresented: $showPanicConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("PANIC", role: .destructive) {
                Task {
                    await viewModel.triggerPanic()
                    panicMessage = viewModel.errorMessage ?? "Panic alert sent — dispatch notified."
                }
            }
        } message: {
            Text("This immediately alerts dispatch and nearby units of your location.")
        }
        .alert("Panic Alert", isPresented: Binding(get: { panicMessage != nil }, set: { if !$0 { panicMessage = nil } })) {
            Button("OK") { panicMessage = nil }
        } message: {
            Text(panicMessage ?? "")
        }
    }

    /// Real per-officer counts from GET /api/dispatch (aggregates.ts) — this
    /// data was always being fetched but never displayed anywhere, and the
    /// fetch itself 404'd until the endpoint path/shape was fixed alongside
    /// this UI.
    @ViewBuilder
    private var statsBanner: some View {
        if let stats = viewModel.stats {
            HStack(spacing: 0) {
                statTile("Pending", stats.calls?.pending, RMPGTheme.statusYellow)
                statTile("Active", stats.calls?.active, RMPGTheme.statusOrange)
                statTile("P1", stats.calls?.p1Count, RMPGTheme.statusRed)
                statTile("Available", stats.units?.available, RMPGTheme.statusGreen)
                statTile("Committed", stats.units?.committed, RMPGTheme.textSecondary)
            }
            .padding(.vertical, 6)
            .background(RMPGTheme.raisedSurface)
            RMPGDivider()
        }
    }

    private func statTile(_ label: String, _ value: Int?, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(value ?? 0)").font(.system(size: 15, weight: .bold)).foregroundColor(color)
            Text(label.uppercased()).font(.system(size: 8, weight: .medium)).foregroundColor(RMPGTheme.textMuted)
        }
        .frame(maxWidth: .infinity)
    }

    /// Officers on-scene at a high-priority call who should have an active
    /// welfare-check timer — surfaces here as a safety banner rather than
    /// requiring a dispatcher to know to check a separate screen.
    @ViewBuilder
    private var welfareBanner: some View {
        if !viewModel.welfareWatches.isEmpty {
            HStack(spacing: 6) {
                Image(systemName: "shield.lefthalf.filled").font(.system(size: 11)).foregroundColor(RMPGTheme.statusYellow)
                Text("\(viewModel.welfareWatches.count) officer\(viewModel.welfareWatches.count == 1 ? "" : "s") under welfare watch:")
                    .font(.system(size: 10, weight: .semibold)).foregroundColor(RMPGTheme.statusYellow)
                Text(viewModel.welfareWatches.compactMap { $0.callSign ?? $0.officerName }.joined(separator: ", "))
                    .font(.system(size: 10)).foregroundColor(RMPGTheme.textSecondary)
                    .lineLimit(1)
                Spacer()
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(RMPGTheme.statusYellow.opacity(0.1))
        }
    }

    @ViewBuilder
    private var statusFilter: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                // Real calls_for_service.status CHECK values (migrations/0001_initial_schema.sql) —
                // a prior version of this list used "active"/"en_route"/"on_scene", none of
                // which exist in the real enum, so those filters silently matched zero calls.
                ForEach(["All", "pending", "dispatched", "enroute", "onscene", "cleared", "closed"], id: \.self) { status in
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
                    || (call.locationAddress?.lowercased().contains(q) ?? false)
            }

        return List(filtered) { call in
            NavigationLink(destination: CallDetailView(call: call, api: viewModel.api)) {
                CallRow(call: call)
            }
            .listRowBackground(RMPGTheme.baseBlack)
            .listRowSeparatorTint(RMPGTheme.borderSubtle)
            .swipeActions(edge: .leading) {
                Button { Task { try? await viewModel.updateCallStatus(id: call.id, status: "dispatched") } }
                label: { Label("Dispatch", systemImage: "play.fill") }
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
                    StatusBadge(text: status.replacingOccurrences(of: "_", with: " ").capitalized, color: RMPGTheme.textSecondary)
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
            if let location = call.locationAddress {
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
                    locationAddress: location,
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
