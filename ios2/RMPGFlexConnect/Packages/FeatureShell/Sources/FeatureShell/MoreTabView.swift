import SwiftUI
import DesignSystem
import CoreAuth
import FeatureReports

@MainActor
public struct MoreTabView: View {
    @Environment(\.theme) private var theme
    @Bindable var session: AuthSession
    @State private var showSignOutConfirm = false
    @State private var showDAR = false
    @State private var showMedical = false

    public init(session: AuthSession) {
        self.session = session
    }

    public var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()
                List {
                    Section("PATROL") {
                        NavigationLink("Duty Roster") { PlaceholderScreen(title: "Duty Roster", milestone: "M1") }
                        NavigationLink("Live Alerts") { PlaceholderScreen(title: "Live Alerts", milestone: "M1") }
                        NavigationLink("Watchlist") { PlaceholderScreen(title: "Watchlist", milestone: "M1") }
                        NavigationLink("Fleet Readiness") { PlaceholderScreen(title: "Fleet Readiness", milestone: "M1") }
                    }
                    .listRowBackground(theme.colors.surfaceRaised)

                    Section("REPORTS & RECORDS") {
                        Button { showDAR = true } label: {
                            Label("Daily Activity Report", systemImage: "doc.text")
                        }
                        NavigationLink("Field Interview Cards") { FieldInterviewCardView() }
                        NavigationLink("Citations") { CitationView() }
                    }
                    .listRowBackground(theme.colors.surfaceRaised)

                    Section("TOOLKIT") {
                        NavigationLink("Field Calculator") { FieldCalcPlaceholder() }
                        NavigationLink("Unit Converter") { FieldCalcPlaceholder() }
                    }
                    .listRowBackground(theme.colors.surfaceRaised)

                    Section("MEDICAL") {
                        Button { showMedical = true } label: {
                            Label("TECC / BLS / Trauma", systemImage: "cross.case")
                        }
                    }
                    .listRowBackground(theme.colors.surfaceRaised)

                    Section("SYSTEM") {
                        infoRow("API", "api.rmpgutah.us")
                        infoRow("App", "RMPG Flex Connect M1")
                        infoRow("Role", session.role.map { "\($0)" } ?? "—")
                    }
                    .listRowBackground(theme.colors.surfaceRaised)

                    Section {
                        Button(role: .destructive) { showSignOutConfirm = true } label: {
                            HStack {
                                Image(systemName: "rectangle.portrait.and.arrow.right")
                                Text("Sign Out").foregroundStyle(theme.colors.critical)
                            }
                        }
                    }
                    .listRowBackground(theme.colors.surfaceRaised)
                }
                .listStyle(.plain).scrollContentBackground(.hidden)
            }
            .navigationTitle("MORE")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .confirmationDialog("Sign out of RMPG Flex?", isPresented: $showSignOutConfirm, titleVisibility: .visible) {
                Button("Sign Out", role: .destructive) { session.signOut() }
                Button("Cancel", role: .cancel) {}
            }
            .sheet(isPresented: $showDAR) { DailyActivityReportView() }
            .sheet(isPresented: $showMedical) { MedicalHubView() }
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

// MARK: - Medical Hub (M10 scaffold)

struct MedicalHubView: View {
    @Environment(\.theme) private var theme

    var body: some View {
        NavigationStack {
            List {
                Section("TRAUMA") {
                    Text("TECC / MARCH Algorithm")
                    Text("Bleeding Control")
                    Text("Tourniquet Application")
                }
                Section("MEDICAL") {
                    Text("CPR Coach")
                    Text("AED Guide")
                    Text("Narcan Administration")
                }
                Section("TRIAGE") {
                    Text("START Triage")
                    Text("GCS Calculator")
                    Text("MCI Management")
                }
            }
            .navigationTitle("FIELD MEDICAL")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Field Calc Placeholder

struct FieldCalcPlaceholder: View {
    @Environment(\.theme) private var theme

    var body: some View {
        ZStack {
            theme.colors.surfaceBase.ignoresSafeArea()
            VStack(spacing: 12) {
                Image(systemName: "function").font(.system(size: 48)).foregroundColor(theme.colors.textMuted)
                Text("FIELD CALCULATOR").font(.title3).bold().foregroundColor(theme.colors.brandGold)
                Text("Phonetic speller, skid-to-speed, sunrise/set,\nhaversine distance, unit converter")
                    .font(.caption).multilineTextAlignment(.center).foregroundColor(theme.colors.textSecondary)
            }
        }
    }
}
