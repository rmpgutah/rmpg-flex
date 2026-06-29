import Foundation

public struct MRZParser {
    private static let passportMRZPattern = try! NSRegularExpression(
        pattern: "^P<([A-Z]{3})([A-Z]+)<<([A-Z]+).*?\n([A-Z0-9<]{9})(\\d)[A-Z]{3}(\\d{6})(\\d)[MF<](\\d{6})(\\d)[A-Z0-9<]+(\\d{2})$",
        options: [.anchorsMatchLines]
    )

    public static func parseMRZ(_ text: String) -> ScannedID? {
        let clean = text.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "\r", with: "")
        let nsString = clean as NSString
        let range = NSRange(location: 0, length: nsString.length)

        guard let match = passportMRZPattern.firstMatch(in: clean, options: [], range: range),
              match.numberOfRanges >= 10 else {
            return fallbackParse(text)
        }

        let country = nsString.substring(with: match.range(at: 1))
        let lastNameRaw = nsString.substring(with: match.range(at: 2)).replacingOccurrences(of: "<", with: " ").trimmingCharacters(in: .whitespaces)
        let firstNameRaw = nsString.substring(with: match.range(at: 3)).replacingOccurrences(of: "<", with: " ").trimmingCharacters(in: .whitespaces)
        let passportNumber = nsString.substring(with: match.range(at: 4)).replacingOccurrences(of: "<", with: "")
        let dob = nsString.substring(with: match.range(at: 6))
        let gender = nsString.substring(with: match.range(at: 8))
        let expiry = nsString.substring(with: match.range(at: 9))

        var nameParts = firstNameRaw.components(separatedBy: " ").filter { !$0.isEmpty }
        let firstName = nameParts.first
        let middleName = nameParts.count > 1 ? nameParts.dropFirst().joined(separator: " ") : nil

        let dobFormatted = formatMRZDate(dob)
        let expFormatted = formatMRZDate(expiry)

        return ScannedID(
            documentType: .passport,
            firstName: firstName?.capitalized,
            lastName: lastNameRaw.capitalized,
            middleName: middleName?.capitalized,
            fullName: [firstName, middleName, lastNameRaw].compactMap { $0?.capitalized }.joined(separator: " "),
            dateOfBirth: dobFormatted,
            documentNumber: passportNumber,
            expirationDate: expFormatted,
            gender: gender == "M" ? "M" : "F",
            nationality: country,
            passportNumber: passportNumber,
            rawMRZ: text,
            confidence: 0.9
        )
    }

    private static func formatMRZDate(_ mrz: String) -> String? {
        guard mrz.count == 6,
              let y = Int(mrz.prefix(2)),
              let m = Int(mrz.dropFirst(2).prefix(2)),
              let d = Int(mrz.suffix(2)) else { return nil }
        let year = y > 50 ? 1900 + y : 2000 + y
        return String(format: "%04d-%02d-%02d", year, m, d)
    }

    private static func fallbackParse(_ text: String) -> ScannedID? {
        guard text.uppercased().contains("P<") || text.uppercased().contains("PASSPORT") else { return nil }

        let lines = text.components(separatedBy: .newlines).filter { $0.count > 10 }
        for line in lines where line.hasPrefix("P<") {
            let parts = line.components(separatedBy: "<<").filter { !$0.isEmpty }
            if parts.count >= 2 {
                let nameParts = parts.dropFirst().joined(separator: "<").components(separatedBy: "<").filter { !$0.isEmpty }
                return ScannedID(
                    documentType: .passport,
                    firstName: nameParts.count > 1 ? nameParts.dropFirst().joined(separator: " ").capitalized : nil,
                    lastName: nameParts.first?.capitalized,
                    rawMRZ: text,
                    confidence: 0.5
                )
            }
        }
        return nil
    }

    public static func looksLikePassport(_ text: String) -> Bool {
        text.contains("P<") || text.contains("PASSPORT") || text.contains("UNITED STATES DEPARTMENT OF STATE")
    }

    public static func looksLikeDL(_ text: String) -> Bool {
        text.uppercased().contains("DRIVER LICENSE") || text.uppercased().contains("DRIVER'S LICENSE") ||
        text.uppercased().contains("OPERATOR LICENSE") || text.uppercased().contains("IDENTIFICATION CARD")
    }
}
