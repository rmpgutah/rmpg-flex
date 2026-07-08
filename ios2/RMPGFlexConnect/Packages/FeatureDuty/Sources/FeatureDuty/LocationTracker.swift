import CoreLocation
import CoreAPI
import Foundation

// Forwards CLLocationManager delegate callbacks to a MainActor handler.
// CLLocationManager must be created and used on the main thread; its delegate
// is called on main thread, but the protocol methods can't be marked @MainActor
// because it's Obj-C — so we bridge via a lightweight nonisolated forwarder.
private final class LocationDelegate: NSObject, CLLocationManagerDelegate, @unchecked Sendable {
    var onLocations: @Sendable ([CLLocation]) -> Void = { _ in }
    var onAuthChange: @Sendable (CLAuthorizationStatus) -> Void = { _ in }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        onLocations(locations)
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        onAuthChange(manager.authorizationStatus)
    }
}

@Observable
@MainActor
public final class LocationTracker {
    public private(set) var authorizationStatus: CLAuthorizationStatus = .notDetermined
    public private(set) var isTracking = false
    public private(set) var lastFix: CLLocation?

    private let manager = CLLocationManager()
    private let delegate = LocationDelegate()
    private var pendingPoints: [GPSPoint] = []
    private var flushTask: Task<Void, Never>?
    private var apiClient: APIClient?

    public init() {
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 15
        manager.delegate = delegate
        authorizationStatus = manager.authorizationStatus

        delegate.onLocations = { [weak self] locs in
            Task { @MainActor [weak self] in
                self?.handleLocations(locs)
            }
        }
        delegate.onAuthChange = { [weak self] status in
            Task { @MainActor [weak self] in
                self?.authorizationStatus = status
                #if os(iOS)
                if status == .authorizedWhenInUse || status == .authorizedAlways {
                    self?.manager.startUpdatingLocation()
                }
                #else
                if status == .authorizedAlways {
                    self?.manager.startUpdatingLocation()
                }
                #endif
            }
        }
    }

    public func start(apiClient: APIClient) {
        self.apiClient = apiClient
        isTracking = true
        switch manager.authorizationStatus {
        case .notDetermined:
            #if os(iOS)
            manager.requestWhenInUseAuthorization()
            #else
            manager.requestAlwaysAuthorization()
            #endif
        #if os(iOS)
        case .authorizedWhenInUse, .authorizedAlways:
            manager.startUpdatingLocation()
        #else
        case .authorizedAlways:
            manager.startUpdatingLocation()
        #endif
        default:
            break
        }
        startFlushLoop()
    }

    // Patrol vehicle location tracking is an iOS-only feature at runtime —
    // `authorizedWhenInUse` doesn't exist on macOS's CLAuthorizationStatus.
    // macOS support here exists only so this package's tests can build/run
    // on the CI macOS runner, not because it ever ships on macOS.
    private static func isAuthorized(_ status: CLAuthorizationStatus) -> Bool {
        #if os(iOS)
        return status == .authorizedWhenInUse || status == .authorizedAlways
        #else
        return status == .authorizedAlways
        #endif
    }

    public func stop() {
        isTracking = false
        manager.stopUpdatingLocation()
        flushTask?.cancel()
        flushTask = nil
        pendingPoints = []
        apiClient = nil
    }

    private func handleLocations(_ locations: [CLLocation]) {
        for loc in locations where loc.horizontalAccuracy > 0 && loc.horizontalAccuracy < 200 {
            lastFix = loc
            pendingPoints.append(GPSPoint(
                latitude: loc.coordinate.latitude,
                longitude: loc.coordinate.longitude,
                accuracy: loc.horizontalAccuracy,
                speed: max(0, loc.speed),
                heading: loc.course >= 0 ? loc.course : nil,
                source: "ios_corelocation"
            ))
        }
    }

    private func startFlushLoop() {
        flushTask?.cancel()
        flushTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                await self?.flush()
            }
        }
    }

    private func flush() async {
        guard !pendingPoints.isEmpty, let client = apiClient else { return }
        let batch = pendingPoints
        pendingPoints = []
        do {
            struct Body: Encodable { let points: [GPSPoint] }
            let endpoint = try Endpoint.jsonPost("api/dispatch/gps", body: Body(points: batch))
            struct R: Decodable {}
            _ = try? await client.request(endpoint, as: R.self)
        } catch {}
    }
}

private struct GPSPoint: Encodable {
    let latitude: Double
    let longitude: Double
    let accuracy: Double?
    let speed: Double?
    let heading: Double?
    let source: String
}
