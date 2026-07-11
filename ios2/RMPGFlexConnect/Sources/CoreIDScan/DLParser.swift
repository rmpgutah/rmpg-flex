import Foundation

public struct DLParser {
    private static let stateNames: [String: String] = [
        "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR",
        "CALIFORNIA": "CA", "COLORADO": "CO", "CONNECTICUT": "CT", "DELAWARE": "DE",
        "FLORIDA": "FL", "GEORGIA": "GA", "HAWAII": "HI", "IDAHO": "ID",
        "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA", "KANSAS": "KS",
        "KENTUCKY": "KY", "LOUISIANA": "LA", "MAINE": "ME", "MARYLAND": "MD",
        "MASSACHUSETTS": "MA", "MICHIGAN": "MI", "MINNESOTA": "MN", "MISSISSIPPI": "MS",
        "MISSOURI": "MO", "MONTANA": "MT", "NEBRASKA": "NE", "NEVADA": "NV",
        "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY",
        "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", "OHIO": "OH", "OKLAHOMA": "OK",
        "OREGON": "OR", "PENNSYLVANIA": "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
        "SOUTH DAKOTA": "SD", "TENNESSEE": "TN", "TEXAS": "TX", "UTAH": "UT",
        "VERMONT": "VT", "VIRGINIA": "VA", "WASHINGTON": "WA", "WEST VIRGINIA": "WV",
        "WISCONSIN": "WI", "WYOMING": "WY", "DISTRICT OF COLUMBIA": "DC",
    ]

    public static func parse(lines: [String]) -> ScannedID {
        let text = lines.joined(separator: "\n").uppercased()
        let raw = lines.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }

        let docType = detectType(text: text)
        var id = ScannedID(documentType: docType, rawText: raw)

        extractName(from: text, into: &id)
        extractDOB(from: text, into: &id)
        extractAddress(from: raw, into: &id)
        extractDocumentNumber(from: text, into: &id)
        extractDates(from: text, into: &id)
        extractPhysical(from: text, into: &id)
        extractState(from: text, into: &id)
        extractEndorsements(from: text, into: &id)

        id.confidence = calculateConfidence(id)
        return id
    }

    private static func detectType(text: String) -> IDDocumentType {
        if text.contains("DRIVER LICENSE") || text.contains("DRIVER'S LICENSE") || text.contains("DRIVERS LICENSE") || text.contains("OPERATOR LICENSE") { return .driversLicense }
        if text.contains("IDENTIFICATION CARD") || text.contains("STATE ID") || text.contains("NON-DRIVER") { return .stateID }
        if text.contains("PASSPORT") && text.contains("UNITED STATES") { return .passport }
        if text.contains("UNIFORMED SERVICES") || text.contains("MILITARY") { return .militaryID }
        return .unknown
    }

    private static func extractName(from text: String, into id: inout ScannedID) {
        for pattern in [
            "1\\s+([A-Z]+)\\s*\n?\\s*([A-Z]+)",
            "LN\\s+([A-Z]+)\\s*\n?\\s*FN\\s+([A-Z]+)",
            "LAST\\s+([A-Z]+).*?FIRST\\s+([A-Z]+)",
            "NAME[:\\.]?\\s*([A-Z]+)\\s*,?\\s*([A-Z]+)",
        ] {
            if let match = text.range(of: pattern, options: .regularExpression) {
                let matched = String(text[match])
                let parts = matched.split(separator: " ").filter { $0.count > 1 && $0.rangeOfCharacter(from: .letters) != nil }
                if parts.count >= 2 {
                    id.lastName = String(parts[0]).capitalized
                    id.firstName = String(parts[1]).capitalized
                    if parts.count >= 3 { id.middleName = String(parts[2]).capitalized }
                    id.fullName = [id.firstName, id.middleName, id.lastName].compactMap { $0 }.joined(separator: " ")
                    break
                }
            }
        }

        if id.lastName == nil {
            let nameLines = text.components(separatedBy: "\n").filter {
                let clean = $0.trimmingCharacters(in: .whitespaces)
                return clean.count > 1 && clean.allSatisfy({ $0.isLetter || $0 == " " || $0 == "-" || $0 == "'" }) && !["DRIVER", "LICENSE", "IDENTIFICATION", "CARD", "USA", "UNITED", "STATES"].contains(clean)
            }
            if nameLines.count >= 2 {
                let first = nameLines[0].trimmingCharacters(in: .whitespaces)
                let last = nameLines[1].trimmingCharacters(in: .whitespaces)
                id.lastName = last.capitalized
                id.firstName = first.capitalized
                id.fullName = "\(id.firstName!) \(id.lastName!)"
            } else if let first = nameLines.first {
                let parts = first.components(separatedBy: ",")
                if parts.count == 2 {
                    id.lastName = parts[0].trimmingCharacters(in: .whitespaces).capitalized
                    id.firstName = parts[1].trimmingCharacters(in: .whitespaces).capitalized
                    id.fullName = "\(id.firstName!) \(id.lastName!)"
                }
            }
        }
    }

    private static func extractDOB(from text: String, into id: inout ScannedID) {
        let dobPatterns = [
            "DOB[:\\.]?\\s*(\\d{2}/\\d{2}/\\d{4})",
            "DOB[:\\.]?\\s*(\\d{4}-\\d{2}-\\d{2})",
            "DOB[:\\.]?\\s*(\\d{2}/\\d{2}/\\d{2})",
            "BIRTH[:\\.]?\\s*(\\d{2}/\\d{2}/\\d{4})",
            "3\\s+DOB\\s+(\\d{2}/\\d{2}/\\d{4})",
        ]
        for p in dobPatterns {
            if let match = text.range(of: p, options: .regularExpression),
               let cap = text[match].range(of: "\\d{2}/\\d{2}/\\d{4}|\\d{4}-\\d{2}-\\d{2}", options: .regularExpression) {
                id.dateOfBirth = String(text[cap])
                break
            }
        }
    }

    private static func extractAddress(from lines: [String], into id: inout ScannedID) {
        for (i, line) in lines.enumerated() {
            if line.range(of: #"\d+\s+[A-Z\s]+(ST|AVE|RD|DR|LN|BLVD|WAY|CT|PL|PKWY|HWY|TRL|CIR)\b"#, options: .regularExpression) != nil {
                id.address = line.trimmingCharacters(in: .whitespaces)
                if i + 1 < lines.count {
                    let cityStateZip = lines[i + 1]
                    let parts = cityStateZip.trimmingCharacters(in: .whitespaces).components(separatedBy: .whitespaces)
                    if parts.count >= 2 {
                        id.city = parts.dropLast(2).joined(separator: " ").capitalized
                        id.state = parts.dropLast(1).last
                        id.zipCode = parts.last
                    }
                }
                break
            }
        }

        if id.address == nil {
            for line in lines {
                if line.range(of: #"^\d+\s+[A-Z]"#, options: .regularExpression) != nil && line.count > 10 {
                    id.address = line
                    break
                }
            }
        }
    }

    private static func extractDocumentNumber(from text: String, into id: inout ScannedID) {
        let patterns = [
            "4D\\s+DLN?\\s*#?\\s*([A-Z0-9]+)",
            "DL[:\\.]?\\s*#?\\s*([A-Z0-9]+)",
            "LIC[:\\.]?\\s*#?\\s*([A-Z0-9]+)",
            "ID[:\\.]?\\s*#?\\s*([A-Z0-9]+)",
            "NO[:\\.]?\\s*([A-Z0-9]{5,})",
        ]
        for p in patterns {
            if let match = text.range(of: p, options: .regularExpression),
               let cap = text[match].range(of: "[A-Z0-9]{5,}", options: .regularExpression) {
                id.documentNumber = String(text[cap]).trimmingCharacters(in: .whitespaces)
                break
            }
        }
    }

    private static func extractDates(from text: String, into id: inout ScannedID) {
        if let match = text.range(of: "EXP[:\\.]?\\s*(\\d{2}/\\d{2}/\\d{4}|\\d{4}-\\d{2}-\\d{2})", options: .regularExpression),
           let cap = text[match].range(of: "\\d{2}/\\d{2}/\\d{4}|\\d{4}-\\d{2}-\\d{2}", options: .regularExpression) {
            id.expirationDate = String(text[cap])
        }
        if let match = text.range(of: "ISS[:\\.]?\\s*(\\d{2}/\\d{2}/\\d{4}|\\d{4}-\\d{2}-\\d{2})", options: .regularExpression),
           let cap = text[match].range(of: "\\d{2}/\\d{2}/\\d{4}|\\d{4}-\\d{2}-\\d{2}", options: .regularExpression) {
            id.issueDate = String(text[cap])
        }
    }

    private static func extractPhysical(from text: String, into id: inout ScannedID) {
        if let match = text.range(of: "SEX[:\\.]?\\s*([MF])", options: .regularExpression),
           let cap = text[match].range(of: "[MF]", options: .regularExpression) {
            id.gender = String(text[cap])
        }
        if let match = text.range(of: "EYES[:\\.]?\\s*([A-Z]+)", options: .regularExpression),
           let cap = text[match].range(of: "[A-Z]{3,}", options: .regularExpression) {
            id.eyeColor = String(text[cap]).capitalized
        }
        if let match = text.range(of: "HAIR[:\\.]?\\s*([A-Z]+)", options: .regularExpression),
           let cap = text[match].range(of: "[A-Z]{3,}", options: .regularExpression) {
            id.hairColor = String(text[cap]).capitalized
        }
        if let match = text.range(of: "HGT[:\\.]?\\s*(\\d['-]\\d{1,2}\")", options: .regularExpression),
           let cap = text[match].range(of: "\\d['-]\\d{1,2}\"", options: .regularExpression) {
            id.height = String(text[cap])
        }
        if let match = text.range(of: "WGT[:\\.]?\\s*(\\d{2,3})\\s*(LB)?", options: .regularExpression),
           let cap = text[match].range(of: "\\d{2,3}", options: .regularExpression) {
            id.weight = String(text[cap])
        }
    }

    private static func extractState(from text: String, into id: inout ScannedID) {
        for (name, code) in stateNames {
            if text.contains(name) { id.issuingState = code; break }
        }
        if id.issuingState == nil {
            for (name, code) in stateNames {
                if text.contains(code) { id.issuingState = code; break }
            }
        }
    }

    private static func extractEndorsements(from text: String, into id: inout ScannedID) {
        id.organDonor = text.contains("ORGAN DONOR") || text.contains("DONOR")
        id.veteran = text.contains("VETERAN")
    }

    private static func calculateConfidence(_ id: ScannedID) -> Float {
        var score: Float = 0
        let fields = 11
        if id.firstName != nil { score += 1 }
        if id.lastName != nil { score += 1 }
        if id.dateOfBirth != nil { score += 1 }
        if id.address != nil { score += 1 }
        if id.documentNumber != nil { score += 1 }
        if id.expirationDate != nil { score += 1 }
        if id.issuingState != nil { score += 1 }
        if id.gender != nil { score += 1 }
        if id.eyeColor != nil { score += 1 }
        if id.height != nil { score += 1 }
        if id.weight != nil { score += 1 }
        return score / Float(fields)
    }
}
