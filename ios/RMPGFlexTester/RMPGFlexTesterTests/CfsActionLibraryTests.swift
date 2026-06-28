import XCTest
@testable import RMPGFlexTester

final class CfsActionLibraryTests: XCTestCase {
    func testAtLeast100Actions() {
        XCTAssertGreaterThanOrEqual(CfsActionLibrary.all.count, 100)
    }

    func testIdsAreUnique() {
        let ids = CfsActionLibrary.all.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
    }

    func testEveryActionIsWellFormed() {
        for a in CfsActionLibrary.all {
            XCTAssertFalse(a.id.isEmpty, "empty id")
            XCTAssertFalse(a.label.isEmpty, "empty label for \(a.id)")
            XCTAssertFalse(a.category.isEmpty, "empty category for \(a.id)")
            XCTAssertTrue(CfsActionLibrary.verbs.contains(a.verb), "unknown verb \(a.verb) for \(a.id)")
        }
    }

    func testStatusActionsCarryValidTargets() {
        let valid = Set(["pending", "dispatched", "enroute", "onscene", "cleared", "closed", "cancelled", "archived"])
        let statuses = CfsActionLibrary.all.filter { $0.verb == "status" }
        XCTAssertFalse(statuses.isEmpty)
        for s in statuses { XCTAssertTrue(valid.contains(s.params["to"] ?? ""), "bad status \(s.id)") }
    }

    func testCategoriesCoverAllActions() {
        let catSet = Set(CfsActionLibrary.categories)
        for a in CfsActionLibrary.all { XCTAssertTrue(catSet.contains(a.category)) }
        // Each category resolves to a non-empty slice.
        for c in CfsActionLibrary.categories { XCTAssertFalse(CfsActionLibrary.inCategory(c).isEmpty) }
    }

    func testSearchFiltersByLabel() {
        XCTAssertTrue(CfsActionLibrary.search("k9").contains { $0.id == "rs_k9" })
        XCTAssertEqual(CfsActionLibrary.search("").count, CfsActionLibrary.all.count)
        XCTAssertTrue(CfsActionLibrary.search("zzzznomatch").isEmpty)
    }

    func testCustomNoteNeedsInput() {
        let custom = CfsActionLibrary.all.first { $0.id == "nt_custom" }
        XCTAssertNotNil(custom)
        XCTAssertTrue(custom?.needsInput ?? false)
    }
}
