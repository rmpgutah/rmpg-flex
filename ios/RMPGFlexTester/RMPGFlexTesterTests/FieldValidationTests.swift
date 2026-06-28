import XCTest
@testable import RMPGFlexTester

final class FieldValidationTests: XCTestCase {
    func testDate() {
        XCTAssertTrue(FieldValidation.isValidDate("2026-06-13"))
        XCTAssertFalse(FieldValidation.isValidDate("06/13/2026"))
        XCTAssertFalse(FieldValidation.isValidDate(""))
    }
    func testNonNegative() {
        XCTAssertTrue(FieldValidation.isNonNegativeNumber("0"))
        XCTAssertTrue(FieldValidation.isNonNegativeNumber("120.50"))
        XCTAssertFalse(FieldValidation.isNonNegativeNumber("-5"))
        XCTAssertFalse(FieldValidation.isNonNegativeNumber("abc"))
    }
    func testDictationTransitions() {
        var s = DictationState.idle
        s = s.next(.start); XCTAssertEqual(s, .listening)
        s = s.next(.stop);  XCTAssertEqual(s, .idle)
        XCTAssertEqual(DictationState.idle.next(.denied), .denied)
        XCTAssertEqual(DictationState.denied.next(.start), .denied)
    }
}
