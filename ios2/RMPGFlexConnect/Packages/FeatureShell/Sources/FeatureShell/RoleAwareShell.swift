import SwiftUI
import CoreAuth

public struct RoleAwareShell: View {
    public let role: AppRole

    public init(role: AppRole) {
        self.role = role
    }

    public var body: some View {
        switch role {
        case .officer:    OfficerShell()
        case .supervisor: SupervisorShell()
        }
    }
}
