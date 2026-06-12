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
        sections = out
    }
}
