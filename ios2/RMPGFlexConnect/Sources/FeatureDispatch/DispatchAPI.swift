import Foundation
import CoreAPI

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
        let response: ApiSingleResponse<CallForService> = try await client.request(Endpoint(
            path: "/api/dispatch/calls",
            method: .post,
            body: body
        ))
        return response.data
    }

    public func updateCall(id: Int, body: [String: String]) async throws -> CallForService {
        let data = try JSONSerialization.data(withJSONObject: body)
        return try await client.request(Endpoint(
            path: "/api/dispatch/calls/\(id)",
            method: .put,
            body: data
        ))
    }

    public func deleteCall(id: Int) async throws {
        try await client.requestVoid(Endpoint(
            path: "/api/dispatch/calls/\(id)",
            method: .delete
        ))
    }

    public func listUnits() async throws -> [Unit] {
        let response: ApiListResponse<Unit> = try await client.request(Endpoint(
            path: "/api/dispatch/units"
        ))
        return response.results
    }

    public func updateUnitStatus(id: Int, status: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["status": status])
        try await client.requestVoid(Endpoint(
            path: "/api/dispatch/units/\(id)/status",
            method: .patch,
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

    public func listWelfareActive() async throws -> [WelfareCheck] {
        let response: ApiListResponse<WelfareCheck> = try await client.request(Endpoint(
            path: "/api/dispatch/welfare/active"
        ))
        return response.results
    }

    public func getDispatchStats() async throws -> DispatchStats {
        try await client.request(Endpoint(
            path: "/api/dispatch/stats"
        ))
    }

    public func assignUnits(callId: Int, unitIds: [Int]) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["unit_ids": unitIds])
        try await client.requestVoid(Endpoint(
            path: "/api/dispatch/calls/\(callId)/assign",
            method: .post,
            body: body
        ))
    }
}

// MARK: - API Response wrappers

struct ApiListResponse<T: Codable & Sendable>: Codable, Sendable {
    let results: [T]
    let total: Int?
}

struct ApiSingleResponse<T: Codable & Sendable>: Codable, Sendable {
    let data: T
}
