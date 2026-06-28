import Foundation

public struct DispatchUnit: Decodable, Identifiable, Sendable {
    public let id: Int
    public let call_sign: String
    public let status: String
    public let officer_name: String?
    public let badge_number: String?
    public let current_call_priority: String?
    public let current_call_location: String?
    public let vehicle_model: String?
    public let maintenance_status: String?

    public var displayStatus: String { status.replacingOccurrences(of: "_", with: " ").uppercased() }

    public var isAvailable: Bool  { status == "available" }
    public var isActive: Bool     { ["dispatched", "enroute", "onscene"].contains(status) }
    public var isOffDuty: Bool    { ["off_duty", "out_of_service"].contains(status) }
}
