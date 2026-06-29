import Foundation
import CoreAPI

public struct Case: Codable, Identifiable, Sendable {
    public let id: Int
    public let caseNumber: String?
    public let type: String?
    public let status: String?
    public let priority: String?
    public let leadInvestigator: Int?
    public let narrative: String?
    public let solvabilityScore: Int?
    public let createdAt: String?
    public let updatedAt: String?
}

public struct CaseCreateRequest: Codable, Sendable {
    public let type: String
    public let priority: String
    public let narrative: String?
    public init(type: String, priority: String = "P3", narrative: String? = nil) {
        self.type = type; self.priority = priority; self.narrative = narrative
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
        let r: ApiList<Case> = try await client.request(Endpoint(path: "/api/cases", queryItems: items))
        return r.results
    }

    public func get(id: Int) async throws -> Case {
        try await client.request(Endpoint(path: "/api/cases/\(id)"))
    }

    public func create(_ req: CaseCreateRequest) async throws -> Case {
        let body = try JSONEncoder().encode(req)
        let r: ApiSingle<Case> = try await client.request(Endpoint(path: "/api/cases", method: .post, body: body))
        return r.data
    }

    public func update(id: Int, body: [String: String]) async throws -> Case {
        let d = try JSONSerialization.data(withJSONObject: body)
        return try await client.request(Endpoint(path: "/api/cases/\(id)", method: .put, body: d))
    }

    public func addNote(caseId: Int, content: String, type: String = "general") async throws -> CaseNote {
        let body = try JSONEncoder().encode(["content": content, "note_type": type] as [String: String])
        return try await client.request(Endpoint(path: "/api/cases/\(caseId)/notes", method: .post, body: body))
    }

    public func listNotes(caseId: Int) async throws -> [CaseNote] {
        let r: ApiList<CaseNote> = try await client.request(Endpoint(path: "/api/cases/\(caseId)/notes"))
        return r.results
    }
}

struct ApiList<T: Codable & Sendable>: Codable, Sendable { let results: [T] }
struct ApiSingle<T: Codable & Sendable>: Codable, Sendable { let data: T }
