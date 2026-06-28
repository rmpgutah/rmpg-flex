import XCTest
@testable import CoreAPI

final class APIErrorTests: XCTestCase {
    func testNotConfiguredEquality() {
        XCTAssertEqual(
            APIError.notConfigured(code: "fleetio_disabled"),
            APIError.notConfigured(code: "fleetio_disabled")
        )
        XCTAssertNotEqual(
            APIError.notConfigured(code: "a"),
            APIError.notConfigured(code: "b")
        )
    }

    func testServerErrorEquality() {
        XCTAssertEqual(
            APIError.server(status: 500, code: "boom", message: "nope"),
            APIError.server(status: 500, code: "boom", message: "nope")
        )
        XCTAssertNotEqual(
            APIError.server(status: 500, code: nil, message: nil),
            APIError.server(status: 502, code: nil, message: nil)
        )
    }

    func testUnauthorizedAndForbiddenSelfEqual() {
        XCTAssertEqual(APIError.unauthorized, APIError.unauthorized)
        XCTAssertEqual(APIError.forbidden, APIError.forbidden)
        XCTAssertNotEqual(APIError.unauthorized, APIError.forbidden)
    }
}
