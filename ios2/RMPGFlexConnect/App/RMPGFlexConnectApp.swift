import SwiftUI
import FeatureShell
import CorePush
import CoreLocationService
import CoreAPI

@main
struct RMPGFlexConnectApp: App {
    @StateObject private var pushManager: PushManager
    @StateObject private var locationManager: LocationManager
    @State private var launchCompleted = false

    init() {
        let client = APIClient(baseURL: Endpoint.productionBaseURL)
        let pm = PushManager(apiClient: client)
        let lm = LocationManager(apiClient: client)
        _pushManager = StateObject(wrappedValue: pm)
        _locationManager = StateObject(wrappedValue: lm)
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                AppView()
                    .opacity(launchCompleted ? 1 : 0)

                if !launchCompleted {
                    LaunchScreen()
                }
            }
            .onAppear {
                pushManager.register()
                locationManager.requestPermission()
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                    withAnimation(.easeInOut(duration: 0.5)) {
                        launchCompleted = true
                    }
                }
            }
            .preferredColorScheme(.dark)
        }
    }
}

struct LaunchScreen: View {
    var body: some View {
        ZStack {
            Color(hex: "0a0a0a").ignoresSafeArea()

            VStack(spacing: 16) {
                Image(systemName: "shield.checkered")
                    .font(.system(size: 72))
                    .foregroundColor(Color(hex: "d4a017"))

                Text("RMPG Flex")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(.white)
                    .tracking(3)

                Text("Connect")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Color(hex: "d4a017"))
                    .tracking(6)

                Text("Rocky Mountain Protective Group")
                    .font(.system(size: 10))
                    .foregroundColor(Color(hex: "666666"))
                    .tracking(1)
                    .padding(.top, 8)

                Text("v1.0.0 — Build 1")
                    .font(.system(size: 9))
                    .foregroundColor(Color(hex: "444444"))
                    .padding(.top, 40)
            }
        }
    }
}
