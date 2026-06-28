import Foundation

enum SmokeOutcome {
    case pass(Int, ms: Int)
    case fail(Int, String)
    case wafChallenge
    case transport(String)
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

    // Build a request URL that PRESERVES query strings. URL.appendingPathComponent
    // treats the whole arg as one path segment and percent-encodes "?" → "%3F",
    // which turned `api/x?limit=1` into the bogus path `/api/x%3Flimit=1` and 404'd
    // every queried endpoint. Concatenating into the URL string keeps "?" a query.
    // Callers already percent-encode dynamic query VALUES (e.g. ?q=<name>).
    private func makeURL(_ path: String) -> URL {
        URL(string: baseURL.absoluteString + "/" + path) ?? baseURL.appendingPathComponent(path)
    }

    func login(username: String, password: String) async throws -> String {
        var req = URLRequest(url: makeURL("api/auth/login"))
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
        var req = URLRequest(url: makeURL(path))
        req.httpMethod = method
        if let jwt { req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            // Attach the parsed JSON error body (when there is one) so callers
            // can branch on the Worker's `code` contract (NEEDS_VEHICLE,
            // MILEAGE_DECREASING, …) instead of string-matching the message.
            let text = String(data: data, encoding: .utf8) ?? ""
            var info: [String: Any] = [NSLocalizedDescriptionKey: "HTTP \(status): \(text.prefix(200))"]
            if let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                info["json"] = body
                if let msg = body["error"] as? String {
                    info[NSLocalizedDescriptionKey] = msg
                }
            }
            throw NSError(domain: "RMPG", code: status, userInfo: info)
        }
        return try JSONSerialization.jsonObject(with: data)
    }

    /// The Worker's machine-readable error `code` from a thrown request error.
    static func apiCode(_ error: Error) -> String? {
        ((error as NSError).userInfo["json"] as? [String: Any])?["code"] as? String
    }
    /// The full parsed JSON error body, when the server sent one.
    static func apiBody(_ error: Error) -> [String: Any]? {
        (error as NSError).userInfo["json"] as? [String: Any]
    }

    func postJSON(_ path: String, body: [String: Any]) async throws {
        var req = URLRequest(url: makeURL(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let jwt { req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization") }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "RMPG", code: status,
                          userInfo: [NSLocalizedDescriptionKey: "HTTP \(status): \(text.prefix(150))"])
        }
    }

    /// POST JSON and return the decoded object (for endpoints that reply
    /// with data we need, e.g. a new recording id).
    func postJSONReturning(_ path: String, body: [String: Any]) async throws -> Any {
        var req = URLRequest(url: makeURL(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let jwt { req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization") }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "RMPG", code: status,
                          userInfo: [NSLocalizedDescriptionKey: "HTTP \(status): \(text.prefix(150))"])
        }
        return try JSONSerialization.jsonObject(with: data)
    }

    /// Raw PUT of binary data (audio segment) with an explicit content-type.
    func putData(_ path: String, data: Data, contentType: String) async throws {
        var req = URLRequest(url: makeURL(path))
        req.httpMethod = "PUT"
        req.setValue(contentType, forHTTPHeaderField: "Content-Type")
        if let jwt { req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization") }
        req.httpBody = data
        let (respData, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let text = String(data: respData, encoding: .utf8) ?? ""
            throw NSError(domain: "RMPG", code: status,
                          userInfo: [NSLocalizedDescriptionKey: "HTTP \(status): \(text.prefix(150))"])
        }
    }

    func probe(_ path: String) async -> SmokeOutcome {
        var req = URLRequest(url: makeURL(path))
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
