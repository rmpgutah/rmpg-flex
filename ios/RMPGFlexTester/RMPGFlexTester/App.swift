import SwiftUI

@main
struct RMPGFlexTesterApp: App {
    @StateObject private var session = AuthSession()
    init() { Theme.configureAppearance() }

    var body: some Scene {
        WindowGroup {
            Group {
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

// The signed-in app shell: 5 tabs with live badges. Field Ops badges the active
// call count; More badges unread notifications. Counts come from LiveCounts
// (polled app-wide) so badges stay fresh regardless of the visible tab.
struct MainTabView: View {
    @ObservedObject private var counts = LiveCounts.shared

    var body: some View {
        TabView {
            DashboardView()
                .tabItem { Label("Home", systemImage: "house.fill") }
            FieldOpsView()
                .tabItem { Label("Field Ops", systemImage: "shield.lefthalf.filled") }
                .badge(counts.activeCalls)
            IDScanView()
                .tabItem { Label("ID Scan", systemImage: "person.text.rectangle") }
            FieldToolkitView()
                .tabItem { Label("Toolkit", systemImage: "square.grid.3x3.fill") }
            MoreHubView()
                .tabItem { Label("More", systemImage: "ellipsis.circle.fill") }
                .badge(counts.unread)
        }
        .tint(Theme.gold)
        .task {
            MDTLink.shared.startPolling()
            LiveCounts.shared.startPolling()
            _ = OfflineSync.shared
        }
    }
}

// Themed hub for the non-primary officer surfaces, grouped into labeled sections.
struct MoreHubView: View {
    @EnvironmentObject var session: AuthSession
    @ObservedObject private var counts = LiveCounts.shared

    private struct Entry: Identifiable {
        let id: String
        let title: String
        let subtitle: String
        let icon: String
        let badge: Int
        let destination: AnyView
    }
    private struct HubSection: Identifiable {
        let id: String
        let header: String
        let entries: [Entry]
    }

    // Computed so the Live Alerts badge reflects the current counts.unread each render.
    private var sections: [HubSection] {
        [
            HubSection(id: "patrol", header: "Patrol", entries: [
                Entry(id: "roster", title: "Duty Roster",
                      subtitle: "On/off duty · time entries",
                      icon: "person.3.fill", badge: 0, destination: AnyView(DutyRosterView())),
                Entry(id: "alerts", title: "Live Alerts",
                      subtitle: "Calls · BOLOs · watchlist hits — one ranked feed",
                      icon: "bell.badge.waveform.fill", badge: counts.unread, destination: AnyView(AlertsFeedView())),
                Entry(id: "watchlist", title: "Watchlist",
                      subtitle: "Subjects you're watching · alerts on new activity",
                      icon: "binoculars.fill", badge: 0, destination: AnyView(WatchlistView())),
                Entry(id: "fleet", title: "Fleet Readiness",
                      subtitle: "Out-of-service · maintenance · inspection-overdue · ready",
                      icon: "car.2.fill", badge: 0, destination: AnyView(FleetReadinessView())),
            ]),
            HubSection(id: "reports", header: "Reports & Records", entries: [
                Entry(id: "timecard", title: "My Timecard",
                      subtitle: "Your hours this week · recent shifts",
                      icon: "clock.badge.checkmark", badge: 0, destination: AnyView(MyTimecardView())),
                Entry(id: "dar", title: "Daily Activity Report",
                      subtitle: "Auto-compiled shift report · review + sign",
                      icon: "doc.text.below.ecg.fill", badge: 0, destination: AnyView(DailyActivityReportView())),
                Entry(id: "recorder", title: "Recorder",
                      subtitle: "Record interaction audio for evidence",
                      icon: "mic.fill", badge: 0, destination: AnyView(RecorderView())),
            ]),
            HubSection(id: "account", header: "Account", entries: [
                Entry(id: "myid", title: "My Officer ID",
                      subtitle: "Your digital badge + live verification QR",
                      icon: "person.text.rectangle.fill", badge: 0, destination: AnyView(WalletIDView())),
                Entry(id: "settings", title: "Settings",
                      subtitle: "RMPG login · Verifier token",
                      icon: "gearshape", badge: 0, destination: AnyView(SettingsView())),
            ]),
        ]
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    ForEach(sections) { section in
                        VStack(spacing: 6) {
                            SectionHeader(title: section.header)
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
                                                .font(Theme.Typography.body).fontWeight(.semibold)
                                                .foregroundStyle(.white)
                                            Text(e.subtitle)
                                                .font(.system(size: 10))
                                                .foregroundStyle(Theme.neutral)
                                                .lineLimit(1)
                                        }
                                        Spacer()
                                        if e.badge > 0 {
                                            Text("\(e.badge)")
                                                .font(.system(size: 9, weight: .heavy)).foregroundStyle(.black)
                                                .padding(.horizontal, 5).padding(.vertical, 1)
                                                .background(Theme.red).clipShape(Capsule())
                                        }
                                        Image(systemName: "chevron.right")
                                            .font(.system(size: 11, weight: .semibold))
                                            .foregroundStyle(Theme.neutral)
                                    }
                                    .themeCard()
                                }
                            }
                        }
                    }

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
