import Foundation
import CoreMotion

/// Publishes the latest CMMotionActivity as (activity, confidence) strings
/// matching the server's gps_breadcrumbs.activity vocabulary.
final class MotionActivityService: ObservableObject {
    static let shared = MotionActivityService()
    private let manager = CMMotionActivityManager()
    @Published private(set) var activity: String = "unknown"
    @Published private(set) var confidence: String = "low"
    private(set) var updatedAt: Date = .distantPast

    func start() {
        guard CMMotionActivityManager.isActivityAvailable() else { return }
        manager.startActivityUpdates(to: .main) { [weak self] a in
            guard let self, let a else { return }
            self.activity = a.walking ? "walking"
                : a.running ? "running"
                : a.automotive ? "automotive"
                : a.cycling ? "cycling"
                : a.stationary ? "stationary"
                : "unknown"
            self.confidence = a.confidence == .high ? "high" : a.confidence == .medium ? "medium" : "low"
            self.updatedAt = Date()
        }
    }

    func stop() { manager.stopActivityUpdates() }

    /// Fields to merge into a GPS post body; empty when stale (>30 s).
    var gpsFields: [String: Any] {
        guard Date().timeIntervalSince(updatedAt) < 30 else { return [:] }
        return ["activity": activity, "activity_confidence": confidence]
    }
}
