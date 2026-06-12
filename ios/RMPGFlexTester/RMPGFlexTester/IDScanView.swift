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
    @State private var recordCheck: String?
    @State private var showFi = false

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
                if let recordCheck {
                    Text(recordCheck)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(recordCheck.hasPrefix("⚠") ? .black : Theme.gold)
                        .frame(maxWidth: .infinity).padding(.vertical, 6)
                        .background(recordCheck.hasPrefix("⚠") ? Theme.red : Theme.raised)
                }
                if result != nil {
                    Button("CREATE & LINK PERSON + PROPERTY") {
                        Task { await createLinked() }
                    }
                    .font(.system(size: 11, weight: .semibold))
                    .frame(maxWidth: .infinity).padding(.vertical, 7)
                    .background(Theme.gold).foregroundStyle(.black)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    Button("CREATE FI CARD FROM SCAN") { showFi = true }
                        .font(.system(size: 11, weight: .semibold))
                        .frame(maxWidth: .infinity).padding(.vertical, 7)
                        .background(Theme.raised).foregroundStyle(Theme.gold)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
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
            .sheet(isPresented: $showFi) {
                FieldInterviewForm(prefill: [
                    "name": result?.displayName ?? "",
                    "dob": result?.fields["date_of_birth"] ?? "",
                ]) { body, label in
                    Task {
                        var client = AppConfig.apiClient()
                        if client.jwt == nil,
                           let u = KeychainStore.load(key: "rmpgUser"),
                           let p = KeychainStore.load(key: "rmpgPass"),
                           let t = try? await client.login(username: u, password: p) {
                            KeychainStore.save(t, key: "rmpgJWT"); client.jwt = t
                        }
                        do { try await client.postJSON(label.isEmpty ? "api/field-interviews" : "api/field-interviews", body: body)
                             relayStatus = "✓ FI card filed" }
                        catch { relayStatus = "✗ FI failed: \(error.localizedDescription)" }
                    }
                }
                .presentationBackground(Theme.base)
            }
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
        await recordChecks(parsed, client: client)
    }

    /// One-shot Person + Property create/link from the scan (same endpoint
    /// the desktop DL Search uses; dedupes server-side).
    @MainActor
    private func createLinked() async {
        guard let result else { return }
        var client = AppConfig.apiClient()
        if client.jwt == nil,
           let u = KeychainStore.load(key: "rmpgUser"),
           let p = KeychainStore.load(key: "rmpgPass"),
           let t = try? await client.login(username: u, password: p) {
            KeychainStore.save(t, key: "rmpgJWT"); client.jwt = t
        }
        do {
            let res = try await client.requestJSON("POST", "api/records/from-dl-scan",
                                                   body: ["scan": result.fields]) as? [String: Any]
            var bits: [String] = []
            if let p = res?["person"] as? [String: Any], let id = p["id"] {
                bits.append("Person #\(id) \((res?["person_created"] as? Bool) == true ? "created" : "linked")")
            }
            if let pr = res?["property"] as? [String: Any], let id = pr["id"] {
                bits.append("Property #\(id) \((res?["property_created"] as? Bool) == true ? "created" : "linked")")
            }
            relayStatus = "✓ " + (bits.isEmpty ? "No records created" : bits.joined(separator: " · "))
        } catch {
            relayStatus = "✗ Create & link failed: \(error.localizedDescription)"
        }
    }

    /// Officer-safety auto-check: warrants + local person history the moment
    /// a license is scanned. Best-effort — silence means the check errored,
    /// never that the subject is clear.
    @MainActor
    private func recordChecks(_ parsed: AamvaResult, client: RMPGAPIClient) async {
        recordCheck = "Checking warrants & local records…"
        let last = parsed.fields["last_name"] ?? ""
        guard !last.isEmpty else { recordCheck = nil; return }
        let q = parsed.displayName.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? last
        func count(_ json: Any?) -> Int {
            if let arr = json as? [[String: Any]] { return arr.count }
            if let obj = json as? [String: Any],
               let arr = (obj["data"] ?? obj["results"] ?? obj["warrants"]) as? [[String: Any]] {
                return arr.count
            }
            return 0
        }
        var wbody: [String: Any] = ["lastName": last]
        if let first = parsed.fields["first_name"] { wbody["firstName"] = first }
        if let dob = parsed.fields["date_of_birth"] { wbody["dob"] = dob }
        let wres = try? await client.requestJSON("POST", "api/warrants/search-all", body: wbody)
        let wobj = wres as? [String: Any] ?? [:]
        let warrants = ["local", "utah", "scraped"].reduce(0) { $0 + ((wobj[$1] as? [[String: Any]])?.count ?? 0) }
        let persons = count(try? await client.requestJSON("GET", "api/records/persons?search=\(q)"))
        if warrants > 0 {
            AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
            recordCheck = "⚠ \(warrants) POSSIBLE WARRANT MATCH(ES) — VERIFY ON MDT BEFORE ACTING"
        } else if persons > 0 {
            recordCheck = "ℹ \(persons) local person record(s) — details on the MDT"
        } else {
            recordCheck = "No local warrant/person matches by name (verify identifiers on MDT)"
        }
    }
}
