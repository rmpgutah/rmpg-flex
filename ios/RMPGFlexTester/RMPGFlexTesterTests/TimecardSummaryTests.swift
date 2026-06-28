import XCTest
@testable import RMPGFlexTester

final class TimecardSummaryTests: XCTestCase {
    private func e(_ clockIn: String, _ hours: Double?) -> [String: Any] {
        var d: [String: Any] = ["clock_in": clockIn]
        if let hours { d["total_hours"] = hours }
        return d
    }
    // Reference "now" = 2026-06-15T12:00:00Z; week window = >= 2026-06-08.
    private let now = Date(timeIntervalSince1970: 1781524800)

    func testSumsHoursWithinLastSevenDays() {
        let rows = [e("2026-06-15T08:00:00Z", 4), e("2026-06-10T08:00:00Z", 8), e("2026-06-01T08:00:00Z", 8)]
        // 4 + 8 (June 1 is outside the 7-day window) = 12
        XCTAssertEqual(TimecardSummary.hoursThisWeek(rows, now: now), 12, accuracy: 0.01)
    }
    func testIgnoresMissingHours() {
        let rows = [e("2026-06-14T08:00:00Z", nil), e("2026-06-14T20:00:00Z", 5)]
        XCTAssertEqual(TimecardSummary.hoursThisWeek(rows, now: now), 5, accuracy: 0.01)
    }
    func testEmpty() {
        XCTAssertEqual(TimecardSummary.hoursThisWeek([], now: now), 0, accuracy: 0.01)
    }
}
