import SwiftUI

@main
struct RMPGFlexTesterApp: App {
    init() { Theme.configureAppearance() }

    var body: some Scene {
        WindowGroup {
            TabView {
                // Officer-facing surfaces get the tab slots; dev/system
                // consoles live in the SYSTEM hub. 5 tabs max — a 6th makes
                // iOS swallow the rest into an unthemeable stock "More" list.
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
            .preferredColorScheme(.dark)
            .background(Theme.base)
        }
    }
}

// Themed hub for the non-patrol surfaces (D1 console, Cloudflare browser,
// smoke tests, data viewer, settings) — replaces iOS's stock "More" screen.
struct SystemHubView: View {
    private struct Entry: Identifiable {
        let id: String
        let title: String
        let subtitle: String
        let icon: String
        let destination: AnyView
    }

    private var entries: [Entry] {
        [
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
