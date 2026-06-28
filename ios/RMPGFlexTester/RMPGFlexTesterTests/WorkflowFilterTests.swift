import XCTest
@testable import RMPGFlexTester

final class WorkflowFilterTests: XCTestCase {
    private func def(_ id: String, _ title: String) -> WorkflowDefinition {
        WorkflowDefinition(id: id, title: title, icon: "x", category: .reports, roles: ["officer"],
                           submit: .single(post: "api/x"), encoding: .json,
                           steps: [WorkflowStep(title: "s", fields: [])], prefill: [],
                           success: SuccessSpec(numberKey: "id", message: "ok"))
    }
    func testMatches() {
        let d = def("citation", "Citation / warning")
        XCTAssertTrue(WorkflowFilter.matches(d, query: ""))
        XCTAssertTrue(WorkflowFilter.matches(d, query: "  "))
        XCTAssertTrue(WorkflowFilter.matches(d, query: "cit"))
        XCTAssertTrue(WorkflowFilter.matches(d, query: "WARNING"))
        XCTAssertTrue(WorkflowFilter.matches(d, query: "citation"))   // by id
        XCTAssertFalse(WorkflowFilter.matches(d, query: "arrest"))
    }
}
