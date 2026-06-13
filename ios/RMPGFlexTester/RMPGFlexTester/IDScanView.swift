import SwiftUI
import AudioToolbox

// Field MDT partner: scan a driver's license PDF417 on the phone and the
// parsed identity relays through D1 to the officer's open desktop session
// (DL Search page polls /dl-records/scan-relay/poll and auto-loads it).
struct IDScanView: View {
    enum ScanMode: String, CaseIterable {
        case license = "LICENSE", passport = "PASSPORT", wireless = "WIRELESS"
    }

    @State private var scanMode: ScanMode = .license
    @State private var scanning = true
    @State private var result: AamvaResult?
    @State private var alerts: [String] = []
    @State private var relayStatus: String?
    @State private var loginStatus: String?
    @State private var recordCheck: String?
    @State private var showFi = false
    @State private var knownPersonId: Int?
    @State private var showRecords = false
    @StateObject private var wireless = WirelessIDVerifier()

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                Picker("Mode", selection: $scanMode) {
                    ForEach(ScanMode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .onChange(of: scanMode) { _, _ in
                    result = nil; alerts = []; relayStatus = nil; recordCheck = nil; scanning = true
                }

                if scanMode == .wireless {
                    wirelessSection
                } else if scanning {
                    ZStack(alignment: .bottom) {
                        // .id forces a fresh camera pipeline when the mode flips
                        // (metadata detector vs Vision OCR output).
                        ScannerCamera(mode: scanMode == .passport ? .mrz : .barcode) { code in
                            handleCode(code)
                        }
                        .id(scanMode)
                        .frame(maxHeight: 360)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                        Text(scanMode == .passport
                             ? "AIM AT THE TWO MRZ LINES (PASSPORT PHOTO PAGE)"
                             : "AIM AT LICENSE BARCODE (BACK OF CARD)")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Theme.gold)
                            .padding(6)
                            .background(.black.opacity(0.7))
                    }
                } else {
                    Button("SCAN ANOTHER") { result = nil; alerts = []; relayStatus = nil; scanning = true }
                        .buttonStyle(GoldButtonStyle())
                }

                ForEach(alerts, id: \.self) { alert in
                    Text("⚠ \(alert)")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity).padding(.vertical, 6)
                        .background(Theme.orange)
                }

                if let relayStatus { StatusLine(text: relayStatus) }
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
                if let knownPersonId {
                    Button("📂 VIEW SUBJECT RECORDS (#\(knownPersonId))") { showRecords = true }
                        .buttonStyle(RaisedButtonStyle())
                }
                if result != nil {
                    Button("CREATE & LINK PERSON + PROPERTY") {
                        Task { await createLinked() }
                    }
                    .buttonStyle(GoldButtonStyle())
                    Button("CREATE FI CARD FROM SCAN") { showFi = true }
                        .buttonStyle(RaisedButtonStyle())
                }

                if let result {
                    ScrollView {
                        PlateCheckSection(scanFields: result.fields)
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
            .sheet(isPresented: $showRecords) {
                if let knownPersonId {
                    SubjectRecordsView(personId: knownPersonId,
                                       displayName: result?.displayName ?? "")
                        .presentationBackground(Theme.base)
                }
            }
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

    private var wirelessSection: some View {
        VStack(spacing: 8) {
            Text("Verify a Wallet-stored mobile ID (mDL / state ID): the subject holds their iPhone or Apple Watch to the top of this phone and approves sharing. iOS shows the verified name + age in a system sheet — identity data never enters this app.")
                .font(.system(size: 11))
                .foregroundStyle(Theme.neutral)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(wireless.busy ? "READING…" : "TAP TO VERIFY WALLET ID") {
                Task { await wireless.verify() }
            }
            .font(.system(size: 12, weight: .semibold))
            .frame(maxWidth: .infinity).padding(.vertical, 10)
            .background(WirelessIDVerifier.isSupported ? Theme.gold : Theme.raised)
            .foregroundStyle(WirelessIDVerifier.isSupported ? .black : Theme.neutral)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            .disabled(wireless.busy)
            if let s = wireless.status { StatusLine(text: s) }
            if !WirelessIDVerifier.isSupported {
                Text("Needs iOS 17+, the Verifier API capability on this bundle id, and a reader token in Settings.")
                    .font(.system(size: 10))
                    .foregroundStyle(Theme.neutral)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(10)
        .background(Theme.raised)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }

    private func rows(_ r: AamvaResult) -> [(String, String)] {
        let order = ["doc_type", "document_number", "dl_number", "dl_state", "dl_class",
                     "issuing_country", "nationality", "date_of_birth", "dl_expiry",
                     "gender", "height", "weight", "eye_color", "hair_color",
                     "address", "city", "state", "zip", "mrz_checks"]
        return order.compactMap { key in
            r.fields[key].map { (key.replacingOccurrences(of: "_", with: " ").uppercased(), $0) }
        }
    }

    private func handleCode(_ code: String) {
        let parsed: AamvaResult
        let parsedAlerts: [String]
        switch scanMode {
        case .license:
            guard AamvaParser.looksLikeAamva(code) else { return }
            parsed = AamvaParser.parse(code)
            parsedAlerts = AamvaParser.alerts(parsed)
        case .passport:
            guard let mrz = MrzParser.parse(code) else { return }
            parsed = mrz
            parsedAlerts = MrzParser.alerts(mrz)
        case .wireless:
            return
        }
        AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
        result = parsed
        alerts = parsedAlerts
        knownPersonId = nil
        scanning = false
        Task { await relay(parsed) }
    }

    /// RECORDS integration: resolve the scan to an existing person so the
    /// dossier button lights up without creating anything. Match precedence:
    /// exact DL number, then exact name+DOB — same keys from-dl-scan dedupes on.
    @MainActor
    private func resolvePerson(_ parsed: AamvaResult, client: RMPGAPIClient) async {
        guard knownPersonId == nil, let last = parsed.fields["last_name"], !last.isEmpty else { return }
        let q = last.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? last
        guard let rows = (try? await client.requestJSON("GET", "api/records/persons/search?q=\(q)"))
                as? [[String: Any]] else { return }
        let dl = parsed.fields["dl_number"]
        let first = parsed.fields["first_name"]?.lowercased()
        let dob = parsed.fields["date_of_birth"]
        let match = rows.first(where: { dl != nil && ($0["dl_number"] as? String) == dl })
            ?? rows.first(where: { row in
                guard let f = first, let d = dob else { return false }
                return (row["first_name"] as? String)?.lowercased() == f
                    && (row["dob"] as? String)?.hasPrefix(d) == true
            })
        if let id = match?["id"] as? Int ?? (match?["id"] as? Double).map(Int.init) {
            knownPersonId = id
        }
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
        // The desktop re-parses aamva_raw with its richer parser; MRZ scans
        // carry mrz_raw instead so it never tries to AAMVA-parse an MRZ.
        payload[parsed.fields["doc_type"] != nil ? "mrz_raw" : "aamva_raw"] = parsed.raw
        payload["source"] = "ios-field-app"
        do {
            try await client.postJSON("api/dl-records/scan-relay", body: ["payload": payload])
            relayStatus = "✓ Sent to your desktop session — open DL Search on the MDT"
        } catch {
            relayStatus = "✗ Relay failed: \(error.localizedDescription)"
        }
        await recordChecks(parsed, client: client)
        await resolvePerson(parsed, client: client)
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
                knownPersonId = (id as? Int) ?? (id as? Double).map(Int.init)
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
