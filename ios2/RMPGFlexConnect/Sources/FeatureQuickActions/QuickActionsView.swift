import SwiftUI







public struct QuickActionsView: View {
    @StateObject private var vm: QuickActionsViewModel
    private let apiClient: APIClient
    @State private var showScanner = false
    @State private var showPopulationResult = false
    @State private var populationSuccess = false
    @State private var populationMessage = ""
    @State private var showCallPicker = false
    @State private var showSearchResults = false
    @State private var showWarrantHitAlert = false
    @State private var warrantHitMessage = ""
    @State private var showPlateEntry = false
    @State private var showDAR = false
    @State private var showCitation = false
    @State private var showFieldInterview = false
    @State private var showWirelessIDVerify = false

    public init(apiClient: APIClient = APIClient(baseURL: Endpoint.productionBaseURL)) {
        self.apiClient = apiClient
        _vm = StateObject(wrappedValue: QuickActionsViewModel(client: apiClient))
    }

    public var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "0a0a0a").ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 16) {
                        scanSection
                        quickActionsSection
                        recentScansSection
                    }
                    .padding(16)
                }
            }
            .navigationTitle("Quick Actions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color(hex: "0a0a0a"), for: .navigationBar)
        }
        .sheet(isPresented: $showScanner) {
            // Fires automatically once the scanner reads a high-confidence
            // front+back barcode/MRZ result — no manual button tap needed.
            // CAD/MDT push AND a local warrant/record cross-reference run
            // together — the moment right after a scan, during a live stop,
            // is exactly when officer-safety information matters most, not
            // only when someone remembers to tap "Run Warrant Check" later.
            DocumentScannerView { id in
                vm.scannedID = id
                showScanner = false
                Task {
                    async let cadResult = vm.pushToCAD(id)
                    async let mdtPush: Void = vm.pushToMDT(id)
                    async let warrantResult = vm.runWarrantCheck(id)
                    let (result, _, warrant) = await (cadResult, mdtPush, warrantResult)
                    populationSuccess = result.success
                    populationMessage = result.success
                        ? "\(id.displayName) sent to CAD & vehicle MDT."
                        : result.message
                    showPopulationResult = true

                    // Either an active warrant OR an officer-safety flag
                    // (caution flags, sex-offender registry, gang affiliation,
                    // probation/parole, watchlist) on the matched local
                    // record — both are urgent enough to interrupt with a
                    // destructive-style alert rather than the routine toast.
                    if warrant.message.contains("WARRANT HIT") || warrant.message.contains("OFFICER SAFETY") {
                        warrantHitMessage = warrant.message
                        showWarrantHitAlert = true
                    }
                }
            }
        }
        .sheet(isPresented: $showCallPicker) {
            ActiveCallPickerSheet(vm: vm) { result in
                populationSuccess = result.success
                populationMessage = result.message
                showPopulationResult = true
            }
        }
        .sheet(isPresented: $showSearchResults) {
            SearchResultsSheet(vm: vm)
        }
        .sheet(isPresented: $showPlateEntry) {
            NavigationStack {
                PlateEntryView(apiClient: RunPlateAPIClient(
                    baseURL: URL(string: Endpoint.productionBaseURL)!,
                    tokenProvider: { PersistentAuth().storedToken() }
                ))
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { showPlateEntry = false } } }
            }
        }
        .sheet(isPresented: $showDAR) {
            DailyActivityReportView()
        }
        .sheet(isPresented: $showCitation) {
            CitationView()
        }
        .sheet(isPresented: $showFieldInterview) {
            FieldInterviewCardView()
        }
        .sheet(isPresented: $showWirelessIDVerify) {
            NavigationStack {
                AppleIDVerifierView()
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { showWirelessIDVerify = false } } }
            }
        }
        .alert(populationSuccess ? "Success" : "Error", isPresented: $showPopulationResult) {
            Button("OK") { showPopulationResult = false }
        } message: {
            Text(populationMessage)
        }
        .alert("⚠️ Local Record Safety Alert", isPresented: $showWarrantHitAlert) {
            Button("Acknowledge", role: .destructive) { showWarrantHitAlert = false }
        } message: {
            Text(warrantHitMessage + "\n\nThis is a match against RMPG's own local records only — not a live state or NCIC/NLETS check.")
        }
    }

    private var scanSection: some View {
        VStack(spacing: 12) {
            Text("ID SCAN & POPULATE".uppercased())
                .font(.system(size: 9, weight: .semibold)).foregroundColor(Color(hex: "666666"))
                .tracking(2).frame(maxWidth: .infinity, alignment: .leading)

            Button { showScanner = true } label: {
                VStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 4)
                            .stroke(Color(hex: "d4a017"), style: StrokeStyle(lineWidth: 2, dash: [6, 3]))
                            .frame(height: 140)
                        VStack(spacing: 8) {
                            Image(systemName: "person.text.rectangle.fill")
                                .font(.system(size: 36)).foregroundColor(Color(hex: "d4a017").opacity(0.5))
                            Text("TAP TO SCAN ID").font(.system(size: 13, weight: .semibold)).foregroundColor(Color(hex: "d4a017"))
                            Text("DL · State ID · Passport · Military ID")
                                .font(.system(size: 10)).foregroundColor(Color(hex: "666666"))
                        }
                    }

                    if vm.isPushing {
                        HStack(spacing: 8) {
                            ProgressView().tint(Color(hex: "d4a017"))
                            Text("Pushing to CAD...").font(.system(size: 11)).foregroundColor(Color(hex: "888888"))
                        }
                    }

                    if let id = vm.lastScanned {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Image(systemName: "checkmark.circle.fill").font(.system(size: 12)).foregroundColor(Color(hex: "22c55e"))
                                Text("Last scan: \(id.displayName)").font(.system(size: 11)).foregroundColor(.white)
                            }
                            if let addr = id.address {
                                Text(addr).font(.system(size: 10)).foregroundColor(Color(hex: "888888"))
                            }
                        }
                        .padding(12).background(Color(hex: "141414")).cornerRadius(2)
                    }
                }
            }
        }
        .padding(16).background(Color(hex: "141414")).cornerRadius(2)
    }

    private var quickActionsSection: some View {
        VStack(spacing: 0) {
            Text("DISPATCH ACTIONS".uppercased())
                .font(.system(size: 9, weight: .semibold)).foregroundColor(Color(hex: "666666"))
                .tracking(2).frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 8)

            VStack(spacing: 0) {
                actionRow("Add Subject to Active Call", "person.badge.plus", Color(hex: "d4a017")) {
                    guard vm.lastScanned != nil else { return }
                    showCallPicker = true
                }
                Divider().background(Color(hex: "1a1a1a"))
                actionRow("Create Person Record", "person.crop.circle.badge.plus", Color(hex: "22c55e")) {
                    if let id = vm.lastScanned { Task { await vm.createPerson(id) } }
                }
                Divider().background(Color(hex: "1a1a1a"))
                actionRow("Search Existing Records", "magnifyingglass", Color(hex: "3b82f6")) {
                    if let id = vm.lastScanned {
                        vm.searchText = [id.firstName, id.lastName].compactMap { $0 }.joined(separator: " ")
                        Task {
                            await vm.searchRecords()
                            showSearchResults = true
                        }
                    }
                }
                Divider().background(Color(hex: "1a1a1a"))
                actionRow("Run Warrant Check", "doc.text.magnifyingglass", Color(hex: "ef4444")) {
                    if let id = vm.lastScanned {
                        Task {
                            let result = await vm.runWarrantCheck(id)
                            populationSuccess = result.success
                            populationMessage = result.message
                            showPopulationResult = true
                        }
                    }
                }
                Divider().background(Color(hex: "1a1a1a"))
                actionRow("Push to MDT", "desktopcomputer", Color(hex: "888888")) {
                    if let id = vm.lastScanned { Task { await vm.pushToMDT(id) } }
                }
                Divider().background(Color(hex: "1a1a1a"))
                NavigationLink(destination: MDTLinkView(apiClient: apiClient)) {
                    HStack(spacing: 10) {
                        Image(systemName: "wave.3.right.circle").font(.system(size: 14)).foregroundColor(Color(hex: "3b82f6")).frame(width: 24)
                        Text("Vehicle MDT Link").font(.system(size: 12)).foregroundColor(.white)
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 10)).foregroundColor(Color(hex: "555555"))
                    }
                    .padding(.horizontal, 12).padding(.vertical, 10)
                }
                Divider().background(Color(hex: "1a1a1a"))
                actionRow("Run Plate", "car.circle", Color(hex: "22c55e")) { showPlateEntry = true }
                Divider().background(Color(hex: "1a1a1a"))
                actionRow("Daily Activity Report", "doc.text", Color(hex: "d4a017")) { showDAR = true }
                Divider().background(Color(hex: "1a1a1a"))
                actionRow("Citation", "doc.badge.plus", Color(hex: "ef4444")) { showCitation = true }
                Divider().background(Color(hex: "1a1a1a"))
                actionRow("Field Interview Card", "person.text.rectangle", Color(hex: "3b82f6")) { showFieldInterview = true }
                Divider().background(Color(hex: "1a1a1a"))
                // Requires the ProximityReader identity-verification entitlement,
                // which isn't in App/RMPGFlexConnect.entitlements yet — Apple
                // grants that capability separately per developer account, it's
                // not something Xcode/code alone can turn on. The button is
                // wired so it's ready the moment that entitlement lands; until
                // then IDVerificationSession.isSupported gates it off at runtime.
                actionRow("Wireless ID Verify", "wave.3.right", Color(hex: "888888")) { showWirelessIDVerify = true }
            }
            .background(Color(hex: "141414")).cornerRadius(2)
        }
    }

    private var recentScansSection: some View {
        VStack(spacing: 8) {
            Text("RECENT SCANS".uppercased())
                .font(.system(size: 9, weight: .semibold)).foregroundColor(Color(hex: "666666"))
                .tracking(2).frame(maxWidth: .infinity, alignment: .leading)

            if vm.recentScans.isEmpty {
                Text("No recent scans").font(.system(size: 11)).foregroundColor(Color(hex: "555555")).padding(.vertical, 24)
            } else {
                // Persisted to disk (ScanHistoryStore) — survives app relaunch,
                // unlike a prior version that kept this purely in memory.
                // Every row now opens the full-detail/advanced-data view;
                // a prior version had no tap action at all.
                ForEach(vm.recentScans, id: \.scannedAt) { id in
                    NavigationLink(destination: ScanDetailView(scan: id)) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(id.displayName).font(.system(size: 12, weight: .medium)).foregroundColor(.white)
                                if let addr = id.address { Text(addr).font(.system(size: 10)).foregroundColor(Color(hex: "888888")) }
                            }
                            Spacer()
                            Text(id.scannedAt, style: .time).font(.system(size: 10)).foregroundColor(Color(hex: "555555"))
                            Image(systemName: "chevron.right").font(.system(size: 9)).foregroundColor(Color(hex: "555555"))
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
        }
    }

    private func actionRow(_ title: String, _ icon: String, _ color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 14)).foregroundColor(color).frame(width: 24)
                Text(title).font(.system(size: 12)).foregroundColor(.white)
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 10)).foregroundColor(Color(hex: "555555"))
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
        }
    }
}

/// Lets the officer pick which active call to attach the last scanned ID to,
/// then calls the real quick-add endpoint. There's no concept of "the"
/// active call on this screen (Quick Actions isn't scoped to one call), so
/// the officer must choose — unlike a call-detail screen where it's implicit.
struct ActiveCallPickerSheet: View {
    @ObservedObject var vm: QuickActionsViewModel
    let onComplete: (QuickActionResult) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var isLoadingCalls = true
    @State private var submittingCallId: Int?

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "0a0a0a").ignoresSafeArea()
                if isLoadingCalls {
                    ProgressView().tint(Color(hex: "d4a017"))
                } else if vm.activeCalls.isEmpty {
                    Text("No active calls to attach to").font(.system(size: 12)).foregroundColor(Color(hex: "888888"))
                } else {
                    List(vm.activeCalls) { call in
                        Button {
                            guard let id = vm.lastScanned else { return }
                            submittingCallId = call.id
                            Task {
                                let result = await vm.addSubjectToCall(id, callId: call.id)
                                submittingCallId = nil
                                onComplete(result)
                                if result.success { dismiss() }
                            }
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(call.callNumber.map { "#\($0)" } ?? "Call \(call.id)")
                                        .font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
                                    Text(call.incidentType ?? "Unknown").font(.system(size: 11)).foregroundColor(Color(hex: "888888"))
                                }
                                Spacer()
                                if submittingCallId == call.id { ProgressView().tint(Color(hex: "d4a017")) }
                            }
                        }
                        .listRowBackground(Color(hex: "141414"))
                        .disabled(submittingCallId != nil)
                    }
                    .listStyle(.plain).scrollContentBackground(.hidden)
                }
            }
            .navigationTitle("Add Subject To Call")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task { await vm.loadActiveCalls(); isLoadingCalls = false }
        }
    }
}

struct SearchResultsSheet: View {
    @ObservedObject var vm: QuickActionsViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "0a0a0a").ignoresSafeArea()
                if vm.isSearching {
                    ProgressView().tint(Color(hex: "d4a017"))
                } else if vm.searchResults.isEmpty {
                    Text("No matching records").font(.system(size: 12)).foregroundColor(Color(hex: "888888"))
                } else {
                    List(vm.searchResults) { person in
                        VStack(alignment: .leading, spacing: 2) {
                            Text([person.firstName, person.lastName].compactMap { $0 }.joined(separator: " "))
                                .font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
                            if let dob = person.dob { Text("DOB: \(dob)").font(.system(size: 11)).foregroundColor(Color(hex: "888888")) }
                            if let addr = person.address { Text(addr).font(.system(size: 11)).foregroundColor(Color(hex: "888888")) }
                        }
                        .listRowBackground(Color(hex: "141414"))
                    }
                    .listStyle(.plain).scrollContentBackground(.hidden)
                }
            }
            .navigationTitle("Search Results")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct QuickActionResult {
    let success: Bool
    let message: String
}

/// Minimal call model for the active-call picker — deliberately not
/// FeatureDispatch's `CallForService` to avoid coupling this module to the
/// whole Dispatch feature just to read two fields.
struct QuickActionCall: Codable, Identifiable, Sendable {
    let id: Int
    let callNumber: String?
    let incidentType: String?
}

@MainActor
final class QuickActionsViewModel: ObservableObject {
    @Published var scannedID: ScannedID?
    @Published var lastScanned: ScannedID?
    @Published var recentScans: [ScannedID] = []
    @Published var isPushing = false
    @Published var searchText = ""
    @Published var searchResults: [PersonSearchResult] = []
    @Published var isSearching = false
    @Published var activeCalls: [QuickActionCall] = []

    private let client: APIClient
    private let historyStore = ScanHistoryStore()

    init(client: APIClient) {
        self.client = client
        // Restore persisted scan history — a prior version started every
        // launch with an empty in-memory array only, so scan history never
        // survived backgrounding long enough for iOS to terminate the app.
        recentScans = historyStore.load()
        lastScanned = recentScans.first
    }

    @discardableResult
    func pushToCAD(_ id: ScannedID) async -> (success: Bool, message: String) {
        isPushing = true
        do {
            let payload = id.toPersonPayload()
            let body = try JSONSerialization.data(withJSONObject: payload)
            try await client.requestVoid(Endpoint(path: "/api/records/persons", method: .post, body: body))
            lastScanned = id
            recentScans.insert(id, at: 0)
            if recentScans.count > 20 { recentScans = Array(recentScans.prefix(20)) }
            historyStore.save(recentScans)
            isPushing = false
            return (true, "\(id.displayName) pushed to CAD.")
        } catch {
            isPushing = false
            return (false, "Failed to push to CAD: \(error.localizedDescription)")
        }
    }

    /// GET /api/dispatch/calls?status=... — reuses the real Dispatch list
    /// endpoint (verified this session: {data:[...], pagination:{...}}) to
    /// find calls an officer could plausibly attach a subject to.
    func loadActiveCalls() async {
        // Fetch all three statuses concurrently instead of one at a time —
        // a prior version awaited each in a sequential loop, tripling the
        // wait before the call picker showed anything.
        async let dispatched = fetchCalls(status: "dispatched")
        async let enroute = fetchCalls(status: "enroute")
        async let onscene = fetchCalls(status: "onscene")
        let results = await [dispatched, enroute, onscene]
        activeCalls = results.flatMap { $0 }
    }

    private func fetchCalls(status: String) async -> [QuickActionCall] {
        do {
            let response: QuickActionCallList = try await client.request(Endpoint(
                path: "/api/dispatch/calls", queryItems: [URLQueryItem(name: "status", value: status)]
            ))
            return response.data
        } catch {
            return []
        }
    }

    /// POST /api/dispatch/calls/:id/persons/quick-add (src/routes/dispatch/callLinks.ts,
    /// mounted at /api/dispatch) — creates-or-links a person to a call in one
    /// step, with server-side duplicate detection. A prior version of this
    /// posted to `/api/dispatch/calls/subject`, which has never existed
    /// anywhere in the Worker — "Add Subject to Active Call" silently 404'd
    /// on every attempt.
    ///
    /// On a 409 duplicate-candidate response, this reports it rather than
    /// silently retrying with force_create — presenting a full merge picker
    /// is out of scope for a one-tap quick action; the officer can resolve
    /// duplicates from the Records screen instead.
    func addSubjectToCall(_ id: ScannedID, callId: Int) async -> QuickActionResult {
        isPushing = true
        defer { isPushing = false }
        var body: [String: Any] = ["role": "subject"]
        if let v = id.firstName { body["first_name"] = v }
        if let v = id.lastName { body["last_name"] = v }
        if let v = id.dobFormatted { body["dob"] = v }
        if let v = id.gender { body["gender"] = v }
        if let v = id.address { body["address"] = v }
        do {
            let data = try JSONSerialization.data(withJSONObject: body)
            try await client.requestVoid(Endpoint(
                path: "/api/dispatch/calls/\(callId)/persons/quick-add", method: .post, body: data
            ))
            return QuickActionResult(success: true, message: "\(id.displayName) added to call.")
        } catch let APIError.httpError(status, responseBody) where status == 409 {
            return QuickActionResult(success: false, message: "Possible duplicate person on file — resolve from Records before adding. (\(responseBody.prefix(120)))")
        } catch {
            return QuickActionResult(success: false, message: "Failed to add subject: \(error.localizedDescription)")
        }
    }

    func createPerson(_ id: ScannedID) async {
        await pushToCAD(id)
    }

    /// GET /api/records/persons/search?q=... (src/routes/records.ts) — bare
    /// array response, verified. A prior version hit a nonexistent
    /// `/api/records/subjects/search` path wrapped in `{results:[...]}` and
    /// discarded the decoded value entirely — tapping "Search Existing
    /// Records" did nothing observable even when it happened to succeed.
    func searchRecords() async {
        guard !searchText.isEmpty else { return }
        isSearching = true
        do {
            searchResults = try await client.request(Endpoint(
                path: "/api/records/persons/search",
                queryItems: [URLQueryItem(name: "q", value: searchText)]
            ))
        } catch {
            searchResults = []
        }
        isSearching = false
    }

    /// GET /api/records/ncic-query?type=person&query=... (src/routes/records.ts) —
    /// the app's real "NCIC/NLETS terminal" endpoint. IMPORTANT: this is a
    /// LOCAL cross-reference against RMPG's own `persons`/`warrants`/
    /// `criminal_history` tables only — it is NOT a connection to the actual
    /// FBI NCIC or the NLETS interstate network (neither is integrated in
    /// this codebase; that requires the agency's own NLETS/AAMVA DLDV
    /// credentials, which aren't configured here). It surfaces a real hit
    /// if the scanned name matches someone already in this department's
    /// records, which is exactly what a prior version's fabricated
    /// `/api/warrants/search` call never actually did.
    func runWarrantCheck(_ id: ScannedID) async -> QuickActionResult {
        let name = [id.firstName, id.lastName].compactMap { $0 }.joined(separator: " ")
        guard !name.isEmpty else {
            return QuickActionResult(success: false, message: "No name to search on this scan.")
        }
        do {
            let response: NCICPersonQueryResponse = try await client.request(Endpoint(
                path: "/api/records/ncic-query",
                queryItems: [URLQueryItem(name: "type", value: "person"), URLQueryItem(name: "query", value: name)]
            ))
            guard let match = response.results.first else {
                return QuickActionResult(success: true, message: "No local record found for \(id.displayName). (Local database only — not a state/NCIC check.)")
            }

            // Officer-safety flags on the `persons` row itself (caution_flags,
            // is_sex_offender, gang_affiliation, probation_parole, watchlist_match —
            // verified against migrations/baseline/schema.sql) were already
            // fetched by this exact endpoint (records.ts's ncic-query does
            // `SELECT * FROM persons` for the match) but silently discarded —
            // the iOS model never decoded the `person` object, only
            // `warrants`/`criminalHistory`. A caution flag is exactly the kind
            // of thing that must never be quietly dropped from a stop.
            var safetyLines: [String] = []
            if match.person.isSexOffender == 1 { safetyLines.append("Registered sex offender") }
            if let gang = match.person.gangAffiliation, !gang.isEmpty { safetyLines.append("Gang affiliation: \(gang)") }
            if let pp = match.person.probationParole, !pp.isEmpty { safetyLines.append("Probation/Parole: \(pp)") }
            if let watch = match.person.watchlistMatch, !watch.isEmpty { safetyLines.append("Watchlist: \(watch)") }
            if let caution = match.person.cautionFlags, !caution.isEmpty { safetyLines.append(caution) }
            let safetyBanner = safetyLines.isEmpty ? "" : "🛑 OFFICER SAFETY: " + safetyLines.joined(separator: " · ") + "\n\n"

            let activeWarrants = match.warrants.filter { $0.status == "active" }
            if !activeWarrants.isEmpty {
                let charges = activeWarrants.compactMap { $0.chargeDescription }.joined(separator: "; ")
                return QuickActionResult(
                    success: true,
                    message: safetyBanner + "⚠️ WARRANT HIT (local records): \(id.displayName) has \(activeWarrants.count) active warrant\(activeWarrants.count == 1 ? "" : "s")\(charges.isEmpty ? "" : " — \(charges)")."
                )
            }
            if !safetyLines.isEmpty {
                // No active warrant, but officer-safety flags alone are urgent
                // enough to interrupt — the caller's alert trigger matches on
                // "OFFICER SAFETY" too, not just "WARRANT HIT".
                return QuickActionResult(success: true, message: safetyBanner + "No active warrant on file for \(id.displayName), but review the flags above before proceeding.")
            }
            if !match.criminalHistory.isEmpty {
                return QuickActionResult(success: true, message: "\(id.displayName): local record found, \(match.criminalHistory.count) criminal history entr\(match.criminalHistory.count == 1 ? "y" : "ies"). No active warrants.")
            }
            return QuickActionResult(success: true, message: "\(id.displayName): local record found. No active warrants or criminal history on file.")
        } catch {
            return QuickActionResult(success: false, message: "Local records check failed: \(error.localizedDescription)")
        }
    }

    /// POST /api/mdt/send — the real phone↔vehicle-MDT message channel
    /// (src/routes/mdt.ts). A prior version of this posted to
    /// `/api/dispatch/mdt/push`, which has never existed under any prefix —
    /// every "push to MDT" silently 404'd. The real contract is
    /// `{to: 'mdt', type: 'person'|'scan'|..., payload: {...}}`, queued for
    /// the CURRENT signed-in officer's own vehicle terminal to poll.
    func pushToMDT(_ id: ScannedID) async {
        do {
            let payload: [String: Any] = ["to": "mdt", "type": "person", "payload": id.toPersonPayload()]
            let body = try JSONSerialization.data(withJSONObject: payload)
            try await client.requestVoid(Endpoint(path: "/api/mdt/send", method: .post, body: body))
        } catch { print("MDT push failed: \(error)") }
    }

    struct QuickActionCallList: Codable, Sendable { let data: [QuickActionCall] }
}

/// Mirrors GET /api/records/ncic-query?type=person's real response shape
/// (src/routes/records.ts): `{type, query, results: [{person, criminalHistory,
/// warrants}]}`. Only the fields this screen actually reads are modeled;
/// `person`/`criminalHistory` rows have many more columns the server
/// doesn't guarantee are present, so they're intentionally NOT modeled here.
struct NCICPersonQueryResponse: Codable, Sendable {
    let results: [NCICPersonMatch]
}

struct NCICPersonMatch: Codable, Sendable {
    let person: NCICPersonRecord
    let warrants: [NCICWarrant]
    let criminalHistory: [NCICCriminalHistoryEntry]
}

/// Officer-safety fields on the matched `persons` row — verified against
/// migrations/baseline/schema.sql. records.ts's ncic-query does
/// `SELECT * FROM persons` and was already returning these; a prior version
/// of this model only decoded `warrants`/`criminalHistory` and silently
/// dropped the `person` object entirely, so caution flags, sex-offender
/// registry status, gang affiliation, probation/parole, and watchlist
/// matches never reached the officer running the check.
struct NCICPersonRecord: Codable, Sendable {
    let isSexOffender: Int?
    let gangAffiliation: String?
    let probationParole: String?
    let cautionFlags: String?
    let watchlistMatch: String?
}

struct NCICWarrant: Codable, Sendable {
    let id: Int?
    let warrantNumber: String?
    let status: String?
    let chargeDescription: String?
}

/// Only used for a count — the server doesn't guarantee a stable shape
/// beyond "some criminal_history row exists."
struct NCICCriminalHistoryEntry: Codable, Sendable {}

/// Mirrors a bare `persons` row from GET /api/records/persons/search.
struct PersonSearchResult: Codable, Identifiable, Sendable {
    let id: Int
    let firstName: String?
    let lastName: String?
    let dob: String?
    let address: String?
    let phone: String?
}
