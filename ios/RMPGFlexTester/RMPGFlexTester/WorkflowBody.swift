import Foundation

// Encode collected field values into a JSON body or multipart string fields.
// Empty values are dropped so the server's optional-field allow-lists aren't
// sent empty strings.
enum WorkflowBody {
    static func json(_ values: [String: FieldValue]) -> [String: Any] {
        var out: [String: Any] = [:]
        for (k, v) in values where !v.isEmpty {
            switch v {
            case .string(let s): out[k] = s
            case .number(let n): out[k] = n
            case .bool(let b): out[k] = b
            case .none: break
            }
        }
        return out
    }

    static func multipartFields(_ values: [String: FieldValue]) -> [String: String] {
        var out: [String: String] = [:]
        for (k, v) in values where !v.isEmpty {
            switch v {
            case .string(let s): out[k] = s
            case .number(let n): out[k] = n == n.rounded() ? String(Int(n)) : String(n)
            case .bool(let b): out[k] = b ? "1" : "0"
            case .none: break
            }
        }
        return out
    }
}
