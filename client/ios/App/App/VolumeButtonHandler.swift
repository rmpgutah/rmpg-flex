import AVFoundation
import MediaPlayer
import UIKit
import WebKit

/// Observes hardware volume button presses and forwards them to the Capacitor
/// WebView as `AudioVolumeUp` keyboard events — matching the Android
/// `MainActivity.dispatchKeyEvent()` behaviour for hardware panic activation.
///
/// Usage: call `VolumeButtonHandler.attach(to:)` from a view controller that
/// has access to the Capacitor `WebViewBridge` (CAPBridgeViewController).
final class VolumeButtonHandler: NSObject {

    private weak var webView: WKWebView?
    private var volumeObservation: NSKeyValueObservation?
    private var lastVolume: Float = 0

    /// Attach to a WKWebView. Installs a hidden MPVolumeView to suppress
    /// the system volume HUD and observes `outputVolume` changes.
    static func attach(to webView: WKWebView, in parentView: UIView) -> VolumeButtonHandler {
        let handler = VolumeButtonHandler()
        handler.webView = webView

        // Add a hidden MPVolumeView to prevent the system volume HUD from showing
        let volumeView = MPVolumeView(frame: CGRect(x: -1000, y: -1000, width: 0, height: 0))
        volumeView.alpha = 0.01
        parentView.addSubview(volumeView)

        // Configure audio session so we can observe volume changes
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setActive(true)
        } catch {
            print("[VolumeButtonHandler] Failed to activate audio session: \(error)")
        }

        handler.lastVolume = session.outputVolume

        // Observe volume changes via KVO on the audio session
        handler.volumeObservation = session.observe(\.outputVolume, options: [.new, .old]) { [weak handler] session, change in
            guard let handler = handler,
                  let newVolume = change.newValue,
                  let oldVolume = change.oldValue,
                  newVolume != oldVolume else { return }

            // Volume Up pressed
            if newVolume > oldVolume {
                handler.dispatchVolumeUpEvent()
            }

            handler.lastVolume = newVolume

            // Reset volume to middle so button can be pressed again in either direction
            handler.resetVolumeToMidpoint(volumeView: volumeView)
        }

        return handler
    }

    /// Inject AudioVolumeUp keyboard events into the WebView — mirrors Android's
    /// `document.dispatchEvent(new KeyboardEvent(...))` approach.
    private func dispatchVolumeUpEvent() {
        let js = """
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'AudioVolumeUp', code: 'AudioVolumeUp', bubbles: true }));
        setTimeout(() => {
            document.dispatchEvent(new KeyboardEvent('keyup', { key: 'AudioVolumeUp', code: 'AudioVolumeUp', bubbles: true }));
        }, 100);
        """
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    /// Reset the system volume to ~0.5 so the user can keep pressing up/down
    /// without hitting the min/max boundary.
    private func resetVolumeToMidpoint(volumeView: MPVolumeView) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            if let slider = volumeView.subviews.compactMap({ $0 as? UISlider }).first {
                slider.value = 0.5
            }
        }
    }

    deinit {
        volumeObservation?.invalidate()
    }
}
