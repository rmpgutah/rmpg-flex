import XCTest
@testable import RMPGFlexTester

final class SpokenAlertTests: XCTestCase {
    func testPhraseFullCall() {
        let call: [String: Any] = [
            "priority": "P1",
            "incident_type": "disturbance",
            "weapons_involved": 1,
            "location_address": "1450 S State St",
        ]
        XCTAssertEqual(
            SpokenAlert.phrase(for: call),
            "New Priority 1. Disturbance. Weapons involved. 1450 South State Street.")
    }

    func testPhraseNoPriorityNoHazards() {
        let call: [String: Any] = ["incident_type": "welfare_check", "address": "200 E Center"]
        XCTAssertEqual(SpokenAlert.phrase(for: call), "New call. Welfare Check. 200 East Center.")
    }

    func testShouldSpeakThreshold() {
        XCTAssertTrue(SpokenAlert.shouldSpeak(callId: 5, isP1: true,  hasHazards: false, lastSpokenId: nil))
        XCTAssertTrue(SpokenAlert.shouldSpeak(callId: 5, isP1: false, hasHazards: true,  lastSpokenId: nil))
        XCTAssertFalse(SpokenAlert.shouldSpeak(callId: 5, isP1: false, hasHazards: false, lastSpokenId: nil))
        XCTAssertFalse(SpokenAlert.shouldSpeak(callId: 5, isP1: true,  hasHazards: true,  lastSpokenId: 5)) // dedup
    }

    func testSpokenAddressExpansion() {
        XCTAssertEqual(SpokenAlert.spokenAddress("1450 S State St"), "1450 South State Street")
        XCTAssertEqual(SpokenAlert.spokenAddress("88 W Temple Ave"), "88 West Temple Avenue")
    }

    func testPriorityParsing() {
        XCTAssertEqual(SpokenAlert.priorityNumber(["priority": "P2"]), 2)
        XCTAssertEqual(SpokenAlert.priorityNumber(["priority": 3]), 3)
        XCTAssertNil(SpokenAlert.priorityNumber([:]))
    }
}
