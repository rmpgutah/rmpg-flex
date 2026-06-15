import Foundation

// App-wide live counts for tab badges + the Home dashboard. Polls the two cheap
// counts every 15s independent of which screen is visible, so the badge is fresh
// even when Home isn't on top. Reuses the shared authedClient() and CountParse.
@MainActor
final class LiveCounts: ObservableObject {
    static let shared = LiveCounts()

    @Published private(set) var activeCalls = 0
    @Published private(set) var unread = 0

    private var polling = false
    private init() {}

    func startPolling() {
        guard !polling else { return }
        polling = true
        Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(15))
            }
        }
    }

    func refresh() async {
        guard let c = await authedClient() else { return }
        if let calls = try? await c.requestJSON("GET", "api/dispatch/calls?status=active") {
            activeCalls = CountParse.rowCount(calls)
        }
        if let u = try? await c.requestJSON("GET", "api/notifications/unread-count") {
            unread = CountParse.intField(u, ["count", "unread", "unread_count", "total"])
        }
    }
}
