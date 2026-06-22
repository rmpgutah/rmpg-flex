import Foundation
import CoreAPI

/// Stub for the Worker's `/api/dispatch/calls` POST endpoint.
public struct CFSAPI: Sendable {
    public let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public struct CreateCallRequest: Encodable, Sendable {
        public let callType: String
        public let location: String
        public let narrative: String

        enum CodingKeys: String, CodingKey {
            case callType = "call_type"
            case location, narrative
        }
    }

    public struct CreateCallResponse: Decodable, Sendable {
        public let cfsNumber: String?
        public let cfsID: Int?

        enum CodingKeys: String, CodingKey {
            case cfsNumber = "cfs_number"
            case cfsID = "cfs_id"
        }
    }

    public func createCall(callType: String, location: String, narrative: String) async throws -> CreateCallResponse {
        let endpoint = try Endpoint.jsonPost(
            "api/dispatch/calls",
            body: CreateCallRequest(callType: callType, location: location, narrative: narrative)
        )
        return try await client.request(endpoint, as: CreateCallResponse.self)
    }
}
