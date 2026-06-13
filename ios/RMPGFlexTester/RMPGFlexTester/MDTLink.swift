import Foundation
import Combine

// The phone end of the MDT link. Polls /api/mdt/inbox for messages pushed from
// the in-vehicle desktop MDT and reports whether that terminal is online; sends
// items the other way via /api/mdt/send. Polling matches the server channel
// (the rewrite WebSocket is dead — see project memory).
@MainActor
final class MDTLink: ObservableObject {
    static let shared = MDTLink()

    @Published private(set) var online = false           // vehicle MDT online?
    @Published private(set) var inbox: [MDTMessage] = []  // newest first
    @Published private(set) var unreadCount = 0

    private var polling = false

    func startPolling() {
        guard !polling else { return }
        polling = true
        Task { await loop() }
    }

    private func loop() async {
        while polling {
            await pollOnce()
            try? await Task.sleep(for: .seconds(8))
        }
    }

    func pollOnce() async {
        var parsed: (messages: [MDTMessage], online: Bool)?
        _ = await authedRetrying { c in
            if let obj = try await c.requestJSON("GET", "api/mdt/inbox?endpoint=phone") as? [String: Any] {
                parsed = MDTInbox.parse(obj)
            }
        }
        guard let parsed else { return }
        online = parsed.online
        if !parsed.messages.isEmpty {
            inbox.insert(contentsOf: parsed.messages, at: 0)
            unreadCount += parsed.messages.count
        }
    }

    func markRead() { unreadCount = 0 }

    /// Push a typed item to the vehicle MDT. Returns true on success.
    @discardableResult
    func send(type: String, payload: [String: Any]) async -> Bool {
        let body: [String: Any] = ["to": "mdt", "type": type, "payload": payload]
        let err = await authedRetrying { c in
            try await c.requestJSON("POST", "api/mdt/send", body: body)
        }
        if let err {
            // Dead zone → queue for auto-replay; treat as accepted.
            if OfflineSyncLogic.shouldQueue(err) {
                OfflineSync.shared.enqueue(method: "POST", path: "api/mdt/send", body: body, label: "MDT \(type)")
                return true
            }
            return false
        }
        return true
    }
}
