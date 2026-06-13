import Foundation

// Pure metadata-overlay model + line layout for the evidence photo burn.
// Foundation-only so it unit-tests under SwiftPM; PhotoBurn.swift renders these
// lines into the JPEG with UIKit. v2 adds the security fields (classification,
// exhibit sequence, SHA-256 fingerprint, device id) — all default-empty so the
// original stamps are byte-for-byte unchanged when they're not supplied.
struct BurnFields {
    var timestamp: String
    var officer: String = ""
    var badge: String = ""
    var unit: String = ""
    var gps: String = ""
    var caseRef: String = ""
    // ── v2 security fields ──
    var classification: String = ""   // e.g. "LAW ENFORCEMENT SENSITIVE"
    var sequence: String = ""         // exhibit/capture sequence, e.g. "003"
    var sha256: String = ""           // short content fingerprint (hex)
    var deviceId: String = ""         // short vendor device id
}

enum PhotoBurnLines {
    /// The bottom-banner lines, in order, for a court-ready evidence stamp.
    static func lines(_ f: BurnFields) -> [String] {
        var out: [String] = []
        if !f.classification.isEmpty { out.append(f.classification) }
        out.append(f.timestamp)
        var who = "RMPG"
        if !f.officer.isEmpty { who += " · \(f.officer)" }
        if !f.badge.isEmpty { who += " #\(f.badge)" }
        if !f.unit.isEmpty { who += " · \(f.unit)" }
        out.append(who)
        if !f.gps.isEmpty { out.append("GPS \(f.gps)") }
        let caseExhibit = [f.caseRef.isEmpty ? nil : f.caseRef,
                           f.sequence.isEmpty ? nil : "EXH \(f.sequence)"]
            .compactMap { $0 }.joined(separator: " · ")
        if !caseExhibit.isEmpty { out.append(caseExhibit) }
        let integrity = [f.sha256.isEmpty ? nil : "SHA256 \(f.sha256)",
                         f.deviceId.isEmpty ? nil : "DEV \(f.deviceId)"]
            .compactMap { $0 }.joined(separator: " · ")
        if !integrity.isEmpty { out.append(integrity) }
        return out
    }
}
