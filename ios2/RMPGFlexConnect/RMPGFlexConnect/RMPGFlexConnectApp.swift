import SwiftUI
import CoreAuth
import DesignSystem

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
