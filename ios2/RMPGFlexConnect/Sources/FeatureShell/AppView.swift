import SwiftUI














public struct AppView: View {
    @StateObject private var authManager: AuthManager
    private let apiClient: APIClient
    @State private var hasRestored = false
    @State private var showBiometricLock = false
    @State private var isAuthenticatingBiometrics = false
    @State private var biometricErrorMessage: String?
    @Environment(\.scenePhase) private var scenePhase

    public init(apiClient: APIClient) {
        self.apiClient = apiClient
        _authManager = StateObject(wrappedValue: AuthManager(apiClient: apiClient))
    }

    public var body: some View {
        Group {
            if !hasRestored {
                ZStack {
                    RMPGTheme.baseBlack.ignoresSafeArea()
                    VStack(spacing: 16) {
                        BrandLogo(size: 96)
                        ProgressView().tint(RMPGTheme.brandGold)
                    }
                }
            } else if showBiometricLock && !authManager.isAuthenticated {
                BiometricLockView(
                    isAuthenticating: isAuthenticatingBiometrics,
                    errorMessage: biometricErrorMessage,
                    onRetry: { Task { await attemptBiometricUnlock() } },
                    onUsePassword: { showBiometricLock = false }
                )
            } else if authManager.isAuthenticated {
                MainTabView(authManager: authManager, apiClient: apiClient)
            } else {
                LoginView(authManager: authManager)
            }
        }
        .task {
            // A persisted session (from a prior password login) is gated
            // behind Face ID / Touch ID before it's silently restored — the
            // standard "unlock the app" pattern, with password as the
            // built-in fallback if biometrics are unavailable, declined, or
            // disabled in Settings (BiometricLoginPreference).
            //
            // IMPORTANT: this block only flips the flags that reveal
            // BiometricLockView — it must NOT also call
            // attemptBiometricUnlock() itself. BiometricLockView's own
            // .onAppear already triggers the first attempt, and firing it
            // from both places raced two concurrent LAContext.evaluatePolicy
            // calls (iOS rejects/cancels whichever loses that race), which
            // is exactly what made Face ID unlock intermittently just fail.
            if BiometricLoginPreference.isEnabled, authManager.hasPersistedSession, BiometricAuth.available != .none {
                showBiometricLock = true
                hasRestored = true
            } else {
                await authManager.restoreSession()
                hasRestored = true
            }
        }
    }

    private func attemptBiometricUnlock() async {
        // Re-entrancy guard: belt-and-suspenders against any future call
        // site duplicating the race this just got fixed for.
        guard !isAuthenticatingBiometrics else { return }
        isAuthenticatingBiometrics = true
        biometricErrorMessage = nil

        // LAContext.evaluatePolicy silently fails (or never shows its sheet)
        // if called before the app's window is truly key/active — which the
        // very first launch-time trigger here can race, since it fires
        // essentially the instant AppView appears. A previous "startup
        // performance" pass removed a 2-second artificial splash delay that
        // had been masking this timing issue; the fix isn't to bring that
        // delay back (it made every launch slow regardless), it's to wait
        // for `scenePhase` to actually report `.active` before prompting.
        var waited = 0
        while scenePhase != .active, waited < 20 {
            try? await Task.sleep(nanoseconds: 100_000_000)
            waited += 1
        }

        // Shared with LoginView's explicit "Login with Face ID" button —
        // one place deciding "can we, should we, did it work."
        let success = await BiometricAuth.attemptLogin(authManager: authManager)
        if success {
            showBiometricLock = false
        } else {
            // A prior version left this silent on failure — cancelling the
            // Face ID prompt (on purpose or by accident) just re-showed the
            // same button with zero explanation, which reads as "broken"
            // even when the underlying mechanism is working correctly.
            biometricErrorMessage = "Face ID didn't unlock. Try again, or use your password."
        }
        isAuthenticatingBiometrics = false
    }
}

struct BiometricLockView: View {
    let isAuthenticating: Bool
    let errorMessage: String?
    let onRetry: () -> Void
    let onUsePassword: () -> Void

    var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 24) {
                BrandLogo(size: 96)

                VStack(spacing: 8) {
                    Text("RMPG Flex")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundColor(RMPGTheme.textPrimary)
                        .tracking(2)
                    Text(BiometricAuth.available == .faceID ? "Face ID required to unlock" : "Touch ID required to unlock")
                        .font(.system(size: 12))
                        .foregroundColor(RMPGTheme.textMuted)
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.system(size: 11))
                        .foregroundColor(RMPGTheme.statusRed)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                if isAuthenticating {
                    ProgressView().tint(RMPGTheme.brandGold)
                } else {
                    VStack(spacing: 12) {
                        Button(action: onRetry) {
                            HStack(spacing: 8) {
                                Image(systemName: BiometricAuth.available == .faceID ? "faceid" : "touchid")
                                Text(BiometricAuth.available == .faceID ? "UNLOCK WITH FACE ID" : "UNLOCK WITH TOUCH ID")
                                    .font(.system(size: 13, weight: .semibold))
                            }
                            .frame(maxWidth: 260)
                            .padding(.vertical, 14)
                            .background(RMPGTheme.brandGold)
                            .foregroundColor(.black)
                            .cornerRadius(2)
                        }

                        Button("Use Password Instead", action: onUsePassword)
                            .font(.system(size: 12))
                            .foregroundColor(RMPGTheme.textMuted)
                    }
                }
            }
        }
        .onAppear { if !isAuthenticating { onRetry() } }
    }
}


struct MainTabView: View {
    @ObservedObject var authManager: AuthManager
    let apiClient: APIClient
    @State private var selectedTab = 0
    // Held here (not inside StartPatrolView) so on-duty status and the
    // shift-elapsed timer survive switching away to another tab and back.
    @State private var dutyState = DutyState()

    var body: some View {
        VStack(spacing: 0) {
            DemoBanner()
            TabView(selection: $selectedTab) {
                NavigationStack {
                    DispatchView(api: DispatchAPI(client: apiClient))
                        .toolbar {
                            ToolbarItem(placement: .navigationBarTrailing) {
                                NavigationLink(destination: UnitBoardView(api: DispatchAPI(client: apiClient))) {
                                    Image(systemName: "person.3.fill").font(.system(size: 14)).foregroundColor(RMPGTheme.brandGold)
                                }
                            }
                        }
                }
                .tabItem { Image(systemName: "antenna.radiowaves.left.and.right"); Text("Dispatch") }.tag(0)

                QuickActionsView(apiClient: apiClient)
                    .tabItem { Image(systemName: "bolt.fill"); Text("Actions") }.tag(1)

                IncidentsView(apiClient: apiClient)
                    .tabItem { Image(systemName: "doc.text.fill"); Text("Incidents") }.tag(2)

                CasesView(apiClient: apiClient)
                    .tabItem { Image(systemName: "briefcase.fill"); Text("Cases") }.tag(3)

                WarrantsView(apiClient: apiClient)
                    .tabItem { Image(systemName: "doc.text.magnifyingglass"); Text("Warrants") }.tag(4)

                RecordsView(apiClient: apiClient)
                    .tabItem { Image(systemName: "folder.fill"); Text("Records") }.tag(5)

                FleetView(apiClient: apiClient)
                    .tabItem { Image(systemName: "car.fill"); Text("Fleet") }.tag(6)

                ServeView(apiClient: apiClient)
                    .tabItem { Image(systemName: "envelope.fill"); Text("Serve") }.tag(7)

                PatrolView(apiClient: apiClient)
                    .tabItem { Image(systemName: "map.fill"); Text("Patrol") }.tag(8)

                NavigationStack { SettingsView() }
                    .tabItem { Image(systemName: "gearshape.fill"); Text("Settings") }.tag(9)

                ProfileView(authManager: authManager)
                    .tabItem { Image(systemName: "person.fill"); Text("Profile") }.tag(10)

                StartPatrolView(dutyState: dutyState, apiClient: apiClient)
                    .tabItem { Image(systemName: "clock.badge.checkmark.fill"); Text("Duty") }.tag(11)
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
    @State private var showChangePassword = false

    var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 0) {
                PanelTitleBar(title: "Profile", icon: "person.fill")
                RMPGDivider()
                if let user = authManager.currentUser {
                    ScrollView {
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

                            Button {
                                showChangePassword = true
                            } label: {
                                HStack {
                                    Image(systemName: "key.fill").font(.system(size: 13))
                                    Text("Change Password").font(.system(size: 13, weight: .semibold))
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.system(size: 10))
                                }
                                .foregroundColor(RMPGTheme.textPrimary)
                                .padding(.horizontal, 12).padding(.vertical, 12)
                                .background(RMPGTheme.raisedSurface).cornerRadius(2)
                            }
                            .padding(.horizontal, 16)

                            Spacer(minLength: 24)
                            RMPGDestructiveButton(title: "LOG OUT") { showLogoutConfirm = true }
                                .padding(.horizontal, 16).padding(.bottom, 40)
                        }
                    }
                    .refreshable { await authManager.restoreSession() }
                }
            }
        }
        .alert("Log Out", isPresented: $showLogoutConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Log Out", role: .destructive) { Task { await authManager.logout() } }
        } message: { Text("Are you sure? GPS tracking will stop.") }
        .sheet(isPresented: $showChangePassword) {
            ChangePasswordView(authManager: authManager)
        }
    }
}

/// POST /api/auth/change-password (verified against src/routes/auth.ts) —
/// server policy requires 8+ characters with upper/lower/number/special.
struct ChangePasswordView: View {
    @ObservedObject var authManager: AuthManager
    @Environment(\.dismiss) private var dismiss

    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var successMessage: String?

    var body: some View {
        NavigationStack {
            ZStack {
                RMPGTheme.baseBlack.ignoresSafeArea()
                VStack(spacing: 16) {
                    VStack(spacing: 12) {
                        RMPGSecureField(placeholder: "Current Password", text: $currentPassword)
                            .textContentType(.password)
                        RMPGSecureField(placeholder: "New Password", text: $newPassword)
                            .textContentType(.newPassword)
                        RMPGSecureField(placeholder: "Confirm New Password", text: $confirmPassword)
                            .textContentType(.newPassword)
                    }
                    .padding(.horizontal, 24).padding(.top, 24)

                    Text("Minimum 8 characters, with an uppercase letter, lowercase letter, number, and special character.")
                        .font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted)
                        .padding(.horizontal, 24)
                        .multilineTextAlignment(.center)

                    if let error = errorMessage {
                        Text(error).font(.system(size: 11)).foregroundColor(RMPGTheme.statusRed).padding(.horizontal, 24)
                    }
                    if let success = successMessage {
                        Text(success).font(.system(size: 11)).foregroundColor(RMPGTheme.statusGreen).padding(.horizontal, 24)
                    }

                    RMPGPrimaryButton(title: "UPDATE PASSWORD", isLoading: isSubmitting) {
                        submit()
                    }
                    .padding(.horizontal, 24)

                    Spacer()
                }
            }
            .navigationTitle("Change Password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func submit() {
        guard !currentPassword.isEmpty, !newPassword.isEmpty else {
            errorMessage = "All fields are required"; return
        }
        guard newPassword == confirmPassword else {
            errorMessage = "New passwords don't match"; return
        }
        isSubmitting = true
        errorMessage = nil
        successMessage = nil
        Task {
            do {
                try await authManager.changePassword(current: currentPassword, new: newPassword)
                successMessage = "Password updated."
                currentPassword = ""; newPassword = ""; confirmPassword = ""
            } catch {
                errorMessage = error.localizedDescription
            }
            isSubmitting = false
        }
    }
}
