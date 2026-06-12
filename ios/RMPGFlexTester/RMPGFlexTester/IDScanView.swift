import SwiftUI
import AudioToolbox

// Field MDT partner: scan a driver's license PDF417 on the phone and the
// parsed identity relays through D1 to the officer's open desktop session
// (DL Search page polls /dl-records/scan-relay/poll and auto-loads it).
struct IDScanView: View {
    @State private var scanning = true
    @State private var result: AamvaResult?
    @State private var alerts: [String] = []
    @State private var relayStatus: String?
    @State private var loginStatus: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                if scanning {
                    ZStack(alignment: .bottom) {
                        ScannerCamera { code in handleCode(code) }
                            .frame(maxHeight: 360)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                        Text("AIM AT LICENSE BARCODE (BACK OF CARD)")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Theme.gold)
                            .padding(6)
                            .background(.black.opacity(0.7))
                    }
                } else {
                    Button("SCAN ANOTHER") { result = nil; alerts = []; relayStatus = nil; scanning = true }
                        .font(.system(size: 12, weight: .semibold))
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                        .background(Theme.gold).foregroundStyle(.black)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                }

                ForEach(alerts, id: \.self) { alert in
                    Text("⚠ \(alert)")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity).padding(.vertical, 6)
                        .background(Theme.orange)
                }

                if let relayStatus {
                    Text(relayStatus)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(relayStatus.hasPrefix("✓") ? Theme.gold : Theme.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if let loginStatus {
                    Text(loginStatus).font(.system(size: 10)).foregroundStyle(Theme.neutral)
                }

                if let result {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(result.displayName)
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(.white)
                            ForEach(rows(result), id: \.0) { label, value in
                                HStack(alignment: .top) {
                                    Text(label).font(.system(size: 10, weight: .semibold))
                                        .foregroundStyle(Theme.gold)
                                        .frame(width: 90, alignment: .leading)
                                    Text(value).font(.system(size: 12, design: .monospaced))
                                        .foregroundStyle(.white)
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(Theme.raised)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .background(Theme.base)
            .navigationTitle("ID SCAN → MDT")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func rows(_ r: AamvaResult) -> [(String, String)] {
        let order = ["dl_number", "dl_state", "dl_class", "date_of_birth", "dl_expiry",
                     "gender", "height", "weight", "eye_color", "hair_color",
                     "address", "city", "state", "zip"]
        return order.compactMap { key in
            r.fields[key].map { (key.replacingOccurrences(of: "_", with: " ").uppercased(), $0) }
        }
    }

    private func handleCode(_ code: String) {
        guard AamvaParser.looksLikeAamva(code) else { return }
        AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
        let parsed = AamvaParser.parse(code)
        result = parsed
        alerts = AamvaParser.alerts(parsed)
        scanning = false
        Task { await relay(parsed) }
    }

    @MainActor
    private func relay(_ parsed: AamvaResult) async {
        relayStatus = "Relaying to desktop…"
        var client = AppConfig.apiClient()
        // Make sure we hold a fresh JWT — scans must reach the MDT first try.
        if let user = KeychainStore.load(key: "rmpgUser"),
           let pass = KeychainStore.load(key: "rmpgPass"), !user.isEmpty {
            if let token = try? await client.login(username: user, password: pass) {
                KeychainStore.save(token, key: "rmpgJWT")
                client.jwt = token
            }
        }
        guard client.jwt != nil else {
            relayStatus = "✗ Not logged in — set RMPG credentials in Settings"
            return
        }
        var payload: [String: Any] = parsed.fields
        payload["aamva_raw"] = parsed.raw
        payload["source"] = "ios-field-app"
        do {
            try await client.postJSON("api/dl-records/scan-relay", body: ["payload": payload])
            relayStatus = "✓ Sent to your desktop session — open DL Search on the MDT"
        } catch {
            relayStatus = "✗ Relay failed: \(error.localizedDescription)"
        }
    }
}
