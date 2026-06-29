import SwiftUI
import CoreAPI
import CoreAuth
import FeatureDispatch
import FeatureRecords
import FeatureIncidents
import FeatureCases
import FeaturePatrol
import FeatureFleet
import FeatureServe
import FeatureWarrants
import FeatureQuickActions
import DesignSystem

public struct AppView: View {
    @StateObject private var authManager: AuthManager
    @State private var hasRestored = false

    public init() {
        let client = APIClient(baseURL: Endpoint.productionBaseURL)
        _authManager = StateObject(wrappedValue: AuthManager(apiClient: client))
    }

    public var body: some View {
        Group {
            if !hasRestored {
                ZStack {
                    RMPGTheme.baseBlack.ignoresSafeArea()
                    VStack(spacing: 16) {
                        Image(systemName: "shield.checkered").font(.system(size: 64)).foregroundColor(RMPGTheme.brandGold)
                        ProgressView().tint(RMPGTheme.brandGold)
                    }
                }
            } else if authManager.isAuthenticated {
                MainTabView(authManager: authManager)
            } else {
                LoginView(authManager: authManager)
            }
        }
        .task { await authManager.restoreSession(); hasRestored = true }
    }
}

struct MainTabView: View {
    @ObservedObject var authManager: AuthManager
    @State private var selectedTab = 0

    var body: some View {
        VStack(spacing: 0) {
            DemoBanner()
            TabView(selection: $selectedTab) {
                NavigationStack {
                    DispatchView(api: DispatchAPI(client: APIClient(baseURL: Endpoint.productionBaseURL)))
                        .toolbar {
                            ToolbarItem(placement: .navigationBarTrailing) {
                                NavigationLink(destination: UnitBoardView(api: DispatchAPI(client: APIClient(baseURL: Endpoint.productionBaseURL)))) {
                                    Image(systemName: "person.3.fill").font(.system(size: 14)).foregroundColor(RMPGTheme.brandGold)
                                }
                            }
                        }
                }
                .tabItem { Image(systemName: "antenna.radiowaves.left.and.right"); Text("Dispatch") }.tag(0)

                QuickActionsView()
                    .tabItem { Image(systemName: "bolt.fill"); Text("Actions") }.tag(1)

                IncidentsView(apiClient: APIClient(baseURL: Endpoint.productionBaseURL))
                    .tabItem { Image(systemName: "doc.text.fill"); Text("Incidents") }.tag(2)

                CasesView(apiClient: APIClient(baseURL: Endpoint.productionBaseURL))
                    .tabItem { Image(systemName: "briefcase.fill"); Text("Cases") }.tag(3)

                WarrantsView()
                    .tabItem { Image(systemName: "doc.text.magnifyingglass"); Text("Warrants") }.tag(4)

                RecordsView(apiClient: APIClient(baseURL: Endpoint.productionBaseURL))
                    .tabItem { Image(systemName: "folder.fill"); Text("Records") }.tag(5)

                FleetView()
                    .tabItem { Image(systemName: "car.fill"); Text("Fleet") }.tag(6)

                ServeView()
                    .tabItem { Image(systemName: "envelope.fill"); Text("Serve") }.tag(7)

                PatrolView()
                    .tabItem { Image(systemName: "map.fill"); Text("Patrol") }.tag(8)

                NavigationStack { SettingsView() }
                    .tabItem { Image(systemName: "gearshape.fill"); Text("Settings") }.tag(9)

                ProfileView(authManager: authManager)
                    .tabItem { Image(systemName: "person.fill"); Text("Profile") }.tag(10)
            }
            .tint(RMPGTheme.brandGold)
            .onAppear {
                let appearance = UITabBarAppearance()
                appearance.configureWithOpaqueBackground()
                appearance.backgroundColor = UIColor(RMPGTheme.baseBlack)
                appearance.stackedLayoutAppearance.selected.iconColor = UIColor(RMPGTheme.brandGold)
                appearance.stackedLayoutAppearance.selected.titleTextAttributes = [.foregroundColor: UIColor(RMPGTheme.brandGold)]
                appearance.stackedLayoutAppearance.normal.iconColor = UIColor(RMPGTheme.textMuted)
                appearance.stackedLayoutAppearance.normal.titleTextAttributes = [.foregroundColor: UIColor(RMPGTheme.textMuted)]
                UITabBar.appearance().standardAppearance = appearance
                UITabBar.appearance().scrollEdgeAppearance = appearance
            }
        }
    }
}

struct ProfileView: View {
    @ObservedObject var authManager: AuthManager
    @State private var showLogoutConfirm = false

    var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 0) {
                PanelTitleBar(title: "Profile", icon: "person.fill")
                RMPGDivider()
                if let user = authManager.currentUser {
                    VStack(spacing: 16) {
                        VStack(spacing: 4) {
                            Image(systemName: "person.circle.fill").font(.system(size: 60)).foregroundColor(RMPGTheme.brandGold)
                            Text(user.fullName).font(.system(size: 18, weight: .bold)).foregroundColor(RMPGTheme.textPrimary)
                            Text(user.role.replacingOccurrences(of: "_", with: " ").uppercased()).font(.system(size: 11)).foregroundColor(RMPGTheme.textMuted)
                        }.padding(.top, 24)
                        VStack(spacing: 0) {
                            RMPGDataRow(label: "Username", value: user.username); RMPGDivider()
                            RMPGDataRow(label: "Badge", value: user.badgeNumber ?? "—"); RMPGDivider()
                            RMPGDataRow(label: "Email", value: user.email ?? "—"); RMPGDivider()
                            RMPGDataRow(label: "Phone", value: user.phone ?? "—"); RMPGDivider()
                            RMPGDataRow(label: "Status", value: user.status, accent: RMPGTheme.statusGreen)
                        }
                        .background(RMPGTheme.raisedSurface).cornerRadius(2).padding(.horizontal, 16)
                        Spacer()
                        RMPGDestructiveButton(title: "LOG OUT") { showLogoutConfirm = true }
                            .padding(.horizontal, 16).padding(.bottom, 40)
                    }
                }
            }
        }
        .alert("Log Out", isPresented: $showLogoutConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Log Out", role: .destructive) { Task { await authManager.logout() } }
        } message: { Text("Are you sure? GPS tracking will stop.") }
    }
}
