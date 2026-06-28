import XCTest
@testable import FeatureQuickActions

final class QuickActionsRegistryTests: XCTestCase {
    func testHasEightActions() {
        XCTAssertEqual(QuickActionsRegistry.all.count, 8)
    }

    func testActionOrderMatchesDesktopBar() {
        let expected = [
            "new_call", "new_incident", "new_citation", "start_patrol",
            "process_server", "quick_capture", "field_camera", "tasks"
        ]
        XCTAssertEqual(QuickActionsRegistry.all.map(\.id), expected)
    }

    func testAllIdsUnique() {
        let ids = QuickActionsRegistry.all.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count, "Duplicate quick action id detected")
    }

    func testAllHaveNonEmptyTitleAndSystemImage() {
        for action in QuickActionsRegistry.all {
            XCTAssertFalse(action.title.isEmpty, "Empty title for \(action.id)")
            XCTAssertFalse(action.systemImage.isEmpty, "Empty SF Symbol for \(action.id)")
        }
    }

    func testAllTargetM1() {
        for action in QuickActionsRegistry.all {
            XCTAssertEqual(action.milestone, "M1", "Expected M1 milestone for \(action.id)")
        }
    }
}
