import SwiftUI
import CoreAPI
import DesignSystem

public struct ServeJob: Codable, Identifiable, Sendable {
    public let id: Int
    public let recipient: String?
    public let address: String?
    public let documentType: String?
    public let priority: String?
    public let status: String?
    public let deadline: String?
    public let attemptCount: Int?
    public let createdAt: String?
}

public struct ServeView: View {
    @StateObject private var vm = ServeViewModel()
    @State private var filter = "all"

    public init() {}

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 0) {
                PanelTitleBar(title: "Process Serve", icon: "envelope.fill")
                RMPGDivider()
                HStack(spacing: 4) {
                    filterChip("All", "all"); filterChip("Pending", "pending")
                    filterChip("Active", "active"); filterChip("Served", "served")
                    filterChip("Overdue", "overdue")
                    Spacer()
                }
                .padding(.horizontal, 12).padding(.vertical, 6).background(RMPGTheme.raisedSurface)
                RMPGDivider()

                if vm.isLoading { Spacer(); ProgressView().tint(RMPGTheme.brandGold); Spacer() }
                else {
                    List(vm.filtered(filter: filter)) { job in
                        ServeRow(job: job)
                            .listRowBackground(RMPGTheme.baseBlack)
                            .listRowSeparatorTint(RMPGTheme.borderSubtle)
                    }
                    .listStyle(.plain).scrollContentBackground(.hidden)
                    .refreshable { await vm.refresh() }
                }
            }
        }
        .onAppear { Task { await vm.refresh() } }
    }

    func filterChip(_ label: String, _ value: String) -> some View {
        Button { filter = value } label: {
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
final class ServeViewModel: ObservableObject {
    @Published var jobs: [ServeJob] = []
    @Published var isLoading = false
    private let client = APIClient(baseURL: Endpoint.productionBaseURL)

    func refresh() async {
        isLoading = true
        do {
            let r: ServeList = try await client.request(Endpoint(path: "/api/serve"))
            jobs = r.results
        } catch { print(error) }
        isLoading = false
    }

    func filtered(filter: String) -> [ServeJob] {
        guard filter != "all" else { return jobs }
        return jobs.filter { ($0.status ?? "").lowercased() == filter }
    }

    struct ServeList: Codable, Sendable { let results: [ServeJob] }
}

struct ServeRow: View {
    let job: ServeJob
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                if let p = job.priority { StatusBadge.priority(p) }
                StatusBadge(text: (job.status ?? "pending").replacingOccurrences(of: "_", with: " "), color: RMPGTheme.textSecondary)
                Spacer()
                if let a = job.attemptCount, a > 0 {
                    Text("\(a) attempt\(a == 1 ? "" : "s")").font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted)
                }
            }
            Text(job.recipient ?? "Unknown Recipient")
                .font(.system(size: 13, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
            HStack(spacing: 4) {
                Image(systemName: "location.fill").font(.system(size: 9)).foregroundColor(RMPGTheme.statusRed)
                Text(job.address ?? "No address").font(.system(size: 11)).foregroundColor(RMPGTheme.textSecondary)
            }
            HStack {
                Text(job.documentType ?? "Document").font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted)
                Spacer()
                if let d = job.deadline {
                    Text("Due: \(String(d.prefix(10)))").font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
