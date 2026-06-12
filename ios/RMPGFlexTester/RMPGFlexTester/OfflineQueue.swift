import Foundation

// Store-and-forward for field actions taken in dead zones. Transport-level
// failures (no signal) enqueue here; anything with an HTTP status is a real
// server answer and is NOT queued (a 400 won't fix itself by retrying).
struct QueuedAction: Codable, Identifiable {
    let id: UUID
    let method: String
    let path: String
    let body: [String: String]   // string-coerced for Codable simplicity
    let label: String
    let queuedAt: Date
}

enum OfflineQueue {
    private static let key = "offlineActionQueue"

    static func all() -> [QueuedAction] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([QueuedAction].self, from: data)) ?? []
    }

    static var count: Int { all().count }

    static func enqueue(method: String, path: String, body: [String: Any], label: String) {
        var list = all()
        let coerced = body.mapValues { "\($0)" }
        list.append(QueuedAction(id: UUID(), method: method, path: path,
                                 body: coerced, label: label, queuedAt: Date()))
        save(list)
    }

    /// True when the error is a connectivity failure worth retrying later.
    static func isTransport(_ error: Error) -> Bool {
        (error as NSError).domain == NSURLErrorDomain
    }

    /// Replays the queue in order; stops at the first transport failure
    /// (still offline). Server rejections are dropped with their label
    /// returned so the officer knows what needs manual follow-up.
    static func flush(using client: RMPGAPIClient) async -> (sent: [String], rejected: [String]) {
        var sent: [String] = [], rejected: [String] = []
        var remaining = all()
        while let action = remaining.first {
            do {
                try await client.requestJSON(action.method, action.path,
                                             body: action.body.isEmpty ? nil : action.body)
                sent.append(action.label)
                remaining.removeFirst()
            } catch where isTransport(error) {
                break   // still offline — keep the rest queued
            } catch {
                rejected.append("\(action.label): \(error.localizedDescription)")
                remaining.removeFirst()
            }
            save(remaining)
        }
        save(remaining)
        return (sent, rejected)
    }

    private static func save(_ list: [QueuedAction]) {
        if let data = try? JSONEncoder().encode(list) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }
}
