import XCTest
@testable import CoreAuth

final class JWTTests: XCTestCase {
    // A real-shaped JWT (signature ignored on decode): header.payload.signature
    // Payload: {"role":"officer","sub":"219","exp":2000000000}
    private let officerToken = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoib2ZmaWNlciIsInN1YiI6IjIxOSIsImV4cCI6MjAwMDAwMDAwMH0.sig"
    // Payload: {"role":"admin","sub":"42"}
    private let adminToken   = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYWRtaW4iLCJzdWIiOiI0MiJ9.sig"

    func testDecodesRoleAndSub() throws {
        let p = try JWT.decode(officerToken)
        XCTAssertEqual(p.role, "officer")
        XCTAssertEqual(p.sub, "219")
        XCTAssertEqual(p.exp?.timeIntervalSince1970, 2_000_000_000)
    }

    func testDecodesAdminRole() throws {
        let p = try JWT.decode(adminToken)
        XCTAssertEqual(p.role, "admin")
        XCTAssertNil(p.exp)
    }

    func testMalformedThrows() {
        XCTAssertThrowsError(try JWT.decode("not.a.jwt.too.many.parts")) { e in
            XCTAssertEqual(e as? JWT.DecodeError, .malformed)
        }
        XCTAssertThrowsError(try JWT.decode("nodotshere")) { e in
            XCTAssertEqual(e as? JWT.DecodeError, .malformed)
        }
    }

    func testInvalidPayloadThrows() {
        // Header.body.sig but body is not valid base64url JSON.
        let bad = "abc.@@@.sig"
        XCTAssertThrowsError(try JWT.decode(bad))
    }
}
