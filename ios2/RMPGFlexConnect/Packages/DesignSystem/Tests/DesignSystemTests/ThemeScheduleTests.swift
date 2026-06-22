import XCTest
@testable import DesignSystem

final class ThemeScheduleTests: XCTestCase {
    /// Denver-pinned calendar so tests are deterministic across timezones (CI runs UTC).
    private static let denverCalendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/Denver")!
        return cal
    }()

    private func date(hour: Int) -> Date {
        var c = DateComponents()
        c.year = 2026; c.month = 6; c.day = 22
        c.hour = hour
        c.minute = 0
        c.timeZone = TimeZone(identifier: "America/Denver")
        return Self.denverCalendar.date(from: c)!
    }

    func testNightBefore6am() {
        XCTAssertEqual(ThemeSchedule.resolveScheduled(for: date(hour: 5), calendar: Self.denverCalendar), .night)
    }

    func testDayAt6amExactly() {
        XCTAssertEqual(ThemeSchedule.resolveScheduled(for: date(hour: 6), calendar: Self.denverCalendar), .day)
    }

    func testDayAt12() {
        XCTAssertEqual(ThemeSchedule.resolveScheduled(for: date(hour: 12), calendar: Self.denverCalendar), .day)
    }

    func testNightAt6pmExactly() {
        XCTAssertEqual(ThemeSchedule.resolveScheduled(for: date(hour: 18), calendar: Self.denverCalendar), .night)
    }

    func testNightAfter6pm() {
        XCTAssertEqual(ThemeSchedule.resolveScheduled(for: date(hour: 22), calendar: Self.denverCalendar), .night)
    }

    func testManualOverrideActiveWins() {
        let m = ThemeSchedule.resolveEffective(
            override: (.day, active: true),
            for: date(hour: 22),
            calendar: Self.denverCalendar
        )
        XCTAssertEqual(m, .day)
    }

    func testManualOverrideInactiveDefersToSchedule() {
        let m = ThemeSchedule.resolveEffective(
            override: (.day, active: false),
            for: date(hour: 22),
            calendar: Self.denverCalendar
        )
        XCTAssertEqual(m, .night)
    }

    func testNoOverrideUsesSchedule() {
        let m = ThemeSchedule.resolveEffective(
            override: nil,
            for: date(hour: 10),
            calendar: Self.denverCalendar
        )
        XCTAssertEqual(m, .day)
    }
}
