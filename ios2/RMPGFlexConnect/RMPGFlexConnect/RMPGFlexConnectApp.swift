import SwiftUI
import CoreAPI
import CoreAuth
import DesignSystem
import FeatureShell

@main
struct RMPGFlexConnectApp: App {
    @State private var session = AuthSession()

    var body: some Scene {
        WindowGroup {
            ThemeProvider {
                ContentView(session: session)
            }
        }
    }
}
