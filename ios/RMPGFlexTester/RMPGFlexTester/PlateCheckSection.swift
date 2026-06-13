import SwiftUI
import AudioToolbox

// Run-plate panel for the scan flow: one tap fans out to the RECORDS
// vehicle checks (registered owner lookup, local stolen flag + BOLO match)
// plus the intel cross-hit screen, and can link the vehicle to the scanned
// subject through the same from-dl-scan endpoint the desktop uses.
// Local-records honesty: a CLEAR here is never a live NCIC clear.
struct PlateCheckSection: View {
    /// Scan fields of the current subject — enables LINK VEHICLE TO SUBJECT.
    var scanFields: [String: String] = [:]

    @State private var plate = ""
    @State private var busy = false
    @State private var lines: [(String, Bool)] = []   // (text, hot)
    @State private var linkStatus: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("RUN PLATE — RECORDS / BOLO / STOLEN")
                .font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.gold)
            HStack(spacing: 6) {
                TextField("Plate", text: $plate)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                    .padding(6).background(Theme.sunken)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                Button(busy ? "…" : "RUN") { Task { await run() } }
                    .font(.system(size: 12, weight: .semibold))
                    .padding(.horizontal, 14).padding(.vertical, 7)
                    .background(Theme.gold).foregroundStyle(.black)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    .disabled(busy || plate.trimmingCharacters(in: .whitespaces).count < 2)
            }
            ForEach(Array(lines.enumerated()), id: \.offset) { _, l in
                Text(l.0)
                    .font(.system(size: 11, weight: l.1 ? .bold : .regular, design: .monospaced))
                    .foregroundStyle(l.1 ? .black : .white)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(l.1 ? 6 : 0)
                    .background(l.1 ? Theme.red : .clear)
            }
            if !lines.isEmpty, !scanFields.isEmpty {
                Button("LINK VEHICLE TO SUBJECT") { Task { await link() } }
                    .font(.system(size: 11, weight: .semibold))
                    .frame(maxWidth: .infinity).padding(.vertical, 6)
                    .background(Theme.raised).foregroundStyle(Theme.gold)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    .disabled(busy)
            }
            if let linkStatus {
                Text(linkStatus).font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(linkStatus.hasPrefix("✓") ? Theme.gold : Theme.red)
            }
        }
        .padding(8).background(Theme.raised)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }

    private var cleanPlate: String {
        plate.trimmingCharacters(in: .whitespaces).uppercased()
    }

    @MainActor
    private func run() async {
        busy = true; defer { busy = false }
        lines = []; linkStatus = nil
        guard let client = await ShiftNet.client(), client.jwt != nil else {
            lines = [("✗ Not logged in — set RMPG credentials in Settings", false)]; return
        }
        let p = cleanPlate
        let q = p.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? p

        async let lookupReq = try? client.requestJSON("GET", "api/records/vehicles/plate-lookup?plate=\(q)")
        async let stolenReq = try? client.requestJSON("POST", "api/records/vehicles/stolen-check", body: ["plate": p])
        async let screenReq = try? client.requestJSON("POST", "api/intel/screen",
                                                      body: ["entity_type": "vehicle", "plate": p])
        let (lookup, stolen, screen) = await (lookupReq, stolenReq, screenReq)

        var out: [(String, Bool)] = []
        if let s = stolen as? [String: Any] {
            let isStolen = s["stolen"] as? Bool ?? false
            let checked = s["checked"] as? Bool ?? false
            let msg = s["message"] as? String ?? ""
            if isStolen { AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate)) }
            out.append(("\(isStolen ? "⚠ " : checked ? "" : "✗ ")\(msg)", isStolen))
        } else {
            out.append(("✗ Stolen check failed — treat as UNVERIFIED, not clear", false))
        }
        if let v = lookup as? [String: Any] {
            let desc = [v["year"], v["color"], v["make"], v["model"]]
                .compactMap { $0.flatMap { "\($0)" } }.filter { !$0.isEmpty && $0 != "<null>" }
                .joined(separator: " ")
            let owner = [v["first_name"] as? String, v["last_name"] as? String]
                .compactMap { $0 }.joined(separator: " ")
            out.append(("REG: \(desc.isEmpty ? "on file" : desc)\(owner.isEmpty ? "" : " — RO \(owner)")", false))
        } else {
            out.append(("No local registration record", false))
        }
        for hit in (screen as? [String: Any])?["hits"] as? [[String: Any]] ?? [] {
            let sev = hit["severity"] as? String ?? "info"
            out.append(("\(sev == "critical" ? "⚠" : "ℹ") \(hit["detail"] as? String ?? "intel hit")", sev == "critical"))
        }
        lines = out
    }

    @MainActor
    private func link() async {
        busy = true; defer { busy = false }
        guard let client = await ShiftNet.client(), client.jwt != nil else {
            linkStatus = "✗ Not logged in"; return
        }
        do {
            let res = try await client.requestJSON("POST", "api/records/from-dl-scan", body: [
                "scan": scanFields,
                "vehicle": ["plate_number": cleanPlate],
                "create_property": false,
            ]) as? [String: Any]
            if let v = res?["vehicle"] as? [String: Any], let id = v["id"] {
                linkStatus = "✓ Vehicle #\(id) \((res?["vehicle_created"] as? Bool) == true ? "created" : "found") and linked to subject"
            } else {
                linkStatus = "✓ Submitted (no vehicle returned)"
            }
        } catch {
            linkStatus = "✗ Link failed: \(error.localizedDescription)"
        }
    }
}
