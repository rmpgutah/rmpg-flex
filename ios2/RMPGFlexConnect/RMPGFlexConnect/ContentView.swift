import SwiftUI
import CoreAPI
import CoreAuth
import DesignSystem
import FeatureShell

struct ContentView: View {
    @Bindable var session: AuthSession

    private static let apiClient = APIClient(
        baseURL: URL(string: "https://api.rmpgutah.us")!,
        tokenProvider: { KeychainStore.get(AuthSession.tokenKey) }
    )

    var body: some View {
        if let role = session.role, session.token != nil {
            RoleAwareShell(role: role, session: session)
        } else {
            LoginView(vm: LoginViewModel(
                authAPI: AuthAPI(client: Self.apiClient),
                session: session
            ))
        }
    }
}
