import XCTest
@testable import RMPGFlexTester

final class PhotoBurnLinesTests: XCTestCase {
    func testFullStamp() {
        let f = BurnFields(timestamp: "2026-06-13 14:30:00", officer: "J. Doe",
                           badge: "42", unit: "D19", gps: "40.76, -111.89", caseRef: "26-RMP-00042")
        XCTAssertEqual(PhotoBurnLines.lines(f), [
            "2026-06-13 14:30:00",
            "RMPG · J. Doe #42 · D19",
            "GPS 40.76, -111.89",
            "26-RMP-00042",
        ])
    }
    func testMinimalStamp() {
        XCTAssertEqual(PhotoBurnLines.lines(BurnFields(timestamp: "T")), ["T", "RMPG"])
    }
    func testPartial() {
        let f = BurnFields(timestamp: "T", officer: "Doe", gps: "1, 2")
        XCTAssertEqual(PhotoBurnLines.lines(f), ["T", "RMPG · Doe", "GPS 1, 2"])
    }
}
