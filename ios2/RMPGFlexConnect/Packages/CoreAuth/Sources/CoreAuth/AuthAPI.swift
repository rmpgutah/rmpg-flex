import Foundation
import CoreAPI

/// Login binding. Mirrors `POST /api/auth/login` on the existing Worker.
public struct AuthAPI: Sendable {
    public let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public struct LoginRequest: Encodable, Sendable {
        public let username: String
        public let password: String
        public init(username: String, password: String) {
            self.username = username
            self.password = password
        }
    }

    public struct LoginResponse: Decodable, Sendable {
        public let token: String
        public let userId: Int?
        public let role: String?
        // The Worker may include other fields; we only model what M0 needs.

        enum CodingKeys: String, CodingKey {
            case token, role
            case userId = "user_id"
        }
    }

    public func login(username: String, password: String) async throws -> LoginResponse {
        let endpoint = try Endpoint.jsonPost(
            "api/auth/login",
            body: LoginRequest(username: username, password: password)
        )
        return try await client.request(endpoint, as: LoginResponse.self)
    }
}
