import SwiftUI
import CoreAPI
import DesignSystem

public struct IncidentsView: View {
    @StateObject private var vm: IncidentsViewModel
    @State private var showNew = false
    @State private var filter: String? = nil

    public init(apiClient: APIClient = APIClient(baseURL: Endpoint.productionBaseURL)) {
        let api = IncidentsAPI(client: apiClient)
        _vm = StateObject(wrappedValue: IncidentsViewModel(api: api))
    }

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 0) {
                PanelTitleBar(title: "Incidents", icon: "doc.text.fill")
                RMPGDivider()

                HStack(spacing: 4) {
                    filterChip("All", nil)
                    filterChip("Draft", "draft")
                    filterChip("Submitted", "submitted")
                    filterChip("Approved", "approved")
                    Spacer()
                    IconButton(systemName: "plus.circle.fill", label: "New Incident") { showNew = true }
                }
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(RMPGTheme.raisedSurface)
                RMPGDivider()

                if vm.isLoading { Spacer(); ProgressView().tint(RMPGTheme.brandGold); Spacer() }
                else {
                    List(vm.incidents) { inc in
                        IncidentRow(incident: inc)
                            .listRowBackground(RMPGTheme.baseBlack)
                            .listRowSeparatorTint(RMPGTheme.borderSubtle)
                            .swipeActions(edge: .trailing) {
                                if inc.status == "draft" {
                                    Button { Task { try? await vm.submit(id: inc.id) } }
                                    label: { Label("Submit", systemImage: "paperplane.fill") }.tint(RMPGTheme.brandGold)
                                }
                            }
                    }
                    .listStyle(.plain).scrollContentBackground(.hidden)
                    .refreshable { await vm.refresh() }
                }
            }
        }
        .onAppear { Task { await vm.refresh() } }
        .onChange(of: filter) { _, _ in Task { await vm.refresh() } }
        .sheet(isPresented: $showNew) {
            NewIncidentView(api: vm.api) { showNew = false; Task { await vm.refresh() } }
        }
    }

    func filterChip(_ label: String, _ value: String?) -> some View {
        Button {
            filter = value; vm.statusFilter = value
        } label: {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(filter == value ? RMPGTheme.brandGold : RMPGTheme.textMuted)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(filter == value ? RMPGTheme.brandGold.opacity(0.1) : Color.clear)
                .cornerRadius(2)
        }
    }
}

@MainActor
final class IncidentsViewModel: ObservableObject {
    @Published var incidents: [Incident] = []
    @Published var isLoading = false
    @Published var statusFilter: String? = nil

    let api: IncidentsAPI
    init(api: IncidentsAPI) { self.api = api }

    func refresh() async {
        isLoading = true
        do { incidents = try await api.list(status: statusFilter) }
        catch { print("Incidents error: \(error)") }
        isLoading = false
    }

    func submit(id: Int) async throws {
        try await api.submit(id: id)
        if let i = incidents.firstIndex(where: { $0.id == id }) {
            var updated = incidents[i]
            incidents.remove(at: i)
            incidents.insert(updated, at: 0)
        }
        await refresh()
    }

    func approve(id: Int) async throws {
        try await api.approve(id: id)
        await refresh()
    }
}

struct IncidentRow: View {
    let incident: Incident
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                if let p = incident.priority { StatusBadge.priority(p) }
                StatusBadge(text: incident.statusLabel, color: RMPGTheme.textSecondary)
                Spacer()
                if let n = incident.incidentNumber {
                    Text("#\(n)").font(.system(size: 10)).foregroundColor(RMPGTheme.brandGold)
                }
            }
            Text(incident.type ?? "Unknown Type")
                .font(.system(size: 13, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
            if let loc = incident.location {
                HStack(spacing: 4) {
                    Image(systemName: "location.fill").font(.system(size: 9)).foregroundColor(RMPGTheme.statusRed)
                    Text(loc).font(.system(size: 11)).foregroundColor(RMPGTheme.textSecondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

struct NewIncidentView: View {
    let api: IncidentsAPI
    let onDone: () -> Void
    @State private var type = ""
    @State private var priority = "P3"
    @State private var location = ""
    @State private var narrative = ""
    @State private var loading = false
    @Environment(\.dismiss) var dismiss

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
                        RMPGTextField(placeholder: "Incident Type", text: $type)
                        RMPGTextField(placeholder: "Location", text: $location)
                        RMPGTextField(placeholder: "Narrative", text: $narrative)
                    }.listRowBackground(RMPGTheme.raisedSurface)
                    Section {
                        RMPGPrimaryButton(title: "CREATE INCIDENT", isLoading: loading) { create() }
                    }.listRowBackground(RMPGTheme.baseBlack)
                }
                .scrollContentBackground(.hidden).formStyle(.grouped)
            }
            .navigationTitle("New Incident").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.foregroundColor(RMPGTheme.textSecondary) } }
        }
    }

    func create() {
        guard !type.isEmpty else { return }
        loading = true
        Task {
            do {
                let req = IncidentCreateRequest(type: type, priority: priority, narrative: narrative.isEmpty ? nil : narrative, location: location.isEmpty ? nil : location)
                _ = try await api.create(req)
                onDone(); dismiss()
            } catch { loading = false }
        }
    }
}
