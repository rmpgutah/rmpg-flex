import XCTest
@testable import RMPGFlexTester

final class CountParseTests: XCTestCase {
    func testRowCountFromArray() {
        XCTAssertEqual(CountParse.rowCount([["id": 1], ["id": 2]]), 2)
    }
    func testRowCountFromWrappedKeys() {
        XCTAssertEqual(CountParse.rowCount(["results": [["a": 1]]]), 1)
        XCTAssertEqual(CountParse.rowCount(["calls": [["a": 1], ["b": 2], ["c": 3]]]), 3)
    }
    func testRowCountFallsBackToZero() {
        XCTAssertEqual(CountParse.rowCount(nil), 0)
        XCTAssertEqual(CountParse.rowCount("nope"), 0)
        XCTAssertEqual(CountParse.rowCount(["other": 5]), 0)
    }
    func testIntFieldDirectAndWrapped() {
        XCTAssertEqual(CountParse.intField(7, ["count"]), 7)
        XCTAssertEqual(CountParse.intField(["unread_count": 4], ["count", "unread_count"]), 4)
    }
    func testIntFieldFallsBackToZero() {
        XCTAssertEqual(CountParse.intField(nil, ["count"]), 0)
        XCTAssertEqual(CountParse.intField(["x": 1], ["count"]), 0)
    }
}
