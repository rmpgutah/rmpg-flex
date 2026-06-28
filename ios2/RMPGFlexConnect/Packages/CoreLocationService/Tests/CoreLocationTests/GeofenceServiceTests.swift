import Testing
import CoreLocation
@testable import CoreLocationService

@Test func haversineDistanceZero() {
    let service = GeofenceService(manager: CLLocationManager())
    let coord = CLLocationCoordinate2D(latitude: 40.7608, longitude: -111.8910)
    let distance = service.haversineDistance(from: coord, to: coord)
    #expect(distance == 0)
}

@Test func haversineDistanceSLCtoProvo() {
    let service = GeofenceService(manager: CLLocationManager())
    let slc = CLLocationCoordinate2D(latitude: 40.7608, longitude: -111.8910)
    let provo = CLLocationCoordinate2D(latitude: 40.2338, longitude: -111.6585)
    let distance = service.haversineDistance(from: slc, to: provo)
    #expect(distance > 50_000)
    #expect(distance < 70_000)
}

@Test func locationPointInitialization() {
    let point = LocationPoint(latitude: 40.0, longitude: -111.0, accuracy: 10.0)
    #expect(point.latitude == 40.0)
    #expect(point.longitude == -111.0)
    #expect(point.accuracy == 10.0)
}
