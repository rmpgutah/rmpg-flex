import Foundation
import CoreLocation


@MainActor
public final class LocationManager: NSObject, ObservableObject, @unchecked Sendable {
    @Published public var currentLocation: CLLocation?
    @Published public var authorizationStatus: CLAuthorizationStatus = .notDetermined
    @Published public var isTracking = false

    private let locationManager = CLLocationManager()
    private let apiClient: APIClient
    private var uploadTimer: Timer?
    private var pendingPoints: [GPSPoint] = []
    private let uploadInterval: TimeInterval = 10
    private let minimumDistance: CLLocationDistance = 5

    public init(apiClient: APIClient) {
        self.apiClient = apiClient
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        locationManager.distanceFilter = minimumDistance
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.activityType = .automotiveNavigation
    }

    public func requestPermission() {
        locationManager.requestAlwaysAuthorization()
    }

    public func startTracking() {
        isTracking = true
        locationManager.startUpdatingLocation()
        uploadTimer = Timer.scheduledTimer(withTimeInterval: uploadInterval, repeats: true) { [weak self] _ in
            Task { await self?.flushPendingPoints() }
        }
    }

    public func stopTracking() {
        isTracking = false
        locationManager.stopUpdatingLocation()
        uploadTimer?.invalidate()
        uploadTimer = nil
        Task { await flushPendingPoints() }
    }

    private func flushPendingPoints() async {
        let points = pendingPoints
        pendingPoints.removeAll()
        guard !points.isEmpty else { return }
        do {
            if points.count == 1, let p = points.first {
                try await apiClient.requestVoid(Endpoint(
                    path: "/api/dispatch/gps",
                    method: .post,
                    body: try JSONEncoder().encode(p)
                ))
            } else {
                let upload = GPSBulkUpload(points: points)
                try await apiClient.requestVoid(Endpoint(
                    path: "/api/dispatch/gps",
                    method: .post,
                    body: try JSONEncoder().encode(upload)
                ))
            }
        } catch {
            pendingPoints.insert(contentsOf: points, at: 0)
        }
    }
}

extension LocationManager: @preconcurrency CLLocationManagerDelegate {
    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorizationStatus = manager.authorizationStatus
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            if isTracking { manager.startUpdatingLocation() }
        default:
            manager.stopUpdatingLocation()
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last, location.horizontalAccuracy >= 0 else { return }
        currentLocation = location

        let point = GPSPoint(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            accuracy: location.horizontalAccuracy,
            heading: location.course >= 0 ? location.course : nil,
            speed: location.speed >= 0 ? location.speed : nil
        )
        pendingPoints.append(point)
    }
}
