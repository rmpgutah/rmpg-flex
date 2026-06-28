import Foundation

/// Typed errors emitted by `APIClient`.
///
/// The `notConfigured` case represents the
/// `{ ok: false, skipped: true, code: "..." }` envelope the Worker returns for
/// disabled-feature endpoints — it is *not* an outage. UI should map this to a
/// disabled affordance, not an error banner.
public enum APIError: Error, Equatable {
    case network(URLError)
    case unauthorized
    case forbidden
    case notConfigured(code: String)
    case server(status: Int, code: String?, message: String?)
    case decode(String)

    public static func == (lhs: APIError, rhs: APIError) -> Bool {
        switch (lhs, rhs) {
        case (.unauthorized, .unauthorized): return true
        case (.forbidden, .forbidden): return true
        case let (.notConfigured(a), .notConfigured(b)): return a == b
        case let (.server(s1, c1, m1), .server(s2, c2, m2)):
            return s1 == s2 && c1 == c2 && m1 == m2
        case let (.network(a), .network(b)): return a.code == b.code
        case let (.decode(a), .decode(b)): return a == b
        default: return false
        }
    }
}
