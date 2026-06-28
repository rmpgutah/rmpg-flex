import AppIntents

@available(iOS 17.0, *)
struct RMPGShortcutsProvider: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: RunPlateIntent(),
            phrases: ["Run a license plate with \(.applicationName)", "Check plate \(.applicationName)"],
            shortTitle: "Run Plate",
            systemImageName: "camera.viewfinder"
        )
        AppShortcut(
            intent: RunIDIntent(),
            phrases: ["Scan an ID with \(.applicationName)", "Run ID \(.applicationName)"],
            shortTitle: "Scan ID",
            systemImageName: "person.text.rectangle"
        )
        AppShortcut(
            intent: ClockOnIntent(),
            phrases: ["Clock on with \(.applicationName)", "Start patrol \(.applicationName)"],
            shortTitle: "Clock On",
            systemImageName: "car.fill"
        )
        AppShortcut(
            intent: PanicIntent(),
            phrases: ["Send panic alert \(.applicationName)", "Emergency \(.applicationName)"],
            shortTitle: "Panic",
            systemImageName: "exclamationmark.shield.fill"
        )
    }
}
