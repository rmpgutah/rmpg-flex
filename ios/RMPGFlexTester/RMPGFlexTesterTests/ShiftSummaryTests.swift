import XCTest
@testable import RMPGFlexTester

final class ShiftSummaryTests: XCTestCase {
    func testCompileCountsAndTotals() {
        let ap: [String: Any] = ["data": [
            "calls": [[:], [:], [:]],          // 3
            "incidents": [[:]],                // 1
            "citations": [[:], [:]],           // 2
            "patrols": [[:], [:], [:], [:]],   // 4
        ]]
        let fuel: [[String: Any]] = [
            ["gallons": 12.5, "total_cost": 41.20],
            ["gallons": "8", "cost": "26.00"],
        ]
        let insp: [[String: Any]] = [
            ["inspection_type": "pre_trip", "mileage_at_inspection": 40000],
            ["inspection_type": "post_trip", "mileage_at_inspection": 40087,
             "checklist": "[{\"status\":\"defect\"},{\"status\":\"pass\"}]"],
        ]
        let s = ShiftSummary.compile(autoPopulate: ap, fuelLogs: fuel, inspections: insp, alprReads: 9)
        XCTAssertEqual(s.calls, 3)
        XCTAssertEqual(s.incidents, 1)
        XCTAssertEqual(s.citations, 2)
        XCTAssertEqual(s.patrols, 4)
        XCTAssertEqual(s.alprReads, 9)
        XCTAssertEqual(s.fuelGallons, 20.5, accuracy: 0.001)
        XCTAssertEqual(s.fuelCost, 67.20, accuracy: 0.001)
        XCTAssertEqual(s.milesDriven, 87)
        XCTAssertEqual(s.inspectionsLogged, 2)
        XCTAssertEqual(s.inspectionDefects, 1)
    }

    func testCompileToleratesBareDataAndEmpties() {
        let s = ShiftSummary.compile(autoPopulate: ["calls": [[:]]], fuelLogs: [], inspections: [], alprReads: 0)
        XCTAssertEqual(s.calls, 1)
        XCTAssertEqual(s.milesDriven, 0)
        XCTAssertEqual(s.fuelGallons, 0)
    }

    func testMilesIgnoresBackwardOrMissing() {
        // post < pre → 0 (don't report negative miles)
        XCTAssertEqual(ShiftSummary.milesFromInspections([
            ["inspection_type": "pre_trip", "mileage": 500],
            ["inspection_type": "post_trip", "mileage": 400],
        ]), 0)
        // only a pre-trip → 0
        XCTAssertEqual(ShiftSummary.milesFromInspections([["inspection_type": "pre_trip", "mileage": 500]]), 0)
    }

    func testDefectCountFallsBackToOverallResult() {
        XCTAssertEqual(ShiftSummary.defectCount(["overall_result": "fail"]), 1)
        XCTAssertEqual(ShiftSummary.defectCount(["overall_result": "pass"]), 0)
    }

    func testNarrativeIncludesKeyLines() {
        let s = ShiftStats(calls: 5, incidents: 2, citations: 1, patrols: 3, alprReads: 12,
                           fuelGallons: 10, fuelCost: 35, milesDriven: 120,
                           inspectionsLogged: 2, inspectionDefects: 0)
        let n = ShiftSummary.narrative(s)
        XCTAssertTrue(n.contains("Calls handled: 5"))
        XCTAssertTrue(n.contains("ALPR reads: 12"))
        XCTAssertTrue(n.contains("Miles driven: 120"))
        XCTAssertTrue(n.contains("Fuel: 10.0 gal"))
        XCTAssertTrue(n.contains("clean"))
    }
}
