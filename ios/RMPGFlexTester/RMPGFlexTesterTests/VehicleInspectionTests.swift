import XCTest
@testable import RMPGFlexTester

final class VehicleInspectionTests: XCTestCase {
    func testCatalogIsComprehensiveAndUnique() {
        XCTAssertGreaterThanOrEqual(VehicleInspection.catalog.count, 30)
        let ids = VehicleInspection.catalog.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
        XCTAssertFalse(VehicleInspection.categories.isEmpty)
        for l in VehicleInspection.catalog { XCTAssertTrue(VehicleInspection.categories.contains(l.category)) }
    }

    func testFreshLinesAllPass() {
        let lines = VehicleInspection.freshLines()
        XCTAssertTrue(lines.allSatisfy { $0.status == .pass })
        XCTAssertEqual(VehicleInspection.overallResult(lines), "pass")
        XCTAssertFalse(VehicleInspection.isOutOfService(lines))
        XCTAssertTrue(VehicleInspection.defects(lines).isEmpty)
    }

    func testMinorDefectFailsButNotOOS() {
        var lines = VehicleInspection.freshLines()
        lines[0].status = .defect
        lines[0].severity = .major
        XCTAssertEqual(VehicleInspection.overallResult(lines), "fail")
        XCTAssertEqual(VehicleInspection.defects(lines).count, 1)
        XCTAssertFalse(VehicleInspection.isOutOfService(lines))
    }

    func testCriticalDefectIsOOS() {
        var lines = VehicleInspection.freshLines()
        let brakeIdx = lines.firstIndex { $0.id == "br_pedal" }!
        lines[brakeIdx].status = .defect
        lines[brakeIdx].severity = .critical
        XCTAssertTrue(VehicleInspection.isOutOfService(lines))
        XCTAssertEqual(VehicleInspection.overallResult(lines), "fail")
    }

    func testNAIsNotADefect() {
        var lines = VehicleInspection.freshLines()
        lines[0].status = .na
        XCTAssertEqual(VehicleInspection.overallResult(lines), "pass")
        XCTAssertTrue(VehicleInspection.defects(lines).isEmpty)
    }

    func testPayloadShape() {
        var lines = VehicleInspection.freshLines()
        lines[0].status = .defect; lines[0].severity = .critical; lines[0].note = "cracked"
        let payload = VehicleInspection.payload(lines)
        XCTAssertEqual(payload.count, lines.count)
        let first = payload[0]
        XCTAssertEqual(first["status"], "defect")
        XCTAssertEqual(first["severity"], "critical")
        XCTAssertEqual(first["notes"], "cracked")
        XCTAssertFalse(first["category"]?.isEmpty ?? true)
        // pass rows carry an empty severity
        XCTAssertEqual(payload.last?["severity"], "")
    }

    func testLinesInCategory() {
        let lines = VehicleInspection.freshLines()
        for cat in VehicleInspection.categories {
            XCTAssertFalse(VehicleInspection.linesIn(cat, lines).isEmpty)
        }
    }
}
