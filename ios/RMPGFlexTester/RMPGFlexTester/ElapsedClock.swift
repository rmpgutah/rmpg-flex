import Foundation

// Pure parsing + formatting for live duration displays (shift timer, active-call
// timer). Server timestamps are UTC: either D1's "YYYY-MM-DD HH:MM:SS" (no zone)
// or ISO8601 with a zone. SwiftUI drives the `now` via TimelineView.
enum ElapsedClock {
    private static let d1: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f
    }()
    private static let iso = ISO8601DateFormatter()

    /// Parse a UTC server timestamp in either supported format. nil on failure.
    static func parseUTC(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        if let d = d1.date(from: s) { return d }
        return iso.date(from: s)
    }

    /// "1h 23m" once an hour has passed, otherwise "12m 04s". Clamped at zero.
    static func elapsed(since start: Date, now: Date) -> String {
        let secs = max(0, Int(now.timeIntervalSince(start)))
        let h = secs / 3600, m = (secs % 3600) / 60, s = secs % 60
        if h > 0 { return "\(h)h \(String(format: "%02d", m))m" }
        return "\(m)m \(String(format: "%02d", s))s"
    }
}
