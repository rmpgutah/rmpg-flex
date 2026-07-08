import XCTest
import CoreLocation
@testable import CoreCarPlay

final class CarPlayNavigationCoordinatorTests: XCTestCase {
    func testReturnsCoordinateWhenBothPresent() {
        let call = CarPlayCall(id: 1, callNumber: nil, incidentType: nil, priority: nil, status: nil, latitude: 40.7608, longitude: -111.8910)
        let coordinate = CarPlayNavigationCoordinator.destinationCoordinate(for: call)
        XCTAssertEqual(coordinate?.latitude, 40.7608)
        XCTAssertEqual(coordinate?.longitude, -111.8910)
    }

    func testReturnsNilWhenLatitudeMissing() {
        let call = CarPlayCall(id: 1, callNumber: nil, incidentType: nil, priority: nil, status: nil, latitude: nil, longitude: -111.8910)
        XCTAssertNil(CarPlayNavigationCoordinator.destinationCoordinate(for: call))
    }

    func testReturnsNilWhenLongitudeMissing() {
        let call = CarPlayCall(id: 1, callNumber: nil, incidentType: nil, priority: nil, status: nil, latitude: 40.7608, longitude: nil)
        XCTAssertNil(CarPlayNavigationCoordinator.destinationCoordinate(for: call))
    }
}
