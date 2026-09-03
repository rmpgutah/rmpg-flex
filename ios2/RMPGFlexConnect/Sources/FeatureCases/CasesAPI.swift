import Foundation


/// Mirrors `cases` (migrations/0028_cases.sql). A prior version used `type`
/// as the property name and had no `title` at all — the real columns are
/// `title` (NOT NULL — the actual case name/identifier) and `case_type`
/// (`.convertFromSnakeCase` → `caseType`; there's no column `type` maps to).
/// `narrative` and `summary` are two SEPARATE real columns, not aliases.
public struct Case: Codable, Identifiable, Sendable {
    public let id: Int
    public let caseNumber: String?
    public let title: String?
    public let caseType: String?
    public let status: String?
    public let priority: String?
    public let leadInvestigatorId: Int?
    public let summary: String?
    public let narrative: String?
    public let solvabilityScore: Int?
    public let createdAt: String?
    public let updatedAt: String?
}

/// POST /api/cases body. Verified against src/routes/cases.ts: `title` is
/// REQUIRED (missing it 400s with "Title is required" — a prior version of
/// this request had no `title` field at all, so creating a case from iOS has
/// always failed regardless of what was typed), and the server reads
/// `case_type`/`summary`, not `type`/`narrative`. Case `priority` is also a
/// completely different enum than call priority — `low|normal|high|critical`,
/// not `P1`-`P4` (that's `calls_for_service.priority`; a prior version of the
/// New Case form reused the call-priority picker here by mistake).
public struct CaseCreateRequest: Codable, Sendable {
    public let title: String
    public let caseType: String
    public let priority: String
    public let summary: String?

    private enum CodingKeys: String, CodingKey {
        case title
        case caseType = "case_type"
        case priority
        case summary
    }

    public init(title: String, caseType: String, priority: String = "normal", summary: String? = nil) {
        self.title = title; self.caseType = caseType; self.priority = priority; self.summary = summary
    }
}

public struct CaseNote: Codable, Identifiable, Sendable {
    public let id: Int?
    public let caseId: Int?
    public let content: String?
    public let noteType: String?
    public let createdAt: String?
}

public final class CasesAPI: @unchecked Sendable {
    private let client: APIClient
    public init(client: APIClient) { self.client = client }

    public func list(status: String? = nil) async throws -> [Case] {
        var items: [URLQueryItem] = []
        if let s = status { items.append(URLQueryItem(name: "status", value: s)) }
        // Real response is {data:[...], pagination:{...}} (src/routes/cases.ts) —
        // a prior version decoded {results:[...]} into a non-optional field,
        // which THROWS a decode error on every call since "results" never
        // exists on the response — the Cases list has never loaded.
        let r: ApiList<Case> = try await client.request(Endpoint(path: "/api/cases", queryItems: items))
        return r.data
    }

    public func get(id: Int) async throws -> Case {
        try await client.request(Endpoint(path: "/api/cases/\(id)"))
    }

    /// POST /api/cases returns only `{data: {id, case_number}}` — a partial
    /// object, not a full case row — so this re-fetches the full record
    /// rather than decoding that partial response as if it were a `Case`
    /// (every other field would have silently come back nil).
    public func create(_ req: CaseCreateRequest) async throws -> Case {
        let body = try JSONEncoder().encode(req)
        let r: ApiSingle<CaseCreateResult> = try await client.request(Endpoint(path: "/api/cases", method: .post, body: body))
        return try await get(id: r.data.id)
    }

    /// PUT /api/cases/:id returns `{data: {...updated case row...}}`, not a
    /// bare case object — a prior version decoded the raw response directly
    /// as `Case`, which throws on every call (there's no top-level `id`,
    /// only nested under `data`), so editing a case from iOS has always failed.
    public func update(id: Int, body: [String: String]) async throws -> Case {
        let d = try JSONSerialization.data(withJSONObject: body)
        let r: ApiSingle<Case> = try await client.request(Endpoint(path: "/api/cases/\(id)", method: .put, body: d))
        return r.data
    }

    /// PUT /api/cases/:id/status — a SEPARATE, role-gated (admin/manager/
    /// supervisor only) endpoint; `status` isn't in the generic PUT's
    /// UPDATABLE column allowlist at all, so this can't go through update().
    /// Its response is only `{data: {id, status, disposition}}`, so this
    /// re-fetches the full case afterward rather than decoding that partial
    /// object as a `Case` (same pattern as create()).
    public func updateStatus(id: Int, status: String, disposition: String? = nil) async throws -> Case {
        var body: [String: String] = ["status": status]
        if let disposition { body["disposition"] = disposition }
        let d = try JSONSerialization.data(withJSONObject: body)
        try await client.requestVoid(Endpoint(path: "/api/cases/\(id)/status", method: .put, body: d))
        return try await get(id: id)
    }

    public func addNote(caseId: Int, content: String, type: String = "general") async throws -> CaseNote {
        let body = try JSONEncoder().encode(["content": content, "note_type": type] as [String: String])
        return try await client.request(Endpoint(path: "/api/cases/\(caseId)/notes", method: .post, body: body))
    }

    /// Real response is {data:[...]} (src/routes/cases.ts), not {results:[...]}.
    public func listNotes(caseId: Int) async throws -> [CaseNote] {
        let r: ApiList<CaseNote> = try await client.request(Endpoint(path: "/api/cases/\(caseId)/notes"))
        return r.data
    }
}

struct ApiList<T: Codable & Sendable>: Codable, Sendable { let data: [T] }
struct ApiSingle<T: Codable & Sendable>: Codable, Sendable { let data: T }
struct CaseCreateResult: Codable, Sendable { let id: Int; let caseNumber: String? }
