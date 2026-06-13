import SwiftUI

struct SettingsView: View {
    @State private var cfAccountId = KeychainStore.load(key: "cfAccountId") ?? ""
    @State private var cfDatabaseId = KeychainStore.load(key: "cfDatabaseId") ?? AppConfig.liveDatabaseId
    @State private var cfToken = KeychainStore.load(key: "cfToken") ?? ""
    @State private var rmpgUser = KeychainStore.load(key: "rmpgUser") ?? ""
    @State private var rmpgPass = KeychainStore.load(key: "rmpgPass") ?? ""
    @State private var verifierToken = KeychainStore.load(key: "verifierToken") ?? ""
    @State private var status: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section("CLOUDFLARE (D1 CONSOLE / DATA VIEWER)") {
                    TextField("Account ID", text: $cfAccountId)
                        .autocorrectionDisabled().textInputAutocapitalization(.never)
                    TextField("Database ID", text: $cfDatabaseId)
                        .autocorrectionDisabled().textInputAutocapitalization(.never)
                    SecureField("API Token (D1 read/write scope)", text: $cfToken)
                    Button("Test D1 (SELECT 1)") { Task { await testD1() } }
                        .disabled(busy)
                }
                Section("RMPG FLEX (SMOKE TESTS)") {
                    TextField("Username", text: $rmpgUser)
                        .autocorrectionDisabled().textInputAutocapitalization(.never)
                    SecureField("Password", text: $rmpgPass)
                    Button("Test login") { Task { await testLogin() } }
                        .disabled(busy)
                }
                Section("WIRELESS ID (APPLE VERIFIER API)") {
                    SecureField("Reader token (valid ~48 h)", text: $verifierToken)
                    Text("From Apple's verifier service after Business Connect enrollment; the bundle id also needs the Verifier API capability in Xcode.")
                        .font(.system(size: 10)).foregroundStyle(Theme.neutral)
                }
                Section {
                    Button("Save all to Keychain") { save() }
                        .fontWeight(.semibold)
                    if let status {
                        Text(status).font(.system(size: 11, design: .monospaced))
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle("SETTINGS")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func save() {
        KeychainStore.save(cfAccountId.trimmingCharacters(in: .whitespaces), key: "cfAccountId")
        KeychainStore.save(cfDatabaseId.trimmingCharacters(in: .whitespaces), key: "cfDatabaseId")
        KeychainStore.save(cfToken.trimmingCharacters(in: .whitespaces), key: "cfToken")
        KeychainStore.save(rmpgUser.trimmingCharacters(in: .whitespaces), key: "rmpgUser")
        KeychainStore.save(rmpgPass, key: "rmpgPass")
        KeychainStore.save(verifierToken.trimmingCharacters(in: .whitespacesAndNewlines), key: "verifierToken")
        status = "Saved."
    }

    @MainActor
    private func testD1() async {
        save()
        guard let client = AppConfig.d1Client() else { status = "Missing account ID or token."; return }
        busy = true; defer { busy = false }
        do {
            _ = try await client.query("SELECT 1 AS ok")
            status = "✓ D1 reachable — credentials valid."
        } catch {
            status = "✗ \(error.localizedDescription)"
        }
    }

    @MainActor
    private func testLogin() async {
        save()
        busy = true; defer { busy = false }
        do {
            let token = try await AppConfig.apiClient().login(username: rmpgUser, password: rmpgPass)
            KeychainStore.save(token, key: "rmpgJWT")
            status = "✓ Logged in — JWT cached."
        } catch {
            status = "✗ \(error.localizedDescription)"
        }
    }
}
