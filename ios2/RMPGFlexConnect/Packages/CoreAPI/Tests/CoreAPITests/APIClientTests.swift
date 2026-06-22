import XCTest
@testable import CoreAPI

final class APIClientTests: XCTestCase {
    private func makeClient(token: String? = nil, handler: @escaping (URLRequest) -> (HTTPURLResponse, Data)) -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        StubURLProtocol.handler = handler
        return APIClient(
            baseURL: URL(string: "https://api.test.example")!,
            session: URLSession(configuration: config),
            tokenProvider: { token }
        )
    }

    func testBuildsBearerHeaderWhenTokenPresent() async throws {
        var captured: URLRequest?
        let client = makeClient(token: "tok-abc") { req in
            captured = req
            return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data("{}".utf8))
        }
        struct Empty: Decodable {}
        _ = try? await client.request(Endpoint(method: .get, path: "ping"), as: Empty.self)
        XCTAssertEqual(captured?.value(forHTTPHeaderField: "Authorization"), "Bearer tok-abc")
    }

    func testOmitsAuthorizationWhenNoToken() async throws {
        var captured: URLRequest?
        let client = makeClient(token: nil) { req in
            captured = req
            return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data("{}".utf8))
        }
        struct Empty: Decodable {}
        _ = try? await client.request(Endpoint(method: .get, path: "ping"), as: Empty.self)
        XCTAssertNil(captured?.value(forHTTPHeaderField: "Authorization"))
    }

    func test401MapsToUnauthorized() async {
        let client = makeClient(token: "tok") { req in
            (HTTPURLResponse(url: req.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!, Data())
        }
        struct Empty: Decodable {}
        do {
            _ = try await client.request(Endpoint(method: .get, path: "x"), as: Empty.self)
            XCTFail("expected throw")
        } catch let e as APIError {
            XCTAssertEqual(e, .unauthorized)
        } catch { XCTFail("wrong error: \(error)") }
    }

    func test403MapsToForbidden() async {
        let client = makeClient(token: "tok") { req in
            (HTTPURLResponse(url: req.url!, statusCode: 403, httpVersion: nil, headerFields: nil)!, Data())
        }
        struct Empty: Decodable {}
        do {
            _ = try await client.request(Endpoint(method: .get, path: "x"), as: Empty.self)
            XCTFail("expected throw")
        } catch let e as APIError {
            XCTAssertEqual(e, .forbidden)
        } catch { XCTFail("wrong error: \(error)") }
    }

    func testNotConfiguredEnvelopeIsRecognized() async {
        let body = #"{"ok":false,"skipped":true,"code":"fleetio_disabled"}"#
        let client = makeClient(token: "tok") { req in
            (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
        }
        struct Empty: Decodable {}
        do {
            _ = try await client.request(Endpoint(method: .get, path: "x"), as: Empty.self)
            XCTFail("expected throw")
        } catch let e as APIError {
            XCTAssertEqual(e, .notConfigured(code: "fleetio_disabled"))
        } catch { XCTFail("wrong error: \(error)") }
    }

    func test5xxMapsToServerError() async {
        let body = #"{"code":"boom","message":"db is sad"}"#
        let client = makeClient(token: "tok") { req in
            (HTTPURLResponse(url: req.url!, statusCode: 500, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
        }
        struct Empty: Decodable {}
        do {
            _ = try await client.request(Endpoint(method: .get, path: "x"), as: Empty.self)
            XCTFail("expected throw")
        } catch let e as APIError {
            XCTAssertEqual(e, .server(status: 500, code: "boom", message: "db is sad"))
        } catch { XCTFail("wrong error: \(error)") }
    }

    func testQueryItemsAreEncodedInURL() async throws {
        var captured: URLRequest?
        let client = makeClient(token: "tok") { req in
            captured = req
            return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data("{}".utf8))
        }
        struct Empty: Decodable {}
        let endpoint = Endpoint(
            method: .get,
            path: "alpr/captures",
            queryItems: [URLQueryItem(name: "call_id", value: "123"), URLQueryItem(name: "limit", value: "20")]
        )
        _ = try? await client.request(endpoint, as: Empty.self)
        let url = captured?.url?.absoluteString ?? ""
        XCTAssertTrue(url.contains("alpr/captures"), "URL should contain path; got \(url)")
        XCTAssertTrue(url.contains("call_id=123"), "URL should contain call_id query; got \(url)")
        XCTAssertTrue(url.contains("limit=20"), "URL should contain limit query; got \(url)")
    }

    func testPathWithLeadingSlashDoesNotDoubleSlash() async throws {
        var captured: URLRequest?
        let client = makeClient(token: "tok") { req in
            captured = req
            return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data("{}".utf8))
        }
        struct Empty: Decodable {}
        _ = try? await client.request(Endpoint(method: .get, path: "/api/health"), as: Empty.self)
        let url = captured?.url?.absoluteString ?? ""
        // Strip the scheme so `https://` does not match the path-level
        // double-slash check.
        let afterScheme = url.replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: "http://", with: "")
        XCTAssertFalse(afterScheme.contains("//"), "Should not have double slash in path; got \(url)")
        XCTAssertTrue(url.hasSuffix("/api/health"), "Should end with /api/health; got \(url)")
    }
}

/// URLProtocol stub for synchronous test injection.
final class StubURLProtocol: URLProtocol {
    static var handler: ((URLRequest) -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let h = Self.handler else { fatalError("no handler") }
        let (resp, data) = h(request)
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
