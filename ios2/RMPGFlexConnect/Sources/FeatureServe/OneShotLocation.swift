import CoreLocation

/// A single GPS fix for tagging a service attempt — deliberately separate
/// from CoreLocationService's LocationManager, which is built for continuous
/// background patrol tracking and uploads every fix to /api/dispatch/gps.
/// Reusing that here would silently start background tracking + a GPS feed
/// as a side effect of just wanting "where am I right now."
@MainActor
final class OneShotLocation: NSObject, @preconcurrency CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocationCoordinate2D?, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    /// Resolves with the current coordinate, or nil if permission is denied,
    /// no fix arrives within the timeout, or location services are off.
    ///
    /// Requests permission itself if it hasn't been decided yet, rather than
    /// only checking `authorizationStatus` — the app-launch request on the
    /// separate CoreLocationService LocationManager instance normally beats
    /// an officer to the Serve tab, but relying on that alone means a
    /// `.notDetermined` status here (e.g. the launch prompt is still pending,
    /// or was dismissed without a choice) permanently fails GPS tagging with
    /// no way to recover short of the officer manually opening Settings.
    func currentCoordinate(timeout: TimeInterval = 8) async -> CLLocationCoordinate2D? {
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
            await waitForAuthorizationDecision(timeout: timeout / 2)
        }

        guard manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse else {
            return nil
        }

        return await withCheckedContinuation { cont in
            self.continuation = cont
            manager.requestLocation()
            Task {
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                if let pending = self.continuation {
                    self.continuation = nil
                    pending.resume(returning: nil)
                }
            }
        }
    }

    private func waitForAuthorizationDecision(timeout: TimeInterval) async {
        guard manager.authorizationStatus == .notDetermined else { return }
        await withCheckedContinuation { cont in
            self.authContinuation = cont
            Task {
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                if let pending = self.authContinuation {
                    self.authContinuation = nil
                    pending.resume()
                }
            }
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let coordinate = locations.last?.coordinate else { return }
        continuation?.resume(returning: coordinate)
        continuation = nil
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        continuation?.resume(returning: nil)
        continuation = nil
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authContinuation?.resume()
        authContinuation = nil
    }

    private var authContinuation: CheckedContinuation<Void, Never>?
}
