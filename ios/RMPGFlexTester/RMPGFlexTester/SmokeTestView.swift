import SwiftUI

struct SmokeRoute: Identifiable {
    let id: String
    let path: String
    let needsAuth: Bool
    var outcome: SmokeOutcome?
}

struct SmokeTestView: View {
    @State private var routes: [SmokeRoute] = [
        SmokeRoute(id: "health", path: "api/health", needsAuth: false, outcome: nil),
        SmokeRoute(id: "calls", path: "api/dispatch/calls?limit=1", needsAuth: true, outcome: nil),
        SmokeRoute(id: "units", path: "api/dispatch/units", needsAuth: true, outcome: nil),
        SmokeRoute(id: "warrants", path: "api/warrants?limit=1", needsAuth: true, outcome: nil),
        SmokeRoute(id: "persons", path: "api/records/persons?limit=1", needsAuth: true, outcome: nil),
    ]
    @State private var running = false
    @State private var note: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                Button(action: { Task { await runAll() } }) {
                    Text(running ? "RUNNING…" : "RUN ALL")
                        .font(.system(size: 12, weight: .semibold))
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                        .background(Theme.gold).foregroundStyle(.black)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                }
                .disabled(running)

                if let note {
                    Text(note).font(.system(size: 11)).foregroundStyle(Theme.orange)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                List(routes) { route in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("/" + route.path.split(separator: "?")[0])
                                .font(.system(size: 12, design: .monospaced))
                            if route.needsAuth {
                                Text("authenticated").font(.system(size: 9)).foregroundStyle(Theme.neutral)
                            }
                        }
                        Spacer()
                        badge(for: route.outcome)
                    }
                    .listRowBackground(Theme.raised)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
            .padding(12)
            .background(Theme.base)
            .navigationTitle("API SMOKE TESTS")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    @ViewBuilder
    private func badge(for outcome: SmokeOutcome?) -> some View {
        switch outcome {
        case nil:
            Text("—").foregroundStyle(Theme.neutral)
        case .pass(let code, let ms):
            Text("PASS \(code) · \(ms)ms")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Theme.gold)
        case .fail(let code, let body):
            VStack(alignment: .trailing) {
                Text("FAIL \(code)").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.red)
                Text(body.prefix(40)).font(.system(size: 8)).foregroundStyle(Theme.neutral)
            }
        case .wafChallenge:
            Text("WAF CHALLENGE")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Theme.orange)
        case .transport(let msg):
            Text(msg.prefix(30)).font(.system(size: 9)).foregroundStyle(Theme.red)
        }
    }

    @MainActor
    private func runAll() async {
        running = true
        note = nil
        defer { running = false }

        var client = AppConfig.apiClient()
        // Refresh the JWT first if credentials are stored.
        if let user = KeychainStore.load(key: "rmpgUser"),
           let pass = KeychainStore.load(key: "rmpgPass"),
           !user.isEmpty {
            do {
                let token = try await client.login(username: user, password: pass)
                KeychainStore.save(token, key: "rmpgJWT")
                client.jwt = token
            } catch {
                note = "Login failed: \(error.localizedDescription) — authed routes will 401."
            }
        } else if client.jwt == nil {
            note = "No RMPG credentials in Settings — authed routes will 401."
        }

        for i in routes.indices {
            routes[i].outcome = nil
        }
        for i in routes.indices {
            routes[i].outcome = await client.probe(routes[i].path)
        }
    }
}
