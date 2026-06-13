import Foundation

// Pure metadata-overlay model + line layout for the evidence photo burn.
// Foundation-only so it unit-tests under SwiftPM; PhotoBurn.swift renders these
// lines into the JPEG with UIKit.
struct BurnFields {
    var timestamp: String
    var officer: String = ""
    var badge: String = ""
    var unit: String = ""
    var gps: String = ""
    var caseRef: String = ""
}

enum PhotoBurnLines {
    /// The bottom-banner lines, in order, for a court-ready evidence stamp.
    static func lines(_ f: BurnFields) -> [String] {
        var out: [String] = [f.timestamp]
        var who = "RMPG"
        if !f.officer.isEmpty { who += " · \(f.officer)" }
        if !f.badge.isEmpty { who += " #\(f.badge)" }
        if !f.unit.isEmpty { who += " · \(f.unit)" }
        out.append(who)
        if !f.gps.isEmpty { out.append("GPS \(f.gps)") }
        if !f.caseRef.isEmpty { out.append(f.caseRef) }
        return out
    }
}
