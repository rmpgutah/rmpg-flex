import SwiftUI



/// Mirrors `warrants` (migrations/0001_initial_schema.sql). A prior version
/// invented `personId`/`firstName`/`lastName`/`charge`/`bond`/`issuedAt` —
/// none of those are real columns (there's no per-warrant person link at
/// all; the subject is a free-text `subject_name`, not split first/last).
/// Every field below decoded to silent nil against real data, so every
/// warrant row showed a blank name, blank charge, and blank bond amount.
public struct Warrant: Codable, Identifiable, Sendable {
    public let id: Int
    public let warrantNumber: String?
    public let type: String?
    public let subjectName: String?
    public let offense: String?
    public let bondAmount: Double?
    public let court: String?
    public let judge: String?
    public let status: String?
    public let issuedDate: String?
    public let expiryDate: String?
}

public struct WarrantsView: View {
    @StateObject private var vm: WarrantsViewModel
    @State private var searchText = ""

    public init(apiClient: APIClient = APIClient(baseURL: Endpoint.productionBaseURL)) {
        _vm = StateObject(wrappedValue: WarrantsViewModel(client: apiClient))
    }

    public var body: some View {
        NavigationStack {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 0) {
                PanelTitleBar(title: "Warrants", icon: "doc.text.magnifyingglass")
                RMPGDivider()
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.system(size: 11)).foregroundColor(RMPGTheme.textMuted)
                    // Client-side filter, not a server search — GET /api/warrants
                    // has no "q"/name-search query param at all (verified against
                    // src/routes/warrants.ts; the router's own file header notes
                    // "CRUD warrant routes... stay on the legacy server until the
                    // full warrants subsystem is migrated"). A prior version sent
                    // ?q=... to the server, which silently ignored it and just
                    // returned the same unfiltered page every time — the search
                    // box looked functional but did nothing. Filtering the already
                    // -loaded page locally at least does what's visibly promised.
                    TextField("Filter by name, offense, or warrant #...", text: $searchText)
                        .font(.system(size: 11)).foregroundColor(RMPGTheme.textPrimary)
                }
                .padding(8).background(RMPGTheme.sunkenSurface).cornerRadius(2)
                .padding(.horizontal, 12).padding(.vertical, 6).background(RMPGTheme.raisedSurface)
                RMPGDivider()

                HStack(spacing: 8) {
                    RMPGPrimaryButton(title: "SCAN UTAH", isLoading: vm.isScanning) {
                        Task { await vm.triggerUtahScan() }
                    }
                    filterChip("All", nil); filterChip("Active", "active")
                    filterChip("Served", "served"); filterChip("Recalled", "recalled")
                }
                .padding(.horizontal, 12).padding(.vertical, 6).background(RMPGTheme.raisedSurface)
                RMPGDivider()

                if vm.isLoading { Spacer(); ProgressView().tint(RMPGTheme.brandGold); Spacer() }
                else if let err = vm.error {
                    Spacer()
                    Text(err).font(.system(size: 12)).foregroundColor(RMPGTheme.statusRed)
                    Spacer()
                } else {
                    List(vm.filtered(filter: vm.filter, search: searchText)) { w in
                        NavigationLink(destination: WarrantDetailView(warrant: w)) {
                            WarrantRow(w: w)
                        }
                        .listRowBackground(RMPGTheme.baseBlack)
                        .listRowSeparatorTint(RMPGTheme.borderSubtle)
                    }
                    .listStyle(.plain).scrollContentBackground(.hidden)
                }
            }
        }
        }
        .onAppear { Task { await vm.refresh() } }
    }

    func filterChip(_ label: String, _ value: String?) -> some View {
        Button { vm.filter = value; vm.refresh() } label: {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(vm.filter == value ? RMPGTheme.brandGold : RMPGTheme.textMuted)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(vm.filter == value ? RMPGTheme.brandGold.opacity(0.1) : Color.clear)
                .cornerRadius(2)
        }
    }
}

@MainActor
final class WarrantsViewModel: ObservableObject {
    @Published var warrants: [Warrant] = []
    @Published var isLoading = false
    @Published var isScanning = false
    @Published var error: String?
    @Published var filter: String?
    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func refresh() {
        isLoading = true
        Task {
            do {
                var items: [URLQueryItem] = []
                if let f = filter { items.append(URLQueryItem(name: "status", value: f)) }
                let r: WarrantList = try await client.request(Endpoint(path: "/api/warrants", queryItems: items))
                warrants = r.data
                error = nil
            } catch let e {
                self.error = e.localizedDescription
            }
            isLoading = false
        }
    }

    func search(query: String) async {
        isLoading = true
        do {
            let r: WarrantList = try await client.request(Endpoint(
                path: "/api/warrants", queryItems: [URLQueryItem(name: "q", value: query)]
            ))
            warrants = r.data; self.error = nil
        } catch let e { self.error = e.localizedDescription }
        isLoading = false
    }

    func triggerUtahScan() async {
        isScanning = true
        do {
            try await client.requestVoid(Endpoint(path: "/api/warrants/utah-scan", method: .post))
            self.error = nil
        } catch let e { self.error = "Scan failed: \(e.localizedDescription)" }
        isScanning = false
    }

    func filtered(filter: String?, search: String = "") -> [Warrant] {
        var result = warrants
        if let f = filter {
            result = result.filter { ($0.status ?? "").lowercased() == f }
        }
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        if !q.isEmpty {
            result = result.filter {
                ($0.subjectName?.lowercased().contains(q) ?? false)
                    || ($0.offense?.lowercased().contains(q) ?? false)
                    || ($0.warrantNumber?.lowercased().contains(q) ?? false)
            }
        }
        return result
    }

    // Real GET /api/warrants response is {data:[...], pagination:{...}}
    // (src/routes/warrants.ts) — a prior version of this decoded {results:[...]},
    // which doesn't exist on the response, so the Warrants list never populated.
    struct WarrantList: Codable, Sendable { let data: [Warrant] }
}

struct WarrantRow: View {
    let w: Warrant
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                StatusBadge(text: w.type ?? "WARRANT", color: RMPGTheme.brandGold)
                StatusBadge(text: (w.status ?? "active").replacingOccurrences(of: "_", with: " ").capitalized, color: RMPGTheme.textSecondary)
                Spacer()
                if let n = w.warrantNumber { Text("#\(n)").font(.system(size: 10)).foregroundColor(RMPGTheme.brandGold) }
            }
            Text(w.subjectName ?? "Unknown Subject")
                .font(.system(size: 13, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
            Text(w.offense ?? "Unknown offense")
                .font(.system(size: 11)).foregroundColor(RMPGTheme.textSecondary)
            HStack {
                if let b = w.bondAmount { Text("Bond: $\(Int(b))").font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted) }
                Spacer()
                if let c = w.court { Text(c).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted) }
            }
        }
        .padding(.vertical, 4)
    }
}

/// Full detail for a tapped warrant. No extra fetch needed — GET /api/warrants
/// already returns bare `SELECT *` rows (verified against src/routes/warrants.ts),
/// so every field the list has is already everything the server has; there's
/// no per-id detail endpoint on this router to call for "more."
struct WarrantDetailView: View {
    let warrant: Warrant

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    StatusBadge(text: warrant.type ?? "WARRANT", color: RMPGTheme.brandGold)
                    StatusBadge(text: (warrant.status ?? "active").replacingOccurrences(of: "_", with: " ").capitalized, color: RMPGTheme.textSecondary)
                    Spacer()
                }
                Text(warrant.subjectName ?? "Unknown Subject")
                    .font(.system(size: 18, weight: .bold)).foregroundColor(RMPGTheme.textPrimary)

                section("Warrant") {
                    fieldRow("Warrant #", warrant.warrantNumber)
                    fieldRow("Type", warrant.type)
                    fieldRow("Status", warrant.status?.replacingOccurrences(of: "_", with: " ").capitalized)
                    fieldRow("Offense", warrant.offense)
                    fieldRow("Bond Amount", warrant.bondAmount.map { "$\(Int($0))" })
                }
                section("Court") {
                    fieldRow("Court", warrant.court)
                    fieldRow("Judge", warrant.judge)
                }
                section("Dates") {
                    fieldRow("Issued", warrant.issuedDate.map { String($0.prefix(10)) })
                    fieldRow("Expires", warrant.expiryDate.map { String($0.prefix(10)) })
                }
            }
            .padding(16)
        }
        .background(RMPGTheme.baseBlack.ignoresSafeArea())
        .navigationTitle(warrant.subjectName ?? "Warrant")
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
