import XCTest
@testable import RMPGFlexTester

final class MrzParserTests: XCTestCase {

    // ICAO 9303 part 4 specimen passport (UTO / ERIKSSON ANNA MARIA).
    let td3 = """
    P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<
    L898902C36UTO7408122F1204159ZE184226B<<<<<10
    """

    func testCheckDigit() {
        XCTAssertEqual(MrzParser.checkDigit(Substring("L898902C3")), 6)
        XCTAssertEqual(MrzParser.checkDigit(Substring("740812")), 2)
        XCTAssertEqual(MrzParser.checkDigit(Substring("120415")), 9)
        XCTAssertNil(MrzParser.checkDigit(Substring("ab!")))
    }

    func testParsesSpecimenPassport() {
        let r = MrzParser.parse(td3)
        XCTAssertNotNil(r)
        XCTAssertEqual(r?.fields["doc_type"], "passport")
        XCTAssertEqual(r?.fields["last_name"], "Eriksson")
        XCTAssertEqual(r?.fields["first_name"], "Anna Maria")
        XCTAssertEqual(r?.fields["document_number"], "L898902C3")
        XCTAssertEqual(r?.fields["nationality"], "UTO")
        XCTAssertEqual(r?.fields["issuing_country"], "UTO")
        XCTAssertEqual(r?.fields["date_of_birth"], "1974-08-12")
        XCTAssertEqual(r?.fields["dl_expiry"], "2012-04-15")
        XCTAssertEqual(r?.fields["gender"], "Female")
        XCTAssertEqual(r?.fields["mrz_checks"], "valid")
        XCTAssertEqual(r?.displayName, "Anna Maria Eriksson")
    }

    func testExpiredPassportAlerts() {
        guard let r = MrzParser.parse(td3) else { return XCTFail("parse failed") }
        let alerts = MrzParser.alerts(r)
        XCTAssertTrue(alerts.contains(where: { $0.contains("DOCUMENT EXPIRED") }))
    }

    func testOcrNoiseToleratedSpacesAndOrder() {
        // OCR commonly injects spaces and returns surrounding text lines.
        let noisy = "PASSPORT\nP<UTOERIKSSON<<ANNA<MARIA<<<<<<<<< <<<<<<<<<<\nL898902C36UTO74 08122F1204159ZE184226B<<<<<10\nUTOPIA"
        let r = MrzParser.parse(noisy)
        XCTAssertEqual(r?.fields["document_number"], "L898902C3")
        XCTAssertEqual(r?.fields["date_of_birth"], "1974-08-12")
    }

    func testCorruptedCheckDigitFlagged() {
        // Flip the DOB check digit (2 → 3): field dropped, integrity flagged.
        let bad = td3.replacingOccurrences(of: "7408122", with: "7408123")
        guard let r = MrzParser.parse(bad) else { return XCTFail("parse failed") }
        XCTAssertNil(r.fields["date_of_birth"])
        XCTAssertEqual(r.fields["mrz_checks"], "FAILED")
        XCTAssertTrue(MrzParser.alerts(r).contains(where: { $0.contains("MRZ CHECK DIGITS FAILED") }))
    }

    func testRejectsGarbage() {
        XCTAssertNil(MrzParser.parse("hello world\nnot an mrz at all"))
        XCTAssertNil(MrzParser.parse(""))
    }

    func testTD1IdCard() {
        // ICAO 9303 part 5 specimen TD1.
        let td1 = """
        I<UTOD231458907<<<<<<<<<<<<<<<
        7408122F1204159UTO<<<<<<<<<<<6
        ERIKSSON<<ANNA<MARIA<<<<<<<<<<
        """
        let r = MrzParser.parse(td1)
        XCTAssertEqual(r?.fields["doc_type"], "id_card")
        XCTAssertEqual(r?.fields["document_number"], "D23145890")
        XCTAssertEqual(r?.fields["last_name"], "Eriksson")
        XCTAssertEqual(r?.fields["date_of_birth"], "1974-08-12")
        XCTAssertEqual(r?.fields["dl_expiry"], "2012-04-15")
    }

    func testDateCenturyResolution() {
        // DOB never resolves into the future; expiry biases forward.
        XCTAssertEqual(MrzParser.isoDate(Substring("740812"), futureBiased: false), "1974-08-12")
        XCTAssertEqual(MrzParser.isoDate(Substring("250101"), futureBiased: false), "2025-01-01")
        XCTAssertEqual(MrzParser.isoDate(Substring("310101"), futureBiased: true), "2031-01-01")
        XCTAssertNil(MrzParser.isoDate(Substring("741350"), futureBiased: false)) // month 13
    }
}
