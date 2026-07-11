import Foundation
#if os(iOS)
import ActivityKit
#endif

public struct ActiveCFSActivityAttributes {
    public let cfsNumber: String
    public let incidentType: String
    public let address: String
    public let dispatchedAt: Date

    public init(cfsNumber: String, incidentType: String, address: String, dispatchedAt: Date) {
        self.cfsNumber = cfsNumber
        self.incidentType = incidentType
        self.address = address
        self.dispatchedAt = dispatchedAt
    }
}

public struct CFSContentState: Codable, Hashable {
    public let elapsed: TimeInterval
    public let status: String
    public let unitsResponding: Int
    public let notes: String?

    public init(elapsed: TimeInterval, status: String, unitsResponding: Int, notes: String? = nil) {
        self.elapsed = elapsed
        self.status = status
        self.unitsResponding = unitsResponding
        self.notes = notes
    }
}

#if os(iOS)
extension ActiveCFSActivityAttributes: ActivityAttributes {
    public typealias ContentState = CFSContentState
}

public enum LiveActivityManager {
    public static func startActivity(for attributes: ActiveCFSActivityAttributes, state: CFSContentState) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: .init(state: state, staleDate: nil),
                pushType: .token
            )
            Task { await registerPushToken(activity) }
        } catch {}
    }

    public static func updateActivity(for cfsNumber: String, state: CFSContentState) {
        Task {
            for activity in Activity<ActiveCFSActivityAttributes>.activities where activity.attributes.cfsNumber == cfsNumber {
                await activity.update(.init(state: state, staleDate: nil))
            }
        }
    }

    public static func endActivity(for cfsNumber: String) {
        Task {
            for activity in Activity<ActiveCFSActivityAttributes>.activities where activity.attributes.cfsNumber == cfsNumber {
                await activity.end(.init(state: activity.content.state, staleDate: nil), dismissalPolicy: .default)
            }
        }
    }

    public static func endAll() {
        Task {
            for activity in Activity<ActiveCFSActivityAttributes>.activities {
                await activity.end(.init(state: activity.content.state, staleDate: nil), dismissalPolicy: .immediate)
            }
        }
    }

    private static func registerPushToken(_ activity: Activity<ActiveCFSActivityAttributes>) async {
        for await token in activity.pushTokenUpdates {
            let tokenString = token.map { String(format: "%02.2hhx", $0) }.joined()
            NotificationCenter.default.post(name: .liveActivityPushToken, object: nil, userInfo: ["token": tokenString, "cfsNumber": activity.attributes.cfsNumber])
        }
    }
}

extension Notification.Name {
    public static let liveActivityPushToken = Notification.Name("liveActivityPushToken")
}
#endif
