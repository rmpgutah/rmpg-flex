import Foundation

public struct MrzResult: Sendable, Equatable {
    public let documentType: String
    public let documentNumber: String
    public let firstName: String
    public let lastName: String
    public let nationality: String
    public let dateOfBirth: String
    public let sex: String
    public let expirationDate: String
    public let optionalData: String
    public var raw: String

    public var fullName: String { "\(firstName) \(lastName)" }

    public var isExpired: Bool {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyMMdd"
        guard let expDate = formatter.date(from: expirationDate) else { return false }
        return expDate < Date()
    }
}

public enum MrzParser {
    public static func parse(_ raw: String) -> MrzResult? {
        let lines = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: .newlines)
            .filter { !$0.isEmpty }
        guard lines.count >= 2 else { return nil }
        let top = lines[0]
        let bottom = lines[1]

        if top.hasPrefix("P<") || top.hasPrefix("P") {
            return parseTD3(top: top, bottom: bottom, raw: raw)
        } else if top.hasPrefix("I<") || top.hasPrefix("I") {
            return parseTD1(top: top, bottom: bottom, raw: raw)
        }
        return nil
    }

    private static func parseTD3(top: String, bottom: String, raw: String) -> MrzResult? {
        guard top.count >= 44, bottom.count >= 44 else { return nil }
        let documentType = String(top.prefix(1))
        let issuingState = String(top[top.index(top.startIndex, offsetBy: 2)..<top.index(top.startIndex, offsetBy: 5)])
            .trimmingCharacters(in: .whitespaces)
        let lastName = String(top[top.index(top.startIndex, offsetBy: 5)...])
            .components(separatedBy: "<<").first?
            .replacingOccurrences(of: "<", with: " ") ?? ""
        let firstName = top.components(separatedBy: "<<").dropFirst().first?
            .replacingOccurrences(of: "<", with: " ")
            .trimmingCharacters(in: .whitespaces) ?? ""
        let docNumber = String(bottom.prefix(9)).replacingOccurrences(of: "<", with: "")
        let nationality = String(bottom[bottom.index(bottom.startIndex, offsetBy: 10)..<bottom.index(bottom.startIndex, offsetBy: 13)])
            .trimmingCharacters(in: .whitespaces)
        let dob = String(bottom[bottom.index(bottom.startIndex, offsetBy: 13)..<bottom.index(bottom.startIndex, offsetBy: 19)])
        let sex = String(bottom[bottom.index(bottom.startIndex, offsetBy: 20)]).trimmingCharacters(in: .whitespaces)
        let exp = String(bottom[bottom.index(bottom.startIndex, offsetBy: 21)..<bottom.index(bottom.startIndex, offsetBy: 27)])
        let optional = String(bottom[bottom.index(bottom.startIndex, offsetBy: 28)...])
            .replacingOccurrences(of: "<", with: " ")
            .trimmingCharacters(in: .whitespaces)
        return MrzResult(
            documentType: documentType,
            documentNumber: docNumber,
            firstName: firstName,
            lastName: lastName,
            nationality: nationality,
            dateOfBirth: dob,
            sex: sex.isEmpty ? "X" : sex,
            expirationDate: exp,
            optionalData: optional,
            raw: raw
        )
    }

    private static func parseTD1(top: String, bottom: String, raw: String) -> MrzResult? {
        guard top.count >= 30, bottom.count >= 30 else { return nil }
        let documentType = String(top.prefix(1)).trimmingCharacters(in: .whitespaces)
        let docNumber = String(top[top.index(top.startIndex, offsetBy: 5)..<top.index(top.startIndex, offsetBy: 14)])
            .replacingOccurrences(of: "<", with: "")
        let dob = String(top[top.index(top.startIndex, offsetBy: 15)..<top.index(top.startIndex, offsetBy: 21)])
        let sex = String(top[top.index(top.startIndex, offsetBy: 22)]).trimmingCharacters(in: .whitespaces)
        let exp = String(top[top.index(top.startIndex, offsetBy: 23)..<top.index(top.startIndex, offsetBy: 29)])
        let nationality = String(top[top.index(top.startIndex, offsetBy: 10)..<top.index(top.startIndex, offsetBy: 13)])
            .trimmingCharacters(in: .whitespaces)
        let optional = String(top[top.index(top.startIndex, offsetBy: 29)...])
            .replacingOccurrences(of: "<", with: " ")
            .trimmingCharacters(in: .whitespaces)
        let names = bottom.replacingOccurrences(of: "<", with: " ").trimmingCharacters(in: .whitespaces)
            .components(separatedBy: "  ")
        let lastName = names.first ?? ""
        let firstName = names.dropFirst().first ?? ""
        return MrzResult(
            documentType: documentType,
            documentNumber: docNumber,
            firstName: firstName,
            lastName: lastName,
            nationality: nationality,
            dateOfBirth: dob,
            sex: sex.isEmpty ? "X" : sex,
            expirationDate: exp,
            optionalData: optional,
            raw: raw
        )
    }

    public static func validateCheckDigit(_ value: String) -> Bool {
        guard value.count >= 1 else { return false }
        let checkChar = value.last!
        let data = String(value.dropLast())
        var sum = 0
        for (i, char) in data.enumerated() {
            guard let val = mrzValue(char) else { return false }
            let weight = [7, 3, 1][i % 3]
            sum += val * weight
        }
        let expected = (sum % 10).description.first!
        return checkChar == expected
    }

    private static func mrzValue(_ char: Character) -> Int? {
        if char.isNumber { return Int(String(char))! }
        if char.isUppercase { return Int(char.asciiValue!) - 55 }
        if char == "<" { return 0 }
        return nil
    }
}
