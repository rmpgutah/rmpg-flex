import XCTest
@testable import RMPGFlexTester

final class WorkflowRegistryTests: XCTestCase {
    func testWellFormed() {
        XCTAssertGreaterThanOrEqual(WorkflowRegistry.all.count, 3)
        for d in WorkflowRegistry.all {
            XCTAssertFalse(d.id.isEmpty)
            XCTAssertFalse(d.roles.isEmpty)
            XCTAssertFalse(d.steps.isEmpty)
            for f in d.allFields { XCTAssertFalse(f.key.isEmpty, "\(d.id) has an empty field key") }
        }
        XCTAssertEqual(Set(WorkflowRegistry.all.map(\.id)).count, WorkflowRegistry.all.count, "ids unique")
    }
    func testProvingSlicePresent() {
        let ids = Set(WorkflowRegistry.all.map(\.id))
        XCTAssertTrue(ids.isSuperset(of: ["incident", "citation", "patrol_scan"]))
    }
}
