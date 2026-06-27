import SwiftUI

// ============================================================
// Duty Roster — dispatch-tier shift supervision from the field app.
//   • Live roster: who's on duty, hours so far, unit status, vehicle, GPS age
//     (GET /api/dispatch/duty/roster, 10 s poll like FieldOpsView)
//   • Start / End shift on an officer's behalf (officer_id passthrough to
//     the same duty endpoints; pre/post-trip sheets reused)
//   • Time corrections via the audited personnel routes
//     (GET /personnel/time?officer_id=…, PUT /personnel/time/:id — reason
//     required, every change lands in time_entry_edits)
// UI gating only — the Worker re-checks the role on every call.
// ============================================================

struct RosterOfficer: Identifiable {
    let id: Int
    let name: String
    let role: String
    let onShift: Bool
    let entryId: Int?
    let clockIn: String?
    let hoursSoFar: Double?
    let callSign: String?
    let unitStatus: String?
    let onCall: Bool
    let vehicleNumber: String?
    let gpsAt: String?

    init?(json: [String: Any]) {
        guard let oid = json["officer_id"] as? Int else { return nil }
        id = oid
        name = json["name"] as? String ?? "Officer #\(oid)"
        role = json["role"] as? String ?? "officer"
        onShift = json["on_shift"] as? Bool ?? false
        entryId = json["entry_id"] as? Int
        clockIn = json["clock_in"] as? String
        hoursSoFar = json["hours_so_far"] as? Double ?? (json["hours_so_far"] as? Int).map(Double.init)
        let unit = json["unit"] as? [String: Any]
        callSign = unit?["call_sign"] as? String
        unitStatus = unit?["status"] as? String
        onCall = (unit?["current_call_id"] as? Int) != nil
        vehicleNumber = (json["vehicle"] as? [String: Any])?["vehicle_number"] as? String
        gpsAt = (json["last_gps"] as? [String: Any])?["at"] as? String
    }
}

struct DutyRosterView: View {
    @State private var officers: [RosterOfficer] = []
    @State private var status = ""
    @State private var claims = JWTClaims.current()
    @State private var loading = false
    // Sheet routing: the target officer + their fetched duty state.
    @State private var sheetTarget: RosterOfficer?
    @State private var sheetDuty: [String: Any] = [:]
    @State private var sheetKind: SheetKind?

    enum SheetKind: Identifiable {
        case start, end, editTimes
        var id: Int { switch self { case .start: 0; case .end: 1; case .editTimes: 2 } }
    }

    var body: some View {
        NavigationStack {
            Group {
                if claims?.isDispatchTier == true {
                    rosterList
                } else {
                    OnDutyView()
                }
            }
            .navigationTitle("DUTY ROSTER")
            .navigationBarTitleDisplayMode(.inline)
            .background(Theme.base)
        }
        .task {
            claims = JWTClaims.current()
            await refresh()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                claims = JWTClaims.current()
                await refresh()
            }
        }
        .sheet(item: $sheetKind) { kind in
            switch kind {
            case .start:
                ShiftStartSheet(dutyState: sheetDuty, onBehalfOfficerId: sheetTarget?.id) { msg in
                    status = msg; Task { await refresh() }
                }
            case .end:
                ShiftEndSheet(dutyState: sheetDuty, onBehalfOfficerId: sheetTarget?.id) { msg in
                    status = msg; Task { await refresh() }
                }
            case .editTimes:
                if let target = sheetTarget {
                    TimeEntryEditSheet(officer: target) { msg in
                        status = msg; Task { await refresh() }
                    }
                }
            }
        }
    }

    private var rosterList: some View {
        List {
            if !status.isEmpty {
                Text(status).font(Theme.Typography.mono).foregroundStyle(Theme.gold)
            }
            Section("ON DUTY (\(officers.filter(\.onShift).count))") {
                ForEach(officers.filter(\.onShift)) { o in row(o) }
            }
            Section("OFF DUTY") {
                ForEach(officers.filter { !$0.onShift }) { o in row(o) }
            }
        }
        .scrollContentBackground(.hidden)
        .refreshable { await refresh() }
        .overlay { if loading && officers.isEmpty { ProgressView() } }
    }

    private func row(_ o: RosterOfficer) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Circle().fill(o.onShift ? (o.onCall ? Theme.red : Theme.gold) : Theme.neutral)
                    .frame(width: 8, height: 8)
                Text(o.name).font(Theme.Typography.body).fontWeight(.semibold)
                Spacer()
                if let h = o.hoursSoFar {
                    Text(String(format: "%.1f h", h))
                        .font(Theme.Typography.mono)
                        .foregroundStyle(h >= 12 ? Theme.red : Theme.neutral)
                }
            }
            HStack(spacing: 8) {
                Text(o.role.uppercased()).font(.system(size: 9)).foregroundStyle(Theme.neutral)
                if let cs = o.callSign { Text(cs).font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.gold) }
                if let st = o.unitStatus, o.onShift { Text(st.uppercased()).font(.system(size: 9)).foregroundStyle(Theme.neutral) }
                if let v = o.vehicleNumber { Text(v).font(.system(size: 9)).foregroundStyle(Theme.neutral) }
                if o.onShift { Text(gpsAge(o.gpsAt)).font(.system(size: 9)).foregroundStyle(Theme.neutral) }
            }
        }
        .swipeActions(edge: .trailing) {
            if o.onShift {
                Button("End Shift") { Task { await openSheet(.end, for: o) } }.tint(Theme.red)
            } else {
                Button("Start Shift") { Task { await openSheet(.start, for: o) } }.tint(.green)
            }
            Button("Edit Times") { sheetTarget = o; sheetKind = .editTimes }.tint(.orange)
        }
        .contextMenu {
            if o.onShift {
                Button("End Shift (post-trip)") { Task { await openSheet(.end, for: o) } }
            } else {
                Button("Start Shift (pre-trip)") { Task { await openSheet(.start, for: o) } }
            }
            Button("Edit Time Entries") { sheetTarget = o; sheetKind = .editTimes }
        }
    }

    private func gpsAge(_ at: String?) -> String {
        guard let at else { return "no GPS" }
        // gps_updated_at is "YYYY-MM-DD HH:MM:SS" UTC from datetime('now').
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd HH:mm:ss"
        fmt.timeZone = TimeZone(identifier: "UTC")
        guard let d = fmt.date(from: at) else { return "GPS ?" }
        let mins = Int(Date().timeIntervalSince(d) / 60)
        return mins < 2 ? "GPS live" : "GPS \(mins)m ago"
    }

    @MainActor
    private func refresh() async {
        guard claims?.isDispatchTier == true else { return }
        loading = true; defer { loading = false }
        guard let c = await ShiftNet.client() else { status = "✗ Set credentials in Settings"; return }
        if let res = try? await c.requestJSON("GET", "api/dispatch/duty/roster") as? [String: Any],
           let rows = res["officers"] as? [[String: Any]] {
            officers = rows.compactMap(RosterOfficer.init)
        }
    }

    /// Fetch the TARGET officer's duty state (vehicle list / assigned car)
    /// before presenting a start/end sheet on their behalf.
    @MainActor
    private func openSheet(_ kind: SheetKind, for officer: RosterOfficer) async {
        guard let c = await ShiftNet.client() else { status = "✗ Set credentials in Settings"; return }
        sheetTarget = officer
        sheetDuty = (try? await c.requestJSON("GET", "api/dispatch/duty/me?officer_id=\(officer.id)") as? [String: Any]) ?? [:]
        sheetKind = kind
    }
}

// ── Time corrections ────────────────────────────────────────
// Lists the officer's recent entries and edits clock_in / clock_out /
// break_minutes through the audited PUT /personnel/time/:id (reason required).
struct TimeEntryEditSheet: View {
    let officer: RosterOfficer
    let onDone: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var entries: [[String: Any]] = []
    @State private var selectedId: Int?
    @State private var clockIn = ""
    @State private var clockOut = ""
    @State private var breakMinutes = ""
    @State private var reason = ""
    @State private var submitting = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("RECENT ENTRIES — \(officer.name.uppercased())") {
                    if entries.isEmpty { EmptyState(icon: "clock.badge.questionmark", title: "No entries in the last 14 days") }
                    ForEach(entries.indices, id: \.self) { i in
                        let e = entries[i]
                        let id = e["id"] as? Int
                        Button { select(e) } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(short(e["clock_in"])) → \(e["clock_out"] == nil ? "OPEN" : short(e["clock_out"]))")
                                        .font(Theme.Typography.mono)
                                    if let h = e["total_hours"] as? Double {
                                        Text(String(format: "%.2f h", h)).font(.system(size: 10)).foregroundStyle(Theme.neutral)
                                    }
                                }
                                Spacer()
                                if id == selectedId { Image(systemName: "checkmark").foregroundStyle(Theme.gold) }
                            }
                        }
                    }
                }
                if selectedId != nil {
                    Section("CORRECTION (ISO timestamps, e.g. 2026-06-12T14:00:00+00:00)") {
                        TextField("Clock in", text: $clockIn).font(Theme.Typography.mono)
                        TextField("Clock out (blank = leave open)", text: $clockOut).font(Theme.Typography.mono)
                        TextField("Break minutes", text: $breakMinutes).keyboardType(.numberPad)
                        TextField("Reason (required — feeds payroll audit)", text: $reason)
                    }
                    Section {
                        Button(submitting ? "SAVING…" : "SAVE CORRECTION") { Task { await submit() } }
                            .fontWeight(.bold)
                            .disabled(submitting || reason.trimmingCharacters(in: .whitespaces).isEmpty)
                        if let error { Text(error).font(Theme.Typography.mono).foregroundStyle(Theme.red) }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle("EDIT TIMES")
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
        }
    }

    private func short(_ v: Any?) -> String {
        guard let s = v as? String else { return "—" }
        return String(s.prefix(16)).replacingOccurrences(of: "T", with: " ")
    }

    private func select(_ e: [String: Any]) {
        selectedId = e["id"] as? Int
        clockIn = e["clock_in"] as? String ?? ""
        clockOut = e["clock_out"] as? String ?? ""
        breakMinutes = (e["break_minutes"] as? Int).map(String.init) ?? "0"
        error = nil
    }

    @MainActor
    private func load() async {
        guard let c = await ShiftNet.client() else { error = "Set credentials in Settings"; return }
        // GET /personnel/time returns a bare array (PersonnelPage contract).
        if let rows = try? await c.requestJSON("GET", "api/personnel/time?officer_id=\(officer.id)") as? [[String: Any]] {
            entries = rows
        } else {
            error = "Could not load time entries"
        }
    }

    @MainActor
    private func submit() async {
        guard let id = selectedId else { return }
        submitting = true; defer { submitting = false }
        guard let c = await ShiftNet.client() else { error = "Set credentials in Settings"; return }
        var body: [String: Any] = ["reason": reason]
        if !clockIn.isEmpty { body["clock_in"] = clockIn }
        body["clock_out"] = clockOut.isEmpty ? NSNull() : clockOut
        if let b = Int(breakMinutes) { body["break_minutes"] = b }
        do {
            try await c.requestJSON("PUT", "api/personnel/time/\(id)", body: body)
            onDone("✓ Time entry #\(id) corrected — audited")
            dismiss()
        } catch {
            self.error = RMPGAPIClient.apiCode(error) == "NO_CHANGES"
                ? "Nothing changed — adjust a field first."
                : error.localizedDescription
        }
    }
}
