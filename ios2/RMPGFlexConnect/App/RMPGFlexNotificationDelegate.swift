import UIKit
#if canImport(CorePush)
import CorePush
#endif

/// Minimal `UIApplicationDelegate` whose sole job is receiving the two
/// remote-notification registration callbacks and forwarding them via
/// `NotificationCenter` — see `PushManager`'s doc comment for why this
/// exists: the app is otherwise pure SwiftUI-lifecycle with no delegate at
/// all, so `UIApplication.shared.registerForRemoteNotifications()` had no
/// way to ever deliver its result back into the app.
final class RMPGFlexNotificationDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        #if canImport(CorePush)
        NotificationCenter.default.post(name: .rmpgDidReceiveAPNsToken, object: deviceToken)
        #endif
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("[Push] Remote notification registration failed: \(error)")
    }
}
