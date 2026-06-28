import Foundation

/// Maps the JWT `role` claim to the two app personas. Unknown roles default to officer
/// because every authenticated user gets at least the patrol surface.
public enum AppRole: String, Sendable, CaseIterable, Equatable {
    case officer
    case supervisor
}

public enum RoleResolver {
    /// Roles from the existing D1 schema. Spec §11.3.
    private static let supervisorRoles: Set<String> = [
        "admin", "manager", "supervisor"
    ]

    public static func resolve(jwtRole: String?) -> AppRole {
        guard let role = jwtRole?.lowercased() else { return .officer }
        return supervisorRoles.contains(role) ? .supervisor : .officer
    }
}
