import XCTest
@testable import RMPGFlexTester

final class WorkflowRegistryTests: XCTestCase {
    func testWellFormed() {
        XCTAssertGreaterThanOrEqual(WorkflowRegistry.all.count, 12)
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

    func testAllCategoriesRepresented() {
        let cats = Set(WorkflowRegistry.all.map(\.category))
        XCTAssertEqual(cats, Set(WorkflowCategory.allCases), "every category should have at least one workflow")
    }

    // Every submit endpoint path is non-empty and starts with the api prefix.
    func testEndpointPathsWellFormed() {
        for d in WorkflowRegistry.all {
            switch d.submit {
            case .single(let post): XCTAssertTrue(post.hasPrefix("api/"), "\(d.id): \(post)")
            case .lifecycle(let c, let u, let f):
                XCTAssertTrue(c.hasPrefix("api/") && u.hasPrefix("api/") && f.hasPrefix("api/"), d.id)
            }
        }
    }
}
