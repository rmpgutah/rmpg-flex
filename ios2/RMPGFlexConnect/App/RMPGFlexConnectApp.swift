import SwiftUI
import FeatureShell
#if canImport(CorePush)
import CorePush
#endif
import CoreLocationService
import CoreAPI
import DesignSystem

@main
struct RMPGFlexConnectApp: App {
    #if canImport(CorePush)
    @UIApplicationDelegateAdaptor(RMPGFlexNotificationDelegate.self) private var notificationDelegate
    @StateObject private var pushManager: PushManager
    #endif
    @StateObject private var locationManager: LocationManager
    private let apiClient: APIClient

    init() {
        let client = APIClient(baseURL: Endpoint.productionBaseURL)
        apiClient = client
        #if canImport(CorePush)
        let pm = PushManager(apiClient: client)
        _pushManager = StateObject(wrappedValue: pm)
        #endif
        let lm = LocationManager(apiClient: client)
        _locationManager = StateObject(wrappedValue: lm)
    }

    var body: some Scene {
        WindowGroup {
            AppView(apiClient: apiClient)
                .onAppear {
                    #if canImport(CorePush)
                    pushManager.register()
                    #endif
                    locationManager.requestPermission()
                }
                .preferredColorScheme(.dark)
        }
    }
}
