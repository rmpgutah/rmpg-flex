import XCTest
@testable import RMPGFlexTester

final class FieldFormatTests: XCTestCase {
    func testLabels() {
        XCTAssertEqual(FieldFormat.label("dob"), "Date of Birth")
        XCTAssertEqual(FieldFormat.label("dl_number"), "Driver License #")
        XCTAssertEqual(FieldFormat.label("incident_type"), "Call Type")
        XCTAssertEqual(FieldFormat.label("some_custom_field"), "Some Custom Field")
        XCTAssertEqual(FieldFormat.label("vin"), "VIN")
        XCTAssertEqual(FieldFormat.label("officer_id"), "Officer #")
    }

    func testCodedValues() {
        XCTAssertEqual(FieldFormat.value("status", "on_scene"), "On Scene (10-23)")
        XCTAssertEqual(FieldFormat.value("status", "closed"), "Closed")
        XCTAssertEqual(FieldFormat.value("priority", "P1"), "Priority 1")
        XCTAssertEqual(FieldFormat.value("priority", "2"), "Priority 2")
        XCTAssertEqual(FieldFormat.value("incident_type", "traffic_stop"), "Traffic Stop")
        XCTAssertEqual(FieldFormat.value("sex", "M"), "Male")
        XCTAssertEqual(FieldFormat.value("is_sex_offender", "1"), "Yes")
        XCTAssertEqual(FieldFormat.value("weapons_involved", "0"), "No")
        XCTAssertEqual(FieldFormat.value("bail_amount", "1500"), "$1500.00")
    }

    func testDatesAndFreeText() {
        XCTAssertEqual(FieldFormat.value("dob", "1980-01-15T00:00:00Z"), "01/15/1980")
        XCTAssertEqual(FieldFormat.value("created_at", "2026-06-12T14:30:00Z"), "06/12/2026 14:30")
        XCTAssertEqual(FieldFormat.value("last_name", "Clark"), "Clark")
        XCTAssertEqual(FieldFormat.value("location_address", "123 Main St"), "123 Main St")
        XCTAssertEqual(FieldFormat.value("notes", nil), "—")
        XCTAssertEqual(FieldFormat.value("notes", "<null>"), "—")
    }
}
