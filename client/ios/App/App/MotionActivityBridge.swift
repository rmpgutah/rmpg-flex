import CoreMotion
import WebKit

/// Streams Apple's CMMotionActivity classifier into the Capacitor WebView as
/// `rmpg-motion-activity` CustomEvents (same inject-into-WebView pattern as
/// VolumeButtonHandler). The web GPS sender (useGpsTracking) stamps the
/// latest activity onto outgoing breadcrumb batches.
final class MotionActivityBridge {
    static let shared = MotionActivityBridge()
    private let manager = CMMotionActivityManager()
    private weak var webView: WKWebView?

    func attach(to webView: WKWebView) {
        self.webView = webView
        guard CMMotionActivityManager.isActivityAvailable() else { return }
        manager.startActivityUpdates(to: .main) { [weak self] activity in
            guard let a = activity, let wv = self?.webView else { return }
            let kind = a.walking ? "walking"
                : a.running ? "running"
                : a.automotive ? "automotive"
                : a.cycling ? "cycling"
                : a.stationary ? "stationary"
                : "unknown"
            let conf = a.confidence == .high ? "high" : a.confidence == .medium ? "medium" : "low"
            let js = "window.dispatchEvent(new CustomEvent('rmpg-motion-activity',{detail:{activity:'\(kind)',confidence:'\(conf)'}}))"
            wv.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    func stop() { manager.stopActivityUpdates() }
}
