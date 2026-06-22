import Foundation

/// Value type describing a single API call.
public struct Endpoint: Sendable {
    public enum Method: String, Sendable {
        case get = "GET"
        case post = "POST"
        case put = "PUT"
        case patch = "PATCH"
        case delete = "DELETE"
    }

    public let method: Method
    public let path: String
    public let headers: [String: String]
    public let body: Data?

    public init(
        method: Method,
        path: String,
        headers: [String: String] = [:],
        body: Data? = nil
    ) {
        self.method = method
        self.path = path
        self.headers = headers
        self.body = body
    }

    /// Convenience for JSON POST.
    public static func jsonPost<E: Encodable>(_ path: String, body: E) throws -> Endpoint {
        let data = try JSONEncoder().encode(body)
        return Endpoint(
            method: .post,
            path: path,
            headers: ["Content-Type": "application/json"],
            body: data
        )
    }
}
