import SwiftUI
import CoreLocation
import AudioToolbox

// Field Ops — the phone side of the desktop CAD:
//   • Duty: start/end shift (clock-on + unit in-service + vehicle, same as ShiftCard)
//   • Unit status buttons → PUT /dispatch/units/:id/status (desktop board updates live)
//   • Assigned call card from the live calls feed
//   • GPS push → POST /dispatch/gps every 15 s (desktop map tracks the phone)
//   • PANIC → POST /dispatch/panic (creates the P1 officer_assist CAD call)
struct FieldOpsView: View {
    @StateObject private var location = LocationManager.shared
    @State private var duty: [String: Any] = [:]
    @State private var myCall: [String: Any]?
    @State private var status: String?
    @State private var busyAction = false
    @State private var confirmPanic = false
    @State private var showStartSheet = false
    @State private var showEndSheet = false
    @State private var gpsPushedAt: Date?
    @State private var lastAlertedCallId: Int?
    @State private var showPreTrip = false

    private var assignedVehicle: [String: Any]? { duty["vehicle"] as? [String: Any] }
    private var assignedVehicleId: Int? { assignedVehicle?["id"] as? Int }
    private var assignedVehicleLabel: String {
        guard let v = assignedVehicle else { return "Assigned vehicle" }
        let num = v["vehicle_number"] as? String ?? "#\(v["id"] as? Int ?? 0)"
        let mk = [v["make"] as? String, v["model"] as? String].compactMap { $0 }.joined(separator: " ")
        return mk.isEmpty ? num : "\(num) — \(mk)"
    }
    private var currentEntryId: Int? { (duty["time_entry"] as? [String: Any])?["id"] as? Int }

    private var onShift: Bool { duty["on_shift"] as? Bool ?? false }
    private var unit: [String: Any]? { duty["unit"] as? [String: Any] }
    private var unitStatus: String { unit?["status"] as? String ?? "—" }

    private let statuses: [(String, String)] = [
        ("available", "10-8 AVAILABLE"), ("enroute", "EN ROUTE"),
        ("on_scene", "ON SCENE"), ("busy", "10-6 BUSY"),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    HStack(spacing: 6) { OfflineStatusPill(); GPSStatusPill(); Spacer(); MDTStatusPill() }
                    dutyCard
                    if onShift { statusCard }
                    NavigationLink {
                        CallsQueueView()
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "list.bullet.rectangle.fill")
                                .foregroundStyle(Theme.gold).frame(width: 24)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("CALLS QUEUE")
                                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                                Text("Active calls · self-assign · status")
                                    .font(.system(size: 10)).foregroundStyle(Theme.neutral)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.neutral)
                        }
                        .themeCard()
                    }
                    NavigationLink {
                        NotificationsView()
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "bell.badge.fill")
                                .foregroundStyle(Theme.gold).frame(width: 24)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("NOTIFICATIONS")
                                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                                Text("Dispatcher alerts · intel hits")
                                    .font(.system(size: 10)).foregroundStyle(Theme.neutral)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.neutral)
                        }
                        .themeCard()
                    }
                    NavigationLink {
                        WorkflowHubView()
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "square.stack.3d.up.fill")
                                .foregroundStyle(Theme.gold).frame(width: 24)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("WORKFLOWS")
                                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                                Text("Reports · citations · patrol · more")
                                    .font(.system(size: 10)).foregroundStyle(Theme.neutral)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.neutral)
                        }
                        .themeCard()
                    }
                    if let myCall { callCard(myCall) }
                    panicButton
                    Button { Task { await sendLocationToMDT() } } label: {
                        Label("SEND LOCATION TO MDT", systemImage: "car.fill")
                            .font(.system(size: 11, weight: .semibold)).frame(maxWidth: .infinity)
                    }.buttonStyle(RaisedButtonStyle())
                    if let status { StatusLine(text: status) }
                    if let gpsPushedAt {
                        Text("GPS → dispatch map · last push \(gpsPushedAt.formatted(date: .omitted, time: .standard))")
                            .font(.system(size: 9)).foregroundStyle(Theme.neutral)
                    }
                }
                .padding(12)
            }
            .background(Theme.base)
            .navigationTitle("FIELD OPS")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                location.start()
                await refresh()
                // Poll loop: duty/call every 10 s, GPS push every 15 s while visible.
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(15))
                    await pushGps()
                    await refresh()
                }
            }
            .sheet(isPresented: $showStartSheet) {
                ShiftStartSheet(dutyState: duty) { msg in
                    status = msg
                    Task { await refresh() }
                }
                .presentationBackground(Theme.base)
            }
            .sheet(isPresented: $showEndSheet) {
                ShiftEndSheet(dutyState: duty) { msg in
                    status = msg
                    Task { await refresh() }
                }
                .presentationBackground(Theme.base)
            }
            .sheet(isPresented: $showPreTrip) {
                if let vid = assignedVehicleId {
                    PreTripInspectionSheet(vehicleId: vid, vehicleLabel: assignedVehicleLabel) { msg in
                        status = msg
                    }
                    .presentationBackground(Theme.base)
                }
            }
            .alert("SEND PANIC ALARM?", isPresented: $confirmPanic) {
                Button("SEND PANIC", role: .destructive) { Task { await panic() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This creates a Priority-1 OFFICER ASSIST call on the dispatch board.")
            }
        }
    }

    private var dutyCard: some View {
        VStack(spacing: 6) {
            HStack {
                Circle().fill(onShift ? Theme.gold : Theme.neutral).frame(width: 10, height: 10)
                Text(onShift ? "ON DUTY" : "OFF DUTY")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(onShift ? Theme.gold : Theme.neutral)
                Spacer()
                if let cs = unit?["call_sign"] as? String {
                    Text(cs).font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.white)
                }
            }
            Button(onShift ? "END SHIFT (POST-TRIP)" : "START SHIFT (PRE-TRIP)") {
                if onShift { showEndSheet = true } else { showStartSheet = true }
            }
            .font(.system(size: 13, weight: .bold))
            .frame(maxWidth: .infinity).padding(.vertical, 10)
            .background(onShift ? Theme.raised : Theme.gold)
            .foregroundStyle(onShift ? Theme.gold : .black)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            .disabled(busyAction)
        }
        .padding(10).background(Theme.raised.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("UNIT STATUS: \(unitStatus.uppercased())")
                .font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.neutral)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
                ForEach(statuses, id: \.0) { value, label in
                    Button(label) { Task { await setStatus(value) } }
                        .font(.system(size: 11, weight: .semibold))
                        .frame(maxWidth: .infinity).padding(.vertical, 9)
                        .background(unitStatus == value ? Theme.gold : Theme.raised)
                        .foregroundStyle(unitStatus == value ? .black : .white)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                        .disabled(busyAction)
                }
            }
        }
    }

    // Hazard flags carried on the call row (SQLite booleans = 1). Surfaced as
    // a red officer-safety banner so the assigned call's known dangers are
    // visible before the officer rolls up — same posture as the subject screen.
    private static let hazardFlags: [(String, String)] = [
        ("officer_safety_caution", "OFFICER SAFETY"), ("weapons_involved", "WEAPONS"),
        ("felony_in_progress", "FELONY IN PROGRESS"), ("domestic_violence", "DV"),
        ("injuries_reported", "INJURIES"), ("mental_health_crisis", "MENTAL HEALTH"),
        ("drugs_involved", "DRUGS"), ("alcohol_involved", "ALCOHOL"),
        ("juvenile_involved", "JUVENILE"),
    ]
    private func hazards(_ call: [String: Any]) -> [String] {
        Self.hazardFlags.compactMap { key, label in
            let v = call[key]
            let on = (v as? Int ?? 0) != 0 || (v as? Bool ?? false) || (v as? String).map { $0 == "1" || $0 == "true" } ?? false
            return on ? label : nil
        }
    }

    // Seed an incident report from the assigned call (call_id + location + type).
    private func callPrefill(_ call: [String: Any]) -> [String: FieldValue] {
        var p: [String: FieldValue] = [:]
        if let id = call["id"] as? Int { p["call_id"] = .number(Double(id)) }
        if let addr = (call["location_address"] as? String) ?? (call["address"] as? String) { p["location_address"] = .string(addr) }
        if let t = (call["incident_type"] as? String) ?? (call["call_type"] as? String) { p["incident_type"] = .string(t) }
        return p
    }

    // Geocoded coordinates the server attaches to a call (0/0 = not yet geocoded).
    private func callCoords(_ call: [String: Any]) -> CLLocationCoordinate2D? {
        let lat = (call["latitude"] as? Double) ?? (call["latitude"] as? NSNumber)?.doubleValue
        let lng = (call["longitude"] as? Double) ?? (call["longitude"] as? NSNumber)?.doubleValue
        if let lat, let lng, lat != 0, lng != 0 { return CLLocationCoordinate2D(latitude: lat, longitude: lng) }
        return nil
    }

    private func callCard(_ call: [String: Any]) -> some View {
        // GET /calls/:id spreads the row, so the column is incident_type
        // (call_type kept as a fallback for any aliased payload).
        let type = (call["incident_type"] as? String) ?? (call["call_type"] as? String) ?? "CALL"
        let priority = (call["priority"] as? String) ?? ((call["priority"] as? Int).map { "P\($0)" })
        let flags = hazards(call)
        return VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("ASSIGNED CALL").font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.gold)
                if let priority, !priority.isEmpty {
                    Text(priority.uppercased())
                        .font(.system(size: 9, weight: .heavy))
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(priority.contains("1") ? Theme.red : priority.contains("2") ? Theme.orange : Theme.neutral)
                        .foregroundStyle(.black)
                }
                Spacer()
                Text(call["call_number"] as? String ?? "")
                    .font(.system(size: 11, design: .monospaced)).foregroundStyle(Theme.neutral)
            }
            Text(type.replacingOccurrences(of: "_", with: " ").uppercased())
                .font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
            Text(call["location_address"] as? String ?? call["address"] as? String ?? "")
                .font(.system(size: 12, design: .monospaced)).foregroundStyle(.white)
            if let desc = call["description"] as? String, !desc.isEmpty {
                Text(desc).font(.system(size: 11)).foregroundStyle(Theme.neutral).lineLimit(4)
            }
            if !flags.isEmpty {
                Text("⚠ " + flags.joined(separator: " · "))
                    .font(.system(size: 11, weight: .bold)).foregroundStyle(.black)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 6).padding(.vertical, 4)
                    .background(Theme.red)
            }
            NavigationLink {
                WorkflowRenderer(def: WorkflowRegistry.incident, prefill: callPrefill(call))
            } label: {
                Text("WRITE REPORT ON THIS CALL")
                    .font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.gold)
                    .frame(maxWidth: .infinity).padding(.vertical, 8)
                    .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.gold, lineWidth: 1))
            }
            .padding(.top, 4)
            if let coords = callCoords(call) {
                NavigationLink {
                    CallNavView(dest: coords, label: (call["location_address"] as? String) ?? (call["address"] as? String) ?? "Call")
                } label: {
                    Label("NAVIGATE", systemImage: "location.north.line.fill")
                        .font(.system(size: 11, weight: .bold)).foregroundStyle(.black)
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                        .background(Theme.gold).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                }
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10).background(Theme.raised)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }

    private var panicButton: some View {
        Button { confirmPanic = true } label: {
            Text("⚠ PANIC")
                .font(.system(size: 16, weight: .heavy))
                .frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(Theme.red).foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
    }

    // ── Networking ──────────────────────────────────────────

    private func client() async -> RMPGAPIClient? {
        var client = AppConfig.apiClient()
        if client.jwt == nil,
           let user = KeychainStore.load(key: "rmpgUser"),
           let pass = KeychainStore.load(key: "rmpgPass"), !user.isEmpty,
           let token = try? await client.login(username: user, password: pass) {
            KeychainStore.save(token, key: "rmpgJWT")
            client.jwt = token
        }
        return client.jwt == nil ? nil : client
    }

    /// Re-login once on 401 (JWTs expire mid-shift), then give up gracefully.
    private func authed(_ work: (RMPGAPIClient) async throws -> Void) async {
        guard var c = await client() else {
            status = "✗ Set RMPG credentials in Settings"; return
        }
        do { try await work(c) } catch {
            let code = (error as NSError).code
            if code == 401,
               let user = KeychainStore.load(key: "rmpgUser"),
               let pass = KeychainStore.load(key: "rmpgPass"),
               let token = try? await c.login(username: user, password: pass) {
                KeychainStore.save(token, key: "rmpgJWT")
                c.jwt = token
                if let _ = try? await work(c) { return }
            }
            status = "✗ \(error.localizedDescription)"
        }
    }

    @MainActor
    private func refresh() async {
        await authed { c in
            if let state = try await c.requestJSON("GET", "api/dispatch/duty/me") as? [String: Any] {
                duty = state
                BackgroundDuty.shared.setActive(
                    state["on_shift"] as? Bool ?? false,
                    currentCallId: ((state["unit"] as? [String: Any])?["current_call_id"]) as? Int)
            }
            // Assigned call: the unit row carries current_call_id; resolve it.
            if let unit = duty["unit"] as? [String: Any],
               let callId = unit["current_call_id"] as? Int {
                myCall = try? await c.requestJSON("GET", "api/dispatch/calls/\(callId)") as? [String: Any]
                // Alert once when a NEW call lands that carries hazards or is
                // P1 — the officer shouldn't have to be watching the screen.
                if callId != lastAlertedCallId, let call = myCall {
                    let p1 = ((call["priority"] as? String)?.contains("1") ?? false)
                        || ((call["priority"] as? Int) == 1)
                    if p1 || !hazards(call).isEmpty {
                        AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
                        Haptics.warning()
                    }
                    lastAlertedCallId = callId
                }
            } else {
                myCall = nil
                lastAlertedCallId = nil
            }
        }
        await maybePromptPreTrip()
    }

    // Auto-present the pre-trip ONCE per shift: on duty, a vehicle assigned, and
    // no pre-trip logged today for it. Remembered per time-entry in UserDefaults
    // so the 15s poll doesn't re-prompt after the officer defers or completes it.
    @MainActor
    private func maybePromptPreTrip() async {
        guard onShift, let vid = assignedVehicleId, let entryId = currentEntryId, !showPreTrip else { return }
        let key = "preTripPrompted.\(entryId)"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        guard let c = await ShiftNet.client() else { return }
        let rows = (try? await c.requestJSON("GET", "api/fleet/\(vid)/inspections") as? [[String: Any]]) ?? []
        if PreTripStatus.hasPreTrip(in: rows, onDay: PreTripStatus.today()) {
            UserDefaults.standard.set(true, forKey: key)   // already done today — don't nag
            return
        }
        UserDefaults.standard.set(true, forKey: key)
        showPreTrip = true
    }

    @MainActor
    private func dutyAction(_ action: String) async {
        busyAction = true; defer { busyAction = false }
        await authed { c in
            do {
                try await c.requestJSON("POST", "api/dispatch/duty/\(action)", body: [:])
                status = action == "start" ? "✓ On duty — clocked in, unit in service" : "✓ Shift ended — clocked out"
            } catch {
                // Common 409: NO_UNIT / vehicle prompt — surface the server's words.
                status = "✗ \(error.localizedDescription)"
            }
            await refresh()
        }
    }

    @MainActor
    private func setStatus(_ value: String) async {
        guard let id = unit?["id"] as? Int else { status = "✗ No unit assigned"; return }
        busyAction = true; defer { busyAction = false }
        Haptics.tap()
        status = await sendOrQueue(method: "PUT", path: "api/dispatch/units/\(id)/status",
                                   body: ["status": value], label: "Status → \(value.uppercased())")
        await refresh()
    }

    @MainActor
    private func pushGps() async {
        guard onShift, let loc = location.last,
              Date().timeIntervalSince(loc.timestamp) < 60 else { return }
        await authed { c in
            try await c.requestJSON("POST", "api/dispatch/gps", body: [
                "latitude": loc.coordinate.latitude,
                "longitude": loc.coordinate.longitude,
                "speed": max(loc.speed, 0) * 2.23694,   // m/s → mph
                "heading": max(loc.course, 0),
                "accuracy": loc.horizontalAccuracy,
                "source": "ios-field-app",
            ])
            gpsPushedAt = Date()
        }
    }

    @MainActor
    private func sendLocationToMDT() async {
        guard let loc = location.last else { status = "✗ No GPS fix yet"; return }
        let ok = await MDTLink.shared.send(type: "location", payload: [
            "latitude": loc.coordinate.latitude, "longitude": loc.coordinate.longitude,
            "label": "Officer position",
        ])
        status = ok ? "✓ Location sent to your vehicle MDT" : "✗ MDT send failed"
    }

    @MainActor
    private func panic() async {
        Haptics.panic()
        AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
        var body: [String: Any] = ["trigger_method": "ios_field_app"]
        if let loc = location.last {
            body["latitude"] = loc.coordinate.latitude
            body["longitude"] = loc.coordinate.longitude
        }
        // Queue on a dead zone so a lost-signal panic still fires on reconnect.
        let result = await sendOrQueue(method: "POST", path: "api/dispatch/panic", body: body, label: "PANIC")
        status = result.hasPrefix("✓") ? "✓ PANIC SENT — P1 officer assist on the board" : result
    }
}
