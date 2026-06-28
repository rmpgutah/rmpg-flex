import XCTest
@testable import RMPGFlexTester

final class AamvaParserTests: XCTestCase {
    // Representative AAMVA v8 Utah-style payload (synthetic data).
    let sample = """
    @\n\u{1e}\rANSI 636040080002DL00410278ZU03190008DLDAQ123456789
    DCSDOE
    DACJOHN
    DADQUINCY
    DBB01151990
    DBA01152030
    DBD01152022
    DBC1
    DAU070 in
    DAW180
    DAYBRO
    DAZBLN
    DAG123 MAIN ST
    DAISALT LAKE CITY
    DAJUT
    DAK841110000
    DCAD
    DCBNONE
    DCDNONE
    DCFDOC123
    """

    func testLooksLikeAamva() {
        XCTAssertTrue(AamvaParser.looksLikeAamva(sample))
        XCTAssertFalse(AamvaParser.looksLikeAamva("hello world"))
    }

    func testParseCoreFields() {
        let r = AamvaParser.parse(sample)
        XCTAssertEqual(r.fields["last_name"], "DOE")
        XCTAssertEqual(r.fields["first_name"], "JOHN")
        XCTAssertEqual(r.fields["date_of_birth"], "1990-01-15")
        XCTAssertEqual(r.fields["dl_expiry"], "2030-01-15")
        XCTAssertEqual(r.fields["dl_number"], "123456789")
        XCTAssertEqual(r.fields["dl_state"], "UT")
        XCTAssertEqual(r.fields["gender"], "Male")
        XCTAssertEqual(r.fields["height"], "5'10\"")
        XCTAssertEqual(r.fields["eye_color"], "Brown")
        XCTAssertEqual(r.fields["zip"], "84111")
        XCTAssertEqual(r.fields["city"], "SALT LAKE CITY")
        XCTAssertEqual(r.displayName, "JOHN DOE")
    }

    func testAlerts() {
        var r = AamvaParser.parse(sample)
        XCTAssertTrue(AamvaParser.alerts(r).isEmpty)
        r.fields["dl_expiry"] = "2020-01-01"
        r.fields["date_of_birth"] = "2008-01-01"
        let alerts = AamvaParser.alerts(r, now: ISO8601DateFormatter().date(from: "2026-06-11T00:00:00Z")!)
        XCTAssertEqual(alerts.count, 2)
        XCTAssertTrue(alerts[0].contains("EXPIRED"))
        XCTAssertTrue(alerts[1].contains("UNDER 21"))
    }

    func testCanadianDateFallback() {
        let r = AamvaParser.parse("DCSROY\nDBB19900115")
        XCTAssertEqual(r.fields["date_of_birth"], "1990-01-15")
    }
}
