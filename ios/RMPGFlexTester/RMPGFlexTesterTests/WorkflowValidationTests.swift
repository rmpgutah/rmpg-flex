import XCTest
@testable import RMPGFlexTester

final class WorkflowValidationTests: XCTestCase {
    func testLocalReadiness() {
        let items = WorkflowValidation.readiness(
            requiredKeys: ["incident_type", "narrative"],
            present: ["incident_type"],
            labels: ["incident_type": "Incident type", "narrative": "Narrative"])
        XCTAssertEqual(items, [
            ReadinessItem(label: "Incident type", satisfied: true),
            ReadinessItem(label: "Narrative", satisfied: false),
        ])
    }

    func testServerValidationErrors() {
        let body: [String: Any] = ["code": "NIBRS_VALIDATION_FAILED",
            "validation": ["errors": ["Victim relationship required", "Offense code missing"]]]
        let items = WorkflowValidation.serverErrors(from: body)
        XCTAssertEqual(items, [
            ReadinessItem(label: "Victim relationship required", satisfied: false),
            ReadinessItem(label: "Offense code missing", satisfied: false),
        ])
    }

    func testServerValidationGenericMessage() {
        let body: [String: Any] = ["error": "violation_date must be YYYY-MM-DD"]
        let items = WorkflowValidation.serverErrors(from: body)
        XCTAssertEqual(items, [ReadinessItem(label: "violation_date must be YYYY-MM-DD", satisfied: false)])
    }
}
