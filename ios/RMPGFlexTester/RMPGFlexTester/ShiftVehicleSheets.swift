import SwiftUI

// ============================================================
// Start/End-of-shift vehicle system:
//   START → pick vehicle + starting odometer + pre-trip inspection
//           POST /dispatch/duty/start  then  POST /fleet/:id/inspections
//   END   → ending odometer + post-trip issues
//           POST /dispatch/duty/end    then  inspection (+ maintenance
//           request when a defect is flagged)
// ============================================================

struct ShiftStartSheet: View {
    let dutyState: [String: Any]
    /// Set when a dispatch-tier user starts the shift FOR another officer
    /// (sent as officer_id; the Worker gates it by ON_BEHALF_ROLES).
    var onBehalfOfficerId: Int? = nil
    let onDone: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var vehicleId: Int?
    @State private var odometer = ""
    @State private var lines = VehicleInspection.freshLines()
    @State private var notes = ""
    @State private var fuelLevel = "F"
    @State private var photoUrls: [String] = []
    @State private var submitting = false
    @State private var error: String?
    // 409-contract state: server may push a fresh vehicle list (NEEDS_VEHICLE)
    // or demand a manager override for a decreasing odometer reading.
    @State private var pushedVehicles: [[String: Any]]?
    @State private var needsOverride = false
    @State private var overrideReason = ""
    // Out-of-service gating: a critical defect requires explicit acknowledgment.
    @State private var oosAck = false

    private var vehicles: [[String: Any]] { pushedVehicles ?? (dutyState["available_vehicles"] as? [[String: Any]] ?? []) }
    private var defects: [InspectionLine] { VehicleInspection.defects(lines) }
    private var isOOS: Bool { VehicleInspection.isOutOfService(lines) }

    var body: some View {
        NavigationStack {
            Form {
                Section("VEHICLE") {
                    Picker("Vehicle", selection: $vehicleId) {
                        Text("Take-home / assigned").tag(nil as Int?)
                        ForEach(vehicles.indices, id: \.self) { i in
                            let v = vehicles[i]
                            Text("\(v["vehicle_number"] as? String ?? "#\(v["id"] as? Int ?? 0)") — \(v["make"] as? String ?? "") \(v["model"] as? String ?? "")")
                                .tag(v["id"] as? Int)
                        }
                    }
                    TextField("Starting odometer (mi)", text: $odometer)
                        .keyboardType(.numberPad)
                    FuelLevelPicker(level: $fuelLevel)
                }
                VehicleInspectionForm(lines: $lines)
                Section("PHOTOS & NOTES") {
                    InspectionPhotoStrip(context: "pre-trip", photoUrls: $photoUrls)
                    TextField("General notes", text: $notes)
                }
                if isOOS {
                    Section("⚠ VEHICLE OUT OF SERVICE") {
                        Text("A critical defect was flagged — this vehicle will be marked OUT OF SERVICE and a maintenance request opened. Do not operate it; notify your supervisor and obtain another vehicle.")
                            .font(Theme.Typography.caption).foregroundStyle(Theme.red)
                        Toggle("I acknowledge — vehicle is out of service", isOn: $oosAck).tint(Theme.red)
                    }
                }
                if needsOverride {
                    Section("MANAGER OVERRIDE") {
                        Text("Reading is below the last recorded odometer — a reason is required to proceed.")
                            .font(Theme.Typography.caption).foregroundStyle(Theme.red)
                        TextField("Override reason", text: $overrideReason)
                    }
                }
                Section {
                    if photoUrls.isEmpty {
                        Text("Add at least one pre-trip photo to go on duty.")
                            .font(Theme.Typography.caption).foregroundStyle(Theme.orange)
                    }
                    Button(submitting ? "STARTING…" : (isOOS ? "LOG OOS & GO ON DUTY" : "GO ON DUTY")) { Task { await submit() } }
                        .fontWeight(.bold).disabled(submitting || photoUrls.isEmpty || (needsOverride && overrideReason.isEmpty) || (isOOS && !oosAck))
                    if let error { Text(error).font(Theme.Typography.mono).foregroundStyle(Theme.red) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle("START OF SHIFT")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    @MainActor
    private func submit() async {
        submitting = true; defer { submitting = false }
        guard let client = await ShiftNet.client() else { error = "Set credentials in Settings"; return }

        var body: [String: Any] = [:]
        if let vehicleId { body["vehicle_id"] = vehicleId }
        if !odometer.isEmpty { body["starting_mileage"] = Int(odometer) ?? odometer }
        if let onBehalfOfficerId { body["officer_id"] = onBehalfOfficerId }
        if needsOverride, !overrideReason.isEmpty { body["override_reason"] = overrideReason }
        do {
            let res = try await client.requestJSON("POST", "api/dispatch/duty/start", body: body)
            // Vehicle id for the inspection: explicit pick, else what duty assigned.
            let assignedVehicle = vehicleId
                ?? (((res as? [String: Any])?["vehicle"] as? [String: Any])?["id"] as? Int)
            if let vid = assignedVehicle {
                var checklist = VehicleInspection.payload(lines)
                checklist.append(["category": "Fuel", "item": "Fuel level at start",
                                  "status": fuelLevel == "E" ? "defect" : "pass", "severity": "",
                                  "notes": "\(fuelLevel) tank"])
                for (i, url) in photoUrls.enumerated() {
                    checklist.append(["category": "Photos", "item": "Photo \(i + 1)", "status": "pass", "severity": "", "notes": url])
                }
                var insp: [String: Any] = [
                    "inspection_date": ISO8601DateFormatter().string(from: Date()),
                    "inspector_name": KeychainStore.load(key: "rmpgUser") ?? "field-app",
                    "inspection_type": "pre_trip",
                    "overall_result": VehicleInspection.overallResult(lines),
                    "out_of_service": isOOS,
                    "items": checklist,
                    "notes": notes,
                ]
                if let mi = Int(odometer) { insp["mileage"] = mi }
                // The server derives OOS from the checklist and flags the vehicle
                // out_of_service automatically (see fleet.ts).
                _ = try? await client.requestJSON("POST", "api/fleet/\(vid)/inspections", body: insp)
                // Any defect opens a maintenance request so the fleet manager sees
                // it without reading every inspection.
                if !defects.isEmpty {
                    _ = try? await client.requestJSON("POST", "api/fleet/\(vid)/maintenance", body: [
                        "type": isOOS ? "out_of_service" : "repair_needed",
                        "performed_at": ISO8601DateFormatter().string(from: Date()),
                        "description": (isOOS ? "OOS — " : "PRE-TRIP DEFECTS: ")
                            + defects.map { "\($0.label) [\($0.status == .defect ? $0.severity.rawValue : "")] — \($0.note)" }.joined(separator: "; "),
                        "mileage_at_service": Int(odometer) ?? 0,
                        "notes": "Reported from iOS field app at shift start",
                    ])
                }
                // OOS → push the vehicle terminal + dispatch so the board reflects
                // it immediately, not just the fleet record.
                if isOOS {
                    _ = await MDTLink.shared.send(type: "vehicle_oos",
                        payload: ["vehicle_id": vid, "defects": defects.map(\.label).joined(separator: ", ")])
                }
            }
            onDone(defects.isEmpty
                   ? "✓ On duty — pre-trip logged clean"
                   : isOOS
                     ? "✓ On duty — VEHICLE OUT OF SERVICE, fleet + MDT notified"
                     : "✓ On duty — pre-trip logged with \(defects.count) defect(s), maintenance request opened")
            dismiss()
        } catch {
            // Drive the Worker's 409 code contract instead of dead-ending.
            switch RMPGAPIClient.apiCode(error) {
            case "NEEDS_VEHICLE":
                pushedVehicles = RMPGAPIClient.apiBody(error)?["available_vehicles"] as? [[String: Any]]
                self.error = "Pick a vehicle from the list, then go on duty again."
            case "NEEDS_MILEAGE":
                self.error = "Enter the starting odometer reading."
            case "MILEAGE_TOO_HIGH":
                self.error = "That reading exceeds 999,999 — check for a stray digit."
            case "MILEAGE_DECREASING":
                needsOverride = true
                let prev = RMPGAPIClient.apiBody(error)?["previous_mileage"] as? Int
                self.error = "Reading is below the last recorded\(prev.map { " (\($0))" } ?? "") — enter an override reason."
            default:
                self.error = error.localizedDescription
            }
        }
    }
}

struct ShiftEndSheet: View {
    let dutyState: [String: Any]
    /// Set when a dispatch-tier user ends the shift FOR another officer.
    var onBehalfOfficerId: Int? = nil
    let onDone: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var needsOverride = false
    @State private var overrideReason = ""
    @State private var odometer = ""
    @State private var fuelLevel = "1/2"
    @State private var lines = VehicleInspection.freshLines()
    @State private var notes = ""
    @State private var oosAck = false
    @State private var photoUrls: [String] = []
    @State private var boughtFuel = false
    @State private var fuelGallons = ""
    @State private var fuelCost = ""
    @State private var submitting = false
    @State private var error: String?

    private var vehicleId: Int? { (dutyState["vehicle"] as? [String: Any])?["id"] as? Int }
    private var defects: [InspectionLine] { VehicleInspection.defects(lines) }
    private var isOOS: Bool { VehicleInspection.isOutOfService(lines) }

    var body: some View {
        NavigationStack {
            Form {
                Section("ODOMETER & FUEL") {
                    TextField("Ending odometer (blank = GPS-derived)", text: $odometer)
                        .keyboardType(.numberPad)
                    FuelLevelPicker(level: $fuelLevel)
                }
                VehicleInspectionForm(lines: $lines)
                Section("PHOTOS & NOTES") {
                    InspectionPhotoStrip(context: "post-trip", photoUrls: $photoUrls)
                    TextField("Mechanical / general notes", text: $notes, axis: .vertical).lineLimit(2...4)
                }
                Section("FUEL PURCHASE THIS SHIFT") {
                    Toggle("I bought fuel", isOn: $boughtFuel).tint(Theme.gold)
                    if boughtFuel {
                        TextField("Gallons", text: $fuelGallons).keyboardType(.decimalPad)
                        TextField("Total cost ($)", text: $fuelCost).keyboardType(.decimalPad)
                    }
                }
                if isOOS {
                    Section("⚠ VEHICLE OUT OF SERVICE") {
                        Text("A critical defect was found on the post-trip — this vehicle will be marked OUT OF SERVICE for the next shift and a maintenance request opened.")
                            .font(Theme.Typography.caption).foregroundStyle(Theme.red)
                        Toggle("I acknowledge — vehicle is out of service", isOn: $oosAck).tint(Theme.red)
                    }
                }
                if needsOverride {
                    Section("MANAGER OVERRIDE") {
                        Text("Reading is below this shift's starting odometer — a reason is required.")
                            .font(Theme.Typography.caption).foregroundStyle(Theme.red)
                        TextField("Override reason", text: $overrideReason)
                    }
                }
                Section {
                    Button(submitting ? "ENDING…" : (isOOS ? "LOG OOS & END SHIFT" : "END SHIFT")) { Task { await submit() } }
                        .fontWeight(.bold)
                        .disabled(submitting || (needsOverride && overrideReason.isEmpty) || (isOOS && !oosAck))
                    if let error { Text(error).font(Theme.Typography.mono).foregroundStyle(Theme.red) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle("END OF SHIFT")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    @MainActor
    private func submit() async {
        submitting = true; defer { submitting = false }
        guard let client = await ShiftNet.client() else { error = "Set credentials in Settings"; return }
        var body: [String: Any] = [:]
        if !odometer.isEmpty { body["ending_mileage"] = Int(odometer) ?? odometer }
        if let onBehalfOfficerId { body["officer_id"] = onBehalfOfficerId }
        if needsOverride, !overrideReason.isEmpty { body["override_reason"] = overrideReason }
        do {
            try await client.requestJSON("POST", "api/dispatch/duty/end", body: body)
            let fuelLow = fuelLevel == "E" || fuelLevel == "1/4"
            let hasIssues = !defects.isEmpty || fuelLow
            if let vid = vehicleId {
                var checklist = VehicleInspection.payload(lines)
                checklist.append(["category": "Fuel", "item": "Fuel level at end",
                                  "status": fuelLow ? "defect" : "pass", "severity": "",
                                  "notes": "\(fuelLevel) tank" + (fuelLow ? " — refuel needed" : "")])
                for (i, url) in photoUrls.enumerated() {
                    checklist.append(["category": "Photos", "item": "Photo \(i + 1)", "status": "pass", "severity": "", "notes": url])
                }
                if boughtFuel {
                    _ = try? await FuelLogger.log(client: client, vehicleId: vid, gallons: fuelGallons,
                                                  totalCost: fuelCost, odometer: odometer, vendor: "")
                }
                var insp: [String: Any] = [
                    "inspection_date": ISO8601DateFormatter().string(from: Date()),
                    "inspector_name": KeychainStore.load(key: "rmpgUser") ?? "field-app",
                    "inspection_type": "post_trip",
                    "overall_result": VehicleInspection.overallResult(lines),
                    "out_of_service": isOOS,
                    "items": checklist,
                    "notes": notes,
                ]
                if let mi = Int(odometer) { insp["mileage"] = mi }
                _ = try? await client.requestJSON("POST", "api/fleet/\(vid)/inspections", body: insp)
                if !defects.isEmpty {
                    _ = try? await client.requestJSON("POST", "api/fleet/\(vid)/maintenance", body: [
                        "type": isOOS ? "out_of_service" : "repair_needed",
                        "performed_at": ISO8601DateFormatter().string(from: Date()),
                        "description": (isOOS ? "POST-TRIP OOS — " : "POST-TRIP DEFECTS: ")
                            + defects.map { "\($0.label) [\($0.severity.rawValue)] — \($0.note)" }.joined(separator: "; "),
                        "mileage_at_service": Int(odometer) ?? 0,
                        "notes": "Reported from iOS field app at shift end",
                    ])
                }
                if isOOS {
                    _ = await MDTLink.shared.send(type: "vehicle_oos",
                        payload: ["vehicle_id": vid, "defects": defects.map(\.label).joined(separator: ", "), "phase": "post_trip"])
                }
            }
            onDone(hasIssues
                   ? (isOOS ? "✓ Off duty — VEHICLE OUT OF SERVICE for next shift, fleet + MDT notified"
                            : "✓ Off duty — post-trip logged, issues reported to fleet")
                   : "✓ Off duty — post-trip clean, books closed")
            dismiss()
        } catch {
            switch RMPGAPIClient.apiCode(error) {
            case "NEEDS_MILEAGE":
                self.error = "Enter the ending odometer reading."
            case "MILEAGE_TOO_HIGH":
                self.error = "That reading exceeds 999,999 — check for a stray digit."
            case "MILEAGE_DECREASING":
                needsOverride = true
                let start = RMPGAPIClient.apiBody(error)?["starting_mileage"] as? Int
                self.error = "Reading is below the shift's start\(start.map { " (\($0))" } ?? "") — enter an override reason."
            default:
                self.error = error.localizedDescription
            }
        }
    }
}

enum ShiftNet {
    static func client() async -> RMPGAPIClient? {
        var client = AppConfig.apiClient()
        if client.jwt == nil,
           let u = KeychainStore.load(key: "rmpgUser"),
           let p = KeychainStore.load(key: "rmpgPass"), !u.isEmpty,
           let t = try? await client.login(username: u, password: p) {
            KeychainStore.save(t, key: "rmpgJWT"); client.jwt = t
        }
        return client.jwt == nil ? nil : client
    }
}
