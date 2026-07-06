import Foundation

/// Parses the raw payload of the PDF417 barcode printed on the back of US/Canadian
/// driver's licenses and state IDs, per the AAMVA DL/ID Card Design Standard.
/// This is a public specification (not derived from any third-party source code) —
/// the barcode encodes structured `DXX<value>` element records, which is far more
/// reliable than OCR-guessing the printed text.
public struct AAMVAParser {
    /// Maps AAMVA element IDs to a setter on the in-progress `ScannedID`.
    private static let elementHandlers: [String: @Sendable (inout ScannedID, String) -> Void] = [
        "DAC": { $0.firstName = $1.capitalized },
        "DAD": { $0.middleName = $1.isEmpty || $1 == "NONE" ? nil : $1.capitalized },
        "DCS": { $0.lastName = $1.capitalized },
        "DBB": { $0.dateOfBirth = formatAAMVADate($1) },
        "DBA": { $0.expirationDate = formatAAMVADate($1) },
        "DBD": { $0.issueDate = formatAAMVADate($1) },
        "DAG": { $0.address = $1.capitalized },
        "DAI": { $0.city = $1.capitalized },
        "DAJ": { $0.state = $1; $0.issuingState = $1 },
        "DAK": { $0.zipCode = String($1.prefix(5)) },
        "DAQ": { $0.documentNumber = $1 },
        "DBC": { $0.gender = $1 == "1" ? "M" : ($1 == "2" ? "F" : nil) },
        "DAU": { $0.height = $1 },
        "DAY": { $0.eyeColor = $1.capitalized },
        "DAZ": { $0.hairColor = $1.capitalized },
        "DAW": { $0.weight = $1 + " lbs" },
        "DAX": { id, value in if id.weight == nil { id.weight = value + " kg" } },
        "DAH": { id, value in
            // Second address line — append rather than overwrite DAG.
            guard !value.isEmpty, value != "NONE" else { return }
            id.address = [id.address, value.capitalized].compactMap { $0 }.joined(separator: ", ")
        },
        "DDK": { $0.organDonor = $1 == "1" },
        "DDL": { $0.veteran = $1 == "1" },
        "DAA": { id, value in
            // Older single-field full-name element ("LAST,FIRST,MIDDLE").
            let parts = value.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            if id.lastName == nil, let last = parts.first { id.lastName = last.capitalized }
            if id.firstName == nil, parts.count > 1 { id.firstName = parts[1].capitalized }
        },
    ]

    /// The AAMVA subfile body always begins with a real element record right
    /// after the "DL"/"ID" designator — used to disambiguate the designator
    /// from any incidental "DL"/"ID" substring earlier in the header/IIN.
    private static let knownFieldCodes = [
        "DAQ", "DCS", "DAC", "DAD", "DBA", "DBB", "DBC", "DBD",
        "DAG", "DAI", "DAJ", "DAK", "DAA", "DAU", "DAY", "DAZ",
        "DAW", "DAX", "DAH", "DDK", "DDL",
    ]

    /// Returns nil if `payload` doesn't look like an AAMVA DL/ID barcode.
    public static func parse(_ payload: String) -> ScannedID? {
        // Real scans/readers vary in how faithfully they preserve the header
        // and subfile-designator table byte-for-byte, so — like every
        // practical AAMVA reader — we locate the "DL" or "ID" subfile marker
        // and then walk its element records by line, rather than trusting
        // exact byte offsets from the header.
        guard payload.contains("ANSI ") || payload.hasPrefix("@") else { return nil }

        let normalized = payload.replacingOccurrences(of: "\r\n", with: "\n")
        guard let subfileRange = findSubfileBoundary(in: normalized) else { return nil }

        let body = String(normalized[subfileRange...])
        let lines = body.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { $0.count >= 3 }

        var id = ScannedID(documentType: .driversLicense, rawText: lines)
        var fieldsFound = 0

        for line in lines {
            let code = String(line.prefix(3))
            let value = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
            guard !value.isEmpty, let handler = elementHandlers[code] else { continue }
            handler(&id, value)
            fieldsFound += 1
        }

        guard fieldsFound > 0 else { return nil }

        id.fullName = [id.firstName, id.middleName, id.lastName].compactMap { $0 }.joined(separator: " ")
        // Structured barcode data is authoritative — much higher confidence than OCR.
        id.confidence = min(1.0, 0.6 + Float(fieldsFound) * 0.04)
        return id
    }

    /// Finds where the "DL"/"ID" subfile designator's element records actually
    /// start, by requiring a known field code (e.g. "DAQ") immediately after
    /// it — this rejects a stray "DL"/"ID" substring that happens to appear
    /// earlier in the IIN/header bytes, which a plain substring search would
    /// have matched incorrectly and thrown off every field's line offsets.
    private static func findSubfileBoundary(in text: String) -> String.Index? {
        for designator in ["DL", "ID"] {
            var searchRange = text.startIndex..<text.endIndex
            while let range = text.range(of: designator, options: [], range: searchRange) {
                let rest = text[range.upperBound...]
                if knownFieldCodes.contains(where: { rest.hasPrefix($0) }) {
                    return range.upperBound
                }
                searchRange = range.upperBound..<text.endIndex
            }
        }
        return nil
    }

    /// AAMVA dates are MMDDCCYY.
    private static func formatAAMVADate(_ raw: String) -> String? {
        guard raw.count == 8,
              let month = Int(raw.prefix(2)),
              let day = Int(raw.dropFirst(2).prefix(2)),
              let year = Int(raw.suffix(4)) else { return nil }
        return String(format: "%04d-%02d-%02d", year, month, day)
    }
}
