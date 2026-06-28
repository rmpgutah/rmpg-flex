import XCTest
@testable import RMPGFlexTester

final class AlprResultParseTests: XCTestCase {
    func testParsesAllVehiclesAndRecordState() {
        let json: [String: Any] = [
            "vehicle_count": 2,
            "hits": [["severity": "critical", "detail": "STOLEN — 8XYZ123"]],
            "vehicles": [
                [
                    "plate": "8XYZ123", "make": "Toyota", "model": "Camry", "color": "silver",
                    "year": 2019, "vehicle_type": "sedan", "confidence": 0.93,
                    "vehicle_record_id": 41, "vehicle_record_created": true,
                    "hits": [["severity": "critical", "detail": "STOLEN — 8XYZ123"]],
                ],
                [
                    "plate": "ABC999", "make": "Ford", "vehicle_record_id": 42,
                    "vehicle_record_created": false, "hits": [],
                ],
            ],
        ]
        let s = AlprResultParse.summary(from: json)
        XCTAssertEqual(s.vehicleCount, 2)
        XCTAssertEqual(s.vehicles.count, 2)
        XCTAssertEqual(s.createdCount, 1)
        XCTAssertTrue(s.hasCritical)
        XCTAssertEqual(s.criticalHits, ["STOLEN — 8XYZ123"])

        let v0 = s.vehicles[0]
        XCTAssertEqual(v0.plate, "8XYZ123")
        XCTAssertEqual(v0.year, 2019)
        XCTAssertEqual(v0.confidence, 0.93)
        XCTAssertTrue(v0.recordCreated)
        XCTAssertEqual(v0.criticalHits, ["STOLEN — 8XYZ123"])
        XCTAssertEqual(v0.descriptor, "silver 2019 Toyota Camry")
        XCTAssertFalse(s.vehicles[1].recordCreated)
    }

    func testDescriptorFallsBackToType() {
        let v = AlprScanVehicle(plate: "X", make: nil, model: nil, color: nil, year: nil,
                                vehicleType: "pickup", confidence: nil, vehicleRecordId: nil,
                                recordCreated: false, criticalHits: [])
        XCTAssertEqual(v.descriptor, "pickup")
    }

    func testHandlesStringNumbersAndEmptyResponse() {
        // Numbers may arrive as strings depending on the JSON encoder.
        let s = AlprResultParse.summary(from: [
            "vehicle_count": "1",
            "vehicles": [["plate": "P1", "year": "2020", "confidence": "0.5"]],
        ])
        XCTAssertEqual(s.vehicleCount, 1)
        XCTAssertEqual(s.vehicles.first?.year, 2020)
        XCTAssertEqual(s.vehicles.first?.confidence, 0.5)

        // No vehicle data → empty summary, no crash.
        let empty = AlprResultParse.summary(from: ["vehicle_count": 0, "vehicles": []])
        XCTAssertEqual(empty.vehicleCount, 0)
        XCTAssertTrue(empty.vehicles.isEmpty)
        XCTAssertFalse(empty.hasCritical)

        // Junk input → safe empty.
        XCTAssertEqual(AlprResultParse.summary(from: nil).vehicleCount, 0)
    }
}
