import SwiftUI

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
        _pushManager = StateObject(wrappedValue: pm)
        let lm = LocationManager(apiClient: client)
        _locationManager = StateObject(wrappedValue: lm)
    }

    var body: some Scene {
        WindowGroup {
            AppView(apiClient: apiClient)
                .onAppear {
                    pushManager.register()
                    locationManager.requestPermission()
                }
                .preferredColorScheme(.dark)
        }
    }
}
