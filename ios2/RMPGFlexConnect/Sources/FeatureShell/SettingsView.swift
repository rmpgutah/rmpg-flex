import SwiftUI
import CoreAPI
import DesignSystem

public struct SettingsView: View {
    @State private var serverStatus = "Checking..."
    @State private var serverVersion = ""
    @State private var isChecking = true
    @AppStorage("gps_enabled") private var gpsEnabled = true
    @AppStorage("auto_refresh_seconds") private var refreshInterval = 30.0

    public init() {}

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 12) {
                    serverSection
                    dispatchSection
                    aboutSection
                }
                .padding(12)
            }
        }
        .navigationTitle("Settings")
        .task { await checkServer() }
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
        }
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
