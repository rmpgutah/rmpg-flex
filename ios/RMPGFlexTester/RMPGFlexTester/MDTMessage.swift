import Foundation

// MDT link message + inbox parsing. Foundation-only (unit-tested under the
// SwiftPM harness). MDTLink.swift wires this to the network.

struct MDTMessage: Identifiable {
    let id: Int
    let type: String
    let payload: [String: Any]
    let createdAt: String
}

enum MDTInbox {
    /// Parse a GET /api/mdt/inbox response into messages + counterpart-online.
    static func parse(_ obj: [String: Any]) -> (messages: [MDTMessage], online: Bool) {
        let online = obj["counterpart_online"] as? Bool ?? false
        let raw = obj["messages"] as? [[String: Any]] ?? []
        let messages = raw.compactMap { m -> MDTMessage? in
            guard let id = m["id"] as? Int, let type = m["type"] as? String else { return nil }
            return MDTMessage(id: id, type: type,
                              payload: m["payload"] as? [String: Any] ?? [:],
                              createdAt: m["created_at"] as? String ?? "")
        }
        return (messages, online)
    }

    /// A short human label for an inbound message (drives the inbox row).
    static func label(for type: String) -> String {
        switch type {
        case "call": return "Respond to call"
        case "nav": return "Navigate to location"
        case "location": return "Location from MDT"
        case "text": return "Message from MDT"
        case "draft": return "Open draft"
        case "person": return "Person from MDT"
        case "plate": return "Plate from MDT"
        case "scan": return "Scan from MDT"
        default: return type.capitalized
        }
    }
}
