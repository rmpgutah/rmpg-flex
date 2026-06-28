import Foundation

// Store-and-forward for field actions taken in dead zones. Transport-level
// failures (no signal) enqueue here; anything with an HTTP status is a real
// server answer and is NOT queued (a 400 won't fix itself by retrying).
//
// The body is stored as full-fidelity JSON (not string-coerced) so nested
// payloads — e.g. an MDT send's {payload:{…}} — replay correctly.
struct QueuedAction: Codable, Identifiable {
    let id: UUID
    let method: String
    let path: String
    let bodyJSON: String
    let label: String
    let queuedAt: Date
}

enum OfflineQueue {
    private static let key = "offlineActionQueue.v2"

    static func all() -> [QueuedAction] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([QueuedAction].self, from: data)) ?? []
    }

    static var count: Int { all().count }

    static func enqueue(method: String, path: String, body: [String: Any], label: String) {
        var list = all()
        let json = (try? JSONSerialization.data(withJSONObject: body))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        list.append(QueuedAction(id: UUID(), method: method, path: path,
                                 bodyJSON: json, label: label, queuedAt: Date()))
        save(list)
    }

    /// True when the error is a connectivity failure worth retrying later.
    static func isTransport(_ error: Error) -> Bool { OfflineSyncLogic.shouldQueue(error) }

    /// Replays the queue in order; stops at the first transport failure (still
    /// offline). Server rejections are dropped with their label returned so the
    /// officer knows what needs manual follow-up.
    static func flush(using client: RMPGAPIClient) async -> (sent: [String], rejected: [String]) {
        var sent: [String] = [], rejected: [String] = []
        var remaining = all()
        while let action = remaining.first {
            let body = action.bodyJSON.data(using: .utf8)
                .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? nil
            do {
                try await client.requestJSON(action.method, action.path,
                                             body: (body?.isEmpty ?? true) ? nil : body)
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
