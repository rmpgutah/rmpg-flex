import Foundation

/// Thin async/await HTTP client.
///
/// Handles auth-header injection, status-code → typed-error mapping, and the
/// `notConfigured` envelope. Retry/backoff is intentionally out of scope here;
/// composition layers add it.
public final class APIClient: Sendable {
    public let baseURL: URL
    public let session: URLSession
    public let tokenProvider: @Sendable () -> String?

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        tokenProvider: @escaping @Sendable () -> String? = { nil }
    ) {
        self.baseURL = baseURL
        self.session = session
        self.tokenProvider = tokenProvider
    }

    public func request<T: Decodable>(
        _ endpoint: Endpoint,
        as type: T.Type,
        decoder: JSONDecoder = JSONDecoder()
    ) async throws -> T {
        let req = buildRequest(for: endpoint)
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch let urlError as URLError {
            throw APIError.network(urlError)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.network(URLError(.badServerResponse))
        }

        switch http.statusCode {
        case 200...299:
            // Recognize the "not configured" envelope before attempting full decode.
            if let env = try? JSONDecoder().decode(NotConfiguredEnvelope.self, from: data),
               env.ok == false, env.skipped == true, let code = env.code {
                throw APIError.notConfigured(code: code)
            }
            do { return try decoder.decode(T.self, from: data) }
            catch { throw APIError.decode(String(describing: error)) }
        case 401: throw APIError.unauthorized
        case 403: throw APIError.forbidden
        default:
            let body = try? JSONDecoder().decode(ServerErrorBody.self, from: data)
            throw APIError.server(status: http.statusCode, code: body?.code, message: body?.message)
        }
    }

    internal func buildRequest(for endpoint: Endpoint) -> URLRequest {
        // Build via URLComponents so query items are encoded correctly and
        // a path string like "api/auth/login" composes with baseURL safely.
        let baseString = baseURL.absoluteString.hasSuffix("/")
            ? baseURL.absoluteString
            : baseURL.absoluteString + "/"
        let trimmedPath = endpoint.path.hasPrefix("/")
            ? String(endpoint.path.dropFirst())
            : endpoint.path
        var components = URLComponents(string: baseString + trimmedPath)
            ?? URLComponents(url: baseURL, resolvingAgainstBaseURL: true)!
        if let items = endpoint.queryItems, !items.isEmpty {
            components.queryItems = (components.queryItems ?? []) + items
        }
        let url = components.url ?? baseURL
        var req = URLRequest(url: url)
        req.httpMethod = endpoint.method.rawValue
        for (k, v) in endpoint.headers { req.setValue(v, forHTTPHeaderField: k) }
        if let token = tokenProvider() {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body = endpoint.body {
            req.httpBody = body
            if req.value(forHTTPHeaderField: "Content-Type") == nil {
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
        }
        return req
    }
}

private struct NotConfiguredEnvelope: Decodable {
    let ok: Bool?
    let skipped: Bool?
    let code: String?
}

private struct ServerErrorBody: Decodable {
    let code: String?
    let message: String?
}
