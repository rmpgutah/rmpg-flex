import SwiftUI
import CoreAuth

public struct RoleAwareShell: View {
    public let role: AppRole
    @Bindable var session: AuthSession

    public init(role: AppRole, session: AuthSession) {
        self.role = role
        self.session = session
    }

    public var body: some View {
        switch role {
        case .officer:    OfficerShell(session: session)
        case .supervisor: SupervisorShell(session: session)
        }
    }
}
