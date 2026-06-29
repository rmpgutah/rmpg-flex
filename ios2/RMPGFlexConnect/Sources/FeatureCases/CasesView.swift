import SwiftUI
import CoreAPI
import DesignSystem

public struct CasesView: View {
    @StateObject private var vm: CasesViewModel
    @State private var showNew = false

    public init(apiClient: APIClient = APIClient(baseURL: Endpoint.productionBaseURL)) {
        _vm = StateObject(wrappedValue: CasesViewModel(api: CasesAPI(client: apiClient)))
    }

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 0) {
                PanelTitleBar(title: "Cases", icon: "briefcase.fill")
                RMPGDivider()
                HStack(spacing: 4) {
                    filterChip("All", nil)
                    filterChip("Open", "open")
                    filterChip("Active", "active")
                    filterChip("Closed", "closed")
                    Spacer()
                    IconButton(systemName: "plus.circle.fill", label: "New Case") { showNew = true }
                }
                .padding(.horizontal, 12).padding(.vertical, 6).background(RMPGTheme.raisedSurface)
                RMPGDivider()

                if vm.isLoading { Spacer(); ProgressView().tint(RMPGTheme.brandGold); Spacer() }
                else {
                    List(vm.cases) { c in
                        CaseRow(item: c)
                            .listRowBackground(RMPGTheme.baseBlack)
                            .listRowSeparatorTint(RMPGTheme.borderSubtle)
                    }
                    .listStyle(.plain).scrollContentBackground(.hidden)
                    .refreshable { await vm.refresh() }
                }
            }
        }
        .onAppear { Task { await vm.refresh() } }
        .sheet(isPresented: $showNew) {
            NewCaseView(api: vm.api) { showNew = false; Task { await vm.refresh() } }
        }
    }

    func filterChip(_ label: String, _ value: String?) -> some View {
        Button { vm.statusFilter = value; Task { await vm.refresh() } } label: {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(vm.statusFilter == value ? RMPGTheme.brandGold : RMPGTheme.textMuted)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(vm.statusFilter == value ? RMPGTheme.brandGold.opacity(0.1) : Color.clear)
                .cornerRadius(2)
        }
    }
}

@MainActor
final class CasesViewModel: ObservableObject {
    @Published var cases: [Case] = []
    @Published var isLoading = false
    @Published var statusFilter: String?
    let api: CasesAPI
    init(api: CasesAPI) { self.api = api }

    func refresh() async {
        isLoading = true
        do { cases = try await api.list(status: statusFilter) } catch { print(error) }
        isLoading = false
    }
}

struct CaseRow: View {
    let item: Case
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                if let p = item.priority { StatusBadge.priority(p) }
                StatusBadge(text: (item.status ?? "open").replacingOccurrences(of: "_", with: " "), color: RMPGTheme.textSecondary)
                Spacer()
                if let n = item.caseNumber { Text("#\(n)").font(.system(size: 10)).foregroundColor(RMPGTheme.brandGold) }
            }
            Text(item.type ?? "Unknown").font(.system(size: 13, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
            if let s = item.solvabilityScore {
                Text("Solvability: \(s)/10").font(.system(size: 10)).foregroundColor(s >= 7 ? RMPGTheme.statusGreen : RMPGTheme.textMuted)
            }
        }
        .padding(.vertical, 4)
    }
}

struct NewCaseView: View {
    let api: CasesAPI
    let onDone: () -> Void
    @State private var type = ""
    @State private var priority = "P3"
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
                            Text("P1 — Critical").tag("P1"); Text("P2 — High").tag("P2")
                            Text("P3 — Normal").tag("P3"); Text("P4 — Low").tag("P4")
                        }
                        RMPGTextField(placeholder: "Case Type", text: $type)
                        RMPGTextField(placeholder: "Narrative", text: $narrative)
                    }.listRowBackground(RMPGTheme.raisedSurface)
                    Section { RMPGPrimaryButton(title: "CREATE CASE", isLoading: loading) { create() } }
                        .listRowBackground(RMPGTheme.baseBlack)
                }.scrollContentBackground(.hidden).formStyle(.grouped)
            }
            .navigationTitle("New Case").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.foregroundColor(RMPGTheme.textSecondary) } }
        }
    }

    func create() {
        guard !type.isEmpty else { return }
        loading = true
        Task {
            do {
                let req = CaseCreateRequest(type: type, priority: priority, narrative: narrative.isEmpty ? nil : narrative)
                _ = try await api.create(req)
                onDone(); dismiss()
            } catch { loading = false }
        }
    }
}
