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

// The signed-in app shell.
struct MainTabView: View {
    var body: some View {
        TabView {
            // Home dashboard is the post-login landing — at-a-glance status +
            // quick actions. Officer-facing surfaces fill the remaining slots;
            // dev/system consoles live in the SYSTEM hub (which iOS folds into
            // its "More" list once tabs exceed 5).
            DashboardView()
                .tabItem { Label("Home", systemImage: "house.fill") }
            FieldOpsView()
                .tabItem { Label("Field Ops", systemImage: "shield.lefthalf.filled") }
            DutyRosterView()
                .tabItem { Label("Roster", systemImage: "person.3.fill") }
            IDScanView()
                .tabItem { Label("ID Scan", systemImage: "person.text.rectangle") }
            FieldToolkitView()
                .tabItem { Label("Toolkit", systemImage: "square.grid.3x3.fill") }
            RecorderView()
                .tabItem { Label("Recorder", systemImage: "mic.fill") }
            SystemHubView()
                .tabItem { Label("System", systemImage: "gearshape.2.fill") }
        }
        .tint(Theme.gold)
        .task { MDTLink.shared.startPolling(); _ = OfflineSync.shared }
    }
}

// Themed hub for the non-patrol surfaces (D1 console, Cloudflare browser,
// smoke tests, data viewer, settings) — replaces iOS's stock "More" screen.
struct SystemHubView: View {
    @EnvironmentObject var session: AuthSession
    private struct Entry: Identifiable {
        let id: String
        let title: String
        let subtitle: String
        let icon: String
        let destination: AnyView
    }

    private var entries: [Entry] {
        [
            Entry(id: "myid", title: "My Officer ID",
                  subtitle: "Your digital badge + live verification QR",
                  icon: "person.text.rectangle.fill", destination: AnyView(WalletIDView())),
            Entry(id: "settings", title: "Settings",
                  subtitle: "RMPG login · Cloudflare keys · Verifier token",
                  icon: "gearshape", destination: AnyView(SettingsView())),
            Entry(id: "d1", title: "D1 Console",
                  subtitle: "SQL against live rmpg-flex (Cloudflare REST)",
                  icon: "terminal", destination: AnyView(D1ConsoleView())),
            Entry(id: "data", title: "Data Viewer",
                  subtitle: "Browse calls · units · persons · warrants",
                  icon: "tablecells", destination: AnyView(DataViewerView())),
            Entry(id: "cloud", title: "Cloud Status",
                  subtitle: "Workers · D1 · KV · R2 · Pages resources",
                  icon: "cloud", destination: AnyView(CloudStatusView())),
            Entry(id: "smoke", title: "Smoke Tests",
                  subtitle: "Probe api.rmpgutah.us routes (WAF-aware)",
                  icon: "checkmark.shield", destination: AnyView(SmokeTestView())),
        ]
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 6) {
                    ForEach(entries) { e in
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
                    .padding(.top, 14)

                    Text("RMPG FLEX FIELD · \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev") · api.rmpgutah.us")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(Theme.neutral)
                        .padding(.top, 12)
                }
                .padding(12)
            }
            .background(Theme.base)
            .navigationTitle("SYSTEM")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
