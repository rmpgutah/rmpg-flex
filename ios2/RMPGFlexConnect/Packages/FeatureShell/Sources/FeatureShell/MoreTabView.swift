import SwiftUI
import DesignSystem
import CoreAuth

@MainActor
public struct MoreTabView: View {
    @Environment(\.theme) private var theme
    @Bindable var session: AuthSession
    @State private var showSignOutConfirm = false

    public init(session: AuthSession) {
        self.session = session
    }

    public var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()
                List {
                    Section {
                        profileRow
                    }
                    .listRowBackground(theme.colors.surfaceRaised)

                    Section("SYSTEM") {
                        infoRow(label: "API", value: "api.rmpgutah.us")
                        infoRow(label: "App", value: "RMPG Flex Connect M1")
                        infoRow(label: "Role", value: session.role.map { "\($0)" } ?? "—")
                    }
                    .listRowBackground(theme.colors.surfaceRaised)

                    Section {
                        Button(role: .destructive) {
                            showSignOutConfirm = true
                        } label: {
                            HStack {
                                Image(systemName: "rectangle.portrait.and.arrow.right")
                                Text("Sign Out")
                                    .foregroundStyle(theme.colors.critical)
                            }
                        }
                    }
                    .listRowBackground(theme.colors.surfaceRaised)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("MORE")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .confirmationDialog("Sign out of RMPG Flex?", isPresented: $showSignOutConfirm, titleVisibility: .visible) {
                Button("Sign Out", role: .destructive) { session.signOut() }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    private var profileRow: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(theme.colors.brandGold)
                    .frame(width: 48, height: 48)
                Image(systemName: "person.fill")
                    .font(.title3)
                    .foregroundStyle(theme.colors.surfaceBase)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Signed In")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(theme.colors.textPrimary)
                Text(session.role.map { "\($0)" } ?? "Officer")
                    .font(.caption)
                    .foregroundStyle(theme.colors.textSecondary)
            }
            Spacer()
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(theme.colors.success)
        }
        .padding(.vertical, 4)
    }

    private func infoRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(theme.colors.textMuted)
                .frame(width: 60, alignment: .leading)
            Text(value)
                .font(.caption)
                .foregroundStyle(theme.colors.textSecondary)
            Spacer()
        }
    }
}
