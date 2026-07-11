import XCTest
@testable import CoreCarPlay

final class CarPlayQuickReplyPayloadTests: XCTestCase {
    func testCannedMessageText() {
        XCTAssertEqual(CannedMessage.enRoute.text, "En Route")
        XCTAssertEqual(CannedMessage.onScene.text, "On Scene")
        XCTAssertEqual(CannedMessage.clear.text, "Clear")
        XCTAssertEqual(CannedMessage.needBackup.text, "Need Backup")
    }

    func testAllCasesOrder() {
        XCTAssertEqual(CannedMessage.allCases, [.enRoute, .onScene, .clear, .needBackup])
    }

    func testMdtSendPayloadShape() {
        let payload = CarPlayQuickReplyPayload.mdtSendPayload(text: "En Route")
        XCTAssertEqual(payload["to"] as? String, "mdt")
        XCTAssertEqual(payload["type"] as? String, "text")
        let inner = payload["payload"] as? [String: String]
        XCTAssertEqual(inner?["text"], "En Route")
    }
}
