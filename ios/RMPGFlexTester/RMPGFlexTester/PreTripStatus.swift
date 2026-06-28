import Foundation

// Pure: given the inspection rows from GET /fleet/:id/inspections, has a
// pre-trip been logged on a given calendar day (yyyy-MM-dd)? Used to decide
// whether to auto-present the start-of-shift pre-trip.
enum PreTripStatus {
    static func hasPreTrip(in rows: [[String: Any]], onDay day: String) -> Bool {
        for r in rows {
            guard (r["inspection_type"] as? String) == "pre_trip",
                  let date = r["inspection_date"] as? String else { continue }
            if String(date.prefix(10)) == day { return true }
        }
        return false
    }

    /// Today's calendar day as yyyy-MM-dd in **UTC** — matches how the sheet
    /// writes `inspection_date` (`ISO8601DateFormatter().string(from:)` emits a
    /// UTC `…Z` stamp), so the `prefix(10)` day comparison in `hasPreTrip` lines
    /// up. Using local time here would misfire across the UTC midnight boundary
    /// on evening/night shifts.
    static func today(now: Date = Date()) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: now)
    }
}
