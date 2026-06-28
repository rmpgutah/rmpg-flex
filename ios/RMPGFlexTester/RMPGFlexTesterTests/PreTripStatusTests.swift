import XCTest
@testable import RMPGFlexTester

final class PreTripStatusTests: XCTestCase {
    private func insp(_ type: String, _ date: String) -> [String: Any] {
        ["inspection_type": type, "inspection_date": date]
    }
    func testDetectsPreTripToday() {
        let rows = [insp("pre_trip", "2026-06-15T08:00:00Z"), insp("post_trip", "2026-06-14T20:00:00Z")]
        XCTAssertTrue(PreTripStatus.hasPreTrip(in: rows, onDay: "2026-06-15"))
    }
    func testIgnoresOtherDays() {
        let rows = [insp("pre_trip", "2026-06-14T08:00:00Z")]
        XCTAssertFalse(PreTripStatus.hasPreTrip(in: rows, onDay: "2026-06-15"))
    }
    func testIgnoresNonPreTrip() {
        let rows = [insp("post_trip", "2026-06-15T08:00:00Z")]
        XCTAssertFalse(PreTripStatus.hasPreTrip(in: rows, onDay: "2026-06-15"))
    }
    func testEmptyAndMalformed() {
        XCTAssertFalse(PreTripStatus.hasPreTrip(in: [], onDay: "2026-06-15"))
        XCTAssertFalse(PreTripStatus.hasPreTrip(in: [["foo": "bar"]], onDay: "2026-06-15"))
    }
}
