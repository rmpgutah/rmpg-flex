import SwiftUI
import DesignSystem
import CoreAPI
import CoreAuth
import CoreLocationService
import FeatureCFS
import FeatureMap

public struct SupervisorShell: View {
    public static let tabs: [TabSpec] = [
        TabSpec(id: "command", title: "Command", systemImage: "shield.lefthalf.filled", milestone: "M2"),
        TabSpec(id: "units",   title: "Units",   systemImage: "mappin.and.ellipse",     milestone: "M2"),
        TabSpec(id: "cfs",     title: "CFS",     systemImage: "list.bullet.rectangle",  milestone: "M2"),
        TabSpec(id: "more",    title: "More",    systemImage: "ellipsis.circle",        milestone: "M2"),
    ]

    @Bindable var session: AuthSession
    @State private var gpsProvider = GPSProvider()
    @State private var boloComposer = false

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
            CommandDashboardView(apiClient: apiClient, gpsProvider: gpsProvider)
                .tabItem { Label("Command", systemImage: "shield.lefthalf.filled") }

            UnitMapView(
                apiClient: UnitMapAPIClient(baseURL: URL(string: "https://api.rmpgutah.us")!, tokenProvider: { KeychainStore.get(AuthSession.tokenKey) }),
                gpsProvider: gpsProvider
            )
                .tabItem { Label("Units", systemImage: "mappin.and.ellipse") }

            CFSTabView(vm: CallsViewModel(api: CFSAPI(client: apiClient)))
                .tabItem { Label("CFS", systemImage: "list.bullet.rectangle") }

            SupervisorMoreView(session: session, boloComposer: $boloComposer)
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
        }
        .tint(ThemeColors.night.brandGold)
    }
}

// MARK: - Command Dashboard

@MainActor
public struct CommandDashboardView: View {
    @Environment(\.theme) private var theme
    let apiClient: APIClient
    let gpsProvider: GPSProvider
    @State private var onDutyCount = 0
    @State private var activeCriticalCount = 0
    @State private var avgResponseTime = "—"
    @State private var pendingApprovals = 0

    public var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 14) {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                            CommandStat(value: "\(onDutyCount)", label: "ON DUTY", icon: "person.fill")
                            CommandStat(value: "\(activeCriticalCount)", label: "CRITICAL", icon: "exclamationmark.shield.fill", color: .red)
                            CommandStat(value: avgResponseTime, label: "AVG RESPONSE", icon: "clock")
                            CommandStat(value: "\(pendingApprovals)", label: "APPROVALS", icon: "doc.badge.clock", color: theme.colors.brandGold)
                        }
                        Text("ON DUTY UNITS").font(.headline).padding(.top, 8)
                        ForEach(0..<max(onDutyCount, 3), id: \.self) { i in
                            UnitBriefRow(callSign: "C\(342 + i)", status: "10-8", location: "Salt Lake City")
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle("COMMAND")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .task { await loadDashboard() }
        }
    }

    private func loadDashboard() async {
        onDutyCount = Int.random(in: 4...12)
        activeCriticalCount = Int.random(in: 0...3)
        avgResponseTime = "\(Int.random(in: 4...12))m"
        pendingApprovals = Int.random(in: 0...5)
        try? await Task.sleep(nanoseconds: 15_000_000_000)
        if !Task.isCancelled { await loadDashboard() }
    }
}

struct CommandStat: View {
    @Environment(\.theme) private var theme
    let value: String
    let label: String
    let icon: String
    var color: Color?

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: icon).font(.title3).foregroundStyle(color ?? theme.colors.brandGold)
            Text(value).font(.title.weight(.black).monospacedDigit()).foregroundStyle(theme.colors.textPrimary)
            Text(label).font(.caption2.weight(.semibold)).foregroundStyle(theme.colors.textMuted)
        }
        .frame(maxWidth: .infinity).padding(14)
        .background(theme.colors.surfaceRaised).cornerRadius(2)
        .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder((color ?? theme.colors.brandGold).opacity(0.2), lineWidth: 1))
    }
}

struct UnitBriefRow: View {
    @Environment(\.theme) private var theme
    let callSign: String
    let status: String
    let location: String

    var body: some View {
        HStack {
            Circle().fill(statusColor).frame(width: 10, height: 10)
            Text(callSign).font(.subheadline.weight(.semibold))
            Text(status).font(.caption).foregroundColor(.secondary)
            Spacer()
            Text(location).font(.caption).foregroundColor(.secondary)
        }
        .padding(10)
        .background(theme.colors.surfaceRaised).cornerRadius(2)
    }

    private var statusColor: Color {
        switch status {
        case "10-8": return .green
        case "10-97": return .orange
        case "10-98": return .red
        default: return .gray
        }
    }
}

// MARK: - Supervisor More

@MainActor
struct SupervisorMoreView: View {
    @Environment(\.theme) private var theme
    @Bindable var session: AuthSession
    @Binding var boloComposer: Bool
    @State private var showSignOut = false

    var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()
                List {
                    Section("COMMAND") {
                        Button { boloComposer = true } label: {
                            Label("Push BOLO", systemImage: "eye")
                        }
                        NavigationLink("Roster") { PlaceholderScreen(title: "Roster", milestone: "M2") }
                        NavigationLink("Audit Log") { PlaceholderScreen(title: "Audit Log", milestone: "M2") }
                        NavigationLink("Approvals") { PlaceholderScreen(title: "Approvals", milestone: "M2") }
                    }
                    .listRowBackground(theme.colors.surfaceRaised)

                    Section("SYSTEM") {
                        infoRow("API", "api.rmpgutah.us")
                        infoRow("App", "RMPG Flex Connect M2")
                        infoRow("Role", session.role.map { "\($0)" } ?? "—")
                    }
                    .listRowBackground(theme.colors.surfaceRaised)

                    Section {
                        Button(role: .destructive) { showSignOut = true } label: {
                            Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                                .foregroundStyle(theme.colors.critical)
                        }
                    }
                    .listRowBackground(theme.colors.surfaceRaised)
                }
                .listStyle(.plain).scrollContentBackground(.hidden)
            }
            .navigationTitle("MORE")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .confirmationDialog("Sign out?", isPresented: $showSignOut, titleVisibility: .visible) {
                Button("Sign Out", role: .destructive) { session.signOut() }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.caption.weight(.semibold)).foregroundColor(theme.colors.textMuted)
                .frame(width: 60, alignment: .leading)
            Text(value).font(.caption).foregroundColor(theme.colors.textSecondary)
            Spacer()
        }
    }
}
