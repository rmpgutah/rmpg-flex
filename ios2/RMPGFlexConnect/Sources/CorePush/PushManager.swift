import Foundation
import UIKit


/// Posted by `RMPGFlexNotificationDelegate.application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`
/// with the raw `Data` token as `object` — decouples the UIKit AppDelegate
/// callback (which has no reference to this SwiftUI-owned instance) from
/// `PushManager` without needing init-order coupling between the two.
public extension Notification.Name {
    static let rmpgDidReceiveAPNsToken = Notification.Name("rmpgDidReceiveAPNsToken")
}

@MainActor
public final class PushManager: NSObject, ObservableObject, @unchecked Sendable {
    @Published public var deviceToken: String?

    private let apiClient: APIClient

    /// A prior version called `UIApplication.shared.registerForRemoteNotifications()`
    /// from `register()` below, but the app had NO `UIApplicationDelegate` at
    /// all (pure SwiftUI-lifecycle `@main App`) — so the system had nowhere
    /// to deliver the resulting token. `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`
    /// was simply never called by anything, meaning `didRegister(token:)`
    /// (and therefore the registration endpoint below) never ran for any
    /// install, ever. Listening for the notification the new
    /// `RMPGFlexNotificationDelegate` posts (wired via
    /// `@UIApplicationDelegateAdaptor` in the App struct) is what actually
    /// connects the two halves of this feature for the first time.
    public init(apiClient: APIClient) {
        self.apiClient = apiClient
        super.init()
        NotificationCenter.default.addObserver(
            forName: .rmpgDidReceiveAPNsToken, object: nil, queue: .main
        ) { [weak self] notification in
            guard let token = notification.object as? Data else { return }
            Task { @MainActor in self?.didRegister(token: token) }
        }
    }

    public func register() {
        Task {
            guard let granted = try? await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .badge, .sound]), granted else { return }
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    /// POST /api/push/register — a prior version of this only stored the
    /// token in `@Published deviceToken` and never sent it anywhere; no
    /// route or table existed on the Worker to receive it at all, so
    /// registering for push notifications has never actually reached the
    /// server for any install. This only registers the token for storage —
    /// actually triggering an APNs send from the Worker still needs an Apple
    /// Push Notification Auth Key provisioned there first.
    public func didRegister(token: Data) {
        let tokenString = token.map { String(format: "%02.2hhx", $0) }.joined()
        deviceToken = tokenString
        Task {
            do {
                let body = try JSONSerialization.data(withJSONObject: ["device_token": tokenString, "platform": "ios"])
                try await apiClient.requestVoid(Endpoint(path: "/api/push/register", method: .post, body: body))
            } catch {
                print("Push token registration failed: \(error)")
            }
        }
    }

    public func scheduleLocal(identifier: String, title: String, body: String, delay: TimeInterval = 1) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .defaultCritical
        content.interruptionLevel = .timeSensitive

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request)
    }

    public func scheduleWelfareCheck(callSign: String, callNumber: String, officerId: Int) {
        scheduleLocal(
            identifier: "welfare-\(officerId)-\(Date().timeIntervalSince1970)",
            title: "Welfare Check — \(callSign)",
            body: "Respond to call #\(callNumber) or your welfare status will escalate.",
            delay: 1
        )
    }

    public func schedulePanicAlert(source: String) {
        scheduleLocal(
            identifier: "panic-\(Date().timeIntervalSince1970)",
            title: "OFFICER PANIC — \(source)",
            body: "Officer duress alert activated. All available units respond.",
            delay: 0.5
        )
    }
}
