import SwiftUI
import CoreAPI
import DesignSystem

public struct Warrant: Codable, Identifiable, Sendable {
    public let id: Int
    public let warrantNumber: String?
    public let type: String?
    public let personId: Int?
    public let firstName: String?
    public let lastName: String?
    public let charge: String?
    public let bond: String?
    public let court: String?
    public let status: String?
    public let issuedAt: String?
}

public struct WarrantsView: View {
    @StateObject private var vm = WarrantsViewModel()
    @State private var searchText = ""

    public init() {}

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 0) {
                PanelTitleBar(title: "Warrants", icon: "doc.text.magnifyingglass")
                RMPGDivider()
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.system(size: 11)).foregroundColor(RMPGTheme.textMuted)
                    TextField("Search by name, charge, or warrant #...", text: $searchText)
                        .font(.system(size: 11)).foregroundColor(RMPGTheme.textPrimary)
                        .onSubmit { Task { await vm.search(query: searchText) } }
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
                    List(vm.filtered(filter: vm.filter)) { w in
                        WarrantRow(w: w)
                            .listRowBackground(RMPGTheme.baseBlack)
                            .listRowSeparatorTint(RMPGTheme.borderSubtle)
                    }
                    .listStyle(.plain).scrollContentBackground(.hidden)
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
    private let client = APIClient(baseURL: Endpoint.productionBaseURL)

    func refresh() {
        isLoading = true
        Task {
            do {
                var items: [URLQueryItem] = []
                if let f = filter { items.append(URLQueryItem(name: "status", value: f)) }
                let r: WarrantList = try await client.request(Endpoint(path: "/api/warrants", queryItems: items))
                warrants = r.results
                error = nil
            } catch {
                error = error.localizedDescription
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
            warrants = r.results; error = nil
        } catch { error = error.localizedDescription }
        isLoading = false
    }

    func triggerUtahScan() async {
        isScanning = true
        do {
            try await client.requestVoid(Endpoint(path: "/api/warrants/utah-scan", method: .post))
            error = nil
        } catch { error = "Scan failed: \(error.localizedDescription)" }
        isScanning = false
    }

    func filtered(filter: String?) -> [Warrant] {
        guard let f = filter else { return warrants }
        return warrants.filter { ($0.status ?? "").lowercased() == f }
    }

    struct WarrantList: Codable, Sendable { let results: [Warrant] }
}

struct WarrantRow: View {
    let w: Warrant
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                StatusBadge(text: w.type ?? "WARRANT", color: RMPGTheme.brandGold)
                StatusBadge(text: (w.status ?? "active").replacingOccurrences(of: "_", with: " "), color: RMPGTheme.textSecondary)
                Spacer()
                if let n = w.warrantNumber { Text("#\(n)").font(.system(size: 10)).foregroundColor(RMPGTheme.brandGold) }
            }
            Text([w.firstName, w.lastName].compactMap { $0 }.joined(separator: " "))
                .font(.system(size: 13, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
            Text(w.charge ?? "Unknown charge")
                .font(.system(size: 11)).foregroundColor(RMPGTheme.textSecondary)
            HStack {
                if let b = w.bond { Text("Bond: $\(b)").font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted) }
                Spacer()
                if let c = w.court { Text(c).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted) }
            }
        }
        .padding(.vertical, 4)
    }
}
