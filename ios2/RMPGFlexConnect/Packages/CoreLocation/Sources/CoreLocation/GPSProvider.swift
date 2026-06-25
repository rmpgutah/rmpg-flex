import Foundation
import CoreLocation

@Observable
public final class GPSProvider: NSObject, CLLocationManagerDelegate {
    private let manager: CLLocationManager

    public var authorizationStatus: CLAuthorizationStatus = .notDetermined
    public var currentLocation: CLLocation?
    public var lastError: Error?

    public override init() {
        self.manager = CLLocationManager()
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.activityType = .automotiveNavigation
        manager.distanceFilter = 10
        manager.allowsBackgroundLocationUpdates = true
        manager.pausesLocationUpdatesAutomatically = false
    }

    public func requestAuthorization() {
        manager.requestAlwaysAuthorization()
    }

    public func startUpdatingLocation() {
        manager.startUpdatingLocation()
    }

    public func stopUpdatingLocation() {
        manager.stopUpdatingLocation()
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorizationStatus = manager.authorizationStatus
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        currentLocation = locations.last
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        lastError = error
    }
}

public struct LocationPoint: Codable, Sendable, Equatable {
    public let latitude: Double
    public let longitude: Double
    public let accuracy: Double
    public let timestamp: Date

    public init(latitude: Double, longitude: Double, accuracy: Double, timestamp: Date = Date()) {
        self.latitude = latitude
        self.longitude = longitude
        self.accuracy = accuracy
        self.timestamp = timestamp
    }

    public init(location: CLLocation) {
        self.latitude = location.coordinate.latitude
        self.longitude = location.coordinate.longitude
        self.accuracy = location.horizontalAccuracy
        self.timestamp = location.timestamp
    }

    public var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}
