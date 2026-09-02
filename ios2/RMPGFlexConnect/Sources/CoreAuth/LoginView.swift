import SwiftUI



/// Public so Settings can show/clear the remembered username without a
/// second copy of these UserDefaults keys drifting out of sync.
public enum RememberedUser {
    public static let usernameKey = "rmpg_remembered_username"
    public static let rememberMeKey = "rmpg_remember_me"

    public static var username: String? { UserDefaults.standard.string(forKey: usernameKey) }
    public static var rememberMeDefault: Bool {
        // Default on — most officers re-use the same device/account daily.
        UserDefaults.standard.object(forKey: rememberMeKey) == nil ? true : UserDefaults.standard.bool(forKey: rememberMeKey)
    }

    public static func save(username: String, remember: Bool) {
        UserDefaults.standard.set(remember, forKey: rememberMeKey)
        if remember {
            UserDefaults.standard.set(username, forKey: usernameKey)
        } else {
            UserDefaults.standard.removeObject(forKey: usernameKey)
        }
    }

    /// Forgets the remembered username entirely — used by Settings' "Forget
    /// Remembered Username" action.
    public static func forget() {
        UserDefaults.standard.removeObject(forKey: usernameKey)
        UserDefaults.standard.set(false, forKey: rememberMeKey)
    }
}

public struct LoginView: View {
    @State private var username: String
    @State private var password = ""
    @State private var rememberMe: Bool
    @State private var isLoading = false
    @State private var isBiometricLoading = false
    @State private var errorMessage: String?

    let authManager: AuthManager

    public init(authManager: AuthManager) {
        self.authManager = authManager
        _username = State(initialValue: RememberedUser.username ?? "")
        _rememberMe = State(initialValue: RememberedUser.rememberMeDefault)
    }

    private var showBiometricOption: Bool {
        BiometricLoginPreference.isEnabled && authManager.hasPersistedSession && BiometricAuth.available != .none
    }

    private var biometricUnavailableReason: String {
        if BiometricAuth.available == .none {
            return "Face ID/Touch ID unavailable — not enrolled on this device, or the app lacks permission (check Settings → Face ID & Passcode → RMPG Flex Connect)."
        }
        if !BiometricLoginPreference.isEnabled {
            return "Face ID login is turned off in Settings."
        }
        if !authManager.hasPersistedSession {
            return "Log in once with your password first — Face ID can only unlock a session already saved on this device."
        }
        return ""
    }

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()

            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    BrandLogo(size: 80)

                    Text("RMPG Flex")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(RMPGTheme.textPrimary)
                        .tracking(2)

                    Text("Rocky Mountain Protective Group")
                        .font(.system(size: 11))
                        .foregroundColor(RMPGTheme.textMuted)
                        .tracking(1)
                }
                .padding(.top, 60)

                VStack(spacing: 12) {
                    RMPGTextField(placeholder: "Username", text: $username)
                        .textContentType(.username)

                    RMPGSecureField(placeholder: "Password", text: $password)
                        .textContentType(.password)

                    Button {
                        rememberMe.toggle()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: rememberMe ? "checkmark.square.fill" : "square")
                                .font(.system(size: 14))
                                .foregroundColor(rememberMe ? RMPGTheme.brandGold : RMPGTheme.textMuted)
                            Text("Remember username")
                                .font(.system(size: 11))
                                .foregroundColor(RMPGTheme.textSecondary)
                            Spacer()
                        }
                    }
                }
                .padding(.horizontal, 24)

                if let error = errorMessage {
                    Text(error)
                        .font(.system(size: 11))
                        .foregroundColor(RMPGTheme.statusRed)
                        .padding(.horizontal, 24)
                }

                VStack(spacing: 8) {
                    RMPGPrimaryButton(title: "LOGIN", isLoading: isLoading) {
                        login()
                    }
                    .padding(.horizontal, 24)

                    // Only offered when THIS device already holds a valid
                    // session for some account — Face ID here can never do
                    // more than a password login already could; it just
                    // skips retyping credentials when the officer previously
                    // signed out via "Use Password Instead" on the launch
                    // gate (BiometricLockView) rather than a real Sign Out.
                    if showBiometricOption {
                        Button {
                            attemptBiometricLogin()
                        } label: {
                            HStack(spacing: 8) {
                                if isBiometricLoading {
                                    ProgressView().tint(RMPGTheme.brandGold)
                                } else {
                                    Image(systemName: BiometricAuth.available == .faceID ? "faceid" : "touchid")
                                        .font(.system(size: 14))
                                }
                                Text(BiometricAuth.available == .faceID ? "LOGIN WITH FACE ID" : "LOGIN WITH TOUCH ID")
                                    .font(.system(size: 13, weight: .semibold))
                            }
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .foregroundColor(RMPGTheme.brandGold)
                            .overlay(RoundedRectangle(cornerRadius: 2).stroke(RMPGTheme.brandGold, lineWidth: 1))
                        }
                        .disabled(isBiometricLoading)
                        .padding(.horizontal, 24)
                        .padding(.top, 4)
                    } else {
                        // Diagnostic — pinpoints exactly which precondition is
                        // false instead of the button just silently not
                        // appearing, so this can be read directly off the
                        // device instead of guessed at over chat.
                        Text(biometricUnavailableReason)
                            .font(.system(size: 10))
                            .foregroundColor(RMPGTheme.textMuted)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                            .padding(.top, 4)
                    }
                }
                .padding(.top, 8)

                Spacer()

                Text("v1.0.0 — CONFIDENTIAL")
                    .font(.system(size: 9))
                    .foregroundColor(RMPGTheme.textMuted)
                    .padding(.bottom, 40)
            }
        }
    }

    private func login() {
        guard !username.isEmpty, !password.isEmpty else {
            errorMessage = "Username and password are required"
            return
        }
        isLoading = true
        errorMessage = nil
        Task {
            do {
                try await authManager.login(username: username, password: password)
                RememberedUser.save(username: username, remember: rememberMe)
            } catch {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }

    private func attemptBiometricLogin() {
        isBiometricLoading = true
        errorMessage = nil
        Task {
            let success = await BiometricAuth.attemptLogin(authManager: authManager, reason: "Sign in with Face ID")
            if !success {
                errorMessage = "Face ID sign-in failed — enter your password instead."
            }
            isBiometricLoading = false
        }
    }
}
