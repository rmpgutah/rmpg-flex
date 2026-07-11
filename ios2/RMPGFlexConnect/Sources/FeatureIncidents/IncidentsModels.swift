import Foundation

/// Mirrors `incidents` (GET /api/incidents/:id) — verified against
/// migrations/0001_initial_schema.sql. A prior version used `type`/`location`
/// as property names; the real columns are `incident_type`/`location_address`,
/// which `.convertFromSnakeCase` maps to `incidentType`/`locationAddress` —
/// there is no column that maps to `type`/`location`, so both fields always
/// silently decoded to nil against real data.
public struct Incident: Codable, Identifiable, Sendable {
    public let id: Int
    public let incidentNumber: String?
    public let incidentType: String?
    public let priority: String?
    public let status: String?
    public let narrative: String?
    public let officerId: Int?
    public let supervisorId: Int?
    public let locationAddress: String?
    public let createdAt: String?
    public let updatedAt: String?

    public var statusLabel: String { (status ?? "draft").replacingOccurrences(of: "_", with: " ").capitalized }
}

/// POST /api/incidents body — CodingKeys map to the real field names the
/// Worker destructures (`incident_type`, `location_address`; see
/// src/routes/incidents.ts). A prior version sent `type`/`location`, which
/// the server read as `undefined` and rejected with a 400 "required" error
/// on every single incident creation regardless of what was actually typed.
public struct IncidentCreateRequest: Codable, Sendable {
    public let incidentType: String
    public let priority: String
    public let narrative: String?
    public let locationAddress: String?

    private enum CodingKeys: String, CodingKey {
        case incidentType = "incident_type"
        case priority
        case narrative
        case locationAddress = "location_address"
    }

    public init(incidentType: String, priority: String = "P3", narrative: String? = nil, locationAddress: String? = nil) {
        self.incidentType = incidentType
        self.priority = priority
        self.narrative = narrative
        self.locationAddress = locationAddress
    }
}

public struct IncidentOffense: Codable, Identifiable, Sendable {
    public let id: Int?
    public let incidentId: Int?
    public let statuteCode: String?
    public let description: String?
    public let offenseType: String?
}
