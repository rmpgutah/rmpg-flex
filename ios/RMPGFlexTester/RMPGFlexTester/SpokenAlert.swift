import Foundation

/// Pure helpers that turn a CAD call dict into an eyes-free spoken phrase and
/// decide whether it's worth speaking. Kept Foundation-only so it unit-tests in
/// the SwiftPM harness; the AVSpeechSynthesizer wrapper lives in SpeechAnnouncer.
enum SpokenAlert {
    /// "New Priority 1. Disturbance. Weapons involved. 1450 South State Street."
    static func phrase(for call: [String: Any]) -> String {
        var parts: [String] = []
        if let p = priorityNumber(call) { parts.append("New Priority \(p).") }
        else { parts.append("New call.") }
        if let t = callType(call) { parts.append("\(t).") }
        for hz in hazardPhrases(call) { parts.append("\(hz).") }
        if let addr = address(call) { parts.append("\(spokenAddress(addr)).") }
        return parts.joined(separator: " ")
    }

    /// Speak only for Priority-1 or hazard-bearing calls, and only once per id.
    static func shouldSpeak(callId: Int, isP1: Bool, hasHazards: Bool, lastSpokenId: Int?) -> Bool {
        guard callId != lastSpokenId else { return false }
        return isP1 || hasHazards
    }

    static func priorityNumber(_ call: [String: Any]) -> Int? {
        if let i = call["priority"] as? Int { return i }
        if let s = call["priority"] as? String {
            let digits = s.filter(\.isNumber)
            return digits.isEmpty ? nil : Int(digits)
        }
        return nil
    }

    static func callType(_ call: [String: Any]) -> String? {
        guard let raw = (call["incident_type"] as? String) ?? (call["call_type"] as? String),
              !raw.isEmpty else { return nil }
        return raw.replacingOccurrences(of: "_", with: " ").capitalized
    }

    static func address(_ call: [String: Any]) -> String? {
        (call["location_address"] as? String) ?? (call["address"] as? String)
    }

    /// Expand common street abbreviations so TTS reads naturally.
    static func spokenAddress(_ raw: String) -> String {
        let map: [String: String] = [
            "N": "North", "S": "South", "E": "East", "W": "West",
            "NE": "Northeast", "NW": "Northwest", "SE": "Southeast", "SW": "Southwest",
            "St": "Street", "Ave": "Avenue", "Blvd": "Boulevard", "Dr": "Drive",
            "Ln": "Lane", "Rd": "Road", "Ct": "Court", "Pl": "Place",
            "Hwy": "Highway", "Cir": "Circle",
        ]
        return raw.split(separator: " ").map { token -> String in
            let cleaned = token.trimmingCharacters(in: CharacterSet(charactersIn: ".,"))
            return map[cleaned] ?? map[cleaned.capitalized] ?? String(token)
        }.joined(separator: " ")
    }

    private static let hazardFlags: [(key: String, phrase: String)] = [
        ("officer_safety_caution", "Officer safety caution"),
        ("weapons_involved", "Weapons involved"),
        ("felony_in_progress", "Felony in progress"),
        ("domestic_violence", "Domestic violence"),
        ("injuries_reported", "Injuries reported"),
        ("mental_health_crisis", "Mental health crisis"),
        ("drugs_involved", "Drugs involved"),
        ("alcohol_involved", "Alcohol involved"),
        ("juvenile_involved", "Juvenile involved"),
    ]

    static func hazardPhrases(_ call: [String: Any]) -> [String] {
        hazardFlags.compactMap { isTruthy(call[$0.key]) ? $0.phrase : nil }
    }

    static func isTruthy(_ v: Any?) -> Bool {
        if let i = v as? Int { return i != 0 }
        if let b = v as? Bool { return b }
        if let s = v as? String { return s == "1" || s.lowercased() == "true" }
        return false
    }
}
