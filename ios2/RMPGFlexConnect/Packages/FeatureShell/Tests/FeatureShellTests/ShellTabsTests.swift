import XCTest
@testable import FeatureShell

final class ShellTabsTests: XCTestCase {
    func testOfficerHasFiveTabs() {
        XCTAssertEqual(OfficerShell.tabs.count, 5)
        XCTAssertEqual(OfficerShell.tabs.map(\.id), ["home", "cfs", "scan", "reports", "more"])
    }

    func testSupervisorHasFourTabs() {
        XCTAssertEqual(SupervisorShell.tabs.count, 4)
        XCTAssertEqual(SupervisorShell.tabs.map(\.id), ["command", "units", "cfs", "more"])
    }

    func testOfficerAndSupervisorBothHaveCfsAndMore() {
        let officerIDs = Set(OfficerShell.tabs.map(\.id))
        let supIDs     = Set(SupervisorShell.tabs.map(\.id))
        XCTAssertTrue(officerIDs.contains("cfs"))
        XCTAssertTrue(officerIDs.contains("more"))
        XCTAssertTrue(supIDs.contains("cfs"))
        XCTAssertTrue(supIDs.contains("more"))
    }

    func testNoDuplicateTabIDsInEitherShell() {
        XCTAssertEqual(Set(OfficerShell.tabs.map(\.id)).count, OfficerShell.tabs.count)
        XCTAssertEqual(Set(SupervisorShell.tabs.map(\.id)).count, SupervisorShell.tabs.count)
    }
}
