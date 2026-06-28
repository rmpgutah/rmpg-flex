import Foundation
import CoreAPI

/// Stub for the Worker's `/api/duty/clock-on` endpoint. Real wiring happens
/// when the corresponding Worker route lands.
public struct DutyAPI: Sendable {
    public let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public struct ClockOnRequest: Encodable, Sendable {
        public let unitID: String
        public let startedAt: String  // ISO8601

        public init(unitID: String, startedAt: Date = Date()) {
            self.unitID = unitID
            let f = ISO8601DateFormatter()
            self.startedAt = f.string(from: startedAt)
        }

        enum CodingKeys: String, CodingKey {
            case unitID = "unit_id"
            case startedAt = "started_at"
        }
    }

    public struct ClockOnResponse: Decodable, Sendable {
        public let dutyID: Int?
        public let serverTime: String?

        enum CodingKeys: String, CodingKey {
            case dutyID = "duty_id"
            case serverTime = "server_time"
        }
    }

    public func clockOn(unitID: String) async throws -> ClockOnResponse {
        let endpoint = try Endpoint.jsonPost(
            "api/duty/clock-on",
            body: ClockOnRequest(unitID: unitID)
        )
        return try await client.request(endpoint, as: ClockOnResponse.self)
    }
}
