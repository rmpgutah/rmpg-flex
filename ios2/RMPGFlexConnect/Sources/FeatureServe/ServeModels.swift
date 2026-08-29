import Foundation

/// Mirrors `serve_queue` (GET /api/serve, GET /api/serve/:id) on the Worker —
/// verified against src/routes/serve.ts rather than guessed, since prior
/// sessions found the iOS client's assumed shapes routinely drifted from the
/// real API (see AuthManager/DispatchAPI fixes). The endpoint returns a BARE
/// array, not `{results: [...]}` — decode accordingly.
public struct ServeJob: Codable, Identifiable, Sendable {
    public let id: Int
    public let recipientName: String?
    public let recipientAddress: String?
    public let recipientAddress2: String?
    public let recipientCity: String?
    public let recipientState: String?
    public let recipientZip: String?
    public let recipientLat: Double?
    public let recipientLng: Double?
    public let documentType: String?
    public let caseNumber: String?
    public let courtName: String?
    public let jurisdiction: String?
    public let clientName: String?
    public let attorneyName: String?
    public let priority: String?
    public let timeWindow: String?
    public let deadline: String?
    public let serviceInstructions: String?
    public let notes: String?
    public let status: String?
    public let attemptCount: Int?
    public let maxAttempts: Int?
    public let officerId: Int?
    public let officerName: String?
    public let createdAt: String?
    public let closedAt: String?
    public let attempts: [ServeAttempt]?

    public var fullAddress: String {
        [recipientAddress, recipientAddress2, [recipientCity, recipientState].compactMap { $0 }.joined(separator: ", "), recipientZip]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }
}

/// Mirrors `serve_attempts` (POST /api/serve/:id/attempt).
public struct ServeAttempt: Codable, Identifiable, Sendable {
    public let id: Int
    public let serveQueueId: Int
    public let attemptNumber: Int?
    public let attemptAt: String?
    public let attemptType: String?
    public let result: String?
    public let dispositionCode: String?
    public let notes: String?
    public let latitude: Double?
    public let longitude: Double?
    public let officerId: Int?
    public let officerName: String?
}

/// The legacy `result` enum the Worker's CHECK constraint still requires —
/// `disposition_code` (PS/xx.xx codes) is the modern path, but a bare
/// `result` is accepted as a fallback and is simplest for a phone UI.
///
/// These 9 cases are the ONLY values the server accepts — verified against
/// both `ATTEMPT_RESULTS` in src/routes/serve.ts and the `serve_attempts.result
/// CHECK` constraint in migrations/0030_serve_intake.sql, which must always
/// agree. A prior version of this enum included a `"not_served"` case that
/// doesn't exist in either — the server doesn't reject unknown values, it
/// silently coerces them to `'other'` (see `ATTEMPT_RESULTS.has(body.result)
/// ? body.result : defaultResult` in serve.ts's logAttempt()), so that bug
/// would have silently mislabeled every "Not Served" attempt as "Other" with
/// no error surfaced to the officer.
public enum ServeAttemptResult: String, CaseIterable, Sendable {
    case served
    case subServed = "sub_served"
    case posted
    case noAnswer = "no_answer"
    case refused
    case badAddress = "bad_address"
    case moved
    case deceased
    case other

    public var label: String {
        switch self {
        case .served: return "Served"
        case .subServed: return "Substitute Service"
        case .posted: return "Posted"
        case .noAnswer: return "No Answer"
        case .refused: return "Refused"
        case .badAddress: return "Bad Address"
        case .moved: return "Moved"
        case .deceased: return "Deceased"
        case .other: return "Other"
        }
    }

    /// True when this outcome closes out the job (matches the Worker's
    /// legacy-result → queue-status heuristic in serve.ts's logAttempt()).
    public var isTerminal: Bool {
        self == .served || self == .subServed
    }
}

/// POST /api/serve/:id/attempt request body.
public struct ServeAttemptRequest: Encodable, Sendable {
    public var result: String
    public var notes: String?
    public var latitude: Double?
    public var longitude: Double?
    public var attemptType: String?
    public var photoIds: [Int]
    public var signatureData: String?
    public var attemptAt: String?
    public var arrivedAt: String?

    public init(
        result: ServeAttemptResult,
        notes: String? = nil,
        latitude: Double? = nil,
        longitude: Double? = nil,
        attemptType: String? = nil,
        photoIds: [Int] = [],
        signatureData: String? = nil,
        attemptAt: String? = nil,
        arrivedAt: String? = nil
    ) {
        self.result = result.rawValue
        self.notes = notes
        self.latitude = latitude
        self.longitude = longitude
        self.attemptType = attemptType
        self.photoIds = photoIds
        self.signatureData = signatureData
        self.attemptAt = attemptAt
        self.arrivedAt = arrivedAt
    }
}

/// A single attachment row returned by POST /api/uploads (bare array response).
public struct UploadedAttachment: Codable, Sendable {
    public let id: Int
    public let fileId: String?
}
