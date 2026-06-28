import Foundation

// Pure: summarize the officer's time entries from GET /dispatch/duty/timecard.
enum TimecardSummary {
    private static let iso = ISO8601DateFormatter()

    /// Sum of `total_hours` over entries whose `clock_in` is within the last
    /// 7 days of `now`.
    static func hoursThisWeek(_ entries: [[String: Any]], now: Date = Date()) -> Double {
        let cutoff = now.addingTimeInterval(-7 * 86_400)
        var total = 0.0
        for e in entries {
            guard let s = e["clock_in"] as? String, let d = iso.date(from: s), d >= cutoff else { continue }
            if let h = e["total_hours"] as? Double { total += h }
            else if let h = e["total_hours"] as? Int { total += Double(h) }
        }
        return (total * 100).rounded() / 100
    }
}
