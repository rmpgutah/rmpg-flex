import SwiftUI



public struct IncidentsView: View {
    @StateObject private var vm: IncidentsViewModel
    @State private var showNew = false
    @State private var filter: String? = nil

    public init(apiClient: APIClient = APIClient(baseURL: Endpoint.productionBaseURL)) {
        let api = IncidentsAPI(client: apiClient)
        _vm = StateObject(wrappedValue: IncidentsViewModel(api: api))
    }

    public var body: some View {
        NavigationStack {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 0) {
                PanelTitleBar(title: "Incidents", icon: "doc.text.fill")
                RMPGDivider()

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) {
                        // Real incidents.status CHECK values (migrations/0001_initial_schema.sql):
                        // draft, submitted, under_review, approved, returned.
                        filterChip("All", nil)
                        filterChip("Draft", "draft")
                        filterChip("Submitted", "submitted")
                        filterChip("Under Review", "under_review")
                        filterChip("Approved", "approved")
                        filterChip("Returned", "returned")
                        Spacer()
                        IconButton(systemName: "plus.circle.fill", label: "New Incident") { showNew = true }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 6)
                }
                .background(RMPGTheme.raisedSurface)
                RMPGDivider()

                if vm.isLoading { Spacer(); ProgressView().tint(RMPGTheme.brandGold); Spacer() }
                else {
                    List(vm.incidents) { inc in
                        NavigationLink(destination: IncidentDetailView(incidentId: inc.id, api: vm.api)) {
                            IncidentRow(incident: inc)
                        }
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
            Text(incident.incidentType ?? "Unknown Type")
                .font(.system(size: 13, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
            if let loc = incident.locationAddress {
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
                let req = IncidentCreateRequest(incidentType: type, priority: priority, narrative: narrative.isEmpty ? nil : narrative, locationAddress: location.isEmpty ? nil : location)
                _ = try await api.create(req)
                onDone(); dismiss()
            } catch { loading = false }
        }
    }
}

struct IncidentDetailView: View {
    let incidentId: Int
    let api: IncidentsAPI

    @State private var incident: Incident?
    @State private var offenses: [IncidentOffense] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var isSubmitting = false

    var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            if isLoading {
                ProgressView().tint(RMPGTheme.brandGold)
            } else if let incident {
                content(incident)
            } else if let errorMessage {
                Text(errorMessage).font(.system(size: 12)).foregroundColor(RMPGTheme.statusRed).padding()
            }
        }
        .navigationTitle(incident?.incidentNumber.map { "#\($0)" } ?? "Incident")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func content(_ inc: Incident) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error = errorMessage {
                    Text(error).font(.system(size: 11)).foregroundColor(RMPGTheme.statusRed)
                }
                HStack {
                    if let p = inc.priority { StatusBadge.priority(p) }
                    StatusBadge(text: inc.statusLabel, color: RMPGTheme.textSecondary)
                    Spacer()
                }
                Text(inc.incidentType ?? "Unknown Type")
                    .font(.system(size: 18, weight: .bold)).foregroundColor(RMPGTheme.textPrimary)

                section("Details") {
                    fieldRow("Incident Number", inc.incidentNumber)
                    fieldRow("Location", inc.locationAddress)
                    fieldRow("Created", inc.createdAt.map { String($0.prefix(19)) })
                }
                if let narrative = inc.narrative, !narrative.isEmpty {
                    section("Narrative") { fieldRow("Narrative", narrative) }
                }

                if !offenses.isEmpty {
                    Text("OFFENSES".uppercased())
                        .font(.system(size: 10, weight: .semibold)).foregroundColor(RMPGTheme.brandGold).tracking(1)
                    VStack(spacing: 0) {
                        ForEach(offenses) { o in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(o.description ?? "Offense").font(.system(size: 12, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
                                HStack(spacing: 8) {
                                    if let code = o.statuteCode { Text(code).font(.system(size: 10)).foregroundColor(RMPGTheme.textSecondary) }
                                    if let type = o.offenseType { Text(type).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted) }
                                }
                            }
                            .padding(12)
                            if o.id != offenses.last?.id { Divider().background(RMPGTheme.borderSubtle) }
                        }
                    }
                    .background(RMPGTheme.raisedSurface).cornerRadius(2)
                }

                // Real incidents.status workflow (migrations/0001_initial_schema.sql):
                // draft/returned → submit (PUT /:id/submit, requires narrative) →
                // submitted/under_review → approve (PUT /:id/approve).
                if inc.status == "draft" || inc.status == "returned" {
                    actionButton("SUBMIT", "paperplane.fill") {
                        Task {
                            isSubmitting = true
                            do { try await api.submit(id: incidentId); await load() }
                            catch { errorMessage = "Could not submit: \(error.localizedDescription)" }
                            isSubmitting = false
                        }
                    }
                } else if inc.status == "submitted" || inc.status == "under_review" {
                    actionButton("APPROVE", "checkmark.seal.fill") {
                        Task {
                            isSubmitting = true
                            do { try await api.approve(id: incidentId); await load() }
                            catch { errorMessage = "Could not approve: \(error.localizedDescription)" }
                            isSubmitting = false
                        }
                    }
                }
            }
            .padding(16)
        }
    }

    private func actionButton(_ title: String, _ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                if isSubmitting { ProgressView().tint(.black) } else { Image(systemName: icon) }
                Text(title).font(.system(size: 13, weight: .semibold))
            }
            .frame(maxWidth: .infinity).padding(.vertical, 14)
            .background(RMPGTheme.brandGold).foregroundColor(.black).cornerRadius(2)
        }
        .disabled(isSubmitting)
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased()).font(.system(size: 10, weight: .semibold)).foregroundColor(RMPGTheme.brandGold).tracking(1)
            VStack(spacing: 0) { content() }.background(RMPGTheme.raisedSurface).cornerRadius(2)
        }
    }

    @ViewBuilder
    private func fieldRow(_ label: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            HStack(alignment: .top) {
                Text(label).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted).frame(width: 110, alignment: .leading)
                Text(value).font(.system(size: 12)).foregroundColor(RMPGTheme.textPrimary)
                Spacer()
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
        }
    }

    private func load() async {
        do {
            async let i = api.get(id: incidentId)
            async let o = api.listOffenses(incidentId: incidentId)
            (incident, offenses) = try await (i, o)
            errorMessage = nil
        } catch {
            errorMessage = "Could not load incident: \(error.localizedDescription)"
        }
        isLoading = false
    }
}
