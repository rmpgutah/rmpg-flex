import Foundation
import UserNotifications

public enum NotificationCategory: String {
    case criticalAlert = "critical_alert"
    case boloPush = "bolo_push"
    case cfsDispatch = "cfs_dispatch_to_me"
    case welfareCheck = "welfare_check_timeout"
    case rosterChange = "roster_change"
    case commsDM = "comms_dm"
    case commsPTT = "comms_ptt_invite"
}

public enum NotificationAction: String {
    case accept = "ACCEPT"
    case acknowledge = "ACKNOWLEDGE"
    case decline = "DECLINE"
    case snooze = "SNOOZE"
    case checkIn = "CHECK_IN"
    case viewMap = "VIEW_MAP"
}

public func registerNotificationCategories() {
    let accept = UNNotificationAction(identifier: NotificationAction.accept.rawValue, title: "Accept", options: .foreground)
    let ack = UNNotificationAction(identifier: NotificationAction.acknowledge.rawValue, title: "Acknowledge", options: .foreground)
    let decline = UNNotificationAction(identifier: NotificationAction.decline.rawValue, title: "Decline", options: .destructive)
    let snooze = UNNotificationAction(identifier: NotificationAction.snooze.rawValue, title: "Snooze 2 min", options: [])
    let checkIn = UNNotificationAction(identifier: NotificationAction.checkIn.rawValue, title: "Check In", options: .foreground)
    let viewMap = UNNotificationAction(identifier: NotificationAction.viewMap.rawValue, title: "View Map", options: .foreground)

    let cfsCategory = UNNotificationCategory(
        identifier: NotificationCategory.cfsDispatch.rawValue,
        actions: [accept, decline, viewMap],
        intentIdentifiers: [],
        options: .customDismissAction
    )
    let boloCategory = UNNotificationCategory(
        identifier: NotificationCategory.boloPush.rawValue,
        actions: [ack, viewMap],
        intentIdentifiers: [],
        options: .customDismissAction
    )
    let welfareCategory = UNNotificationCategory(
        identifier: NotificationCategory.welfareCheck.rawValue,
        actions: [checkIn, snooze],
        intentIdentifiers: [],
        options: .customDismissAction
    )
    let criticalCategory = UNNotificationCategory(
        identifier: NotificationCategory.criticalAlert.rawValue,
        actions: [ack, viewMap],
        intentIdentifiers: [],
        options: [.customDismissAction, .hiddenPreviewsShowTitle]
    )

    UNUserNotificationCenter.current().setNotificationCategories([
        cfsCategory, boloCategory, welfareCategory, criticalCategory
    ])
}
