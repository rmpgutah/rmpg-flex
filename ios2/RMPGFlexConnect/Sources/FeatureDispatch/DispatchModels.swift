import Foundation

public struct CallForService: Codable, Identifiable, Sendable {
    public let id: Int
    public let callNumber: String?
    public let incidentType: String?
    public let priority: String?
    public let status: String?
    public let location: String?
    public let callerName: String?
    public let callerPhone: String?
    public let narrative: String?
    public let createdAt: String?
    public let updatedAt: String?
    public let assignedUnitIds: String?
    public let dispatcherId: Int?
    public let district: String?
    public let beat: String?

    public var parsedUnitIds: [Int] {
        guard let ids = assignedUnitIds,
              let data = ids.data(using: .utf8),
              let arr = try? JSONDecoder().decode([Int].self, from: data) else { return [] }
        return arr
    }
}

public struct Unit: Codable, Identifiable, Sendable {
    public let id: Int
    public let callSign: String?
    public let officerId: Int?
    public let status: String?
    public let lat: Double?
    public let lng: Double?
    public let vehicleId: Int?
    public let currentCallId: Int?
    public let capabilities: String?
}

public struct PanicAlert: Codable, Identifiable, Sendable {
    public let id: Int?
    public let source: String
    public let escalationLevel: String?
    public let lat: Double?
    public let lng: Double?
}

public struct DispatchStats: Codable, Sendable {
    public let totalCalls: Int?
    public let pendingCalls: Int?
    public let activeCalls: Int?
    public let availableUnits: Int?
    public let busyUnits: Int?
}

public struct CreateCallRequest: Codable, Sendable {
    public let incidentType: String
    public let priority: String
    public let location: String
    public let callerName: String?
    public let callerPhone: String?
    public let narrative: String?
    public let district: String?
    public let beat: String?

    public init(incidentType: String, priority: String, location: String,
                callerName: String? = nil, callerPhone: String? = nil,
                narrative: String? = nil, district: String? = nil, beat: String? = nil) {
        self.incidentType = incidentType
        self.priority = priority
        self.location = location
        self.callerName = callerName
        self.callerPhone = callerPhone
        self.narrative = narrative
        self.district = district
        self.beat = beat
    }
}

public struct WelfareCheck: Codable, Identifiable, Sendable {
    public let id: Int
    public let officerId: Int?
    public let callId: Int?
    public let callNumber: String?
    public let status: String?
    public let startedAt: String?
    public let timeoutMinutes: Int?
}
