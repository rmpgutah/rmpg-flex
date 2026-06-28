import XCTest
@testable import RMPGFlexTester

final class MDTMessageTests: XCTestCase {
    func testParseInbox() {
        let obj: [String: Any] = [
            "counterpart_online": true,
            "messages": [
                ["id": 2, "type": "call", "payload": ["call_id": 42], "created_at": "2026-06-13 10:00:00"],
                ["id": 3, "type": "text", "payload": ["text": "head to 200 S Main"]],
                ["id": 4, "payload": [:]],  // missing type → dropped
            ],
        ]
        let (msgs, online) = MDTInbox.parse(obj)
        XCTAssertTrue(online)
        XCTAssertEqual(msgs.count, 2)
        XCTAssertEqual(msgs[0].id, 2)
        XCTAssertEqual(msgs[0].type, "call")
        XCTAssertEqual(msgs[0].payload["call_id"] as? Int, 42)
        XCTAssertEqual(msgs[1].type, "text")
    }

    func testParseEmptyDefaults() {
        let (msgs, online) = MDTInbox.parse([:])
        XCTAssertEqual(msgs.count, 0)
        XCTAssertFalse(online)
    }

    func testLabels() {
        XCTAssertEqual(MDTInbox.label(for: "call"), "Respond to call")
        XCTAssertEqual(MDTInbox.label(for: "nav"), "Navigate to location")
        XCTAssertEqual(MDTInbox.label(for: "weird"), "Weird")
    }
}
