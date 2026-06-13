import Foundation

// Account-level Cloudflare API client for the Cloud tab: Workers, D1, KV, R2,
// Pages. Each section degrades independently if the token lacks that scope.
struct CFResource: Identifiable {
    let id: String
    let title: String
    let subtitle: String
}

struct CloudflareClient {
    var accountId: String
    var apiToken: String

    enum Section: String, CaseIterable {
        case workers = "WORKERS"
        case d1 = "D1 DATABASES"
        case kv = "KV NAMESPACES"
        case r2 = "R2 BUCKETS"
        case pages = "PAGES PROJECTS"

        var path: String {
            switch self {
            case .workers: return "workers/scripts"
            case .d1: return "d1/database"
            case .kv: return "storage/kv/namespaces"
            case .r2: return "r2/buckets"
            case .pages: return "pages/projects"
            }
        }

        // The exact Cloudflare token permission this section needs — shown in the
        // UI when the call is denied, so a blocked row tells the user what to add.
        var scopeHint: String {
            switch self {
            case .workers: return "Workers Scripts: Read"
            case .d1: return "D1: Edit"
            case .kv: return "Workers KV Storage: Read"
            case .r2: return "Workers R2 Storage: Read"
            case .pages: return "Pages: Read"
            }
        }
    }

    func list(_ section: Section) async throws -> [CFResource] {
        var req = URLRequest(url: URL(string:
            "https://api.cloudflare.com/client/v4/accounts/\(accountId)/\(section.path)")!)
        req.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        // A 401/403 — or the CF "Authentication error" some endpoints (KV) return
        // in a success:false body — means the token is missing this section's
        // permission. Surface the exact scope to add in Settings, not a cryptic
        // "Authentication error". (D1 + R2 prove the token + paths are otherwise OK.)
        if status == 401 || status == 403 {
            throw D1Error.api("Add '\(section.scopeHint)' to your CF token (Settings)")
        }
        let resources: [CFResource]
        do {
            resources = try Self.parseList(data, section: section)
        } catch let e as D1Error {
            if case .api(let m) = e,
               ["authentication", "permission", "scope", "unauthorized", "not authorized"]
                 .contains(where: { m.lowercased().contains($0) }) {
                throw D1Error.api("Add '\(section.scopeHint)' to your CF token (Settings)")
            }
            throw e
        }
        // The D1 LIST endpoint returns num_tables=0 for every database (it isn't
        // computed there) — only the per-database GET has the real count. Enrich
        // each D1 row with its detail so they don't all read "0 tables".
        if section == .d1 {
            var enriched: [CFResource] = []
            for r in resources {
                if let d = try? await d1Detail(r.id) {
                    let bytes = (d["file_size"] as? NSNumber)?.doubleValue ?? 0
                    let size = String(format: "%.1f MB", bytes / 1_048_576)
                    let tables = (d["num_tables"] as? NSNumber)?.stringValue ?? "?"
                    enriched.append(CFResource(id: r.id, title: r.title,
                        subtitle: "\(size) · \(tables) tables · \(r.id.prefix(8))…"))
                } else {
                    enriched.append(r) // detail failed — keep the list row
                }
            }
            return enriched
        }
        return resources
    }

    // Per-database detail (GET /d1/database/:uuid) — the authoritative
    // num_tables + file_size the list endpoint omits.
    private func d1Detail(_ uuid: String) async throws -> [String: Any] {
        var req = URLRequest(url: URL(string:
            "https://api.cloudflare.com/client/v4/accounts/\(accountId)/d1/database/\(uuid)")!)
        req.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: req)
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let result = root["result"] as? [String: Any] else { throw D1Error.malformed }
        return result
    }

    static func parseList(_ data: Data, section: Section) throws -> [CFResource] {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw D1Error.malformed
        }
        if (root["success"] as? Bool) != true {
            let msgs = (root["errors"] as? [[String: Any]])?
                .compactMap { $0["message"] as? String } ?? []
            throw D1Error.api(msgs.isEmpty ? "unknown error" : msgs.joined(separator: "; "))
        }
        // R2 nests under result.buckets; everything else is a flat result array.
        let items: [[String: Any]]
        if let arr = root["result"] as? [[String: Any]] {
            items = arr
        } else if let obj = root["result"] as? [String: Any],
                  let arr = obj["buckets"] as? [[String: Any]] {
            items = arr
        } else {
            items = []
        }
        return items.map { item in
            switch section {
            case .workers:
                let id = item["id"] as? String ?? "?"
                return CFResource(id: id, title: id,
                                  subtitle: "modified \(item["modified_on"] as? String ?? "?")")
            case .d1:
                let name = item["name"] as? String ?? "?"
                let uuid = item["uuid"] as? String ?? "?"
                let size = (item["file_size"] as? NSNumber).map {
                    String(format: "%.1f MB", $0.doubleValue / 1_048_576)
                } ?? "?"
                let tables = (item["num_tables"] as? NSNumber)?.stringValue ?? "?"
                return CFResource(id: uuid, title: name,
                                  subtitle: "\(size) · \(tables) tables · \(uuid.prefix(8))…")
            case .kv:
                return CFResource(id: item["id"] as? String ?? "?",
                                  title: item["title"] as? String ?? "(untitled)",
                                  subtitle: item["id"] as? String ?? "")
            case .r2:
                let name = item["name"] as? String ?? "?"
                return CFResource(id: name, title: name,
                                  subtitle: "created \(item["creation_date"] as? String ?? "?")")
            case .pages:
                let name = item["name"] as? String ?? "?"
                let domain = (item["domains"] as? [String])?.first ?? ""
                return CFResource(id: name, title: name, subtitle: domain)
            }
        }
    }
}
