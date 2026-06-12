import SwiftUI

// ============================================================
// Start/End-of-shift vehicle system:
//   START → pick vehicle + starting odometer + pre-trip inspection
//           POST /dispatch/duty/start  then  POST /fleet/:id/inspections
//   END   → ending odometer + post-trip issues
//           POST /dispatch/duty/end    then  inspection (+ maintenance
//           request when a defect is flagged)
// ============================================================

private let PRE_TRIP_ITEMS = [
    "Exterior body / damage", "Tires & wheels", "Lights & signals",
    "Windshield & wipers", "Horn & siren", "Emergency equipment",
    "Interior clean / no contraband", "Fluid leaks under vehicle",
    "Brakes feel", "Fuel level adequate", "Radio / MDT working",
    "First aid & fire extinguisher",
]

struct ChecklistItem: Identifiable {
    let id: String
    var pass = true
    var note = ""
}

struct ShiftStartSheet: View {
    let dutyState: [String: Any]
    let onDone: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var vehicleId: Int?
    @State private var odometer = ""
    @State private var items = PRE_TRIP_ITEMS.map { ChecklistItem(id: $0) }
    @State private var notes = ""
    @State private var fuelLevel = "F"
    @State private var photoUrls: [String] = []
    @State private var submitting = false
    @State private var error: String?

    private var vehicles: [[String: Any]] { dutyState["available_vehicles"] as? [[String: Any]] ?? [] }
    private var failed: [ChecklistItem] { items.filter { !$0.pass } }

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
                Section("PRE-TRIP INSPECTION") {
                    InspectionPhotoStrip(context: "pre-trip", photoUrls: $photoUrls)
                    ForEach($items) { $item in
                        VStack(alignment: .leading, spacing: 2) {
                            Toggle(item.id, isOn: $item.pass).tint(Theme.gold)
                            if !item.pass {
                                TextField("Describe the defect", text: $item.note)
                                    .font(.system(size: 12))
                            }
                        }
                    }
                    TextField("General notes", text: $notes)
                }
                Section {
                    Button(submitting ? "STARTING…" : "GO ON DUTY") { Task { await submit() } }
                        .fontWeight(.bold).disabled(submitting)
                    if let error { Text(error).font(.system(size: 11, design: .monospaced)).foregroundStyle(Theme.red) }
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
        do {
            let res = try await client.requestJSON("POST", "api/dispatch/duty/start", body: body)
            // Vehicle id for the inspection: explicit pick, else what duty assigned.
            let assignedVehicle = vehicleId
                ?? (((res as? [String: Any])?["vehicle"] as? [String: Any])?["id"] as? Int)
            if let vid = assignedVehicle {
                var checklist = items.map { ["category": "PRE-TRIP", "item": $0.id,
                                             "status": $0.pass ? "pass" : "fail", "notes": $0.note] }
                checklist.append(["category": "PRE-TRIP", "item": "Fuel level at start",
                                  "status": fuelLevel == "E" ? "fail" : "pass", "notes": "\(fuelLevel) tank"])
                for (i, url) in photoUrls.enumerated() {
                    checklist.append(["category": "PHOTOS", "item": "Photo \(i + 1)", "status": "pass", "notes": url])
                }
                var insp: [String: Any] = [
                    "inspection_date": ISO8601DateFormatter().string(from: Date()),
                    "inspector_name": KeychainStore.load(key: "rmpgUser") ?? "field-app",
                    "inspection_type": "pre_trip",
                    "overall_result": failed.isEmpty ? "pass" : "fail",
                    "items": checklist,
                    "notes": notes,
                ]
                if let mi = Int(odometer) { insp["mileage"] = mi }
                _ = try? await client.requestJSON("POST", "api/fleet/\(vid)/inspections", body: insp)
                // A failed pre-trip item also opens a maintenance request so the
                // fleet manager sees it without reading every inspection.
                if !failed.isEmpty {
                    _ = try? await client.requestJSON("POST", "api/fleet/\(vid)/maintenance", body: [
                        "type": "repair_needed",
                        "performed_at": ISO8601DateFormatter().string(from: Date()),
                        "description": "PRE-TRIP DEFECTS: " + failed.map { "\($0.id) — \($0.note)" }.joined(separator: "; "),
                        "mileage_at_service": Int(odometer) ?? 0,
                        "notes": "Reported from iOS field app at shift start",
                    ])
                }
            }
            onDone(failed.isEmpty
                   ? "✓ On duty — pre-trip logged clean"
                   : "✓ On duty — pre-trip logged with \(failed.count) defect(s), maintenance request opened")
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ShiftEndSheet: View {
    let dutyState: [String: Any]
    let onDone: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var odometer = ""
    @State private var issues = ""
    @State private var fuelLevel = "1/2"
    @State private var newDamage = false
    @State private var damageNote = ""
    @State private var photoUrls: [String] = []
    @State private var boughtFuel = false
    @State private var fuelGallons = ""
    @State private var fuelCost = ""
    @State private var submitting = false
    @State private var error: String?

    private var vehicleId: Int? { (dutyState["vehicle"] as? [String: Any])?["id"] as? Int }

    var body: some View {
        NavigationStack {
            Form {
                Section("ODOMETER") {
                    TextField("Ending odometer (blank = GPS-derived)", text: $odometer)
                        .keyboardType(.numberPad)
                }
                Section("POST-TRIP") {
                    FuelLevelPicker(level: $fuelLevel)
                    Toggle("New damage found", isOn: $newDamage).tint(Theme.red)
                    if newDamage { TextField("Describe damage", text: $damageNote) }
                    TextField("Mechanical issues this shift (blank = none)", text: $issues, axis: .vertical)
                        .lineLimit(2...4)
                    InspectionPhotoStrip(context: "post-trip", photoUrls: $photoUrls)
                }
                Section("FUEL PURCHASE THIS SHIFT") {
                    Toggle("I bought fuel", isOn: $boughtFuel).tint(Theme.gold)
                    if boughtFuel {
                        TextField("Gallons", text: $fuelGallons).keyboardType(.decimalPad)
                        TextField("Total cost ($)", text: $fuelCost).keyboardType(.decimalPad)
                    }
                }
                Section {
                    Button(submitting ? "ENDING…" : "END SHIFT") { Task { await submit() } }
                        .fontWeight(.bold).disabled(submitting)
                    if let error { Text(error).font(.system(size: 11, design: .monospaced)).foregroundStyle(Theme.red) }
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
        do {
            try await client.requestJSON("POST", "api/dispatch/duty/end", body: body)
            let fuelLow = fuelLevel == "E" || fuelLevel == "1/4"
            let hasIssues = newDamage || fuelLow || !issues.isEmpty
            if let vid = vehicleId {
                var checklist: [[String: String]] = []
                checklist.append(["category": "POST-TRIP", "item": "Fuel level at end",
                                  "status": fuelLow ? "fail" : "pass",
                                  "notes": "\(fuelLevel) tank" + (fuelLow ? " — refuel needed" : "")])
                checklist.append(["category": "POST-TRIP", "item": "New damage",
                                  "status": newDamage ? "fail" : "pass", "notes": damageNote])
                if !issues.isEmpty {
                    checklist.append(["category": "POST-TRIP", "item": "Mechanical", "status": "fail", "notes": issues])
                }
                for (i, url) in photoUrls.enumerated() {
                    checklist.append(["category": "PHOTOS", "item": "Photo \(i + 1)", "status": "pass", "notes": url])
                }
                if boughtFuel {
                    _ = try? await FuelLogger.log(client: client, vehicleId: vid, gallons: fuelGallons,
                                                  totalCost: fuelCost, odometer: odometer, vendor: "")
                }
                var insp: [String: Any] = [
                    "inspection_date": ISO8601DateFormatter().string(from: Date()),
                    "inspector_name": KeychainStore.load(key: "rmpgUser") ?? "field-app",
                    "inspection_type": "post_trip",
                    "overall_result": hasIssues ? "fail" : "pass",
                    "items": checklist,
                    "notes": issues,
                ]
                if let mi = Int(odometer) { insp["mileage"] = mi }
                _ = try? await client.requestJSON("POST", "api/fleet/\(vid)/inspections", body: insp)
                if newDamage || !issues.isEmpty {
                    _ = try? await client.requestJSON("POST", "api/fleet/\(vid)/maintenance", body: [
                        "type": "repair_needed",
                        "performed_at": ISO8601DateFormatter().string(from: Date()),
                        "description": "POST-TRIP: " + [newDamage ? "DAMAGE: \(damageNote)" : "", issues].filter { !$0.isEmpty }.joined(separator: "; "),
                        "mileage_at_service": Int(odometer) ?? 0,
                        "notes": "Reported from iOS field app at shift end",
                    ])
                }
            }
            onDone(hasIssues ? "✓ Off duty — post-trip logged, issues reported to fleet"
                             : "✓ Off duty — post-trip clean, books closed")
            dismiss()
        } catch {
            self.error = error.localizedDescription
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
