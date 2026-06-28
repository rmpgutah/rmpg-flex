import XCTest
@testable import RMPGFlexTester

final class WorkflowModelsTests: XCTestCase {
    func testMissingRequiredKeys() {
        let step = WorkflowStep(title: "Detail", fields: [
            WorkflowField(key: "incident_type", type: .chips, label: "Type", required: true),
            WorkflowField(key: "narrative", type: .dictatableNarrative, label: "Narrative", required: true),
            WorkflowField(key: "notes", type: .text, label: "Notes", required: false),
        ])
        let def = WorkflowDefinition(
            id: "incident", title: "Incident report", icon: "doc.text",
            category: .reports, roles: ["officer"],
            submit: .lifecycle(create: "api/incidents", update: "api/incidents/{id}", finalize: "api/incidents/{id}/submit"),
            encoding: .json, steps: [step], prefill: [.call],
            success: SuccessSpec(numberKey: "incident_number", message: "Filed {incident_number}"))

        let values: [String: FieldValue] = ["incident_type": .string("theft")]
        XCTAssertEqual(def.missingRequiredKeys(in: values), ["narrative"])

        let complete: [String: FieldValue] = ["incident_type": .string("theft"), "narrative": .string("…")]
        XCTAssertEqual(def.missingRequiredKeys(in: complete), [])
    }

    func testFieldValueIsEmpty() {
        XCTAssertTrue(FieldValue.string("   ").isEmpty)
        XCTAssertTrue(FieldValue.none.isEmpty)
        XCTAssertFalse(FieldValue.string("x").isEmpty)
        XCTAssertFalse(FieldValue.number(0).isEmpty)
        XCTAssertFalse(FieldValue.bool(false).isEmpty)
    }
}
