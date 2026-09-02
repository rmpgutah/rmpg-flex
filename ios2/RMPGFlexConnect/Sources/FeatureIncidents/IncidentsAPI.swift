import Foundation


public final class IncidentsAPI: @unchecked Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Real response is {data:[...], pagination:{...}} (src/routes/incidents.ts) —
    /// a prior version decoded {results:[...]} into a non-optional field,
    /// throwing a decode error on every call since "results" doesn't exist
    /// on the response.
    public func list(status: String? = nil) async throws -> [Incident] {
        var items: [URLQueryItem] = []
        if let s = status { items.append(URLQueryItem(name: "status", value: s)) }
        let response: ApiList<Incident> = try await client.request(Endpoint(
            path: "/api/incidents", queryItems: items
        ))
        return response.data
    }

    public func get(id: Int) async throws -> Incident {
        try await client.request(Endpoint(path: "/api/incidents/\(id)"))
    }

    /// POST /api/incidents returns the created incident as a bare object
    /// (`c.json(created, 201)`), not wrapped in `{data: ...}` — a prior
    /// version decoded `ApiSingle<Incident>{data: Incident}` here, which
    /// would throw on every creation since there's no "data" key.
    public func create(_ req: IncidentCreateRequest) async throws -> Incident {
        let body = try JSONEncoder().encode(req)
        return try await client.request(Endpoint(
            path: "/api/incidents", method: .post, body: body
        ))
    }

    public func update(id: Int, body: [String: String]) async throws -> Incident {
        let data = try JSONSerialization.data(withJSONObject: body)
        return try await client.request(Endpoint(
            path: "/api/incidents/\(id)", method: .put, body: data
        ))
    }

    /// PUT, not POST — verified against src/routes/incidents.ts
    /// (`incidents.put('/:id/submit', ...)`). A prior version sent POST,
    /// which 404/405s since Hono matches on exact method.
    public func submit(id: Int) async throws {
        try await client.requestVoid(Endpoint(
            path: "/api/incidents/\(id)/submit", method: .put
        ))
    }

    /// PUT, not POST — same verb mismatch as submit() above
    /// (`incidents.put('/:id/approve', ...)`).
    public func approve(id: Int) async throws {
        try await client.requestVoid(Endpoint(
            path: "/api/incidents/\(id)/approve", method: .put
        ))
    }

    /// Real response is a bare JSON array (`c.json(rows)` in
    /// src/routes/incidentSubresources.ts), not `{results:[...]}` — a prior
    /// version's wrapper wouldn't decode against that shape at all.
    public func listOffenses(incidentId: Int) async throws -> [IncidentOffense] {
        try await client.request(Endpoint(path: "/api/incidents/\(incidentId)/offenses"))
    }

    // NOTE: a prior `listPersons(incidentId:)` here called
    // GET /api/incidents/:id/persons, which does not exist anywhere in the
    // Worker (verified via routesConfig.ts + a full grep of src/routes) — the
    // only `/:id/persons` route lives on `/api/cases`, a different resource
    // entirely. Removed rather than left as dead, guaranteed-404 API surface;
    // it was never called from any view. If incident-linked persons are
    // needed later, that requires a new server-side route first.
}

struct ApiList<T: Codable & Sendable>: Codable, Sendable { let data: [T] }
