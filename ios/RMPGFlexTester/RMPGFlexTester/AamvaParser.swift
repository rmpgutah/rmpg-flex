import Foundation

// Minimal AAMVA DL/ID barcode parser — Swift port of the field subset the
// desktop relay consumes (client/src/utils/aamvaParser.ts). The full raw
// string is always relayed too, so the desktop can re-run its richer parser.
struct AamvaResult {
    var fields: [String: String] = [:]   // snake_case keys matching the web contract
    var raw: String = ""

    var displayName: String {
        [fields["first_name"], fields["last_name"]].compactMap { $0 }
            .filter { !$0.isEmpty }.joined(separator: " ")
    }
}

enum AamvaParser {
    static func looksLikeAamva(_ raw: String) -> Bool {
        raw.contains("ANSI ") || raw.contains("AAMVA") ||
            (raw.hasPrefix("@") && raw.contains("DL")) || raw.contains("DAQ")
    }

    private static let sexMap = ["1": "Male", "2": "Female", "9": "X",
                                 "M": "Male", "F": "Female", "X": "X"]
    private static let eyeMap = ["BLK": "Black", "BLU": "Blue", "BRO": "Brown",
                                 "BRN": "Brown", "GRY": "Gray", "GRN": "Green",
                                 "HAZ": "Hazel", "MAR": "Maroon", "UNK": "Unknown"]
    private static let hairMap = ["BAL": "Bald", "BLK": "Black", "BLN": "Blond",
                                  "BRO": "Brown", "BRN": "Brown", "GRY": "Gray",
                                  "RED": "Red", "SDY": "Sandy", "WHI": "White"]

    static func parse(_ raw: String) -> AamvaResult {
        var elements: [String: String] = [:]
        // Elements are newline-separated; each line is a 3-char id + value.
        for line in raw.split(whereSeparator: { $0 == "\n" || $0 == "\r" }) {
            let s = String(line).trimmingCharacters(in: .whitespaces)
            guard s.count >= 3 else { continue }
            // The first data line often arrives glued to the subfile header,
            // e.g. "DLDAQ123456789" — strip the leading DL/ID designator. The
            // ANSI header line may carry it too ("...DL00410278ZU...DLDAQ…"),
            // so also split on a late "DLD"/"IDD" occurrence in header lines.
            var body = s
            if s.hasPrefix("@") || s.contains("ANSI ") {
                if let r = s.range(of: "DLD", options: .backwards) ?? s.range(of: "IDD", options: .backwards) {
                    body = String(s[s.index(r.lowerBound, offsetBy: 2)...])
                } else { continue }
            } else if (body.hasPrefix("DLD") || body.hasPrefix("IDD") ||
                       body.hasPrefix("DLZ") || body.hasPrefix("IDZ")), body.count >= 5 {
                body = String(body.dropFirst(2))
            }
            let id = String(body.prefix(3))
            let value = String(body.dropFirst(3))
            guard id.allSatisfy({ $0.isUppercase || $0.isNumber }) else { continue }
            elements[id] = value.trimmingCharacters(in: .whitespaces)
        }

        var r = AamvaResult()
        r.raw = raw
        func put(_ key: String, _ value: String?) {
            if let v = value, !v.isEmpty { r.fields[key] = v }
        }
        put("first_name", elements["DAC"] ?? elements["DCT"])
        put("middle_name", elements["DAD"])
        put("last_name", elements["DCS"])
        put("suffix", elements["DCU"])
        put("date_of_birth", date(elements["DBB"]))
        put("gender", elements["DBC"].flatMap { sexMap[$0] })
        put("height", height(elements["DAU"]))
        put("weight", elements["DAW"])
        put("eye_color", elements["DAY"].flatMap { eyeMap[$0] } ?? elements["DAY"])
        put("hair_color", elements["DAZ"].flatMap { hairMap[$0] } ?? elements["DAZ"])
        put("address", elements["DAG"])
        put("address2", elements["DAH"])
        put("city", elements["DAI"])
        put("state", elements["DAJ"])
        put("zip", zip(elements["DAK"]))
        put("dl_number", elements["DAQ"])
        put("dl_state", elements["DAJ"])
        put("dl_class", elements["DCA"])
        put("dl_expiry", date(elements["DBA"]))
        put("dl_issue_date", date(elements["DBD"]))
        put("dl_restrictions", elements["DCB"])
        put("dl_endorsements", elements["DCD"])
        put("document_discriminator", elements["DCF"])
        return r
    }

    /// AAMVA US dates are MMDDCCYY; some Canadian issuers use CCYYMMDD.
    private static func date(_ v: String?) -> String? {
        guard let v, v.count == 8, v.allSatisfy(\.isNumber) else { return v }
        let mm = String(v.prefix(2))
        if let m = Int(mm), m >= 1, m <= 12 {
            return "\(v.suffix(4))-\(mm)-\(v.dropFirst(2).prefix(2))"
        }
        return "\(v.prefix(4))-\(v.dropFirst(4).prefix(2))-\(v.suffix(2))"
    }

    /// DAU arrives as "070 in" or "070 IN" (total inches) or "178 cm".
    private static func height(_ v: String?) -> String? {
        guard let v else { return nil }
        let upper = v.uppercased()
        if upper.contains("IN"), let inches = Int(upper.replacingOccurrences(of: "IN", with: "")
            .trimmingCharacters(in: .whitespaces)) {
            return "\(inches / 12)'\(inches % 12)\""
        }
        return v
    }

    private static func zip(_ v: String?) -> String? {
        guard let v else { return nil }
        let digits = v.filter(\.isNumber)
        let plus4 = String(digits.dropFirst(5).prefix(4))
        if digits.count >= 9, plus4 != "0000" { return "\(digits.prefix(5))-\(plus4)" }
        return String(digits.prefix(5))
    }

    /// Officer-safety quick checks shown on-phone (the desktop runs the full set).
    static func alerts(_ r: AamvaResult, now: Date = Date()) -> [String] {
        var out: [String] = []
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        if let exp = r.fields["dl_expiry"], let d = df.date(from: exp), d < now {
            out.append("LICENSE EXPIRED \(exp)")
        }
        if let dob = r.fields["date_of_birth"], let d = df.date(from: dob) {
            let age = Calendar.current.dateComponents([.year], from: d, to: now).year ?? 99
            if age < 21 { out.append("UNDER 21 — age \(age)") }
        }
        return out
    }
}
