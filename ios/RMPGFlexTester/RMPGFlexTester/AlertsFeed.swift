import Foundation

// Pure-logic core for the Live Alerts feed (Situational Awareness). Aggregates
// three live, NON-consuming sources — assigned/active dispatch calls,
// notifications (which already carry the per-minute watchlist cron hits), and
// active BOLOs — into one severity-ranked stream. Foundation-only so it builds +
// unit-tests on the macOS host. (The MDT inbox is intentionally excluded: its
// GET consumes messages and is owned by MDTInboxView.)

enum AlertKind: String {
    case call, bolo, notification, watchlist

    var icon: String {
        switch self {
        case .call: return "phone.fill"
        case .bolo: return "eye.fill"
        case .notification: return "bell.fill"
        case .watchlist: return "binoculars.fill"
        }
    }
}

enum AlertSeverity: Int, Comparable {
    case normal = 0, high = 1, critical = 2
    static func < (a: AlertSeverity, b: AlertSeverity) -> Bool { a.rawValue < b.rawValue }
    /// Color-token name the view maps to a Theme color.
    var tone: String {
        switch self { case .critical: return "red"; case .high: return "orange"; case .normal: return "gold" }
    }
}

struct AlertItem: Identifiable, Equatable {
    let id: String            // "kind:sourceid" — stable dedup key
    let kind: AlertKind
    let severity: AlertSeverity
    let title: String
    let subtitle: String
    let epoch: Double         // sort key (seconds since 1970; 0 if unknown)
    let unread: Bool
    let personId: Int?        // tap-target deep links (nil when not applicable)
    let callId: Int?
}

enum AlertsFeed {
    // ── Severity mapping ─────────────────────────────────────
    /// Map a free-form priority string (P1…P4 / "critical" / "high" / "1") to severity.
    static func severity(priority: String) -> AlertSeverity {
        let p = priority.lowercased()
        if p.contains("p1") || p.contains("critical") || p.contains("emergency") || p == "1" { return .critical }
        if p.contains("p2") || p.contains("high") || p == "2" { return .high }
        return .normal
    }

    // ── Source builders ──────────────────────────────────────
    /// Active dispatch calls. The officer's own assigned call is bumped to at
    /// least HIGH and marked unread so it never sinks below routine traffic.
    static func fromCalls(_ rows: [[String: Any]], myCallId: Int?) -> [AlertItem] {
        rows.compactMap { row in
            guard let id = intValue(row["id"] ?? row["call_id"]) else { return nil }
            let pri = str(row, ["priority", "priority_level"])
            var sev = severity(priority: pri)
            let mine = (myCallId != nil && id == myCallId)
            if mine { sev = max(sev, .high) }
            let number = str(row, ["call_number", "number"])
            let type = str(row, ["call_type", "type", "nature"])
            let title = [number, type].filter { !$0.isEmpty }.joined(separator: " · ")
            return AlertItem(
                id: "call:\(id)", kind: .call, severity: sev,
                title: title.isEmpty ? "Call #\(id)" : title,
                subtitle: str(row, ["address", "location", "common_name"]),
                epoch: epoch(row["created_at"] ?? row["received_at"]),
                unread: mine, personId: nil, callId: id)
        }
    }

    /// Notifications — also the channel watchlist cron hits arrive on. A type
    /// mentioning "watch" is reclassified to `.watchlist` so intel hits read
    /// distinctly in the feed.
    static func fromNotifications(_ rows: [[String: Any]]) -> [AlertItem] {
        rows.compactMap { row in
            guard let id = intValue(row["id"]) else { return nil }
            let type = str(row, ["type", "category"]).lowercased()
            let kind: AlertKind = type.contains("watch") ? .watchlist : .notification
            let title = firstNonEmpty(str(row, ["title", "subject"]), label(type))
            let body = str(row, ["message", "body", "content"])
            let entity = str(row, ["entity_type", "subject_type"]).lowercased()
            let entityId = intValue(row["entity_id"] ?? row["subject_id"])
            return AlertItem(
                id: "notification:\(id)", kind: kind,
                severity: severity(priority: str(row, ["priority", "severity"])),
                title: title.isEmpty ? "Notification" : title,
                subtitle: body,
                epoch: epoch(row["created_at"] ?? row["sent_at"]),
                unread: !isRead(row),
                personId: entity == "person" ? entityId : nil,
                callId: entity == "call" ? entityId : nil)
        }
    }

    /// Active BOLOs.
    static func fromBolos(_ rows: [[String: Any]]) -> [AlertItem] {
        rows.compactMap { row in
            guard let id = intValue(row["id"]) else { return nil }
            let title = str(row, ["title", "summary", "subject"])
            return AlertItem(
                id: "bolo:\(id)", kind: .bolo,
                severity: severity(priority: str(row, ["priority"])),
                title: "BOLO: \(title.isEmpty ? "#\(id)" : title)",
                subtitle: str(row, ["description", "details"]),
                epoch: epoch(row["created_at"]),
                unread: false, personId: nil, callId: nil)
        }
    }

    // ── Merge + rank ─────────────────────────────────────────
    /// Flatten groups, dedup by id (keep the higher-severity / more-recent copy),
    /// then rank: severity desc, then unread-first, then recency desc, then title.
    static func merge(_ groups: [[AlertItem]]) -> [AlertItem] {
        var best: [String: AlertItem] = [:]
        for item in groups.flatMap({ $0 }) {
            if let prior = best[item.id] {
                if item.severity > prior.severity || (item.severity == prior.severity && item.epoch > prior.epoch) {
                    best[item.id] = item
                }
            } else {
                best[item.id] = item
            }
        }
        return best.values.sorted { a, b in
            if a.severity != b.severity { return a.severity > b.severity }
            if a.unread != b.unread { return a.unread }
            if a.epoch != b.epoch { return a.epoch > b.epoch }
            return a.title.localizedCaseInsensitiveCompare(b.title) == .orderedAscending
        }
    }

    // ── Relative time ────────────────────────────────────────
    /// Human relative time ("just now" / "5m" / "3h" / "2d"). `now` injected for tests.
    static func relativeTime(epoch: Double, now: Double) -> String {
        guard epoch > 0 else { return "" }
        let s = max(0, now - epoch)
        if s < 60 { return "just now" }
        if s < 3600 { return "\(Int(s / 60))m" }
        if s < 86_400 { return "\(Int(s / 3600))h" }
        return "\(Int(s / 86_400))d"
    }

    // ── Helpers ──────────────────────────────────────────────
    static func intValue(_ any: Any?) -> Int? {
        if let n = any as? Int { return n }
        if let d = any as? Double { return Int(d) }
        if let s = any as? String { return Int(s) }
        return nil
    }
    static func str(_ row: [String: Any], _ keys: [String]) -> String {
        for k in keys {
            if let s = row[k] as? String, !s.isEmpty { return s }
            if let n = row[k] as? Int { return "\(n)" }
        }
        return ""
    }
    static func isRead(_ row: [String: Any]) -> Bool {
        if let b = row["read"] as? Bool { return b }
        if let b = row["is_read"] as? Bool { return b }
        if let n = row["read"] as? Int { return n != 0 }
        if let n = row["is_read"] as? Int { return n != 0 }
        if row["read_at"] is String { return true }
        return false
    }
    static func label(_ type: String) -> String {
        guard !type.isEmpty else { return "" }
        return type.replacingOccurrences(of: "_", with: " ").capitalized
    }
    private static func firstNonEmpty(_ a: String, _ b: String) -> String { a.isEmpty ? b : a }

    private static let isoFmt: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let sqlFmt: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC"); f.dateFormat = "yyyy-MM-dd HH:mm:ss"; return f
    }()
    /// Parse a D1 / ISO timestamp to epoch seconds. 0 on failure (sorts last).
    static func epoch(_ any: Any?) -> Double {
        guard let s = any as? String, !s.isEmpty else {
            if let n = any as? Double { return n }
            if let n = any as? Int { return Double(n) }
            return 0
        }
        if let d = isoFmt.date(from: s) { return d.timeIntervalSince1970 }
        let iso2 = ISO8601DateFormatter(); if let d = iso2.date(from: s) { return d.timeIntervalSince1970 }
        if let d = sqlFmt.date(from: s) { return d.timeIntervalSince1970 }
        return 0
    }
}
