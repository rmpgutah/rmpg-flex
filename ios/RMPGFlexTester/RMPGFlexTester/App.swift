import SwiftUI

@main
struct RMPGFlexTesterApp: App {
    var body: some Scene {
        WindowGroup {
            TabView {
                D1ConsoleView()
                    .tabItem { Label("D1 Console", systemImage: "terminal") }
                SmokeTestView()
                    .tabItem { Label("Smoke", systemImage: "checkmark.shield") }
                DataViewerView()
                    .tabItem { Label("Data", systemImage: "tablecells") }
                SettingsView()
                    .tabItem { Label("Settings", systemImage: "gearshape") }
            }
            .tint(Theme.gold)
            .preferredColorScheme(.dark)
            .background(Theme.base)
        }
    }
}
