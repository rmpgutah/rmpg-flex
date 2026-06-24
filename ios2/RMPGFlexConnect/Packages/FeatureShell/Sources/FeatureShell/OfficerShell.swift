import SwiftUI
import DesignSystem
import CoreAPI
import CoreAuth
import FeatureDuty
import FeatureQuickActions
import FeatureCFS

@MainActor
public struct OfficerShell: View {
    // Kept for tests (ShellTabsTests.testOfficerHasFiveTabs etc.)
    public static let tabs: [TabSpec] = [
        TabSpec(id: "home",    title: "Home",    systemImage: "house.fill",            milestone: "M1"),
        TabSpec(id: "cfs",     title: "CFS",     systemImage: "list.bullet.rectangle", milestone: "M1"),
        TabSpec(id: "scan",    title: "Scan ID", systemImage: "camera.viewfinder",     milestone: "M1"),
        TabSpec(id: "records", title: "Records", systemImage: "doc.text",              milestone: "M1"),
        TabSpec(id: "more",    title: "More",    systemImage: "ellipsis.circle",       milestone: "M1"),
    ]

    @Bindable var session: AuthSession
    @State private var dutyState = DutyState()

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
            HomeView(dutyState: dutyState, apiClient: apiClient)
                .tabItem { Label("Home", systemImage: "house.fill") }

            CFSTabView(vm: CallsViewModel(api: CFSAPI(client: apiClient)))
                .tabItem { Label("CFS", systemImage: "list.bullet.rectangle") }

            ScanTabView(apiClient: apiClient)
                .tabItem { Label("Scan ID", systemImage: "camera.viewfinder") }

            RecordsTabView(client: apiClient)
                .tabItem { Label("Records", systemImage: "doc.text") }

            MoreTabView(session: session)
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
        }
        .tint(ThemeColors.night.brandGold)
    }
}

// Kept for tests (ShellTabsTests references it)
public struct TabSpec: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let systemImage: String
    public let milestone: String

    public init(id: String, title: String, systemImage: String, milestone: String) {
        self.id = id
        self.title = title
        self.systemImage = systemImage
        self.milestone = milestone
    }
}
