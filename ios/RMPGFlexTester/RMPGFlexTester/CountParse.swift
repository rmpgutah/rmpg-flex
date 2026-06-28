import Foundation

// Pure helpers for reading counts out of the app's loosely-typed JSON responses
// (`[String: Any]` / `[[String: Any]]`). Extracted from DashboardView so both it
// and LiveCounts share one tested implementation.
enum CountParse {
    /// Number of rows in a response that is either a bare array or an object
    /// wrapping the array under a common key.
    static func rowCount(_ any: Any?) -> Int {
        if let arr = any as? [[String: Any]] { return arr.count }
        if let obj = any as? [String: Any] {
            for k in ["results", "calls", "data", "rows"] {
                if let arr = obj[k] as? [[String: Any]] { return arr.count }
            }
        }
        return 0
    }

    /// First integer found either directly or under one of `keys` in an object.
    static func intField(_ any: Any?, _ keys: [String]) -> Int {
        if let n = any as? Int { return n }
        if let obj = any as? [String: Any] {
            for k in keys { if let n = obj[k] as? Int { return n } }
        }
        return 0
    }
}
