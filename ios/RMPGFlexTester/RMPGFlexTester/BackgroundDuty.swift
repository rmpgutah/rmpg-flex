import Foundation
import CoreLocation
import UserNotifications

// While ON SHIFT: keeps GPS flowing to the dispatch map and watches for new
// call assignments even with the app backgrounded/pocketed. Driven by
// CLLocationManager background updates (UIBackgroundModes: location), which
// wake us on movement; each wake throttles its own work.
final class BackgroundDuty: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let shared = BackgroundDuty()

    private let manager = CLLocationManager()
    @Published private(set) var active = false
    @Published var lastGpsPush: Date?
    private var lastPoll = Date.distantPast
    private var lastPush = Date.distantPast
    private var knownCallId: Int?

    override private init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 10
        manager.pausesLocationUpdatesAutomatically = false
    }

    /// Call with the duty state on every refresh; idempotent.
    func setActive(_ onShift: Bool, currentCallId: Int?) {
        knownCallId = currentCallId ?? knownCallId
        guard onShift != active else { return }
        active = onShift
        if onShift {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
            manager.requestAlwaysAuthorization()
            if CLLocationManager().authorizationStatus == .authorizedAlways ||
               CLLocationManager().authorizationStatus == .authorizedWhenInUse {
                manager.allowsBackgroundLocationUpdates = true
            }
            manager.startUpdatingLocation()
        } else {
            manager.stopUpdatingLocation()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if active, manager.authorizationStatus == .authorizedAlways {
            manager.allowsBackgroundLocationUpdates = true
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard active, let loc = locations.last else { return }
        LocationManager.shared.last = loc
        let now = Date()
        if now.timeIntervalSince(lastPush) >= 20 {
            lastPush = now
            Task { await pushGps(loc) }
        }
        if now.timeIntervalSince(lastPoll) >= 30 {
            lastPoll = now
            Task { await pollForNewCall() }
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    private func authedClient() async -> RMPGAPIClient? {
        var client = AppConfig.apiClient()
        if client.jwt == nil,
           let u = KeychainStore.load(key: "rmpgUser"),
           let p = KeychainStore.load(key: "rmpgPass"), !u.isEmpty,
           let t = try? await client.login(username: u, password: p) {
            KeychainStore.save(t, key: "rmpgJWT"); client.jwt = t
        }
        return client.jwt == nil ? nil : client
    }

    private func pushGps(_ loc: CLLocation) async {
        guard let client = await authedClient() else { return }
        _ = try? await client.requestJSON("POST", "api/dispatch/gps", body: [
            "latitude": loc.coordinate.latitude,
            "longitude": loc.coordinate.longitude,
            "speed": max(loc.speed, 0) * 2.23694,
            "heading": max(loc.course, 0),
            "accuracy": loc.horizontalAccuracy,
            "source": "ios-field-app-bg",
        ])
        await MainActor.run { lastGpsPush = Date() }
    }

    private func pollForNewCall() async {
        guard let client = await authedClient(),
              let state = try? await client.requestJSON("GET", "api/dispatch/duty/me") as? [String: Any],
              let unit = state["unit"] as? [String: Any] else { return }
        let callId = unit["current_call_id"] as? Int
        defer { knownCallId = callId }
        guard let callId, callId != knownCallId else { return }

        // New assignment — local notification with call details.
        var title = "NEW CALL ASSIGNED"
        var bodyText = "Open Field Ops for details"
        if let call = try? await client.requestJSON("GET", "api/dispatch/calls/\(callId)") as? [String: Any] {
            let type = (call["call_type"] as? String ?? call["incident_type"] as? String ?? "CALL").uppercased()
            let pri = call["priority"] as? String ?? ""
            title = "\(pri) \(type)".trimmingCharacters(in: .whitespaces)
            bodyText = call["location_address"] as? String ?? bodyText
        }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = bodyText
        content.sound = .defaultCritical
        try? await UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: "call-\(callId)", content: content, trigger: nil))
    }
}
