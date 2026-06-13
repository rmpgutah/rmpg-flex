import Foundation

enum SmokeOutcome {
    case pass(Int, ms: Int)
    case fail(Int, String)
    case wafChallenge
    case transport(String)
}

/// Typed API error. Parses the Worker's `{ error|message, code, ... }` body
/// so callers get the server's own words (and machine `code`) instead of a
/// raw "HTTP 409: {json}" blob. The full decoded payload is kept so actionable
/// conflicts (duty-start NEEDS_VEHICLE carrying `available_vehicles`,
/// NEEDS_MILEAGE carrying `previous_mileage`) can be handled, not just shown.
struct APIError: LocalizedError {
    let status: Int
    let code: String?
    let serverMessage: String?
    let payload: [String: Any]

    /// True for 409 Conflict — a state clash the officer can usually resolve
    /// (already clocked in, unit on call, vehicle taken, mileage needed).
    var isConflict: Bool { status == 409 }

    var errorDescription: String? {
        if let m = serverMessage, !m.isEmpty { return m }
        return "Request failed (HTTP \(status))"
    }

    static func from(status: Int, data: Data) -> APIError {
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let msg = (obj["error"] as? String) ?? (obj["message"] as? String)
            ?? (obj["hint"] as? String)
        return APIError(status: status, code: obj["code"] as? String,
                        serverMessage: msg, payload: obj)
    }
}

struct RMPGAPIClient {
    var baseURL = URL(string: "https://api.rmpgutah.us")!
    var jwt: String?

    // The Cloudflare managed challenge 403s non-browser clients with an HTML
    // interstitial; surface that distinctly instead of as a JSON parse failure.
    static func isWAFChallenge(status: Int, body: String, headers: [AnyHashable: Any]) -> Bool {
        if let mitigated = headers["cf-mitigated"] as? String,
           mitigated.lowercased().contains("challenge") {
            return true
        }
        guard status == 403 else { return false }
        return body.contains("Just a moment") || body.contains("cf-chl")
            || body.contains("challenge-platform")
    }

    func login(username: String, password: String) async throws -> String {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/auth/login"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "username": username, "password": password,
        ])
        let (data, resp) = try await URLSession.shared.data(for: req)
        let http = resp as? HTTPURLResponse
        let body = String(data: data, encoding: .utf8) ?? ""
        if Self.isWAFChallenge(status: http?.statusCode ?? 0, body: body,
                               headers: http?.allHeaderFields ?? [:]) {
            throw NSError(domain: "RMPG", code: 403,
                          userInfo: [NSLocalizedDescriptionKey: "Blocked by WAF managed challenge"])
        }
        guard http?.statusCode == 200,
              let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = obj["token"] as? String else {
            throw NSError(domain: "RMPG", code: http?.statusCode ?? 0,
                          userInfo: [NSLocalizedDescriptionKey: "Login failed (\(http?.statusCode ?? 0)): \(body.prefix(200))"])
        }
        return token
    }

    /// Generic authenticated request returning parsed JSON (object or array).
    @discardableResult
    func requestJSON(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> Any {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        if let jwt { req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw APIError.from(status: status, data: data)
        }
        return try JSONSerialization.jsonObject(with: data)
    }

    func postJSON(_ path: String, body: [String: Any]) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let jwt { req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization") }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw APIError.from(status: status, data: data)
        }
    }

    /// POST JSON and return the decoded object (for endpoints that reply
    /// with data we need, e.g. a new recording id).
    func postJSONReturning(_ path: String, body: [String: Any]) async throws -> Any {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let jwt { req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization") }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw APIError.from(status: status, data: data)
        }
        return try JSONSerialization.jsonObject(with: data)
    }

    /// Raw PUT of binary data (audio segment) with an explicit content-type.
    func putData(_ path: String, data: Data, contentType: String) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "PUT"
        req.setValue(contentType, forHTTPHeaderField: "Content-Type")
        if let jwt { req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization") }
        req.httpBody = data
        let (respData, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw APIError.from(status: status, data: respData)
        }
    }

    func probe(_ path: String) async -> SmokeOutcome {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        if let jwt { req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization") }
        let start = Date()
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            let ms = Int(Date().timeIntervalSince(start) * 1000)
            let http = resp as? HTTPURLResponse
            let status = http?.statusCode ?? 0
            let body = String(data: data, encoding: .utf8) ?? ""
            if Self.isWAFChallenge(status: status, body: body,
                                   headers: http?.allHeaderFields ?? [:]) {
                return .wafChallenge
            }
            return (200..<300).contains(status)
                ? .pass(status, ms: ms)
                : .fail(status, String(body.prefix(200)))
        } catch {
            return .transport(error.localizedDescription)
        }
    }
}
