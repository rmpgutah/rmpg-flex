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

    /// Today's calendar day as yyyy-MM-dd in the device's local time zone.
    static func today(now: Date = Date()) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: now)
    }
}
