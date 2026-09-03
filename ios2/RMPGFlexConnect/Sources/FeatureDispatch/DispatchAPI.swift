import Foundation


public final class DispatchAPI: @unchecked Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func listCalls(status: String? = nil) async throws -> [CallForService] {
        var items: [URLQueryItem] = []
        if let status = status { items.append(URLQueryItem(name: "status", value: status)) }
        let response: ApiListResponse<CallForService> = try await client.request(Endpoint(
            path: "/api/dispatch/calls",
            queryItems: items
        ))
        return response.results
    }

    public func getCall(id: Int) async throws -> CallForService {
        try await client.request(Endpoint(path: "/api/dispatch/calls/\(id)"))
    }

    public func createCall(_ req: CreateCallRequest) async throws -> CallForService {
        let body = try JSONEncoder().encode(req)
        return try await client.request(Endpoint(
            path: "/api/dispatch/calls",
            method: .post,
            body: body
        ))
    }

    public func updateCall(id: Int, body: [String: String]) async throws -> CallForService {
        let data = try JSONSerialization.data(withJSONObject: body)
        return try await client.request(Endpoint(
            path: "/api/dispatch/calls/\(id)",
            method: .put,
            body: data
        ))
    }

    /// POST /api/dispatch/calls/:id/status — the purpose-built status
    /// transition endpoint (src/routes/dispatch/calls.ts), which also
    /// stamps the matching timeline column (dispatched_at/enroute_at/etc.)
    /// and persists a disposition on terminal transitions. Prefer this over
    /// `updateCall(body: ["status": ...])` — the generic PUT accepts a raw
    /// status write too, but skips those timeline side effects.
    ///
    /// `status` MUST be one of the real `calls_for_service.status` CHECK
    /// values — verified against migrations/0001_initial_schema.sql:
    /// pending, dispatched, enroute, onscene, cleared, closed, cancelled, archived.
    /// There is no "active" status — a prior version of this call site sent
    /// exactly that and would have 500'd on the DB constraint every time.
    public func updateCallStatus(id: Int, status: String, disposition: String? = nil) async throws -> CallForService {
        var payload: [String: String] = ["status": status]
        if let disposition { payload["disposition"] = disposition }
        let body = try JSONSerialization.data(withJSONObject: payload)
        return try await client.request(Endpoint(
            path: "/api/dispatch/calls/\(id)/status",
            method: .post,
            body: body
        ))
    }

    public func deleteCall(id: Int) async throws {
        try await client.requestVoid(Endpoint(
            path: "/api/dispatch/calls/\(id)",
            method: .delete
        ))
    }

    public func listUnits() async throws -> [Unit] {
        try await client.request(Endpoint(path: "/api/dispatch/units"))
    }

    /// PUT /api/dispatch/units/:id/status (verified against src/routes/dispatch/units.ts —
    /// it's a PUT route; a PATCH request to it 404s since Hono routes match on
    /// exact method). `status` must be one of the real `units.status` CHECK
    /// values: available, dispatched, enroute, onscene, busy, off_duty, out_of_service.
    public func updateUnitStatus(id: Int, status: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["status": status])
        try await client.requestVoid(Endpoint(
            path: "/api/dispatch/units/\(id)/status",
            method: .put,
            body: body
        ))
    }

    public func postGPS(_ point: GPSPoint) async throws {
        let body = try JSONEncoder().encode(point)
        try await client.requestVoid(Endpoint(
            path: "/api/dispatch/gps",
            method: .post,
            body: body
        ))
    }

    public func postGPSBulk(_ points: [GPSPoint]) async throws {
        let upload = GPSBulkUpload(points: points)
        let body = try JSONEncoder().encode(upload)
        try await client.requestVoid(Endpoint(
            path: "/api/dispatch/gps",
            method: .post,
            body: body
        ))
    }

    public func triggerPanic(source: String = "manual", lat: Double? = nil, lng: Double? = nil) async throws -> PanicAlert {
        let body = try JSONEncoder().encode(PanicAlert(id: nil, source: source, escalationLevel: nil, lat: lat, lng: lng))
        return try await client.request(Endpoint(
            path: "/api/dispatch/panic",
            method: .post,
            body: body
        ))
    }

    /// Real response is {count, watches:[...]} — see WelfareCheck's doc comment.
    public func listWelfareActive() async throws -> [WelfareCheck] {
        let response: WelfareActiveResponse = try await client.request(Endpoint(
            path: "/api/dispatch/welfare/active"
        ))
        return response.watches
    }

    /// GET /api/dispatch (bare — the aggregates router mounts at the bare
    /// `/api/dispatch` prefix with an internal `.get('/')`, per routesConfig.ts's
    /// explicit comment not to add an `/aggregates` segment). A prior version
    /// called `/api/dispatch/stats`, which 404s — that path doesn't exist
    /// anywhere on this Worker.
    public func getDispatchStats() async throws -> DispatchStats {
        try await client.request(Endpoint(
            path: "/api/dispatch"
        ))
    }

    /// POST /api/dispatch/calls/:id/assign-unit — a per-unit endpoint (verified
    /// against src/routes/dispatch/calls.ts, which has NO batch `/assign` route
    /// and expects a single `unit_id`, not a `unit_ids` array). Call once per
    /// unit to assign several. Returns 409 with `{warning:"vehicle_unavailable"}`
    /// if the unit's assigned vehicle is out of service/in maintenance.
    public func assignUnit(callId: Int, unitId: Int) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["unit_id": unitId])
        try await client.requestVoid(Endpoint(
            path: "/api/dispatch/calls/\(callId)/assign-unit",
            method: .post,
            body: body
        ))
    }
}

// MARK: - API Response wrappers

struct ApiListResponse<T: Codable & Sendable>: Codable, Sendable {
    let data: [T]
    let pagination: Pagination?

    var results: [T] { data }

    struct Pagination: Codable, Sendable {
        let page: Int?
        let limit: Int?
        let total: Int?
        let totalPages: Int?
    }
}
