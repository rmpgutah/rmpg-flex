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

    /// Multipart file upload (e.g. `POST /api/uploads`) — the JSON `request()`
    /// path always sends `Content-Type: application/json`, which breaks a
    /// multipart body, so uploads need their own request builder.
    public func uploadMultipart<T: Decodable>(
        path: String,
        fileFieldName: String = "files",
        fileName: String,
        mimeType: String,
        fileData: Data,
        formFields: [String: String] = [:]
    ) async throws -> T {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw APIError.invalidURL("\(baseURL)\(path)")
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        var request = URLRequest(url: url, timeoutInterval: 60)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = authToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        var body = Data()
        for (key, value) in formFields {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(fileFieldName)\"; filename=\"\(fileName)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(fileData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let (data, response) = try await session.data(for: request)
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
            throw APIError.serverError(String(data: data, encoding: .utf8) ?? "")
        default:
            throw APIError.httpError(status: httpResponse.statusCode, body: String(data: data, encoding: .utf8) ?? "")
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
