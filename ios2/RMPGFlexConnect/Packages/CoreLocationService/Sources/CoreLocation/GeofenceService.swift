import Foundation
import CoreLocation

public actor GeofenceService {
    private var monitoredRegions: [String: CLCircularRegion] = [:]
    private let manager: CLLocationManager

    public init(manager: CLLocationManager) {
        self.manager = manager
    }

    public func startMonitoring(identifier: String, center: CLLocationCoordinate2D, radius: CLLocationDistance) {
        let region = CLCircularRegion(center: center, radius: radius, identifier: identifier)
        region.notifyOnEntry = true
        region.notifyOnExit = true
        monitoredRegions[identifier] = region
        manager.startMonitoring(for: region)
    }

    public func stopMonitoring(identifier: String) {
        guard let region = monitoredRegions.removeValue(forKey: identifier) else { return }
        manager.stopMonitoring(for: region)
    }

    public func stopAll() {
        for (_, region) in monitoredRegions {
            manager.stopMonitoring(for: region)
        }
        monitoredRegions.removeAll()
    }

    public func haversineDistance(from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) -> CLLocationDistance {
        let r = 6371000.0
        let lat1 = from.latitude * .pi / 180
        let lat2 = to.latitude * .pi / 180
        let dLat = (to.latitude - from.latitude) * .pi / 180
        let dLon = (to.longitude - from.longitude) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2) +
                cos(lat1) * cos(lat2) *
                sin(dLon / 2) * sin(dLon / 2)
        let c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return r * c
    }
}
