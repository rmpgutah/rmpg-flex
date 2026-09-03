import Foundation


@MainActor
public final class OfflineSync: ObservableObject {
    @Published public var pendingCount = 0
    @Published public var lastSync: Date?

    private let apiClient: APIClient
    // `UserDefaults(suiteName:)` returns nil if the named App Group isn't
    // actually provisioned — force-unwrapping it crashed the instant this
    // class was instantiated, because `com.apple.security.application-groups`
    // in the entitlements is an empty array (no App Group capability set up
    // at all; the suite name here didn't even match the group ID used
    // elsewhere in the app — see PersistentAuth.swift's identical bug, fixed
    // the same way). Falls back to the app's own standard defaults, which
    // needs no special entitlement and always works; only revisit a shared
    // suite once a real App Group is provisioned for cross-target access.
    private let defaults = UserDefaults(suiteName: "group.us.rmpgutah.rmpgflex") ?? .standard
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
                // `item.payload` is `[String: AnyCodable]`, a custom Codable
                // struct — `JSONSerialization.data(withJSONObject:)` only
                // accepts plain Foundation types (NSNumber/NSString/NSArray/
                // NSDictionary/NSNull) and throws on anything else, so this
                // always failed here regardless of what AnyCodable's own
                // (now-fixed) Codable conformance does. `JSONEncoder` is the
                // correct encoder for an actual Codable value.
                let body = try JSONEncoder().encode(item.payload)
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

/// A real JSON-value box — a prior version's `encode(to:)` was a no-op and
/// `init(from:)` unconditionally hardcoded `0` regardless of what was
/// actually stored, so every offline-queued action lost its entire payload
/// the moment it round-tripped through `saveQueue`/`loadQueue` (i.e. on
/// every single app relaunch while an action was still queued/retrying) —
/// silent, total data loss for exactly the actions this type exists to
/// protect from being lost.
public struct AnyCodable: Codable, @unchecked Sendable {
    public let value: Any
    public init(_ value: Any) { self.value = value }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let v = try? container.decode(Bool.self) { value = v }
        else if let v = try? container.decode(Int.self) { value = v }
        else if let v = try? container.decode(Double.self) { value = v }
        else if let v = try? container.decode(String.self) { value = v }
        else if let v = try? container.decode([AnyCodable].self) { value = v.map { $0.value } }
        else if let v = try? container.decode([String: AnyCodable].self) { value = v.mapValues { $0.value } }
        else if container.decodeNil() { value = NSNull() }
        else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported AnyCodable value") }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let v as Bool: try container.encode(v)
        case let v as Int: try container.encode(v)
        case let v as Double: try container.encode(v)
        case let v as String: try container.encode(v)
        case let v as [Any]: try container.encode(v.map { AnyCodable($0) })
        case let v as [String: Any]: try container.encode(v.mapValues { AnyCodable($0) })
        case is NSNull: try container.encodeNil()
        default:
            throw EncodingError.invalidValue(value, EncodingError.Context(codingPath: encoder.codingPath, debugDescription: "Unsupported AnyCodable value"))
        }
    }
}
