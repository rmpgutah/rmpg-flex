import Foundation
import CoreAPI

public final class IncidentsAPI: @unchecked Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func list(status: String? = nil) async throws -> [Incident] {
        var items: [URLQueryItem] = []
        if let s = status { items.append(URLQueryItem(name: "status", value: s)) }
        let response: ApiList<Incident> = try await client.request(Endpoint(
            path: "/api/incidents", queryItems: items
        ))
        return response.results
    }

    public func get(id: Int) async throws -> Incident {
        try await client.request(Endpoint(path: "/api/incidents/\(id)"))
    }

    public func create(_ req: IncidentCreateRequest) async throws -> Incident {
        let body = try JSONEncoder().encode(req)
        let response: ApiSingle<Incident> = try await client.request(Endpoint(
            path: "/api/incidents", method: .post, body: body
        ))
        return response.data
    }

    public func update(id: Int, body: [String: String]) async throws -> Incident {
        let data = try JSONSerialization.data(withJSONObject: body)
        return try await client.request(Endpoint(
            path: "/api/incidents/\(id)", method: .put, body: data
        ))
    }

    public func submit(id: Int) async throws {
        try await client.requestVoid(Endpoint(
            path: "/api/incidents/\(id)/submit", method: .post
        ))
    }

    public func approve(id: Int) async throws {
        try await client.requestVoid(Endpoint(
            path: "/api/incidents/\(id)/approve", method: .post
        ))
    }

    public func listOffenses(incidentId: Int) async throws -> [IncidentOffense] {
        let response: ApiList<IncidentOffense> = try await client.request(Endpoint(
            path: "/api/incidents/\(incidentId)/offenses"
        ))
        return response.results
    }

    public func listPersons(incidentId: Int) async throws -> [IncidentPerson] {
        let response: ApiList<IncidentPerson> = try await client.request(Endpoint(
            path: "/api/incidents/\(incidentId)/persons"
        ))
        return response.results
    }
}

struct ApiList<T: Codable & Sendable>: Codable, Sendable { let results: [T] }
struct ApiSingle<T: Codable & Sendable>: Codable, Sendable { let data: T }
