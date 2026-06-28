import XCTest
@testable import RMPGFlexTester

final class WorkflowBodyTests: XCTestCase {
    func testJSONOmitsEmptyAndEncodesTypes() {
        let values: [String: FieldValue] = [
            "violation_description": .string("speeding"),
            "fine_amount": .number(120),
            "is_warning": .bool(false),
            "blank": .string("   "),
            "missing": FieldValue.none,
        ]
        let json = WorkflowBody.json(values)
        XCTAssertEqual(json["violation_description"] as? String, "speeding")
        XCTAssertEqual(json["fine_amount"] as? Double, 120)
        XCTAssertEqual(json["is_warning"] as? Bool, false)
        XCTAssertNil(json["blank"])
        XCTAssertNil(json["missing"])
    }

    func testMultipartFieldsAreStrings() {
        let f = WorkflowBody.multipartFields([
            "notes": .string("x"), "lat": .number(40.7), "skip": .string(""),
        ])
        XCTAssertEqual(f["notes"], "x")
        XCTAssertEqual(f["lat"], "40.7")
        XCTAssertNil(f["skip"])
    }
}
