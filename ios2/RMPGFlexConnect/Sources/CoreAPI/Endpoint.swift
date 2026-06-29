import Foundation

public struct Endpoint: Sendable {
    public let path: String
    public let method: HTTPMethod
    public let queryItems: [URLQueryItem]
    public let body: Data?
    public let requiresAuth: Bool
    public let timeout: TimeInterval

    public init(
        path: String,
        method: HTTPMethod = .get,
        queryItems: [URLQueryItem] = [],
        body: Data? = nil,
        requiresAuth: Bool = true,
        timeout: TimeInterval = 30
    ) {
        self.path = path
        self.method = method
        self.queryItems = queryItems
        self.body = body
        self.requiresAuth = requiresAuth
        self.timeout = timeout
    }

    public enum HTTPMethod: String, Sendable {
        case get = "GET"
        case post = "POST"
        case put = "PUT"
        case patch = "PATCH"
        case delete = "DELETE"
    }
}

public extension Endpoint {
    static let productionBaseURL = "https://api.rmpgutah.us"
    static let stagingBaseURL = "https://api-staging.rmpgutah.us"
}
