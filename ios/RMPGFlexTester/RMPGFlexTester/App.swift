import SwiftUI

@main
struct RMPGFlexTesterApp: App {
    @StateObject private var session = AuthSession()
    init() { Theme.configureAppearance() }

    var body: some Scene {
        WindowGroup {
            Group {
                // Auth gate: the app opens to the branded LoginView (Face ID /
                // password) and only reveals the field surfaces once signed in.
                if session.isAuthenticated {
                    MainTabView()
                } else {
                    LoginView()
                }
            }
            .environmentObject(session)
            .tint(Theme.gold)
            .preferredColorScheme(.dark)
            .background(Theme.base)
        }
    }
}

// The signed-in app shell: 5 tabs. Four officer-facing surfaces plus a themed
// "More" hub for the secondary surfaces — kept at 5 so iOS never folds tabs
// into its unthemeable stock "More" list.
struct MainTabView: View {
    var body: some View {
        TabView {
            DashboardView()
                .tabItem { Label("Home", systemImage: "house.fill") }
            FieldOpsView()
                .tabItem { Label("Field Ops", systemImage: "shield.lefthalf.filled") }
            IDScanView()
                .tabItem { Label("ID Scan", systemImage: "person.text.rectangle") }
            FieldToolkitView()
                .tabItem { Label("Toolkit", systemImage: "square.grid.3x3.fill") }
            MoreHubView()
                .tabItem { Label("More", systemImage: "ellipsis.circle.fill") }
        }
        .tint(Theme.gold)
        .task { MDTLink.shared.startPolling(); _ = OfflineSync.shared }
    }
}

// Themed hub for the non-primary officer surfaces, grouped into labeled
// sections. (Replaces the old SystemHubView, whose dev/test consoles were
// removed in Phase 1.)
struct MoreHubView: View {
    @EnvironmentObject var session: AuthSession

    private struct Entry: Identifiable {
        let id: String
        let title: String
        let subtitle: String
        let icon: String
        let destination: AnyView
    }
    private struct HubSection: Identifiable {
        let id: String
        let header: String
        let entries: [Entry]
    }

    private var sections: [HubSection] {
        [
            HubSection(id: "patrol", header: "Patrol", entries: [
                Entry(id: "roster", title: "Duty Roster",
                      subtitle: "On/off duty · time entries",
                      icon: "person.3.fill", destination: AnyView(DutyRosterView())),
                Entry(id: "alerts", title: "Live Alerts",
                      subtitle: "Calls · BOLOs · watchlist hits — one ranked feed",
                      icon: "bell.badge.waveform.fill", destination: AnyView(AlertsFeedView())),
                Entry(id: "watchlist", title: "Watchlist",
                      subtitle: "Subjects you're watching · alerts on new activity",
                      icon: "binoculars.fill", destination: AnyView(WatchlistView())),
                Entry(id: "fleet", title: "Fleet Readiness",
                      subtitle: "Out-of-service · maintenance · inspection-overdue · ready",
                      icon: "car.2.fill", destination: AnyView(FleetReadinessView())),
            ]),
            HubSection(id: "reports", header: "Reports & Records", entries: [
                Entry(id: "dar", title: "Daily Activity Report",
                      subtitle: "Auto-compiled shift report · review + sign",
                      icon: "doc.text.below.ecg.fill", destination: AnyView(DailyActivityReportView())),
                Entry(id: "recorder", title: "Recorder",
                      subtitle: "Record interaction audio for evidence",
                      icon: "mic.fill", destination: AnyView(RecorderView())),
            ]),
            HubSection(id: "account", header: "Account", entries: [
                Entry(id: "myid", title: "My Officer ID",
                      subtitle: "Your digital badge + live verification QR",
                      icon: "person.text.rectangle.fill", destination: AnyView(WalletIDView())),
                Entry(id: "settings", title: "Settings",
                      subtitle: "RMPG login · Verifier token",
                      icon: "gearshape", destination: AnyView(SettingsView())),
            ]),
        ]
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    ForEach(sections) { section in
                        VStack(spacing: 6) {
                            HStack {
                                SectionHeader(title: section.header)
                                Spacer()
                            }
                            ForEach(section.entries) { e in
                                NavigationLink {
                                    e.destination
                                        .navigationBarTitleDisplayMode(.inline)
                                } label: {
                                    HStack(spacing: 10) {
                                        Image(systemName: e.icon)
                                            .font(.system(size: 16))
                                            .foregroundStyle(Theme.gold)
                                            .frame(width: 28)
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(e.title)
                                                .font(.system(size: 13, weight: .semibold))
                                                .foregroundStyle(.white)
                                            Text(e.subtitle)
                                                .font(.system(size: 10))
                                                .foregroundStyle(Theme.neutral)
                                                .lineLimit(1)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.system(size: 11, weight: .semibold))
                                            .foregroundStyle(Theme.neutral)
                                    }
                                    .themeCard()
                                }
                            }
                        }
                    }

                    // Session controls — Lock keeps credentials (Face ID re-entry);
                    // Sign out wipes them.
                    VStack(spacing: 6) {
                        Button { session.lock() } label: {
                            Label("Lock", systemImage: "lock.fill")
                        }.buttonStyle(RaisedButtonStyle())
                        Button(role: .destructive) { session.signOut() } label: {
                            Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                                .frame(maxWidth: .infinity)
                                .font(.system(size: 11, weight: .semibold))
                        }
                        .foregroundStyle(Theme.red)
                        .padding(.vertical, 8)
                    }
                    .padding(.top, 8)

                    Text("RMPG FLEX FIELD · \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev") · api.rmpgutah.us")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(Theme.neutral)
                        .padding(.top, 12)
                }
                .padding(12)
            }
            .background(Theme.base)
            .navigationTitle("MORE")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
