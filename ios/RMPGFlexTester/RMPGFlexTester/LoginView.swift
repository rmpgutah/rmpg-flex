import SwiftUI

// LoginView — the app's front door. Branded RMPG sign-in with Face ID / Touch ID
// unlock once credentials are stored. On launch it auto-offers biometric unlock
// when credentials exist; otherwise it shows the username/password form.
struct LoginView: View {
    @EnvironmentObject var session: AuthSession
    @State private var user = KeychainStore.load(key: "rmpgUser") ?? ""
    @State private var pass = ""
    @State private var showPasswordForm = false
    @FocusState private var focused: Field?
    private enum Field { case user, pass }

    private var biometricEntry: Bool {
        session.hasStoredCredentials && session.biometryAvailable && !showPasswordForm
    }

    var body: some View {
        ZStack {
            Theme.base.ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer()
                branding
                Spacer().frame(height: 36)
                if biometricEntry { biometricSection } else { passwordSection }
                if let s = session.status {
                    StatusLine(text: s).padding(.top, 14).padding(.horizontal, 4)
                }
                Spacer(); Spacer()
                Text("RMPG FLEX FIELD · api.rmpgutah.us")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(Theme.neutral)
                    .padding(.bottom, 10)
            }
            .padding(.horizontal, 28)
            .frame(maxWidth: 460)
        }
        .task {
            // Auto-prompt biometric unlock on a fresh launch when we can.
            if biometricEntry { await session.unlockWithBiometrics() }
        }
    }

    private var branding: some View {
        VStack(spacing: 10) {
            Image(systemName: "shield.lefthalf.filled")
                .font(.system(size: 60))
                .foregroundStyle(Theme.gold)
            Text("RMPG FLEX")
                .font(Theme.Typography.title)
                .fontWeight(.bold)
                .foregroundStyle(.white)
                .tracking(3)
            Text("ROCKY MOUNTAIN PROTECTIVE GROUP")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Theme.gold)
                .tracking(2)
        }
    }

    private var biometricSection: some View {
        VStack(spacing: 12) {
            if let name = session.officerName {
                Text("Welcome back, \(name)")
                    .font(Theme.Typography.body).foregroundStyle(Theme.neutral)
            }
            Button { Task { await session.unlockWithBiometrics() } } label: {
                Label("Unlock with \(session.biometryLabel)", systemImage: session.biometrySymbol)
            }
            .buttonStyle(GoldButtonStyle())
            .disabled(session.busy)

            Button("Use password instead") { showPasswordForm = true; focused = .user }
                .font(Theme.Typography.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Theme.neutral)
                .padding(.top, 2)
        }
    }

    private var passwordSection: some View {
        VStack(spacing: 10) {
            field { TextField("Username", text: $user)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .focused($focused, equals: .user).submitLabel(.next)
                .onSubmit { focused = .pass } }
            field { SecureField("Password", text: $pass)
                .focused($focused, equals: .pass).submitLabel(.go)
                .onSubmit { Task { await session.loginWithPassword(user, pass) } } }

            Button { Task { await session.loginWithPassword(user, pass) } } label: {
                Text(session.busy ? "Signing in…" : "Sign In")
            }
            .buttonStyle(GoldButtonStyle())
            .disabled(session.busy || user.isEmpty || pass.isEmpty)
            .padding(.top, 4)

            if session.hasStoredCredentials && session.biometryAvailable {
                Button("Use \(session.biometryLabel) instead") { showPasswordForm = false }
                    .font(Theme.Typography.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Theme.neutral)
                    .padding(.top, 2)
            }
        }
    }

    // Themed input row.
    private func field<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .font(Theme.Typography.body)
            .foregroundStyle(.white)
            .padding(.horizontal, 12).padding(.vertical, 11)
            .background(Theme.sunken)
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }
}
