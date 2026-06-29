import Foundation

public struct Incident: Codable, Identifiable, Sendable {
    public let id: Int
    public let incidentNumber: String?
    public let type: String?
    public let priority: String?
    public let status: String?
    public let narrative: String?
    public let officerId: Int?
    public let supervisorId: Int?
    public let location: String?
    public let createdAt: String?
    public let updatedAt: String?

    public var statusLabel: String { (status ?? "draft").replacingOccurrences(of: "_", with: " ") }
}

public struct IncidentCreateRequest: Codable, Sendable {
    public let type: String
    public let priority: String
    public let narrative: String?
    public let location: String?

    public init(type: String, priority: String = "P3", narrative: String? = nil, location: String? = nil) {
        self.type = type
        self.priority = priority
        self.narrative = narrative
        self.location = location
    }
}

public struct IncidentOffense: Codable, Identifiable, Sendable {
    public let id: Int?
    public let incidentId: Int?
    public let statuteCode: String?
    public let description: String?
    public let offenseType: String?
}

public struct IncidentPerson: Codable, Identifiable, Sendable {
    public let id: Int?
    public let incidentId: Int?
    public let personId: Int?
    public let role: String?
    public let statement: String?
    public let personName: String?
}
