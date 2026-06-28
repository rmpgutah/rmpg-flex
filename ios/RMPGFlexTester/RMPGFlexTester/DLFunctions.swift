import Foundation

// ============================================================
// DLFunctions — Swift port of the shared DL bridge
// ============================================================
// Mirrors client/src/utils/dlFunctions.ts so the iOS app derives the
// SAME driver's-license intelligence as the desktop. `evaluateDL` is the
// single bridge call: feed it a parsed AAMVA result, get the full derived
// set back. Foundation-only (no UIKit) so it unit-tests standalone.
// ============================================================

struct DLEvaluation {
    var jurisdiction = ""
    var jurisdictionName = ""
    var country = ""
    var dlValid = false
    var age: Int?
    var ageBracket = ""
    var eligibility: [String: Bool] = [:]
    var expiry = ""            // expired | expiring | valid | unknown
    var expiringSoon = false
    var realId = ""
    var documentType = ""
    var badges: [String] = []
    var summary = ""
}

enum DLFunctions {

    // ── reference data ──────────────────────────────────────

    static let jurisdictionNames: [String: String] = [
        "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
        "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia",
        "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
        "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
        "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
        "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
        "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
        "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
        "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
        "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
        "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
        "GU": "Guam", "PR": "Puerto Rico", "VI": "U.S. Virgin Islands", "AS": "American Samoa",
        "AB": "Alberta", "BC": "British Columbia", "MB": "Manitoba", "NB": "New Brunswick",
        "NL": "Newfoundland and Labrador", "NS": "Nova Scotia", "ON": "Ontario",
        "PE": "Prince Edward Island", "QC": "Quebec", "SK": "Saskatchewan",
    ]

    static let caProvinces: Set<String> = ["AB", "BC", "MB", "NB", "NL", "NS", "ON", "PE", "QC", "SK", "NT", "NU", "YT"]

    // Per-jurisdiction DL number format (AAMVA-published subset).
    static let dlFormats: [String: String] = [
        "UT": "^[0-9]{4,10}$", "CA": "^[A-Z][0-9]{7}$", "TX": "^[0-9]{7,8}$",
        "NY": "^[0-9]{9}$", "FL": "^[A-Z][0-9]{12}$", "PA": "^[0-9]{8}$",
        "AZ": "^([A-Z][0-9]{8}|[0-9]{9})$", "CO": "^[0-9]{9}$", "ID": "^([A-Z]{2}[0-9]{6}[A-Z]|[0-9]{9})$",
        "NV": "^[0-9]{9,12}$", "NM": "^[0-9]{8,9}$", "OR": "^[0-9]{1,9}$", "WA": "^[A-Z0-9*]{12}$",
    ]

    private static let sentinel = #"^(none|n/a|na|no|0|\[\]|unknown)$"#

    static func clean(_ v: String?) -> String {
        let s = (v ?? "").trimmingCharacters(in: .whitespaces)
        if s.range(of: sentinel, options: [.regularExpression, .caseInsensitive]) != nil { return "" }
        return s
    }

    // ── jurisdiction ────────────────────────────────────────

    static func normalizeJurisdiction(_ input: String) -> String {
        let s = input.trimmingCharacters(in: .whitespaces)
        if s.isEmpty { return "" }
        let up = s.uppercased()
        if jurisdictionNames[up] != nil { return up }
        for (code, name) in jurisdictionNames where name.uppercased() == up { return code }
        return String(up.prefix(2))
    }

    static func jurisdictionName(_ state: String) -> String {
        jurisdictionNames[normalizeJurisdiction(state)] ?? ""
    }

    static func jurisdictionCountry(_ state: String) -> String {
        let s = normalizeJurisdiction(state)
        if jurisdictionNames[s] == nil { return "" }
        return caProvinces.contains(s) ? "CAN" : "USA"
    }

    static func validateDLNumber(state: String, dl: String) -> Bool {
        let n = dl.replacingOccurrences(of: "[\\s-]", with: "", options: .regularExpression).uppercased()
        guard let pat = dlFormats[normalizeJurisdiction(state)] else { return !n.isEmpty }
        return n.range(of: pat, options: .regularExpression) != nil
    }

    // ── dates / age ─────────────────────────────────────────

    private static func parseISO(_ iso: String) -> DateComponents? {
        let parts = iso.split(separator: "-")
        guard parts.count == 3, let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]) else { return nil }
        var c = DateComponents(); c.year = y; c.month = m; c.day = d
        return c
    }

    static func ageFromDOB(_ dobISO: String, on: Date = Date()) -> Int? {
        guard let dob = parseISO(dobISO) else { return nil }
        let cal = Calendar(identifier: .gregorian)
        let now = cal.dateComponents([.year, .month, .day], from: on)
        guard let ny = now.year, let nm = now.month, let nd = now.day,
              let by = dob.year, let bm = dob.month, let bd = dob.day else { return nil }
        var age = ny - by
        if nm < bm || (nm == bm && nd < bd) { age -= 1 }
        return (age < 0 || age > 130) ? nil : age
    }

    static func ageBracket(_ dobISO: String, on: Date = Date()) -> String {
        guard let a = ageFromDOB(dobISO, on: on) else { return "unknown" }
        switch a {
        case ..<16: return "under 16"
        case 16..<18: return "16-17"
        case 18..<21: return "18-20"
        case 21..<25: return "21-24"
        case 25..<65: return "25-64"
        default: return "65+"
        }
    }

    static func eligibilityFlags(_ dobISO: String, on: Date = Date()) -> [String: Bool] {
        guard let a = ageFromDOB(dobISO, on: on) else { return [:] }
        return [
            "adult": a >= 18, "minor": a < 18, "under21": a < 21,
            "drinking": a >= 21, "voting": a >= 18, "rentCar": a >= 25, "senior": a >= 65,
        ]
    }

    static func expiryStatus(_ expiryISO: String, soonDays: Int = 30, on: Date = Date()) -> String {
        guard let e = parseISO(expiryISO), let ey = e.year, let em = e.month, let ed = e.day else { return "unknown" }
        let cal = Calendar(identifier: .gregorian)
        guard let exp = cal.date(from: DateComponents(year: ey, month: em, day: ed)) else { return "unknown" }
        let today = cal.startOfDay(for: on)
        let days = cal.dateComponents([.day], from: today, to: exp).day ?? 0
        if days < 0 { return "expired" }
        if days <= soonDays { return "expiring" }
        return "valid"
    }

    // ── compliance ──────────────────────────────────────────

    static func realIdStatus(_ fields: [String: String]) -> String {
        switch clean(fields["is_real_id"] ?? fields["DDA"]) {
        case "true", "F": return "REAL ID compliant"
        case "false", "N": return "NOT REAL ID compliant"
        default: return "Unknown"
        }
    }

    // ── bridge ──────────────────────────────────────────────

    /// Single bridge call — desktop's evaluateDl equivalent.
    static func evaluateDL(_ r: AamvaResult, on: Date = Date()) -> DLEvaluation {
        let f = r.fields
        var e = DLEvaluation()
        let state = f["dl_state"] ?? ""
        e.jurisdiction = normalizeJurisdiction(state)
        e.jurisdictionName = jurisdictionName(state)
        e.country = jurisdictionCountry(state).isEmpty ? (f["country"] ?? "") : jurisdictionCountry(state)
        e.dlValid = validateDLNumber(state: state, dl: f["dl_number"] ?? "")
        if let dob = f["date_of_birth"] {
            e.age = ageFromDOB(dob, on: on)
            e.ageBracket = ageBracket(dob, on: on)
            e.eligibility = eligibilityFlags(dob, on: on)
        }
        e.expiry = expiryStatus(f["dl_expiry"] ?? "", on: on)
        e.expiringSoon = e.expiry == "expiring"
        e.realId = realIdStatus(f)
        e.documentType = (f["card_type"] == "ID") ? "Identification Card" : "Driver's License"
        if e.realId == "REAL ID compliant" { e.badges.append("REAL ID") }
        if e.realId == "NOT REAL ID compliant" { e.badges.append("NOT REAL ID") }
        if f["card_type"] == "ID" { e.badges.append("ID CARD ONLY") }
        let name = [f["last_name"], f["first_name"]].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
        e.summary = [name.isEmpty ? "UNKNOWN" : name,
                     f["date_of_birth"].map { "DOB \($0)" },
                     f["dl_number"].map { "OLN \($0) (\(state.isEmpty ? "?" : state))" }]
            .compactMap { $0 }.joined(separator: " · ")
        return e
    }
}
