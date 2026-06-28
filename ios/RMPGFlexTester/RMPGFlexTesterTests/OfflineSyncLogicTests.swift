import XCTest
@testable import RMPGFlexTester

final class OfflineSyncLogicTests: XCTestCase {
    func testShouldQueueOfflineErrors() {
        XCTAssertTrue(OfflineSyncLogic.shouldQueue(NSError(domain: NSURLErrorDomain, code: NSURLErrorNotConnectedToInternet)))
        XCTAssertTrue(OfflineSyncLogic.shouldQueue(NSError(domain: NSURLErrorDomain, code: NSURLErrorNetworkConnectionLost)))
        XCTAssertTrue(OfflineSyncLogic.shouldQueue(NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut)))
    }
    func testDoesNotQueueServerOrCancelled() {
        XCTAssertFalse(OfflineSyncLogic.shouldQueue(NSError(domain: "RMPG", code: 400)))   // server answer
        XCTAssertFalse(OfflineSyncLogic.shouldQueue(NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled)))
    }
    func testSummary() {
        XCTAssertEqual(OfflineSyncLogic.summary(sent: 0, rejected: 0), "Nothing to sync")
        XCTAssertEqual(OfflineSyncLogic.summary(sent: 3, rejected: 0), "✓ 3 sent")
        XCTAssertEqual(OfflineSyncLogic.summary(sent: 2, rejected: 1), "✓ 2 sent · ✗ 1 rejected")
    }
}
