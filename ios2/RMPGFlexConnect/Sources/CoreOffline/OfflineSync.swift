import Foundation
import CoreAPI

@MainActor
public final class OfflineSync: ObservableObject {
    @Published public var pendingCount = 0
    @Published public var lastSync: Date?

    private let apiClient: APIClient
    private let defaults = UserDefaults(suiteName: "group.us.rmpgutah.rmpgflex")!
    private let queueKey = "offline_sync_queue"
    private let maxRetries = 3

    public init(apiClient: APIClient) {
        self.apiClient = apiClient
        loadQueue()
    }

    public func enqueue(_ item: OfflineAction) {
        var queue = loadQueue()
        queue.append(item)
        saveQueue(queue)
        pendingCount = queue.count
        Task { await processQueue() }
    }

    public func processQueue() async {
        var queue = loadQueue()
        guard !queue.isEmpty else { return }

        let batch = queue
        queue.removeAll()
        saveQueue(queue)

        for item in batch {
            do {
                let body = try JSONSerialization.data(withJSONObject: item.payload)
                try await apiClient.requestVoid(Endpoint(
                    path: item.path,
                    method: Endpoint.HTTPMethod(rawValue: item.method) ?? .post,
                    body: body
                ))
            } catch {
                if item.retryCount < maxRetries {
                    var retry = item
                    retry.retryCount += 1
                    queue.append(retry)
                }
            }
        }

        saveQueue(queue)
        pendingCount = queue.count
        lastSync = Date()
    }

    private func loadQueue() -> [OfflineAction] {
        guard let data = defaults.data(forKey: queueKey),
              let queue = try? JSONDecoder().decode([OfflineAction].self, from: data) else {
            return []
        }
        return queue
    }

    private func saveQueue(_ queue: [OfflineAction]) {
        if let data = try? JSONEncoder().encode(queue) {
            defaults.set(data, forKey: queueKey)
        }
    }
}

public struct OfflineAction: Codable, Sendable {
    public let path: String
    public let method: String
    public let payload: [String: AnyCodable]
    public var retryCount: Int
    public let timestamp: Date

    public init(path: String, method: String, payload: [String: AnyCodable], retryCount: Int = 0) {
        self.path = path
        self.method = method
        self.payload = payload
        self.retryCount = retryCount
        self.timestamp = Date()
    }
}

public struct AnyCodable: Codable, Sendable {
    public let value: Any
    public init(_ value: Any) { self.value = value }
    public init(from decoder: Decoder) throws { self.value = 0 }
    public func encode(to encoder: Encoder) throws {}
}
