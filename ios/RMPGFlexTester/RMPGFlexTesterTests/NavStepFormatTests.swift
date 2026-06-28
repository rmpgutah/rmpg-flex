import XCTest
@testable import RMPGFlexTester

final class NavStepFormatTests: XCTestCase {
    func testIcon() {
        XCTAssertEqual(NavStepFormat.icon(for: "Turn left onto Main St"), "arrow.turn.up.left")
        XCTAssertEqual(NavStepFormat.icon(for: "Turn right"), "arrow.turn.up.right")
        XCTAssertEqual(NavStepFormat.icon(for: "Arrive at destination"), "mappin.circle.fill")
        XCTAssertEqual(NavStepFormat.icon(for: "Make a U-turn"), "arrow.uturn.down")
        XCTAssertEqual(NavStepFormat.icon(for: "Continue straight"), "arrow.up")
    }
    func testDistance() {
        XCTAssertEqual(NavStepFormat.distance(100), "328 ft")
        XCTAssertEqual(NavStepFormat.distance(3218), "2.0 mi")
    }
}
