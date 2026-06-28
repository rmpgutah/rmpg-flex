import XCTest
@testable import RMPGFlexTester

final class AlprScanLogTests: XCTestCase {
    private func veh(_ plate: String?, hits: [String] = []) -> AlprScanVehicle {
        AlprScanVehicle(plate: plate, make: nil, model: nil, color: nil, year: nil, vehicleType: nil,
                        confidence: nil, vehicleRecordId: nil, recordCreated: false, criticalHits: hits)
    }
    private func sum(_ v: [AlprScanVehicle]) -> AlprScanSummary {
        AlprScanSummary(vehicleCount: v.count, vehicles: v, criticalHits: [], createdCount: 0)
    }

    func testNormalizePlate() {
        XCTAssertEqual(AlprScanLog.normalizePlate("7abc 123"), "7ABC123")
        XCTAssertEqual(AlprScanLog.normalizePlate("ABC-1234"), "ABC1234")
        XCTAssertNil(AlprScanLog.normalizePlate(""))
        XCTAssertNil(AlprScanLog.normalizePlate("- -"))
        XCTAssertNil(AlprScanLog.normalizePlate(nil))
    }

    func testMergeDedupsAndCounts() {
        var log = AlprScanLog.merge([], sum([veh("7ABC123"), veh("XYZ 9")]))
        XCTAssertEqual(log.count, 2)
        // Re-read the same plate (different formatting) → seenCount bumps, no dup.
        log = AlprScanLog.merge(log, sum([veh("7abc-123")]))
        XCTAssertEqual(log.count, 2)
        XCTAssertEqual(log.first { $0.id == "7ABC123" }?.seenCount, 2)
    }

    func testMergeDropsPlatelessReads() {
        let log = AlprScanLog.merge([], sum([veh(nil), veh("   "), veh("GOOD1")]))
        XCTAssertEqual(log.count, 1)
        XCTAssertEqual(log[0].id, "GOOD1")
    }

    func testCriticalHitsPersistAcrossReads() {
        var log = AlprScanLog.merge([], sum([veh("HIT1", hits: ["STOLEN"])]))
        // A later clean read of the same plate keeps the hit flag.
        log = AlprScanLog.merge(log, sum([veh("HIT1")]))
        XCTAssertEqual(log.first { $0.id == "HIT1" }?.vehicle.criticalHits, ["STOLEN"])
        XCTAssertEqual(AlprScanLog.criticalCount(log), 1)
    }

    func testSortPutsCriticalFirstThenMostSeen() {
        var log = AlprScanLog.merge([], sum([veh("CLEAN", ), veh("CLEAN"), veh("FLAG", hits: ["WARRANT"])]))
        // CLEAN seen twice, FLAG once but critical.
        log = AlprScanLog.sorted(log)
        XCTAssertEqual(log[0].id, "FLAG")          // critical first
        XCTAssertEqual(log[1].id, "CLEAN")
        XCTAssertEqual(log[1].seenCount, 2)
    }
}
