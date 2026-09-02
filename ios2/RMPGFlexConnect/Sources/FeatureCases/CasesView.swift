import SwiftUI



public struct CasesView: View {
    @StateObject private var vm: CasesViewModel
    @State private var showNew = false

    public init(apiClient: APIClient = APIClient(baseURL: Endpoint.productionBaseURL)) {
        _vm = StateObject(wrappedValue: CasesViewModel(api: CasesAPI(client: apiClient)))
    }

    public var body: some View {
        NavigationStack {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 0) {
                PanelTitleBar(title: "Cases", icon: "briefcase.fill")
                RMPGDivider()
                HStack(spacing: 4) {
                    // Real cases.status values (migrations/0028_cases.sql):
                    // open, under_review, approved, closed. "Active" was never
                    // a real value — that filter chip has always returned zero
                    // results since the server would never match it.
                    filterChip("All", nil)
                    filterChip("Open", "open")
                    filterChip("Under Review", "under_review")
                    filterChip("Closed", "closed")
                    Spacer()
                    IconButton(systemName: "plus.circle.fill", label: "New Case") { showNew = true }
                }
                .padding(.horizontal, 12).padding(.vertical, 6).background(RMPGTheme.raisedSurface)
                RMPGDivider()

                if vm.isLoading { Spacer(); ProgressView().tint(RMPGTheme.brandGold); Spacer() }
                else {
                    List(vm.cases) { c in
                        NavigationLink(destination: CaseDetailView(caseId: c.id, api: vm.api)) {
                            CaseRow(item: c)
                        }
                        .listRowBackground(RMPGTheme.baseBlack)
                        .listRowSeparatorTint(RMPGTheme.borderSubtle)
                    }
                    .listStyle(.plain).scrollContentBackground(.hidden)
                    .refreshable { await vm.refresh() }
                }
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
                StatusBadge(text: (item.priority ?? "normal").capitalized, color: priorityColor(item.priority))
                StatusBadge(text: (item.status ?? "open").replacingOccurrences(of: "_", with: " ").capitalized, color: RMPGTheme.textSecondary)
                Spacer()
                if let n = item.caseNumber { Text("#\(n)").font(.system(size: 10)).foregroundColor(RMPGTheme.brandGold) }
            }
            Text(item.title ?? item.caseType ?? "Unknown").font(.system(size: 13, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
            if let type = item.caseType { Text(type.capitalized).font(.system(size: 11)).foregroundColor(RMPGTheme.textSecondary) }
            if let s = item.solvabilityScore {
                Text("Solvability: \(s)/10").font(.system(size: 10)).foregroundColor(s >= 7 ? RMPGTheme.statusGreen : RMPGTheme.textMuted)
            }
        }
        .padding(.vertical, 4)
    }

    private func priorityColor(_ priority: String?) -> Color {
        switch priority {
        case "critical": return RMPGTheme.statusRed
        case "high": return RMPGTheme.statusOrange
        case "low": return RMPGTheme.textMuted
        default: return RMPGTheme.textSecondary
        }
    }
}

struct NewCaseView: View {
    let api: CasesAPI
    let onDone: () -> Void
    @State private var title = ""
    @State private var caseType = "general"
    @State private var priority = "normal"
    @State private var summary = ""
    @State private var loading = false
    @State private var errorMessage: String?
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                RMPGTheme.baseBlack.ignoresSafeArea()
                Form {
                    Section {
                        // Real cases.priority values (migrations/0028_cases.sql) —
                        // low/normal/high/critical, a completely different enum
                        // than the P1-P4 call-priority scheme a prior version of
                        // this picker used by mistake.
                        Picker("Priority", selection: $priority) {
                            Text("Critical").tag("critical"); Text("High").tag("high")
                            Text("Normal").tag("normal"); Text("Low").tag("low")
                        }
                        RMPGTextField(placeholder: "Case Title", text: $title)
                        RMPGTextField(placeholder: "Case Type", text: $caseType)
                        RMPGTextField(placeholder: "Summary", text: $summary)
                    }.listRowBackground(RMPGTheme.raisedSurface)
                    if let error = errorMessage {
                        Text(error).font(.system(size: 11)).foregroundColor(RMPGTheme.statusRed)
                            .listRowBackground(RMPGTheme.baseBlack)
                    }
                    Section { RMPGPrimaryButton(title: "CREATE CASE", isLoading: loading) { create() } }
                        .listRowBackground(RMPGTheme.baseBlack)
                }.scrollContentBackground(.hidden).formStyle(.grouped)
            }
            .navigationTitle("New Case").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.foregroundColor(RMPGTheme.textSecondary) } }
        }
    }

    func create() {
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty else {
            errorMessage = "Title is required"; return
        }
        loading = true
        errorMessage = nil
        Task {
            do {
                let req = CaseCreateRequest(title: title, caseType: caseType.isEmpty ? "general" : caseType, priority: priority, summary: summary.isEmpty ? nil : summary)
                _ = try await api.create(req)
                onDone(); dismiss()
            } catch {
                loading = false
                errorMessage = "Could not create case: \(error.localizedDescription)"
            }
        }
    }
}

struct CaseDetailView: View {
    let caseId: Int
    let api: CasesAPI

    @State private var caseItem: Case?
    @State private var notes: [CaseNote] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showStatusSheet = false
    @State private var newNoteText = ""
    @State private var isAddingNote = false

    var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            if isLoading {
                ProgressView().tint(RMPGTheme.brandGold)
            } else if let caseItem {
                content(caseItem)
            } else if let errorMessage {
                Text(errorMessage).font(.system(size: 12)).foregroundColor(RMPGTheme.statusRed).padding()
            }
        }
        .navigationTitle(caseItem?.caseNumber.map { "Case #\($0)" } ?? "Case")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(isPresented: $showStatusSheet) {
            CaseStatusSheet(caseItem: caseItem, api: api) {
                Task { await load() }
            }
        }
    }

    private func content(_ item: Case) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error = errorMessage {
                    Text(error).font(.system(size: 11)).foregroundColor(RMPGTheme.statusRed)
                }
                HStack {
                    StatusBadge(text: (item.priority ?? "normal").capitalized, color: priorityColor(item.priority))
                    StatusBadge(text: (item.status ?? "open").replacingOccurrences(of: "_", with: " ").capitalized, color: RMPGTheme.textSecondary)
                    Spacer()
                }
                Text(item.title ?? item.caseType ?? "Unknown Case")
                    .font(.system(size: 18, weight: .bold)).foregroundColor(RMPGTheme.textPrimary)

                section("Details") {
                    fieldRow("Case Number", item.caseNumber)
                    fieldRow("Type", item.caseType?.capitalized)
                    fieldRow("Solvability", item.solvabilityScore.map { "\($0)/10" })
                    fieldRow("Created", item.createdAt.map { String($0.prefix(19)) })
                }
                if let summary = item.summary, !summary.isEmpty {
                    section("Summary") { fieldRow("Summary", summary) }
                }
                if let narrative = item.narrative, !narrative.isEmpty {
                    section("Narrative") { fieldRow("Narrative", narrative) }
                }

                Button {
                    showStatusSheet = true
                } label: {
                    HStack {
                        Image(systemName: "arrow.triangle.2.circlepath")
                        Text("UPDATE STATUS").font(.system(size: 13, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(RMPGTheme.brandGold).foregroundColor(.black).cornerRadius(2)
                }

                Text("NOTES".uppercased())
                    .font(.system(size: 10, weight: .semibold)).foregroundColor(RMPGTheme.brandGold).tracking(1)

                HStack(spacing: 8) {
                    TextField("Add a note...", text: $newNoteText)
                        .font(.system(size: 12)).foregroundColor(RMPGTheme.textPrimary)
                        .padding(8).background(RMPGTheme.raisedSurface).cornerRadius(2)
                    Button {
                        Task { await addNote() }
                    } label: {
                        if isAddingNote { ProgressView().tint(RMPGTheme.brandGold) }
                        else { Image(systemName: "paperplane.fill").foregroundColor(RMPGTheme.brandGold) }
                    }
                    .disabled(newNoteText.trimmingCharacters(in: .whitespaces).isEmpty || isAddingNote)
                }

                if notes.isEmpty {
                    Text("No notes yet").font(.system(size: 11)).foregroundColor(RMPGTheme.textMuted)
                } else {
                    VStack(spacing: 0) {
                        ForEach(notes) { note in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(note.content ?? "").font(.system(size: 12)).foregroundColor(RMPGTheme.textPrimary)
                                if let date = note.createdAt {
                                    Text(String(date.prefix(19))).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted)
                                }
                            }
                            .padding(12)
                            if note.id != notes.last?.id { Divider().background(RMPGTheme.borderSubtle) }
                        }
                    }
                    .background(RMPGTheme.raisedSurface).cornerRadius(2)
                }
            }
            .padding(16)
        }
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
                Text(label).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted).frame(width: 100, alignment: .leading)
                Text(value).font(.system(size: 12)).foregroundColor(RMPGTheme.textPrimary)
                Spacer()
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
        }
    }

    private func priorityColor(_ priority: String?) -> Color {
        switch priority {
        case "critical": return RMPGTheme.statusRed
        case "high": return RMPGTheme.statusOrange
        case "low": return RMPGTheme.textMuted
        default: return RMPGTheme.textSecondary
        }
    }

    private func load() async {
        do {
            async let c = api.get(id: caseId)
            async let n = api.listNotes(caseId: caseId)
            (caseItem, notes) = try await (c, n)
            errorMessage = nil
        } catch {
            errorMessage = "Could not load case: \(error.localizedDescription)"
        }
        isLoading = false
    }

    private func addNote() async {
        guard !newNoteText.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        isAddingNote = true
        do {
            _ = try await api.addNote(caseId: caseId, content: newNoteText)
            newNoteText = ""
            notes = try await api.listNotes(caseId: caseId)
        } catch {
            errorMessage = "Could not add note: \(error.localizedDescription)"
        }
        isAddingNote = false
    }
}

/// Only exposes the real `cases.status` values — verified against
/// migrations/0028_cases.sql. Note: PUT /:id/status is admin/manager/
/// supervisor-only server-side; an officer tapping this will see the
/// server's 403 surfaced honestly rather than a silent no-op.
struct CaseStatusSheet: View {
    let caseItem: Case?
    let api: CasesAPI
    let onComplete: () -> Void

    private let statuses = ["open", "under_review", "approved", "closed"]
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                RMPGTheme.baseBlack.ignoresSafeArea()
                VStack(spacing: 0) {
                    ForEach(statuses, id: \.self) { status in
                        Button {
                            Task { await update(to: status) }
                        } label: {
                            HStack {
                                Text(status.replacingOccurrences(of: "_", with: " ").capitalized)
                                    .font(.system(size: 13)).foregroundColor(RMPGTheme.textPrimary)
                                Spacer()
                                if caseItem?.status == status {
                                    Image(systemName: "checkmark.circle.fill").foregroundColor(RMPGTheme.brandGold)
                                }
                                if isSubmitting { ProgressView().tint(RMPGTheme.brandGold) }
                            }
                            .padding(.horizontal, 16).padding(.vertical, 12)
                        }
                        .disabled(isSubmitting)
                        if status != statuses.last { Divider().background(RMPGTheme.borderSubtle) }
                    }
                    if let error = errorMessage {
                        Text(error).font(.system(size: 11)).foregroundColor(RMPGTheme.statusRed).padding()
                    }
                }
                .background(RMPGTheme.raisedSurface)
            }
            .navigationTitle("Update Case Status")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func update(to status: String) async {
        guard let caseItem else { return }
        isSubmitting = true
        errorMessage = nil
        do {
            _ = try await api.updateStatus(id: caseItem.id, status: status)
            onComplete()
            dismiss()
        } catch {
            errorMessage = "Could not update status: \(error.localizedDescription)"
        }
        isSubmitting = false
    }
}
