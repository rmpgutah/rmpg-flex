import UIKit
import CoreLocation
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private let locationManager = CLLocationManager()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Request location permissions on launch — GPS tracking is mandatory for all officers
        requestLocationPermissions()
        return true
    }

    // ─── Location Permissions ────────────────────────────────────
    // Mirrors Android MainActivity.requestLocationPermissions()

    private func requestLocationPermissions() {
        locationManager.delegate = self
        let status = locationManager.authorizationStatus
        switch status {
        case .notDetermined:
            // Request "Always" directly — the app needs background GPS for shift tracking
            locationManager.requestAlwaysAuthorization()
        case .authorizedWhenInUse:
            // Upgrade from When In Use → Always for background tracking
            locationManager.requestAlwaysAuthorization()
        default:
            break
        }
    }

    // ─── Standard Capacitor Lifecycle ────────────────────────────

    func applicationWillResignActive(_ application: UIApplication) {}

    func applicationDidEnterBackground(_ application: UIApplication) {}

    func applicationWillEnterForeground(_ application: UIApplication) {}

    func applicationDidBecomeActive(_ application: UIApplication) {}

    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

// ─── CLLocationManagerDelegate ───────────────────────────────
extension AppDelegate: CLLocationManagerDelegate {
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        // When authorization changes, the WebView's JS geolocation API will
        // automatically pick up the new permission level.
    }
}
