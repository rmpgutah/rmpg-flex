import SwiftUI

// Standalone start-of-shift pre-trip — used when an officer is ALREADY on duty
// (auto-presented from FieldOpsView) so it logs only the inspection, not a new
// clock-in. At least one photo is required. Defects open a maintenance ticket,
// matching ShiftStartSheet.
struct PreTripInspectionSheet: View {
    let vehicleId: Int
    let vehicleLabel: String
    let onDone: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var odometer = ""
    @State private var lines = VehicleInspection.freshLines()
    @State private var notes = ""
    @State private var fuelLevel = "F"
    @State private var photoUrls: [String] = []
    @State private var submitting = false
    @State private var error: String?

    private var defects: [InspectionLine] { VehicleInspection.defects(lines) }
    private var isOOS: Bool { VehicleInspection.isOutOfService(lines) }
    private var canSubmit: Bool { !submitting && !photoUrls.isEmpty }

    var body: some View {
        NavigationStack {
            Form {
                Section("VEHICLE") {
                    Text(vehicleLabel).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                    TextField("Current odometer (mi)", text: $odometer).keyboardType(.numberPad)
                    FuelLevelPicker(level: $fuelLevel)
                }
                Section("PRE-TRIP INSPECTION") {
                    InspectionPhotoStrip(context: "pre-trip", photoUrls: $photoUrls)
                    if photoUrls.isEmpty {
                        Text("At least one photo is required.")
                            .font(.system(size: 11)).foregroundStyle(Theme.orange)
                    }
                }
                VehicleInspectionForm(lines: $lines)
                Section("NOTES") {
                    TextField("General notes", text: $notes)
                }
                Section {
                    Button(submitting ? "LOGGING…" : "LOG PRE-TRIP") { Task { await submit() } }
                        .fontWeight(.bold).disabled(!canSubmit)
                    if let error { Text(error).font(.system(size: 11, design: .monospaced)).foregroundStyle(Theme.red) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle("PRE-TRIP REQUIRED")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Later") { dismiss() }
                }
            }
        }
    }

    @MainActor
    private func submit() async {
        submitting = true; defer { submitting = false }
        guard let client = await ShiftNet.client() else { error = "Set credentials in Settings"; return }
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
        do {
            _ = try await client.requestJSON("POST", "api/fleet/\(vehicleId)/inspections", body: insp)
            if !defects.isEmpty {
                _ = try? await client.requestJSON("POST", "api/fleet/\(vehicleId)/maintenance", body: [
                    "type": isOOS ? "out_of_service" : "repair_needed",
                    "performed_at": ISO8601DateFormatter().string(from: Date()),
                    "description": (isOOS ? "OOS — " : "PRE-TRIP DEFECTS: ")
                        + defects.map { "\($0.label) [\($0.severity.rawValue)] — \($0.note)" }.joined(separator: "; "),
                    "mileage_at_service": Int(odometer) ?? 0,
                    "notes": "Reported from iOS field app (auto pre-trip)",
                ])
            }
            onDone(defects.isEmpty ? "✓ Pre-trip logged clean"
                                   : "✓ Pre-trip logged with \(defects.count) defect(s), maintenance request opened")
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
