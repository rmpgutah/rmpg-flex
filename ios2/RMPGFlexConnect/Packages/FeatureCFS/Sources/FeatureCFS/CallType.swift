import Foundation

/// Common CFS types. Codes match the existing Worker's `cfs_types` table
/// where possible — see CLAUDE.md for the canonical list.
public struct CallType: Identifiable, Equatable, Hashable, Sendable {
    public let id: String     // short code, e.g. "10-91"
    public let label: String  // human-readable, e.g. "Disturbance"

    public init(id: String, label: String) {
        self.id = id
        self.label = label
    }
}

public enum CallTypeRegistry {
    /// Common picks for the New Call form. Order is "most-used first" for
    /// muscle memory. The full agency catalog ships in M1.1.
    public static let common: [CallType] = [
        CallType(id: "10-91", label: "Disturbance"),
        CallType(id: "10-66", label: "Suspicious"),
        CallType(id: "10-50", label: "Traffic Accident"),
        CallType(id: "10-15", label: "Prisoner in custody"),
        CallType(id: "10-99", label: "Wanted/Stolen check"),
        CallType(id: "10-39", label: "Burglary"),
        CallType(id: "10-32", label: "Person with weapon"),
        CallType(id: "10-54", label: "Welfare check"),
        CallType(id: "10-12", label: "Standby"),
        CallType(id: "OTHER", label: "Other (free text)"),
    ]
}
