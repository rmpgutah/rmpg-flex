import Foundation

/// Minimal AAMVA PDF417 DL barcode parser (Swift port of the web aamvaParser.ts subset).
/// Parses element IDs per the AAMVA DL/ID standard (versions 2–10, US/Canada).
public struct AamvaResult: Sendable, Equatable {
    public let raw: String
    public let elements: [String: String]

    public var firstName: String   { elements["DAC"] ?? "" }
    public var lastName: String    { elements["DCS"] ?? "" }
    public var middleName: String? { elements["DAD"]?.nonEmpty }
    public var suffix: String?     { elements["DCU"]?.nonEmpty }

    public var dobRaw: String?     { elements["DBB"]?.nonEmpty }
    public var dob: String?        { dobRaw.flatMap(AamvaParser.parseDate) }

    public var expiryRaw: String?  { elements["DBA"]?.nonEmpty }
    public var dlExpiry: String?   { expiryRaw.flatMap(AamvaParser.parseDate) }

    public var issueDateRaw: String? { elements["DBD"]?.nonEmpty }
    public var dlIssueDate: String?  { issueDateRaw.flatMap(AamvaParser.parseDate) }

    public var dlNumber: String?   { elements["DAQ"]?.nonEmpty }
    public var dlState: String?    { elements["DAJ"]?.nonEmpty }
    public var dlClass: String?    { elements["DCA"]?.nonEmpty }
    public var dlRestrictions: String? { elements["DCB"]?.nonEmpty }
    public var dlEndorsements: String? { elements["DCD"]?.nonEmpty }

    public var address: String?    { elements["DAG"]?.nonEmpty }
    public var city: String?       { elements["DAI"]?.nonEmpty }
    public var state: String?      { elements["DAJ"]?.nonEmpty }
    public var zip: String?        { elements["DAK"].flatMap { String($0.prefix(5)).nonEmpty } }

    public var heightRaw: String?  { elements["DAU"]?.nonEmpty }
    public var weightRaw: String?  { elements["DAW"]?.nonEmpty }
    public var eyeColor: String?   { elements["DAY"]?.nonEmpty }
    public var hairColor: String?  { elements["DAZ"]?.nonEmpty }

    public var genderCode: String? { elements["DBC"]?.nonEmpty }
    public var gender: String? {
        switch genderCode {
        case "1": return "Male"
        case "2": return "Female"
        default:  return nil
        }
    }

    public var isExpired: Bool {
        guard let exp = dlExpiry else { return false }
        return exp < isoToday()
    }

    private func isoToday() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }
}

public enum AamvaParser {
    /// Parse a raw PDF417 barcode string into an `AamvaResult`.
    public static func parse(_ raw: String) -> AamvaResult? {
        guard raw.contains("ANSI") || raw.contains("AAMVA") || raw.contains("DL\n") else { return nil }
        var elements: [String: String] = [:]
        let lines = raw.components(separatedBy: .newlines)
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.count >= 4 else { continue }
            // Skip header lines and subfile delimiters
            let prefix = String(trimmed.prefix(1))
            if prefix == "@" || prefix == "\u{1e}" { continue }
            if trimmed.hasPrefix("ANSI") || trimmed.hasPrefix("DL") || trimmed.hasPrefix("ID") { continue }
            let code = String(trimmed.prefix(3))
            // Validate: element IDs are [A-Z][A-Z0-9]{2}
            let validChars = CharacterSet.uppercaseLetters.union(.decimalDigits)
            guard code.unicodeScalars.allSatisfy({ validChars.contains($0) }) else { continue }
            let value = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty { elements[code] = value }
        }
        guard !elements.isEmpty else { return nil }
        return AamvaResult(raw: raw, elements: elements)
    }

    /// Parse AAMVA date (MMDDYYYY or CCYYMMDD) → ISO "YYYY-MM-DD".
    public static func parseDate(_ s: String) -> String? {
        let d = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard d.count == 8, d.allSatisfy(\.isNumber) else { return nil }
        let a = String(d.prefix(2)), b = String(d.dropFirst(2).prefix(2)), c = String(d.suffix(4))
        let mm = Int(a) ?? 0, dd = Int(b) ?? 0, yyyy = Int(c) ?? 0
        // MMDDYYYY: month 1-12
        if mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && yyyy >= 1900 {
            return String(format: "%04d-%02d-%02d", yyyy, mm, dd)
        }
        // CCYYMMDD fallback
        let ccyy = Int(String(d.prefix(4))) ?? 0
        let m2 = Int(String(d.dropFirst(4).prefix(2))) ?? 0
        let d2 = Int(String(d.suffix(2))) ?? 0
        if ccyy >= 1900 && m2 >= 1 && m2 <= 12 && d2 >= 1 && d2 <= 31 {
            return String(format: "%04d-%02d-%02d", ccyy, m2, d2)
        }
        return nil
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
