import XCTest
@testable import RMPGFlexTester

final class FleetReadinessTests: XCTestCase {
    private let now = 1_700_000_000.0

    func testParseTolerant() {
        let rows: [[String: Any]] = [
            ["id": 1, "vehicle_number": "PS-D19", "make": "Ford", "model": "Explorer", "status": "in_service", "current_mileage": 42000],
            ["id": "2", "status": "OUT_OF_SERVICE"],     // string id, uppercase status
            ["status": "in_service"],                     // no id → dropped
        ]
        let v = FleetReadiness.parse(rows)
        XCTAssertEqual(v.count, 2)
        XCTAssertEqual(v[0].number, "PS-D19")
        XCTAssertEqual(v[0].name, "Ford Explorer")
        XCTAssertEqual(v[0].mileage, 42000)
        XCTAssertEqual(v[1].status, "out_of_service")     // lowercased
    }

    func testReadinessByStatus() {
        func mk(_ status: String, insp: Double? = nil, result: String? = nil) -> FleetVehicle {
            FleetVehicle(id: 1, number: "A", name: "", status: status, mileage: nil, lastInspectionEpoch: insp, lastResult: result)
        }
        XCTAssertEqual(FleetReadiness.readiness(mk("out_of_service"), now: now), .oos)
        XCTAssertEqual(FleetReadiness.readiness(mk("maintenance"), now: now), .maintenance)
        XCTAssertEqual(FleetReadiness.readiness(mk("retired"), now: now), .unknown)
        XCTAssertEqual(FleetReadiness.readiness(mk("in_service"), now: now), .ready)               // no inspection data → ready
        XCTAssertEqual(FleetReadiness.readiness(mk("in_service", result: "fail"), now: now), .defects)
        // inspection 40 days ago → overdue (>30d)
        XCTAssertEqual(FleetReadiness.readiness(mk("in_service", insp: now - 40 * 86_400), now: now), .overdue)
        // inspection 5 days ago → ready
        XCTAssertEqual(FleetReadiness.readiness(mk("in_service", insp: now - 5 * 86_400), now: now), .ready)
    }

    func testSortPutsNotReadyFirst() {
        let vehicles = [
            FleetVehicle(id: 1, number: "C", name: "", status: "in_service", mileage: nil, lastInspectionEpoch: nil, lastResult: nil),
            FleetVehicle(id: 2, number: "B", name: "", status: "out_of_service", mileage: nil, lastInspectionEpoch: nil, lastResult: nil),
            FleetVehicle(id: 3, number: "A", name: "", status: "maintenance", mileage: nil, lastInspectionEpoch: nil, lastResult: nil),
        ]
        let sorted = FleetReadiness.sorted(vehicles, now: now)
        XCTAssertEqual(sorted[0].status, "out_of_service")  // priority 0
        XCTAssertEqual(sorted[1].status, "maintenance")     // priority 1
        XCTAssertEqual(sorted[2].status, "in_service")      // priority 4
    }

    func testSummaryAndNotReadyCount() {
        let vehicles = [
            FleetVehicle(id: 1, number: "A", name: "", status: "out_of_service", mileage: nil, lastInspectionEpoch: nil, lastResult: nil),
            FleetVehicle(id: 2, number: "B", name: "", status: "in_service", mileage: nil, lastInspectionEpoch: nil, lastResult: nil),
            FleetVehicle(id: 3, number: "C", name: "", status: "in_service", mileage: nil, lastInspectionEpoch: nil, lastResult: nil),
        ]
        let s = FleetReadiness.summary(vehicles, now: now)
        XCTAssertEqual(s[.oos], 1)
        XCTAssertEqual(s[.ready], 2)
        XCTAssertEqual(FleetReadiness.notReadyCount(vehicles, now: now), 1)
    }

    func testReadinessHasToneAndIcon() {
        for r in [VehicleReadiness.oos, .maintenance, .overdue, .defects, .ready, .unknown] {
            XCTAssertFalse(r.label.isEmpty)
            XCTAssertFalse(r.tone.isEmpty)
            XCTAssertFalse(r.icon.isEmpty)
        }
    }
}
