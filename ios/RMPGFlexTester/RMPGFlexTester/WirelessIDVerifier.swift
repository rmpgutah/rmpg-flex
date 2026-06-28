import Foundation
#if canImport(ProximityReader)
import ProximityReader
#endif

// Wireless ID — Apple's ID Verifier (ProximityReader, iOS 17+): the subject
// taps their iPhone/Watch (Wallet-stored mDL / state ID) against this phone
// and iOS shows a system sheet with the verified name/age for visual
// inspection (display request — identity data never enters app memory,
// which is exactly the evidence posture we want for consent stops).
//
// Operational prerequisites (one-time, account level):
//  1. Apple Business Connect enrollment + "Verifier API" capability approved
//     for the RMPG-Field bundle id (Xcode → Signing & Capabilities).
//  2. A reader token from Apple's verifier service, pasted into Settings
//     (stored in Keychain as `verifierToken`; valid ~48h per Apple).
// Until both exist, the button reports exactly which prerequisite is missing
// instead of failing silently.
@MainActor
final class WirelessIDVerifier: ObservableObject {
    @Published var status: String?
    @Published var busy = false

    static var isSupported: Bool {
        #if canImport(ProximityReader)
        if #available(iOS 17.0, *) { return MobileDocumentReader.isSupported }
        #endif
        return false
    }

    #if canImport(ProximityReader)
    @available(iOS 17.0, *)
    private static var reader: MobileDocumentReader?
    @available(iOS 17.0, *)
    private static var session: MobileDocumentReaderSession?
    #endif

    func verify() async {
        busy = true
        defer { busy = false }
        #if canImport(ProximityReader)
        guard #available(iOS 17.0, *) else { status = "✗ Requires iOS 17 or later"; return }
        guard MobileDocumentReader.isSupported else {
            status = "✗ This device can't read Wallet IDs (Verifier API unsupported)"
            return
        }
        guard let token = KeychainStore.load(key: "verifierToken"), !token.isEmpty else {
            status = "✗ No Apple Verifier reader token — paste one in Settings"
            return
        }
        do {
            if Self.reader == nil { Self.reader = MobileDocumentReader() }
            if Self.session == nil {
                status = "Preparing reader…"
                Self.session = try await Self.reader!.prepare(using: MobileDocumentReader.Token(token))
            }
            status = "Hold the subject's iPhone/Watch to the top of this phone…"
            let request = MobileDriversLicenseDisplayRequest(
                elements: [.givenName, .familyName, .age],
                options: .init()
            )
            _ = try await Self.session!.requestDocument(request)
            // Display requests render the verified identity in the system
            // sheet only — by design nothing comes back to the app.
            status = "✓ ID displayed in the system sheet — note details on your FI card"
        } catch {
            // A failed prepare invalidates the cached session (expired token).
            Self.session = nil
            status = "✗ \(error.localizedDescription)"
        }
        #else
        status = "✗ ProximityReader framework unavailable in this build"
        #endif
    }
}
