import SwiftUI
import FeatureShell
import CorePush
import CoreLocationService
import CoreAPI
import DesignSystem

@main
struct RMPGFlexConnectApp: App {
    @UIApplicationDelegateAdaptor(RMPGFlexNotificationDelegate.self) private var notificationDelegate
    @StateObject private var pushManager: PushManager
    @StateObject private var locationManager: LocationManager
    private let apiClient: APIClient

    init() {
        let client = APIClient(baseURL: Endpoint.productionBaseURL)
        apiClient = client
        let pm = PushManager(apiClient: client)
        let lm = LocationManager(apiClient: client)
        _pushManager = StateObject(wrappedValue: pm)
        _locationManager = StateObject(wrappedValue: lm)
    }

    var body: some Scene {
        WindowGroup {
            // AppView already renders its own branded loading screen (BrandLogo
            // + spinner) while restoring the session / running the Face ID
            // gate — a prior version of this file additionally held a
            // fixed 2-second timer here before AppView was even shown, adding
            // a flat 2s to EVERY launch regardless of how fast auth actually
            // resolved (often much faster). Showing AppView immediately lets
            // its real loading state — not a guessed timer — drive the delay.
            AppView(apiClient: apiClient)
                .onAppear {
                    pushManager.register()
                    locationManager.requestPermission()
                }
                .preferredColorScheme(.dark)
        }
    }
}
