import Foundation

/// A single call-for-service row as returned by `GET /api/dispatch/calls/active`.
public struct ActiveCall: Decodable, Identifiable, Sendable, Equatable {
    public let id: Int
    public let call_number: String?
    public let incident_type: String
    public let priority: String?
    public let status: String
    public let location_address: String
    public let description: String?
    public let notes: String?
    public let created_at: String
    public let updated_at: String?
    public let unit_call_signs: String?
    public let assigned_unit_ids: String?
    public let caller_name: String?
    public let caller_phone: String?
    public let disposition: String?
    public let action_taken: String?
    public let dispatcher_name: String?

    public var displayCallNumber: String { call_number ?? "PENDING" }

    public var displayIncidentType: String { incident_type.replacingOccurrences(of: "_", with: " ").uppercased() }

    public var displayPriority: Int {
        guard let p = priority else { return 3 }
        return Int(p.filter(\.isNumber).prefix(1)) ?? 3
    }

    public var priorityColor: String {
        switch displayPriority {
        case 1: return "critical"
        case 2: return "warning"
        default: return "secondary"
        }
    }

    public var statusDisplay: String { status.uppercased() }

    public var unitList: [String] {
        guard let s = unit_call_signs, !s.isEmpty else { return [] }
        return s.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
}
