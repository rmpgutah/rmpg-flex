import SwiftUI





public struct SettingsView: View {
    @State private var serverStatus = "Checking..."
    @State private var serverVersion = ""
    @State private var isChecking = true
    @AppStorage("gps_enabled") private var gpsEnabled = true
    @AppStorage("auto_refresh_seconds") private var refreshInterval = 30.0
    @AppStorage(BiometricLoginPreference.key) private var biometricLoginEnabled = true
    @State private var rememberedUsername: String?
    @State private var showClearHistoryConfirm = false
    @State private var showForgetUserConfirm = false
    @State private var historyClearedMessage: String?
    @State private var showResetConfirm = false
    @State private var resetMessage: String?

    public init() {}

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 12) {
                    serverSection
                    dispatchSection
                    securitySection
                    dataSection
                    aboutSection
                }
                .padding(12)
            }
        }
        .navigationTitle("Settings")
        .task {
            await checkServer()
            rememberedUsername = RememberedUser.username
        }
    }

    private var serverSection: some View {
        VStack(spacing: 0) {
            sectionHeader("Server Connection")
            VStack(spacing: 0) {
                RMPGDataRow(label: "API Endpoint", value: "api.rmpgutah.us")
                RMPGDivider()
                RMPGDataRow(label: "Status", value: serverStatus, accent: serverStatus == "Connected" ? RMPGTheme.statusGreen : RMPGTheme.statusRed)
                RMPGDivider()
                RMPGDataRow(label: "Version", value: serverVersion)
            }
            .background(RMPGTheme.raisedSurface).cornerRadius(2)

            if isChecking {
                HStack { ProgressView().tint(RMPGTheme.brandGold); Spacer() }.padding(.top, 4)
            } else {
                Button("Retry Check") { Task { await checkServer() } }
                    .font(.system(size: 11)).foregroundColor(RMPGTheme.brandGold).padding(.top, 4)
            }
        }
    }

    private var dispatchSection: some View {
        VStack(spacing: 0) {
            sectionHeader("Dispatch Preferences")
            VStack(spacing: 0) {
                ToggleRow("GPS Tracking", $gpsEnabled)
                RMPGDivider()
                HStack {
                    Text("Auto-refresh").font(.system(size: 11)).foregroundColor(RMPGTheme.textMuted)
                    Spacer()
                    Picker("", selection: $refreshInterval) {
                        Text("15s").tag(15.0); Text("30s").tag(30.0); Text("60s").tag(60.0)
                    }
                    .pickerStyle(.menu).tint(RMPGTheme.brandGold)
                }
                .padding(.horizontal, 12).padding(.vertical, 6)
            }
            .background(RMPGTheme.raisedSurface).cornerRadius(2)
        }
    }

    private var securitySection: some View {
        VStack(spacing: 0) {
            sectionHeader("Security")
            VStack(spacing: 0) {
                ToggleRow(BiometricAuth.available == .faceID ? "Face ID Login" : "Touch ID Login", $biometricLoginEnabled)
                RMPGDivider()
                RMPGDataRow(
                    label: "Remembered User",
                    value: rememberedUsername ?? "None"
                )
            }
            .background(RMPGTheme.raisedSurface).cornerRadius(2)

            if BiometricAuth.available == .none {
                Text("Face ID / Touch ID isn't available on this device.")
                    .font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted).padding(.top, 4)
            }

            if rememberedUsername != nil {
                Button("Forget Remembered Username") { showForgetUserConfirm = true }
                    .font(.system(size: 11)).foregroundColor(RMPGTheme.statusRed).padding(.top, 4)
            }
        }
        .alert("Forget Remembered Username?", isPresented: $showForgetUserConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Forget", role: .destructive) {
                RememberedUser.forget()
                rememberedUsername = nil
            }
        } message: {
            Text("The login screen will no longer pre-fill a username.")
        }
    }

    private var dataSection: some View {
        VStack(spacing: 0) {
            sectionHeader("Data")
            VStack(spacing: 0) {
                Button {
                    showClearHistoryConfirm = true
                } label: {
                    HStack {
                        Text("Clear Scan History").font(.system(size: 11)).foregroundColor(RMPGTheme.statusRed)
                        Spacer()
                        Image(systemName: "trash").font(.system(size: 11)).foregroundColor(RMPGTheme.statusRed)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                }
                RMPGDivider()
                Button {
                    showResetConfirm = true
                } label: {
                    HStack {
                        Text("Reset Preferences to Defaults").font(.system(size: 11)).foregroundColor(RMPGTheme.textMuted)
                        Spacer()
                        Image(systemName: "arrow.counterclockwise").font(.system(size: 11)).foregroundColor(RMPGTheme.textMuted)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                }
            }
            .background(RMPGTheme.raisedSurface).cornerRadius(2)

            if let message = historyClearedMessage {
                Text(message).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted).padding(.top, 4)
            }
            if let message = resetMessage {
                Text(message).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted).padding(.top, 4)
            }
        }
        .alert("Clear Scan History?", isPresented: $showClearHistoryConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Clear", role: .destructive) {
                ScanHistoryStore().clear()
                historyClearedMessage = "Scan history cleared. Takes effect next time Quick Actions loads."
            }
        } message: {
            Text("This removes every locally-saved ID scan. This can't be undone.")
        }
        .alert("Reset Preferences?", isPresented: $showResetConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Reset", role: .destructive) { resetPreferences() }
        } message: {
            Text("Restores GPS tracking, auto-refresh, and Face ID login to their defaults. Doesn't sign you out or touch scan history.")
        }
    }

    /// Resets only local device preferences this screen itself owns —
    /// deliberately does NOT touch the auth session (RememberedUser/tokens)
    /// or scan history, which have their own dedicated, explicit controls.
    private func resetPreferences() {
        gpsEnabled = true
        refreshInterval = 30.0
        biometricLoginEnabled = true
        resetMessage = "Preferences reset to defaults."
    }

    private var aboutSection: some View {
        VStack(spacing: 0) {
            sectionHeader("About")
            VStack(spacing: 0) {
                RMPGDataRow(label: "App Version", value: "1.0.0 (Demo)")
                RMPGDivider()
                RMPGDataRow(label: "Build", value: "1")
                RMPGDivider()
                RMPGDataRow(label: "Organization", value: "Rocky Mountain Protective Group")
                RMPGDivider()
                RMPGDataRow(label: "License", value: "Confidential — Law Enforcement Use Only")
            }
            .background(RMPGTheme.raisedSurface).cornerRadius(2)

            // Real support workflow: bundles version/device/connectivity info
            // an IT/help-desk ticket would actually need, so an officer isn't
            // reading server status off this screen aloud over the phone.
            ShareLink(item: diagnosticsText) {
                HStack {
                    Image(systemName: "square.and.arrow.up").font(.system(size: 11))
                    Text("Share Diagnostics").font(.system(size: 11))
                }
                .foregroundColor(RMPGTheme.brandGold)
            }
            .padding(.top, 6)
        }
    }

    private var diagnosticsText: String {
        """
        RMPG Flex Connect Diagnostics
        App Version: 1.0.0 (Build 1)
        API Endpoint: api.rmpgutah.us
        Server Status: \(serverStatus)
        Server Version: \(serverVersion)
        Device: \(UIDevice.current.model), iOS \(UIDevice.current.systemVersion)
        Generated: \(Date().formatted(date: .abbreviated, time: .standard))
        """
    }

    private func sectionHeader(_ t: String) -> some View {
        Text(t.uppercased()).font(.system(size: 9, weight: .semibold)).foregroundColor(RMPGTheme.brandGold).tracking(1).frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 4)
    }

    private func checkServer() async {
        isChecking = true
        do {
            let client = APIClient(baseURL: Endpoint.productionBaseURL)
            struct Health: Codable { let status: String; let version: String? }
            let h: Health = try await client.request(Endpoint(path: "/api/health", requiresAuth: false))
            serverStatus = h.status == "ok" ? "Connected" : h.status
            serverVersion = h.version ?? "—"
        } catch {
            serverStatus = "Unreachable"
            serverVersion = error.localizedDescription
        }
        isChecking = false
    }
}

struct ToggleRow: View {
    let label: String
    @Binding var isOn: Bool
    init(_ l: String, _ b: Binding<Bool>) { label = l; _isOn = b }
    var body: some View {
        HStack {
            Text(label).font(.system(size: 11)).foregroundColor(RMPGTheme.textMuted)
            Spacer()
            Toggle("", isOn: $isOn).tint(RMPGTheme.brandGold).labelsHidden()
        }
        .padding(.horizontal, 12).padding(.vertical, 4)
    }
}
