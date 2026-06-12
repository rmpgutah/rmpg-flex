import SwiftUI
import UIKit

// Shared photo upload → /api/field-photos (R2). Returns the served URL so
// inspections can reference photos in their checklist JSON.
enum PhotoUploader {
    static func upload(_ image: UIImage, notes: String) async throws -> String {
        guard let jpeg = image.jpegData(compressionQuality: 0.75) else {
            throw NSError(domain: "RMPG", code: 0, userInfo: [NSLocalizedDescriptionKey: "JPEG encode failed"])
        }
        guard let client = await ShiftNet.client(), let jwt = client.jwt else {
            throw NSError(domain: "RMPG", code: 401, userInfo: [NSLocalizedDescriptionKey: "Not logged in"])
        }
        var fields: [String: String] = ["notes": notes]
        if let loc = LocationManager.shared.last {
            fields["lat"] = "\(loc.coordinate.latitude)"
            fields["lng"] = "\(loc.coordinate.longitude)"
        }
        let boundary = "rmpg-\(UUID().uuidString)"
        var body = Data()
        for (key, value) in fields where !value.isEmpty {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(key)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"inspection.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(jpeg)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        var req = URLRequest(url: client.baseURL.appendingPathComponent("api/field-photos"))
        req.httpMethod = "POST"
        req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code),
              let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let url = obj["url"] as? String else {
            throw NSError(domain: "RMPG", code: code,
                          userInfo: [NSLocalizedDescriptionKey: "Photo upload failed (HTTP \(code))"])
        }
        return url
    }
}

// Reusable inspection photo strip: capture N photos, expose uploaded URLs.
struct InspectionPhotoStrip: View {
    let context: String                       // e.g. "pre-trip V12"
    @Binding var photoUrls: [String]
    @State private var showCamera = false
    @State private var uploading = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Button {
                    showCamera = true
                } label: {
                    Label(uploading ? "Uploading…" : "Add Photo (\(photoUrls.count))",
                          systemImage: "camera.fill")
                        .font(.system(size: 12, weight: .semibold))
                }
                .disabled(uploading)
                Spacer()
            }
            if let error {
                Text(error).font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.red)
            }
            if !photoUrls.isEmpty {
                Text("\(photoUrls.count) photo(s) attached — visible in the desktop fleet record")
                    .font(.system(size: 10)).foregroundStyle(Theme.neutral)
            }
        }
        .sheet(isPresented: $showCamera) {
            CameraPicker { image in
                Task { await upload(image) }
            }
            .ignoresSafeArea()
        }
    }

    @MainActor
    private func upload(_ image: UIImage) async {
        uploading = true; defer { uploading = false }
        do {
            let url = try await PhotoUploader.upload(image, notes: "Vehicle inspection photo — \(context)")
            photoUrls.append(url)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// Fuel level picker used at shift start + end. Stored in the inspection
// checklist as a normal item so the desktop renders it with no changes.
struct FuelLevelPicker: View {
    @Binding var level: String
    static let levels = ["E", "1/4", "1/2", "3/4", "F"]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("FUEL LEVEL").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.neutral)
            HStack(spacing: 4) {
                ForEach(Self.levels, id: \.self) { l in
                    Button(l) { level = l }
                        .font(.system(size: 12, weight: .bold))
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                        .background(level == l ? Theme.gold : Theme.raised)
                        .foregroundStyle(level == l ? .black : .white)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                        .buttonStyle(.plain)
                }
            }
        }
    }
}

// Fuel purchase → POST /api/fleet/:vehicleId/fuel. Used from the end-of-shift
// sheet and as a standalone Toolkit tool (vehicle resolved from duty state).
struct FuelPurchaseSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var gallons = ""
    @State private var totalCost = ""
    @State private var odometer = ""
    @State private var vendor = ""
    @State private var status: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section("FUEL PURCHASE") {
                    TextField("Gallons", text: $gallons).keyboardType(.decimalPad)
                    TextField("Total cost ($)", text: $totalCost).keyboardType(.decimalPad)
                    TextField("Odometer (mi)", text: $odometer).keyboardType(.numberPad)
                    TextField("Station / vendor (optional)", text: $vendor)
                }
                Button(busy ? "LOGGING…" : "LOG FUEL EXPENSE") { Task { await submit() } }
                    .fontWeight(.bold)
                    .disabled(busy || (gallons.isEmpty && totalCost.isEmpty))
                if let status { Text(status).font(.system(size: 11, design: .monospaced)) }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle("FUEL LOG")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    @MainActor
    private func submit() async {
        busy = true; defer { busy = false }
        guard let client = await ShiftNet.client() else { status = "✗ Set credentials in Settings"; return }
        guard let state = try? await client.requestJSON("GET", "api/dispatch/duty/me") as? [String: Any],
              let vid = (state["vehicle"] as? [String: Any])?["id"] as? Int else {
            status = "✗ No vehicle assigned — start a shift first"
            return
        }
        do {
            _ = try await FuelLogger.log(client: client, vehicleId: vid, gallons: gallons,
                                         totalCost: totalCost, odometer: odometer, vendor: vendor)
            status = "✓ Fuel expense logged to vehicle #\(vid)"
            try? await Task.sleep(for: .seconds(1))
            dismiss()
        } catch {
            status = "✗ \(error.localizedDescription)"
        }
    }
}

enum FuelLogger {
    @discardableResult
    static func log(client: RMPGAPIClient, vehicleId: Int, gallons: String,
                    totalCost: String, odometer: String, vendor: String) async throws -> Any {
        var body: [String: Any] = [
            "fuel_date": ISO8601DateFormatter().string(from: Date()),
            "notes": vendor.isEmpty ? "Logged from iOS field app" : "\(vendor) — iOS field app",
        ]
        if let g = Double(gallons) { body["gallons"] = g }
        if let c = Double(totalCost) { body["total_cost"] = c }
        if let o = Int(odometer) { body["odometer"] = o }
        return try await client.requestJSON("POST", "api/fleet/\(vehicleId)/fuel", body: body)
    }
}
