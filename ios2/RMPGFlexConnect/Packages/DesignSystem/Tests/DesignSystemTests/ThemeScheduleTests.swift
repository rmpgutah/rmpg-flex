import XCTest
@testable import DesignSystem

final class ThemeScheduleTests: XCTestCase {
    private func date(hour: Int) -> Date {
        var c = DateComponents()
        c.year = 2026; c.month = 6; c.day = 22
        c.hour = hour
        c.minute = 0
        c.timeZone = TimeZone(identifier: "America/Denver")
        return Calendar(identifier: .gregorian).date(from: c)!
    }

    func testNightBefore6am() {
        XCTAssertEqual(ThemeSchedule.resolveScheduled(for: date(hour: 5)), .night)
    }

    func testDayAt6amExactly() {
        XCTAssertEqual(ThemeSchedule.resolveScheduled(for: date(hour: 6)), .day)
    }

    func testDayAt12() {
        XCTAssertEqual(ThemeSchedule.resolveScheduled(for: date(hour: 12)), .day)
    }

    func testNightAt6pmExactly() {
        XCTAssertEqual(ThemeSchedule.resolveScheduled(for: date(hour: 18)), .night)
    }

    func testNightAfter6pm() {
        XCTAssertEqual(ThemeSchedule.resolveScheduled(for: date(hour: 22)), .night)
    }

    func testManualOverrideActiveWins() {
        let m = ThemeSchedule.resolveEffective(
            override: (.day, active: true),
            for: date(hour: 22)
        )
        XCTAssertEqual(m, .day)
    }

    func testManualOverrideInactiveDefersToSchedule() {
        let m = ThemeSchedule.resolveEffective(
            override: (.day, active: false),
            for: date(hour: 22)
        )
        XCTAssertEqual(m, .night)
    }

    func testNoOverrideUsesSchedule() {
        let m = ThemeSchedule.resolveEffective(
            override: nil,
            for: date(hour: 10)
        )
        XCTAssertEqual(m, .day)
    }
}
