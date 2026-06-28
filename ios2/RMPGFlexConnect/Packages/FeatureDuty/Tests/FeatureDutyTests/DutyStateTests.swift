import XCTest
@testable import FeatureDuty

@MainActor
final class DutyStateTests: XCTestCase {
    func testInitialState() {
        let s = DutyState()
        XCTAssertFalse(s.isOnDuty)
        XCTAssertNil(s.shiftStartedAt)
        XCTAssertEqual(s.unitID, "")
    }

    func testClockOnSetsAllFields() {
        let s = DutyState()
        let start = Date()
        s.clockOn(unitID: "219", at: start)
        XCTAssertTrue(s.isOnDuty)
        XCTAssertEqual(s.shiftStartedAt, start)
        XCTAssertEqual(s.unitID, "219")
    }

    func testClockOffResetsAllFields() {
        let s = DutyState()
        s.clockOn(unitID: "219")
        s.clockOff()
        XCTAssertFalse(s.isOnDuty)
        XCTAssertNil(s.shiftStartedAt)
        XCTAssertEqual(s.unitID, "")
    }

    func testElapsedIsZeroBeforeClockOn() {
        let s = DutyState()
        XCTAssertEqual(s.elapsedSinceShiftStart(), 0)
    }

    func testElapsedIsPositiveAfterClockOn() {
        let s = DutyState()
        let start = Date(timeIntervalSinceNow: -120) // 2 min ago
        s.clockOn(unitID: "219", at: start)
        let elapsed = s.elapsedSinceShiftStart()
        XCTAssertGreaterThan(elapsed, 119)
        XCTAssertLessThan(elapsed, 121)
    }
}
