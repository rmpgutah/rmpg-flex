import Foundation
import UIKit
import CoreAPI

@MainActor
public final class PushManager: NSObject, ObservableObject, @unchecked Sendable {
    @Published public var deviceToken: String?

    private let apiClient: APIClient

    public init(apiClient: APIClient) {
        self.apiClient = apiClient
        super.init()
    }

    public func register() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    public func didRegister(token: Data) {
        let tokenString = token.map { String(format: "%02.2hhx", $0) }.joined()
        deviceToken = tokenString
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
