import XCTest
@testable import CoreCarPlay

final class CarPlayCallListBuilderTests: XCTestCase {
    func testDisplayTextWithAllFields() {
        let call = CarPlayCall(id: 1, callNumber: "24-001234", incidentType: "Domestic Disturbance", priority: "P1", status: "dispatched", latitude: 40.7, longitude: -111.9)
        let (title, detail) = CarPlayCallListBuilder.displayText(for: call)
        XCTAssertEqual(title, "P1 · Domestic Disturbance")
        XCTAssertEqual(detail, "Call 24-001234")
    }

    func testDisplayTextWithMissingFields() {
        let call = CarPlayCall(id: 2, callNumber: nil, incidentType: nil, priority: nil, status: "dispatched", latitude: nil, longitude: nil)
        let (title, detail) = CarPlayCallListBuilder.displayText(for: call)
        XCTAssertEqual(title, "Call for Service")
        XCTAssertEqual(detail, "")
    }

    func testDisplayTextWithTypeOnly() {
        let call = CarPlayCall(id: 3, callNumber: nil, incidentType: "Welfare Check", priority: nil, status: "dispatched", latitude: nil, longitude: nil)
        let (title, _) = CarPlayCallListBuilder.displayText(for: call)
        XCTAssertEqual(title, "Welfare Check")
    }

    func testDisplayTextWithPriorityOnly() {
        let call = CarPlayCall(id: 4, callNumber: nil, incidentType: nil, priority: "P1", status: "dispatched", latitude: nil, longitude: nil)
        let (title, _) = CarPlayCallListBuilder.displayText(for: call)
        XCTAssertEqual(title, "P1")
    }
}
