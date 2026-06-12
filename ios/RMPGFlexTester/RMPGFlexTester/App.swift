import SwiftUI

@main
struct RMPGFlexTesterApp: App {
    var body: some Scene {
        WindowGroup {
            TabView {
                FieldOpsView()
                    .tabItem { Label("Field Ops", systemImage: "shield.lefthalf.filled") }
                IDScanView()
                    .tabItem { Label("ID Scan", systemImage: "person.text.rectangle") }
                FieldToolkitView()
                    .tabItem { Label("Toolkit", systemImage: "square.grid.3x3.fill") }
                D1ConsoleView()
                    .tabItem { Label("D1 Console", systemImage: "terminal") }
                CloudStatusView()
                    .tabItem { Label("Cloud", systemImage: "cloud") }
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
