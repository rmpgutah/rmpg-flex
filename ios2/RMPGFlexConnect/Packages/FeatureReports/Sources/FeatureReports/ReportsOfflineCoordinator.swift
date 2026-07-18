import Foundation
import SwiftData
import Observation
import CoreOffline
import CoreAuth

/// Wires report-submission views in `FeatureReports` into `CoreOffline`'s outbox.
///
/// Every submit goes through `submitJSON`: it tries a live POST first, and if the
/// device is offline (or the live attempt fails for any network reason), the
/// request is queued in the SwiftData-backed outbox instead of failing hard. The
/// outbox is drained automatically whenever `NWPathMonitor` reports connectivity
/// restored (`OfflineManager.startMonitoring`), and `refresh()` opportunistically
/// re-checks + drains too (call it from `.task`/`.onAppear`).
@MainActor
@Observable
public final class ReportsOfflineCoordinator {
    public static let shared = ReportsOfflineCoordinator()

    /// What happened to a submitted report.
    public enum SubmitOutcome: Equatable {
        case sentLive
        case queuedOffline
    }

    private let modelContainer: ModelContainer
    private let offlineManager: OfflineManager
    private let apiBaseURL = URL(string: "https://api.rmpgutah.us")!

    /// Best-known connectivity state. Updated by `refresh()` and the path monitor.
    public private(set) var isOnline: Bool = true
    /// Count of not-yet-sent (and not permanently failed) queued reports.
    public private(set) var pendingCount: Int = 0

    private init() {
        let schema = Schema([OutboxEntry.self])
        let container: ModelContainer
        if let onDisk = try? ModelContainer(for: schema, configurations: [ModelConfiguration(schema: schema)]) {
            container = onDisk
        } else if let inMemory = try? ModelContainer(
            for: schema,
            configurations: [ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)]
        ) {
            // Disk store unavailable (e.g. sandbox issue) — degrade to in-memory rather than crash.
            container = inMemory
        } else {
            fatalError("ReportsOfflineCoordinator: unable to create any SwiftData ModelContainer for OutboxEntry")
        }
        self.modelContainer = container
        self.offlineManager = OfflineManager(
            modelContainer: container,
            apiBaseURL: apiBaseURL,
            tokenProvider: { KeychainStore.get(AuthSession.tokenKey) }
        )

        pendingCount = fetchPendingCount()
        Task { [weak self] in await self?.bootstrap() }
    }

    private func bootstrap() async {
        await offlineManager.startMonitoring()
        await refresh()
    }

    /// Re-check connectivity, drain the outbox if we're online, and refresh `pendingCount`.
    /// Safe to call as often as needed (e.g. view `.task`, pull-to-refresh, post-submit).
    public func refresh() async {
        isOnline = await offlineManager.isOnline
        if isOnline {
            await offlineManager.drainIfNeeded()
        }
        pendingCount = fetchPendingCount()
    }

    /// Submit a JSON report. Tries live first; on failure (or if already offline),
    /// queues it in the outbox for automatic replay on reconnect.
    @discardableResult
    public func submitJSON(endpoint: String, method: String = "POST", json: [String: Any]) async -> SubmitOutcome {
        let body = try? JSONSerialization.data(withJSONObject: json)

        if isOnline, await attemptLive(endpoint: endpoint, method: method, body: body) {
            await refresh()
            return .sentLive
        }

        enqueue(endpoint: endpoint, method: method, body: body)
        await refresh()
        return .queuedOffline
    }

    private func attemptLive(endpoint: String, method: String, body: Data?) async -> Bool {
        guard let url = URL(string: endpoint, relativeTo: apiBaseURL) else { return false }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = KeychainStore.get(AuthSession.tokenKey) {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = body
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return false }
            return (200...299).contains(http.statusCode)
        } catch {
            // Any transport-level failure (no connection, timeout, DNS, etc.) falls
            // through to the offline queue rather than surfacing an error to the user.
            return false
        }
    }

    private func enqueue(endpoint: String, method: String, body: Data?) {
        let entry = OutboxEntry(endpoint: endpoint, method: method, body: body)
        let context = ModelContext(modelContainer)
        context.insert(entry)
        try? context.save()
    }

    private func fetchPendingCount() -> Int {
        let context = ModelContext(modelContainer)
        let descriptor = FetchDescriptor<OutboxEntry>(predicate: #Predicate { !$0.isFailed })
        return (try? context.fetchCount(descriptor)) ?? 0
    }
}
