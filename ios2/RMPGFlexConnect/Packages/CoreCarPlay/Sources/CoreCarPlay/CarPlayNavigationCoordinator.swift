import CoreLocation

/// CLLocationCoordinate2D itself is available on macOS (unlike CLLocationManager's
/// authorization APIs — see FeatureDuty/LocationTracker.swift's #if os(iOS) guards
/// from a prior PR), so this stays plain-testable with no platform guard needed.
public enum CarPlayNavigationCoordinator {
    public static func destinationCoordinate(for call: CarPlayCall) -> CLLocationCoordinate2D? {
        guard let latitude = call.latitude, let longitude = call.longitude else { return nil }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}
