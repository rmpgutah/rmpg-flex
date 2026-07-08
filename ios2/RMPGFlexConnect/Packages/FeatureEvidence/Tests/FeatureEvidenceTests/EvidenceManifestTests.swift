import XCTest
@testable import FeatureEvidence

final class EvidenceManifestTests: XCTestCase {
    func testClassificationNormalizeKnownValue() {
        XCTAssertEqual(EvidenceClassification.normalize("confidential"), .confidential)
        XCTAssertEqual(EvidenceClassification.normalize("  EVIDENCE  "), .evidence)
    }

    func testClassificationNormalizeUnknownDefaultsToEvidence() {
        XCTAssertEqual(EvidenceClassification.normalize("bogus"), .evidence)
        XCTAssertEqual(EvidenceClassification.normalize(nil), .evidence)
    }

    func testEvidenceNumberFormat() {
        XCTAssertEqual(evidenceNumber(year: 2026, sequence: 42), "26-EVD-00042")
        XCTAssertEqual(evidenceNumber(year: 2026, sequence: 0), "26-EVD-00000")
        XCTAssertEqual(evidenceNumber(year: 2026, sequence: -5), "26-EVD-00000")
    }

    func testShortHashTruncatesAndUppercases() {
        XCTAssertEqual(shortHash("abcd1234ef567890abcdef"), "ABCD1234EF567890")
    }

    func testIsValidHexDigestAcceptsSha256() {
        let sha = String(repeating: "a", count: 64)
        XCTAssertTrue(isValidHexDigest(sha))
    }

    func testIsValidHexDigestRejectsTooShortOrNonHex() {
        XCTAssertFalse(isValidHexDigest("abc"))
        XCTAssertFalse(isValidHexDigest(String(repeating: "z", count: 64)))
    }

    #if canImport(CryptoKit)
    func testSha256HexIsDeterministicAndCorrectLength() {
        let data = "chain-of-custody".data(using: .utf8)!
        let hash1 = sha256Hex(of: data)
        let hash2 = sha256Hex(of: data)
        XCTAssertEqual(hash1, hash2)
        XCTAssertEqual(hash1.count, 64)
        XCTAssertTrue(isValidHexDigest(hash1))
    }
    #endif

    func testManifestEncodesServerFieldNames() throws {
        let manifest = EvidenceManifest(
            sha256: String(repeating: "b", count: 64),
            classification: .lawEnforcementSensitive,
            sequence: 3,
            officerName: "J. Doe",
            caseRef: "26-1234",
            gpsLat: 40.7,
            gpsLng: -111.9
        )
        let data = try JSONEncoder().encode(manifest)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(json?["classification"] as? String, "LAW ENFORCEMENT SENSITIVE")
        XCTAssertEqual(json?["officer_name"] as? String, "J. Doe")
        XCTAssertEqual(json?["case_ref"] as? String, "26-1234")
        XCTAssertNotNil(json?["captured_at"])
    }
}
