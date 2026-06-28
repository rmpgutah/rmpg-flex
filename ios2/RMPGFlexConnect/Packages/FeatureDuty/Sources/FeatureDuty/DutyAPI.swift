import Foundation
import CoreAPI

public struct DutyAPI: Sendable {
    public let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    // Server auto-resolves unit + vehicle via JWT officer_id.
    // Optionally override with explicit unit_id (numeric) or starting_mileage.
    public struct StartRequest: Encodable, Sendable {
        public let unit_id: Int?
        public let starting_mileage: Double?
        public init(unitID: Int? = nil, startingMileage: Double? = nil) {
            self.unit_id = unitID
            self.starting_mileage = startingMileage
        }
    }

    public struct DutyStateResponse: Decodable, Sendable {
        public let officer_id: Int?
        public let on_shift: Bool
        public let clock_in: String?
        public let unit: UnitInfo?

        public struct UnitInfo: Decodable, Sendable {
            public let id: Int
            public let call_sign: String?
            public let status: String?
        }
    }

    public func clockOn() async throws -> DutyStateResponse {
        let endpoint = try Endpoint.jsonPost("api/dispatch/duty/start", body: StartRequest())
        return try await client.request(endpoint, as: DutyStateResponse.self)
    }

    public func clockOff() async throws -> DutyStateResponse {
        let endpoint = try Endpoint.jsonPost("api/dispatch/duty/end", body: EmptyBody())
        return try await client.request(endpoint, as: DutyStateResponse.self)
    }
}

private struct EmptyBody: Encodable {}
