import AppIntents
import Foundation

// Hands-free / locked-phone actions via Siri, the Shortcuts app, and the Action
// button (iPhone 15 Pro+). Each runs WITHOUT opening the app and reuses the same
// networking + offline queue as the in-app buttons.
//
// NOTE: App Intents compile with swiftc, but their Siri/Action-button
// discoverability comes from Xcode's "Extract App Intents Metadata" build phase
// — build once via the Xcode GUI to activate them on-device.

// Shared: set the on-duty unit's status, queueing on a dead zone.
private func setUnitStatus(_ value: String, label: String) async -> String {
    guard let client = await authedClient() else { return "Set your RMPG credentials in the app first." }
    guard let state = try? await client.requestJSON("GET", "api/dispatch/duty/me") as? [String: Any],
          let unit = state["unit"] as? [String: Any], let id = unit["id"] as? Int else {
        return "You're not on duty with a unit."
    }
    do {
        try await client.requestJSON("PUT", "api/dispatch/units/\(id)/status", body: ["status": value])
        return "Status set to \(label)."
    } catch {
        OfflineQueue.enqueue(method: "PUT", path: "api/dispatch/units/\(id)/status",
                             body: ["status": value], label: "Status → \(label)")
        return "Offline — \(label) queued; it sends when signal returns."
    }
}

struct PanicIntent: AppIntent {
    static var title: LocalizedStringResource = "Send Panic Alarm"
    static var description = IntentDescription("Sends a Priority-1 officer-assist alarm to RMPG dispatch.")
    static var openAppWhenRun = false
    // Fire even when the phone is locked — a panic must not require Face ID.
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let client = await authedClient() else {
            return .result(dialog: "Set your RMPG credentials in the app first.")
        }
        var body: [String: Any] = ["trigger_method": "ios_app_intent"]
        if let loc = LocationManager.shared.last {
            body["latitude"] = loc.coordinate.latitude
            body["longitude"] = loc.coordinate.longitude
        }
        do {
            try await client.requestJSON("POST", "api/dispatch/panic", body: body)
            return .result(dialog: "Panic alarm sent. Officer-assist is on the dispatch board.")
        } catch {
            OfflineQueue.enqueue(method: "POST", path: "api/dispatch/panic", body: body, label: "PANIC")
            return .result(dialog: "Offline — panic queued; it sends the moment signal returns.")
        }
    }
}

struct MarkOnSceneIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark On Scene"
    static var openAppWhenRun = false
    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: "\(await setUnitStatus("on_scene", label: "on scene"))")
    }
}

struct MarkEnRouteIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark En Route"
    static var openAppWhenRun = false
    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: "\(await setUnitStatus("enroute", label: "en route"))")
    }
}

struct MarkAvailableIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark Available"
    static var openAppWhenRun = false
    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: "\(await setUnitStatus("available", label: "available"))")
    }
}

// Zero-config App Shortcuts — appear in Siri/Shortcuts/Action-button once the app
// is built through Xcode (metadata extraction). Phrases must include the app name.
struct RMPGShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: PanicIntent(), phrases: [
            "Send panic in \(.applicationName)",
            "\(.applicationName) panic",
            "Officer needs assistance in \(.applicationName)",
        ], shortTitle: "Panic", systemImageName: "exclamationmark.triangle.fill")
        AppShortcut(intent: MarkOnSceneIntent(), phrases: [
            "Mark on scene in \(.applicationName)",
            "\(.applicationName) on scene",
        ], shortTitle: "On Scene", systemImageName: "mappin.circle.fill")
        AppShortcut(intent: MarkEnRouteIntent(), phrases: [
            "Mark en route in \(.applicationName)",
        ], shortTitle: "En Route", systemImageName: "arrow.triangle.turn.up.right.diamond.fill")
        AppShortcut(intent: MarkAvailableIntent(), phrases: [
            "Mark available in \(.applicationName)",
        ], shortTitle: "Available", systemImageName: "checkmark.circle.fill")
    }
}
