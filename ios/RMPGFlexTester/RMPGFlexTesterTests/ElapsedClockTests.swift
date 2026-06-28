import XCTest
@testable import RMPGFlexTester

final class ElapsedClockTests: XCTestCase {
    func testParsesD1UTCTimestamp() {
        // D1 datetime('now') format, no timezone suffix → treated as UTC.
        let d = ElapsedClock.parseUTC("2026-06-15 14:30:00")
        XCTAssertNotNil(d)
        XCTAssertEqual(d!.timeIntervalSince1970, 1781533800, accuracy: 1)
    }
    func testParsesISO8601() {
        let d = ElapsedClock.parseUTC("2026-06-15T14:30:00Z")
        XCTAssertNotNil(d)
        XCTAssertEqual(d!.timeIntervalSince1970, 1781533800, accuracy: 1)
    }
    func testParseNilAndGarbage() {
        XCTAssertNil(ElapsedClock.parseUTC(nil))
        XCTAssertNil(ElapsedClock.parseUTC(""))
        XCTAssertNil(ElapsedClock.parseUTC("not a date"))
    }
    func testElapsedUnderOneHourIsMinutesSeconds() {
        let start = Date(timeIntervalSince1970: 1000)
        XCTAssertEqual(ElapsedClock.elapsed(since: start, now: Date(timeIntervalSince1970: 1000 + 5)), "0m 05s")
        XCTAssertEqual(ElapsedClock.elapsed(since: start, now: Date(timeIntervalSince1970: 1000 + 12 * 60 + 4)), "12m 04s")
    }
    func testElapsedOverOneHourIsHoursMinutes() {
        let start = Date(timeIntervalSince1970: 1000)
        XCTAssertEqual(ElapsedClock.elapsed(since: start, now: Date(timeIntervalSince1970: 1000 + 3600 + 23 * 60)), "1h 23m")
    }
    func testElapsedNeverNegative() {
        let start = Date(timeIntervalSince1970: 2000)
        XCTAssertEqual(ElapsedClock.elapsed(since: start, now: Date(timeIntervalSince1970: 1000)), "0m 00s")
    }
}
