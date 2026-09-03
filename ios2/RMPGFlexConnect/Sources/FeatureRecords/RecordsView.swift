import SwiftUI



public struct RecordsView: View {
    @StateObject private var viewModel: RecordsViewModel
    @StateObject private var dlViewModel: DLRecordsViewModel
    @State private var searchText = ""
    @State private var mode: Mode = .all
    private let apiClient: APIClient

    enum Mode: String, CaseIterable { case all = "All Records", dl = "DL Records" }

    public init(apiClient: APIClient) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: RecordsViewModel(client: apiClient))
        _dlViewModel = StateObject(wrappedValue: DLRecordsViewModel(api: DLRecordsAPI(client: apiClient)))
    }

    public var body: some View {
        NavigationStack {
            ZStack {
                RMPGTheme.baseBlack.ignoresSafeArea()

                VStack(spacing: 0) {
                    PanelTitleBar(title: "Records", icon: "folder.fill")
                    RMPGDivider()

                    Picker("Mode", selection: $mode) {
                        ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(RMPGTheme.raisedSurface)

                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 11))
                            .foregroundColor(RMPGTheme.textMuted)
                        TextField(mode == .all ? "Search persons, vehicles, businesses..." : "Search by name or DL number...", text: $searchText)
                            .font(.system(size: 11))
                            .foregroundColor(RMPGTheme.textPrimary)
                            .onSubmit {
                                switch mode {
                                case .all: viewModel.search(query: searchText)
                                case .dl: dlViewModel.search(query: searchText)
                                }
                            }
                    }
                    .padding(8)
                    .background(RMPGTheme.sunkenSurface)
                    .cornerRadius(2)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(RMPGTheme.raisedSurface)

                    RMPGDivider()

                    switch mode {
                    case .all: allRecordsResults
                    case .dl: dlRecordsResults
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var allRecordsResults: some View {
        if let error = viewModel.error {
            Text(error).font(.system(size: 11)).foregroundColor(RMPGTheme.statusRed).padding(8)
        }
        if viewModel.isLoading {
            Spacer(); ProgressView().tint(RMPGTheme.brandGold); Spacer()
        } else if viewModel.results.isEmpty, !searchText.isEmpty {
            Spacer()
            Text("No results found").font(.system(size: 12)).foregroundColor(RMPGTheme.textMuted)
            Spacer()
        } else {
            List(viewModel.results) { result in
                NavigationLink(destination: RecordDetailView(result: result, client: apiClient)) {
                    RecordRow(result: result)
                }
                .listRowBackground(RMPGTheme.baseBlack)
                .listRowSeparatorTint(RMPGTheme.borderSubtle)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
    }

    @ViewBuilder
    private var dlRecordsResults: some View {
        if let error = dlViewModel.error {
            Text(error).font(.system(size: 11)).foregroundColor(RMPGTheme.statusRed).padding(8)
        }
        if dlViewModel.isLoading {
            Spacer(); ProgressView().tint(RMPGTheme.brandGold); Spacer()
        } else if dlViewModel.results.isEmpty, !searchText.isEmpty {
            Spacer()
            Text("No DL records found").font(.system(size: 12)).foregroundColor(RMPGTheme.textMuted)
            Spacer()
        } else {
            List(dlViewModel.results) { record in
                NavigationLink(destination: DLRecordDetailView(record: record)) {
                    DLRecordRow(record: record)
                }
                .listRowBackground(RMPGTheme.baseBlack)
                .listRowSeparatorTint(RMPGTheme.borderSubtle)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
    }
}

@MainActor
final class DLRecordsViewModel: ObservableObject {
    @Published var results: [DLRecord] = []
    @Published var isLoading = false
    @Published var error: String?
    private let api: DLRecordsAPI

    init(api: DLRecordsAPI) {
        self.api = api
    }

    func search(query: String) {
        guard !query.isEmpty else { return }
        isLoading = true
        error = nil
        Task {
            do {
                results = try await api.search(query)
            } catch {
                self.error = "DL search failed: \(error.localizedDescription)"
                results = []
            }
            isLoading = false
        }
    }
}

struct DLRecordRow: View {
    let record: DLRecord
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "person.text.rectangle.fill")
                .font(.system(size: 14)).foregroundColor(record.isFlagged ? RMPGTheme.statusRed : RMPGTheme.brandGold)
                .frame(width: 28, height: 28)
                .background((record.isFlagged ? RMPGTheme.statusRed : RMPGTheme.brandGold).opacity(0.1))
                .cornerRadius(4)

            VStack(alignment: .leading, spacing: 2) {
                Text(record.displayName.isEmpty ? "Unknown" : record.displayName)
                    .font(.system(size: 13, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
                HStack(spacing: 6) {
                    if let num = record.dlNumber { Text(num).font(.system(size: 11)).foregroundColor(RMPGTheme.textSecondary) }
                    if let state = record.dlState { Text(state).font(.system(size: 11)).foregroundColor(RMPGTheme.textMuted) }
                }
            }
            Spacer()
            if let status = record.dlStatus {
                StatusBadge(text: status, color: record.isFlagged ? RMPGTheme.statusRed : RMPGTheme.textMuted)
            }
        }
        .padding(.vertical, 2)
    }
}

struct DLRecordDetailView: View {
    let record: DLRecord

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if record.isFlagged {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.triangle.fill")
                        Text("LICENSE STATUS FLAGGED").font(.system(size: 12, weight: .bold))
                    }
                    .foregroundColor(.white)
                    .padding(10).frame(maxWidth: .infinity).background(RMPGTheme.statusRed).cornerRadius(2)
                }

                section("Identity") {
                    fieldRow("Name", record.displayName)
                    fieldRow("Date of Birth", record.dateOfBirth)
                    fieldRow("Gender", record.gender)
                    fieldRow("Race", record.race)
                }
                section("Physical Description") {
                    fieldRow("Height", record.height)
                    fieldRow("Weight", record.weight)
                    fieldRow("Eye Color", record.eyeColor)
                    fieldRow("Hair Color", record.hairColor)
                }
                section("License") {
                    fieldRow("DL Number", record.dlNumber)
                    fieldRow("State", record.dlState)
                    fieldRow("Class", record.dlClass)
                    fieldRow("Status", record.dlStatus)
                    fieldRow("Expiration", record.dlExpiration)
                    fieldRow("Issue Date", record.dlIssueDate)
                    fieldRow("Restrictions", record.dlRestrictions)
                    fieldRow("Endorsements", record.dlEndorsements)
                }
                if let addresses = record.addresses, !addresses.isEmpty {
                    section("Addresses") {
                        ForEach(Array(addresses.enumerated()), id: \.offset) { _, addr in
                            fieldRow("Address", [addr.address, addr.city, addr.state, addr.postalCode].compactMap { $0 }.joined(separator: ", "))
                        }
                    }
                }
            }
            .padding(16)
        }
        .background(RMPGTheme.baseBlack.ignoresSafeArea())
        .navigationTitle(record.displayName.isEmpty ? "DL Record" : record.displayName)
        .navigationBarTitleDisplayMode(.inline)
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
            HStack {
                Text(label).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted).frame(width: 100, alignment: .leading)
                Text(value).font(.system(size: 12)).foregroundColor(RMPGTheme.textPrimary)
                Spacer()
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
        }
    }
}

@MainActor
final class RecordsViewModel: ObservableObject {
    @Published var results: [SubjectResult] = []
    @Published var isLoading = false
    @Published var error: String?

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    /// GET /api/records/search?q=...&type=person|vehicle|business
    /// (src/routes/records.ts) — the real universal search, one type per
    /// call. A prior version hit a nonexistent `/api/records/subjects/search`
    /// wrapped in `{results:[...]}`, which doesn't exist on the response
    /// either — search has never returned a single result. Every row here
    /// includes a server-synthesized `label` (never a bare numeric id).
    /// The three types run concurrently, matching the placeholder text
    /// ("persons, vehicles, businesses") rather than a single unscoped call.
    func search(query: String) {
        guard !query.isEmpty else { return }
        isLoading = true
        error = nil
        Task {
            async let persons = fetch(type: "person", query: query)
            async let vehicles = fetch(type: "vehicle", query: query)
            async let businesses = fetch(type: "business", query: query)
            let all = await [persons, vehicles, businesses]
            results = all.flatMap { $0 }
            isLoading = false
        }
    }

    private func fetch(type: String, query: String) async -> [SubjectResult] {
        do {
            let rows: [RecordSearchRow] = try await client.request(Endpoint(
                path: "/api/records/search",
                queryItems: [URLQueryItem(name: "q", value: query), URLQueryItem(name: "type", value: type)]
            ))
            return rows.map { SubjectResult(id: $0.id, type: type, name: $0.label, detail: nil) }
        } catch {
            self.error = "Search failed: \(error.localizedDescription)"
            return []
        }
    }
}

/// The server synthesizes a `label` on every row regardless of entity type
/// (see records.ts's `/search` handler) — that's the only field this view
/// needs, so decoding just `{id, label}` is robust across person/vehicle/
/// business rows even though their other columns differ entirely.
private struct RecordSearchRow: Codable, Sendable {
    let id: Int
    let label: String?
}

public struct SubjectResult: Codable, Identifiable, Sendable {
    public let id: Int
    public let type: String
    public let name: String?
    public let detail: String?

    public var entityType: String { type }
}

struct RecordRow: View {
    let result: SubjectResult

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: result.entityType == "person" ? "person.fill" :
                    result.entityType == "vehicle" ? "car.fill" : "building.2.fill")
                .font(.system(size: 14))
                .foregroundColor(RMPGTheme.brandGold)
                .frame(width: 28, height: 28)
                .background(RMPGTheme.brandGold.opacity(0.1))
                .cornerRadius(4)

            VStack(alignment: .leading, spacing: 2) {
                Text(result.name ?? "Unknown")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(RMPGTheme.textPrimary)
                if let detail = result.detail {
                    Text(detail)
                        .font(.system(size: 11))
                        .foregroundColor(RMPGTheme.textSecondary)
                }
            }

            Spacer()

            StatusBadge(text: result.entityType, color: RMPGTheme.textMuted)
        }
        .padding(.vertical, 2)
    }
}
