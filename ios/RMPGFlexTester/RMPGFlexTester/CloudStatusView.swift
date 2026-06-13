import SwiftUI

// Account-wide Cloudflare overview: Workers, D1, KV, R2, Pages.
struct CloudStatusView: View {
    @State private var sections: [(CloudflareClient.Section, Result<[CFResource], Error>)] = []
    @State private var loading = false

    var body: some View {
        NavigationStack {
            List {
                ForEach(Array(sections.enumerated()), id: \.offset) { _, entry in
                    Section(entry.0.rawValue) {
                        switch entry.1 {
                        case .success(let items) where items.isEmpty:
                            Text("none").font(.system(size: 11)).foregroundStyle(Theme.neutral)
                        case .success(let items):
                            ForEach(items) { item in
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(item.title)
                                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                        .foregroundStyle(.white)
                                    Text(item.subtitle)
                                        .font(.system(size: 9, design: .monospaced))
                                        .foregroundStyle(Theme.neutral)
                                }
                            }
                        case .failure(let err):
                            Text(err.localizedDescription)
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(Theme.orange)
                        }
                    }
                    .listRowBackground(Theme.raised)
                }
                if sections.isEmpty && !loading {
                    Text("Pull to refresh — needs CF credentials in Settings.")
                        .font(.system(size: 11)).foregroundStyle(Theme.neutral)
                        .listRowBackground(Theme.base)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .refreshable { await load() }
            .overlay { if loading && sections.isEmpty { ProgressView().tint(Theme.gold) } }
            .navigationTitle("CLOUDFLARE")
            .navigationBarTitleDisplayMode(.inline)
            .task { if sections.isEmpty { await load() } }
        }
    }

    @MainActor
    private func load() async {
        guard let account = KeychainStore.load(key: "cfAccountId"), !account.isEmpty,
              let token = KeychainStore.load(key: "cfToken"), !token.isEmpty else {
            sections = []
            return
        }
        loading = true
        defer { loading = false }
        let client = CloudflareClient(accountId: account, apiToken: token)
        var out: [(CloudflareClient.Section, Result<[CFResource], Error>)] = []
        for section in CloudflareClient.Section.allCases {
            do { out.append((section, .success(try await client.list(section)))) }
            catch { out.append((section, .failure(error))) }
        }
        // Org-wide fallback: for scope-gated sections the device token can't read
        // (workers/kv/pages), use the RMPG backend /api/cloudflare/resources, which
        // runs the SERVER cf_api_token (set in web Admin → Cloudflare). D1 + R2
        // keep their richer direct-token data. No-op until a server token is set.
        let gated: Set<CloudflareClient.Section> = [.workers, .kv, .pages]
        let anyGatedFailed = out.contains { sec, res in
            gated.contains(sec) && { if case .failure = res { return true } else { return false } }()
        }
        if anyGatedFailed, let backend = await backendResources() {
            out = out.map { sec, res in
                if gated.contains(sec), case .failure = res, let items = backend[sec], !items.isEmpty {
                    return (sec, .success(items))
                }
                return (sec, res)
            }
        }
        sections = out
    }

    // Pull workers/kv/pages from the RMPG backend (server CF token) as a fallback.
    private func backendResources() async -> [CloudflareClient.Section: [CFResource]]? {
        let api = AppConfig.apiClient()
        guard api.jwt != nil,
              let obj = try? await api.requestJSON("GET", "api/cloudflare/resources") as? [String: Any],
              (obj["configured"] as? Bool) == true else { return nil }
        func rows(_ key: String) -> [[String: Any]] { obj[key] as? [[String: Any]] ?? [] }
        var map: [CloudflareClient.Section: [CFResource]] = [:]
        map[.workers] = rows("workers").map { CFResource(id: $0["id"] as? String ?? "?",
            title: $0["id"] as? String ?? "?", subtitle: "via server token") }
        map[.kv] = rows("kv").map { CFResource(id: $0["id"] as? String ?? "?",
            title: $0["title"] as? String ?? "(untitled)", subtitle: "via server token") }
        map[.pages] = rows("pages").map { CFResource(id: $0["name"] as? String ?? "?",
            title: $0["name"] as? String ?? "?", subtitle: ($0["domain"] as? String ?? "") + " · via server token") }
        return map
    }
}
