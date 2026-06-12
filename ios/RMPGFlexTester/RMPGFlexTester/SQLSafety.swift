import Foundation

// Classifies SQL so the console can demand confirmation before anything destructive
// hits the live rmpg-flex D1 database.
enum SQLSafety {
    private static let readOnlyKeywords: Set<String> = ["SELECT", "PRAGMA", "EXPLAIN"]
    private static let writeTokens: Set<String> = [
        "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE",
        "CREATE", "REPLACE", "VACUUM", "ATTACH", "DETACH", "REINDEX",
    ]

    static func isDestructive(_ sql: String) -> Bool {
        let statements = stripComments(sql)
            .split(separator: ";")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !statements.isEmpty else { return false }

        for stmt in statements {
            let tokens = stmt.uppercased()
                .components(separatedBy: CharacterSet.alphanumerics.inverted)
                .filter { !$0.isEmpty }
            guard let first = tokens.first else { continue }
            if readOnlyKeywords.contains(first) { continue }
            if first == "WITH" {
                // CTE: read-only only if no write token appears in the statement.
                if tokens.contains(where: { writeTokens.contains($0) }) { return true }
                continue
            }
            return true
        }
        return false
    }

    private static func stripComments(_ sql: String) -> String {
        sql.split(separator: "\n", omittingEmptySubsequences: false)
            .map { line -> String in
                if let range = line.range(of: "--") {
                    return String(line[line.startIndex..<range.lowerBound])
                }
                return String(line)
            }
            .joined(separator: "\n")
    }
}
