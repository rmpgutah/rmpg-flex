import Foundation

public struct MRZParser {
    private static let passportMRZPattern = try! NSRegularExpression(
        pattern: "^P<([A-Z]{3})([A-Z]+)<<([A-Z]+).*?\n([A-Z0-9<]{9})(\\d)[A-Z]{3}(\\d{6})(\\d)[MF<](\\d{6})(\\d)[A-Z0-9<]+(\\d{2})$",
        options: [.anchorsMatchLines]
    )

    // TD1 (3-line, 30 chars/line) — used on ID cards / some driver's licenses.
    // Line 1: doc code(2) issuing state(3) doc number(9) check(1) optional(15)
    // Line 2: DOB(6) check(1) sex(1) expiry(6) check(1) nationality(3) optional(11) composite check(1)
    // Line 3: surname<<given names, padded with '<' to 30 chars
    private static let td1Pattern = try! NSRegularExpression(
        pattern: "^[A-Z][A-Z0-9<]<([A-Z]{3})([A-Z0-9<]{9})(\\d)[A-Z0-9<]{15}\\n(\\d{6})(\\d)([MF<])(\\d{6})(\\d)([A-Z]{3})[A-Z0-9<]{11}(\\d)\\n([A-Z<]{30})$",
        options: [.anchorsMatchLines]
    )

    public static func parseMRZ(_ text: String) -> ScannedID? {
        let clean = text.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "\r", with: "")
        let nsString = clean as NSString
        let range = NSRange(location: 0, length: nsString.length)

        if let td1 = parseTD1(clean, nsString: nsString, range: range) { return td1 }

        guard let match = passportMRZPattern.firstMatch(in: clean, options: [], range: range),
              match.numberOfRanges >= 10 else {
            return fallbackParse(text)
        }

        let country = nsString.substring(with: match.range(at: 1))
        let lastNameRaw = nsString.substring(with: match.range(at: 2)).replacingOccurrences(of: "<", with: " ").trimmingCharacters(in: .whitespaces)
        let firstNameRaw = nsString.substring(with: match.range(at: 3)).replacingOccurrences(of: "<", with: " ").trimmingCharacters(in: .whitespaces)
        let passportNumberField = nsString.substring(with: match.range(at: 4))
        let passportNumberCheck = nsString.substring(with: match.range(at: 5))
        let dob = nsString.substring(with: match.range(at: 6))
        let dobCheck = nsString.substring(with: match.range(at: 7))
        let gender = nsString.substring(with: match.range(at: 8))
        let expiry = nsString.substring(with: match.range(at: 9))

        let passportNumber = passportNumberField.replacingOccurrences(of: "<", with: "")

        var nameParts = firstNameRaw.components(separatedBy: " ").filter { !$0.isEmpty }
        let firstName = nameParts.first
        let middleName = nameParts.count > 1 ? nameParts.dropFirst().joined(separator: " ") : nil

        let dobFormatted = formatMRZDate(dob)
        let expFormatted = formatMRZDate(expiry)

        // ICAO 9303 check digits — confirms the MRZ was actually read correctly
        // (rather than an OCR misread that happens to loosely match the pattern).
        let docNumberValid = checkDigit(of: passportNumberField) == Int(passportNumberCheck)
        let dobValid = checkDigit(of: dob) == Int(dobCheck)
        let checksPassed = [docNumberValid, dobValid].filter { $0 }.count
        let confidence: Float = checksPassed == 2 ? 0.95 : (checksPassed == 1 ? 0.75 : 0.5)

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
            confidence: confidence
        )
    }

    private static func parseTD1(_ clean: String, nsString: NSString, range: NSRange) -> ScannedID? {
        guard let match = td1Pattern.firstMatch(in: clean, options: [], range: range),
              match.numberOfRanges >= 10 else { return nil }

        let country = nsString.substring(with: match.range(at: 1))
        let docNumberField = nsString.substring(with: match.range(at: 2))
        let docNumberCheck = nsString.substring(with: match.range(at: 3))
        let dob = nsString.substring(with: match.range(at: 4))
        let dobCheck = nsString.substring(with: match.range(at: 5))
        let sex = nsString.substring(with: match.range(at: 6))
        let expiry = nsString.substring(with: match.range(at: 7))
        let expiryCheck = nsString.substring(with: match.range(at: 8))
        let nameField = nsString.substring(with: match.range(at: 10))

        let nameComponents = nameField.components(separatedBy: "<<")
        let lastName = nameComponents.first?.replacingOccurrences(of: "<", with: " ").trimmingCharacters(in: .whitespaces)
        let firstNameRaw = nameComponents.count > 1
            ? nameComponents[1].replacingOccurrences(of: "<", with: " ").trimmingCharacters(in: .whitespaces)
            : nil
        let firstName = firstNameRaw?.components(separatedBy: " ").first

        let docNumberValid = checkDigit(of: docNumberField) == Int(docNumberCheck)
        let dobValid = checkDigit(of: dob) == Int(dobCheck)
        let expiryValid = checkDigit(of: expiry) == Int(expiryCheck)
        let checksPassed = [docNumberValid, dobValid, expiryValid].filter { $0 }.count
        let confidence: Float = 0.5 + Float(checksPassed) * 0.15

        return ScannedID(
            // TD1 (3-line, 30-char MRZ) is the format US passport cards use.
            // It's technically shared with some national ID cards too, but a
            // printed MRZ almost never appears on a US state driver's license/
            // ID (those carry their data in the PDF417 barcode instead), so
            // "passport card" is the far more accurate default for whatever
            // reaches this specific scan path.
            documentType: .passportCard,
            firstName: firstName?.capitalized,
            lastName: lastName?.capitalized,
            fullName: [firstName, lastName].compactMap { $0?.capitalized }.joined(separator: " "),
            dateOfBirth: formatMRZDate(dob),
            documentNumber: docNumberField.replacingOccurrences(of: "<", with: ""),
            expirationDate: formatMRZDate(expiry),
            issuingState: country,
            gender: sex == "M" ? "M" : (sex == "F" ? "F" : nil),
            nationality: country,
            rawMRZ: clean,
            confidence: confidence
        )
    }

    /// ICAO 9303 Part 3 check-digit algorithm: weights cycle 7,3,1; '0'-'9' = 0-9,
    /// 'A'-'Z' = 10-35, '<' = 0. Sum of (value * weight) mod 10 is the check digit.
    private static func checkDigit(of field: String) -> Int {
        let weights = [7, 3, 1]
        var sum = 0
        for (i, char) in field.enumerated() {
            let value: Int
            if let digit = char.wholeNumberValue, char.isNumber {
                value = digit
            } else if let ascii = char.asciiValue, char.isUppercase {
                value = Int(ascii) - 55 // 'A' (65) -> 10
            } else {
                value = 0 // '<' or unrecognized
            }
            sum += value * weights[i % 3]
        }
        return sum % 10
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
