import Foundation

/// The subset of FeatureDispatch's `CallForService` the CarPlay scene
/// actually needs — kept local (not a dependency on FeatureDispatch) since
/// this standalone package can't path-depend on a root-package-only target.
/// `CarPlaySceneDelegate` maps the real `CallForService` into this.
public struct CarPlayCall: Sendable {
    public let id: Int
    public let callNumber: String?
    public let incidentType: String?
    public let priority: String?
    public let status: String?
    public let latitude: Double?
    public let longitude: Double?

    public init(id: Int, callNumber: String?, incidentType: String?, priority: String?, status: String?, latitude: Double?, longitude: Double?) {
        self.id = id
        self.callNumber = callNumber
        self.incidentType = incidentType
        self.priority = priority
        self.status = status
        self.latitude = latitude
        self.longitude = longitude
    }
}

public enum CarPlayCallListBuilder {
    /// (title, detail) for a CPListItem — kept as plain strings so this is
    /// testable without the CarPlay framework, which doesn't exist outside
    /// iOS/CarPlay Simulator.
    public static func displayText(for call: CarPlayCall) -> (title: String, detail: String) {
        let title: String
        switch (call.priority, call.incidentType) {
        case let (priority?, type?):
            title = "\(priority) · \(type)"
        case let (priority?, nil):
            title = priority
        case let (nil, type?):
            title = type
        case (nil, nil):
            title = "Call for Service"
        }
        let detail = call.callNumber.map { "Call \($0)" } ?? ""
        return (title, detail)
    }
}
