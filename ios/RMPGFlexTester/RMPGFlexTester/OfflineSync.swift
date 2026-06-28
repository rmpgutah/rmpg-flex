import Foundation
import Combine

// App-wide offline store-and-forward coordinator. Owns the queue badge count,
// and auto-replays the queue the moment connectivity returns (no manual flush).
@MainActor
final class OfflineSync: ObservableObject {
    static let shared = OfflineSync()

    @Published private(set) var queueCount = OfflineQueue.count + OfflinePhotoQueue.count
    @Published var lastResult: String?

    private var cancellables = Set<AnyCancellable>()

    private init() {
        Connectivity.shared.$isOnline
            .removeDuplicates()
            .sink { [weak self] online in if online { Task { await self?.flush() } } }
            .store(in: &cancellables)
    }

    /// Queue a write that failed in a dead zone, then refresh the badge.
    func enqueue(method: String, path: String, body: [String: Any], label: String) {
        OfflineQueue.enqueue(method: method, path: path, body: body, label: label)
        queueCount = OfflineQueue.count
    }

    func refreshCount() { queueCount = OfflineQueue.count + OfflinePhotoQueue.count }

    /// Replay anything queued — JSON writes then staged photos. Safe to call repeatedly.
    func flush() async {
        guard (OfflineQueue.count + OfflinePhotoQueue.count) > 0,
              let client = await authedClient() else { refreshCount(); return }
        let r1 = await OfflineQueue.flush(using: client)
        let r2 = await OfflinePhotoQueue.flush(using: client)
        refreshCount()
        let sent = r1.sent.count + r2.sent.count
        let rejected = r1.rejected.count + r2.rejected.count
        if sent > 0 || rejected > 0 {
            lastResult = OfflineSyncLogic.summary(sent: sent, rejected: rejected)
        }
    }
}

/// Try a JSON write; on a dead-zone error, queue it for automatic replay.
/// Returns a human status string (✓ done / ⚠ queued / ✗ error).
@MainActor
func sendOrQueue(method: String, path: String, body: [String: Any], label: String) async -> String {
    let err = await authedRetrying { c in
        try await c.requestJSON(method, path, body: body.isEmpty ? nil : body)
    }
    guard let err else { return "✓ \(label)" }
    if OfflineSyncLogic.shouldQueue(err) {
        OfflineSync.shared.enqueue(method: method, path: path, body: body, label: label)
        return "⚠ Offline — \(label) queued"
    }
    return "✗ \(err.localizedDescription)"
}
