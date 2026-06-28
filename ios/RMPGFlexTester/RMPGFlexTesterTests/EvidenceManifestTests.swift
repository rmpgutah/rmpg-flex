import XCTest
@testable import RMPGFlexTester

final class EvidenceManifestTests: XCTestCase {
    func testShortHash() {
        XCTAssertEqual(EvidenceManifest.shortHash("a1b2c3d4e5f60718abcdef00"), "A1B2C3D4E5F60718")
        XCTAssertEqual(EvidenceManifest.shortHash(""), "")
        XCTAssertEqual(EvidenceManifest.shortHash("abcd"), "ABCD")
    }

    func testSequenceLabel() {
        XCTAssertEqual(EvidenceManifest.sequenceLabel(3), "003")
        XCTAssertEqual(EvidenceManifest.sequenceLabel(42), "042")
        XCTAssertEqual(EvidenceManifest.sequenceLabel(1234), "1234")
        XCTAssertEqual(EvidenceManifest.sequenceLabel(-1), "000")
    }

    func testBodyAndSummary() {
        let m = EvidenceManifest(sha256: "abc123", classification: .evidence, sequence: 5,
                                 officer: "Doe", badge: "42", unit: "D19", caseRef: "26-1",
                                 lat: 40.7, lng: -111.8, capturedAt: "2026-06-13T14:00:00Z", deviceId: "7F3A")
        let b = m.body()
        XCTAssertEqual(b["sha256"] as? String, "abc123")
        XCTAssertEqual(b["classification"] as? String, "EVIDENCE")
        XCTAssertEqual(b["sequence"] as? Int, 5)
        XCTAssertEqual(b["gps_lat"] as? Double, 40.7)
        XCTAssertEqual(b["device_id"] as? String, "7F3A")
        XCTAssertEqual(m.burnShortHash, "ABC123")
        XCTAssertEqual(m.sequenceLabel, "005")
        XCTAssertTrue(m.summary.contains("EXH 005"))
        XCTAssertTrue(m.summary.contains("EVIDENCE"))
    }

    func testBodyOmitsNilGPS() {
        let m = EvidenceManifest(sha256: "x", classification: .unrestricted, sequence: 0, capturedAt: "T")
        XCTAssertNil(m.body()["gps_lat"])
        XCTAssertNil(m.body()["gps_lng"])
    }

    func testClassificationCases() {
        XCTAssertEqual(EvidenceClassification.leSensitive.rawValue, "LAW ENFORCEMENT SENSITIVE")
        XCTAssertFalse(EvidenceClassification.allCases.isEmpty)
        for c in EvidenceClassification.allCases { XCTAssertFalse(c.short.isEmpty) }
    }
}
