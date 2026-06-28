import XCTest
@testable import RMPGFlexTester

final class DLVehicleFunctionsTests: XCTestCase {
    // Fixed reference date so age/expiry are deterministic.
    let now = Calendar(identifier: .gregorian).date(from: DateComponents(year: 2026, month: 6, day: 12))!

    // ── DLFunctions ──────────────────────────────────────────

    func testJurisdiction() {
        XCTAssertEqual(DLFunctions.jurisdictionName("UT"), "Utah")
        XCTAssertEqual(DLFunctions.normalizeJurisdiction("Utah"), "UT")
        XCTAssertEqual(DLFunctions.jurisdictionCountry("ON"), "CAN")
        XCTAssertEqual(DLFunctions.jurisdictionCountry("UT"), "USA")
    }

    func testDLNumberValidation() {
        XCTAssertTrue(DLFunctions.validateDLNumber(state: "CA", dl: "A1234567"))
        XCTAssertFalse(DLFunctions.validateDLNumber(state: "CA", dl: "12345678"))
        XCTAssertTrue(DLFunctions.validateDLNumber(state: "UT", dl: "123456"))
    }

    func testAgeAndEligibility() {
        XCTAssertEqual(DLFunctions.ageFromDOB("1985-01-15", on: now), 41)
        XCTAssertEqual(DLFunctions.ageFromDOB("2008-07-01", on: now), 17) // birthday not reached
        XCTAssertEqual(DLFunctions.ageBracket("1985-01-15", on: now), "25-64")
        let f = DLFunctions.eligibilityFlags("2006-12-25", on: now)
        XCTAssertEqual(f["under21"], true)
        XCTAssertEqual(f["drinking"], false)
    }

    func testExpiry() {
        XCTAssertEqual(DLFunctions.expiryStatus("2025-01-15", on: now), "expired")
        XCTAssertEqual(DLFunctions.expiryStatus("2026-06-25", on: now), "expiring")
        XCTAssertEqual(DLFunctions.expiryStatus("2030-01-01", on: now), "valid")
    }

    func testEvaluateDLBridge() {
        var r = AamvaResult()
        r.fields = ["dl_state": "UT", "dl_number": "123456", "date_of_birth": "1985-01-15",
                    "dl_expiry": "2030-01-01", "card_type": "DL", "is_real_id": "true",
                    "first_name": "JOHN", "last_name": "SAMPLE"]
        let e = DLFunctions.evaluateDL(r, on: now)
        XCTAssertEqual(e.jurisdictionName, "Utah")
        XCTAssertEqual(e.country, "USA")
        XCTAssertEqual(e.age, 41)
        XCTAssertEqual(e.eligibility["drinking"], true)
        XCTAssertEqual(e.expiry, "valid")
        XCTAssertEqual(e.realId, "REAL ID compliant")
        XCTAssertTrue(e.dlValid)
        XCTAssertTrue(e.summary.contains("SAMPLE, JOHN"))
    }

    // ── VehicleFunctions ─────────────────────────────────────

    func testVINCheckDigitAndValidation() {
        XCTAssertEqual(VehicleFunctions.vinCheckDigit("1HGCM82633A004352"), "3")
        XCTAssertTrue(VehicleFunctions.isValidVIN("1HGCM82633A004352"))
        XCTAssertFalse(VehicleFunctions.isValidVIN("1HGCM82633A004353")) // wrong check digit
        XCTAssertFalse(VehicleFunctions.isValidVIN("1HGCM8263OA004352")) // illegal O
        XCTAssertTrue(VehicleFunctions.vinValidationError("1HGCM8263OA004352").contains("illegal"))
    }

    func testVINDecode() {
        XCTAssertEqual(VehicleFunctions.vinModelYear("1FTFW1ET9DFC10312", now: now), 2013)
        XCTAssertEqual(VehicleFunctions.vinCountry("1HGCM82633A004352"), "United States")
    }

    func testPlateAndCodes() {
        XCTAssertTrue(VehicleFunctions.validatePlate(state: "CA", plate: "7ABC123"))
        XCTAssertFalse(VehicleFunctions.validatePlate(state: "CA", plate: "ABC1234"))
        XCTAssertEqual(VehicleFunctions.expandColor("SIL"), "Silver")
        XCTAssertEqual(VehicleFunctions.expandMake("TOYT"), "Toyota")
        XCTAssertEqual(VehicleFunctions.vehicleCategory("PK"), "light truck")
    }

    func testEvaluateVehicleBridge() {
        let e = VehicleFunctions.evaluateVehicle(vin: "1FTFW1ET9DFC10312", plate: "ABC1234", state: "TX",
                                                 year: 2013, color: "BLK", make: "FORD", bodyStyle: "PK", now: now)
        XCTAssertTrue(e.vinValid)
        XCTAssertEqual(e.decodedYear, 2013)
        XCTAssertTrue(e.plateValid)
        XCTAssertEqual(e.make, "Ford")
        XCTAssertEqual(e.category, "light truck")
        XCTAssertEqual(e.age, 13)
        XCTAssertEqual(e.key, "VIN:1FTFW1ET9DFC10312")
    }
}
