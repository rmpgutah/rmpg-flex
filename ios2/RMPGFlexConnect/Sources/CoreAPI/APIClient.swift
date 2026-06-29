import Foundation

public actor APIClient {
    private let baseURL: String
    private let session: URLSession
    private var authToken: String?

    public init(baseURL: String = Endpoint.productionBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func setAuthToken(_ token: String?) {
        authToken = token
    }

    public func request<T: Decodable>(_ endpoint: Endpoint) async throws -> T {
        let (data, response) = try await perform(endpoint)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.unknown("Invalid response")
        }

        switch httpResponse.statusCode {
        case 200...299:
            do {
                let decoder = JSONDecoder()
                decoder.keyDecodingStrategy = .convertFromSnakeCase
                return try decoder.decode(T.self, from: data)
            } catch {
                throw APIError.decodingError(error)
            }
        case 401:
            throw APIError.unauthorized
        case 403:
            throw APIError.forbidden
        case 404:
            throw APIError.notFound
        case 500...599:
            let body = String(data: data, encoding: .utf8) ?? ""
            throw APIError.serverError(body)
        default:
            let body = String(data: data, encoding: .utf8) ?? ""
            throw APIError.httpError(status: httpResponse.statusCode, body: body)
        }
    }

    public func requestVoid(_ endpoint: Endpoint) async throws {
        let (data, response) = try await perform(endpoint)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.unknown("Invalid response")
        }
        switch httpResponse.statusCode {
        case 200...299:
            return
        case 401:
            throw APIError.unauthorized
        case 403:
            throw APIError.forbidden
        case 404:
            throw APIError.notFound
        case 500...599:
            let body = String(data: data, encoding: .utf8) ?? ""
            throw APIError.serverError(body)
        default:
            let body = String(data: data, encoding: .utf8) ?? ""
            throw APIError.httpError(status: httpResponse.statusCode, body: body)
        }
    }

    private func perform(_ endpoint: Endpoint) async throws -> (Data, URLResponse) {
        var urlComponents = URLComponents(string: "\(baseURL)\(endpoint.path)")
        if !endpoint.queryItems.isEmpty {
            urlComponents?.queryItems = endpoint.queryItems
        }
        guard let url = urlComponents?.url else {
            throw APIError.invalidURL("\(baseURL)\(endpoint.path)")
        }

        var request = URLRequest(url: url, timeoutInterval: endpoint.timeout)
        request.httpMethod = endpoint.method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if endpoint.requiresAuth, let token = authToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body = endpoint.body {
            request.httpBody = body
        }

        return try await session.data(for: request)
    }
}
