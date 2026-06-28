import XCTest
@testable import RMPGFlexTester

final class WAFDetectionTests: XCTestCase {
    func testChallengePageDetected() {
        XCTAssertTrue(RMPGAPIClient.isWAFChallenge(
            status: 403,
            body: "<html><title>Just a moment...</title></html>",
            headers: [:]))
        XCTAssertTrue(RMPGAPIClient.isWAFChallenge(
            status: 403, body: "<script src=\"/cdn-cgi/challenge-platform/x.js\">", headers: [:]))
    }

    func testCfMitigatedHeaderDetectedRegardlessOfStatus() {
        XCTAssertTrue(RMPGAPIClient.isWAFChallenge(
            status: 503, body: "", headers: ["cf-mitigated": "challenge"]))
    }

    func testPlain403IsNotChallenge() {
        XCTAssertFalse(RMPGAPIClient.isWAFChallenge(
            status: 403, body: "{\"error\":\"forbidden\"}", headers: [:]))
    }

    func testSuccessIsNotChallenge() {
        XCTAssertFalse(RMPGAPIClient.isWAFChallenge(
            status: 200, body: "{\"ok\":true}", headers: [:]))
    }
}
