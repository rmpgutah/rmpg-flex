import Foundation

struct D1QueryResult {
    let columns: [String]
    let rows: [[String]]
    let meta: String?
}

enum D1Error: LocalizedError {
    case api(String)
    case http(Int, String)
    case malformed

    var errorDescription: String? {
        switch self {
        case .api(let msg): return "D1: \(msg)"
        case .http(let code, let body): return "HTTP \(code): \(body.prefix(300))"
        case .malformed: return "Unrecognized D1 response shape"
        }
    }
}

struct D1Client {
    var accountId: String
    var databaseId: String
    var apiToken: String

    func query(_ sql: String) async throws -> D1QueryResult {
        var req = URLRequest(url: URL(string:
            "https://api.cloudflare.com/client/v4/accounts/\(accountId)/d1/database/\(databaseId)/query")!)
        req.httpMethod = "POST"
        req.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["sql": sql])

        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if status >= 500 {
            throw D1Error.http(status, String(data: data, encoding: .utf8) ?? "")
        }
        return try Self.parse(data)
    }

    // Pure parser — rows are heterogenous JSON so we go through JSONSerialization
    // and stringify every value for display.
    static func parse(_ data: Data) throws -> D1QueryResult {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw D1Error.malformed
        }
        if (root["success"] as? Bool) != true {
            let msgs = (root["errors"] as? [[String: Any]])?
                .compactMap { $0["message"] as? String } ?? []
            throw D1Error.api(msgs.isEmpty ? "unknown error" : msgs.joined(separator: "; "))
        }
        guard let result = (root["result"] as? [[String: Any]])?.first else {
            throw D1Error.malformed
        }
        let rawRows = result["results"] as? [[String: Any]] ?? []
        var metaText: String?
        if let meta = result["meta"] as? [String: Any] {
            let duration = meta["duration"].map { "\($0)" } ?? "?"
            let changes = meta["changes"].map { "\($0)" } ?? "0"
            metaText = "\(rawRows.count) rows · \(changes) changes · \(duration) ms"
        }
        guard let first = rawRows.first else {
            return D1QueryResult(columns: [], rows: [], meta: metaText)
        }
        let columns = first.keys.sorted()
        let rows = rawRows.map { row in
            columns.map { stringify(row[$0]) }
        }
        return D1QueryResult(columns: columns, rows: rows, meta: metaText)
    }

    private static func stringify(_ value: Any?) -> String {
        switch value {
        case nil, is NSNull: return "NULL"
        case let n as NSNumber: return n.stringValue
        case let s as String: return s
        case let other?: return "\(other)"
        }
    }
}
