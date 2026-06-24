import SwiftUI
import DesignSystem
import CoreAPI
import CoreAuth
import FeatureCFS

public struct SupervisorShell: View {
    public static let tabs: [TabSpec] = [
        TabSpec(id: "command", title: "Command", systemImage: "shield.lefthalf.filled", milestone: "M2"),
        TabSpec(id: "units",   title: "Units",   systemImage: "mappin.and.ellipse",     milestone: "M2"),
        TabSpec(id: "cfs",     title: "CFS",     systemImage: "list.bullet.rectangle",  milestone: "M2"),
        TabSpec(id: "more",    title: "More",    systemImage: "ellipsis.circle",        milestone: "M2"),
    ]

    @Bindable var session: AuthSession

    private var apiClient: APIClient {
        APIClient(
            baseURL: URL(string: "https://api.rmpgutah.us")!,
            tokenProvider: { KeychainStore.get(AuthSession.tokenKey) }
        )
    }

    public init(session: AuthSession) {
        self.session = session
    }

    public var body: some View {
        TabView {
            CommandView(apiClient: apiClient)
                .tabItem { Label("Command", systemImage: "shield.lefthalf.filled") }

            UnitsView(apiClient: apiClient)
                .tabItem { Label("Units", systemImage: "mappin.and.ellipse") }

            CFSTabView(vm: CallsViewModel(api: CFSAPI(client: apiClient)))
                .tabItem { Label("CFS", systemImage: "list.bullet.rectangle") }

            MoreTabView(session: session)
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
        }
        .tint(ThemeColors.night.brandGold)
    }
}
