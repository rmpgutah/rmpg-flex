import Foundation

public enum IDDocumentType: String, Codable, Sendable {
    case driversLicense = "drivers_license"
    case stateID = "state_id"
    case passport = "passport"
    case passportCard = "passport_card"
    case militaryID = "military_id"
    case unknown = "unknown"
}

public struct ScannedID: Codable, Sendable {
    public var documentType: IDDocumentType
    public var firstName: String?
    public var lastName: String?
    public var middleName: String?
    public var fullName: String?
    public var dateOfBirth: String?
    public var address: String?
    public var city: String?
    public var state: String?
    public var zipCode: String?
    public var documentNumber: String?
    public var expirationDate: String?
    public var issueDate: String?
    public var issuingState: String?
    public var gender: String?
    public var eyeColor: String?
    public var hairColor: String?
    public var height: String?
    public var weight: String?
    public var organDonor: Bool?
    public var veteran: Bool?
    public var nationality: String?
    public var passportNumber: String?
    public var rawMRZ: String?
    public var rawText: [String]
    public var confidence: Float
    public let scannedAt: Date

    public init(
        documentType: IDDocumentType = .unknown,
        firstName: String? = nil, lastName: String? = nil, middleName: String? = nil,
        fullName: String? = nil, dateOfBirth: String? = nil,
        address: String? = nil, city: String? = nil, state: String? = nil, zipCode: String? = nil,
        documentNumber: String? = nil, expirationDate: String? = nil, issueDate: String? = nil,
        issuingState: String? = nil, gender: String? = nil,
        eyeColor: String? = nil, hairColor: String? = nil,
        height: String? = nil, weight: String? = nil,
        organDonor: Bool? = nil, veteran: Bool? = nil,
        nationality: String? = nil, passportNumber: String? = nil, rawMRZ: String? = nil,
        rawText: [String] = [], confidence: Float = 0
    ) {
        self.documentType = documentType
        self.firstName = firstName; self.lastName = lastName; self.middleName = middleName
        self.fullName = fullName; self.dateOfBirth = dateOfBirth
        self.address = address; self.city = city; self.state = state; self.zipCode = zipCode
        self.documentNumber = documentNumber; self.expirationDate = expirationDate
        self.issueDate = issueDate; self.issuingState = issuingState
        self.gender = gender; self.eyeColor = eyeColor; self.hairColor = hairColor
        self.height = height; self.weight = weight
        self.organDonor = organDonor; self.veteran = veteran
        self.nationality = nationality; self.passportNumber = passportNumber
        self.rawMRZ = rawMRZ; self.rawText = rawText
        self.confidence = confidence; self.scannedAt = Date()
    }

    public var displayName: String {
        fullName ?? [firstName, lastName].compactMap { $0 }.joined(separator: " ")
    }

    public var dobFormatted: String? {
        guard let dob = dateOfBirth, dob.count >= 8 else { return dateOfBirth }
        let df = DateFormatter()
        let cleaned = dob.replacingOccurrences(of: "-", with: "").replacingOccurrences(of: "/", with: "")
        guard cleaned.count == 8,
              let y = Int(cleaned.prefix(4)),
              let m = Int(cleaned.dropFirst(4).prefix(2)),
              let d = Int(cleaned.suffix(2)) else { return dob }
        return String(format: "%04d-%02d-%02d", y, m, d)
    }

    public func toPersonPayload() -> [String: Any] {
        var p: [String: Any] = [:]
        p["first_name"] = firstName; p["last_name"] = lastName
        p["middle_name"] = middleName; p["full_name"] = fullName
        p["dob"] = dobFormatted; p["address"] = address
        p["city"] = city; p["state"] = state
        p["zip_code"] = zipCode; p["gender"] = gender
        p["eye_color"] = eyeColor; p["hair_color"] = hairColor
        p["height"] = height; p["weight"] = weight
        p["id_number"] = documentNumber; p["id_type"] = documentType.rawValue
        p["id_state"] = issuingState; p["id_expires"] = expirationDate
        p["nationality"] = nationality; p["passport_number"] = passportNumber
        return p.compactMapValues { $0 }
    }

    public func toCallSubjectPayload(role: String = "subject") -> [String: Any] {
        var p = toPersonPayload()
        p["role"] = role
        p["source"] = "id_scan"
        p["scanned_at"] = ISO8601DateFormatter().string(from: scannedAt)
        return p
    }
}
