import SwiftUI
import AudioToolbox

// DashboardView — the post-login home. At-a-glance duty status + live counts
// (active calls, unread notifications, the officer's own assigned call) with
// quick-nav tiles into the field surfaces and a one-tap panic. Polls every 15s.
struct DashboardView: View {
    @State private var onShift = false
    @State private var callSign: String?
    @State private var unitStatus = ""
    @State private var myCallNumber: String?
    @State private var activeCalls = 0
    @State private var unread = 0
    @State private var loading = true
    @State private var status: String?
    @State private var confirmPanic = false

    private var officerName: String { JWTClaims.current()?.name ?? "Officer" }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    HStack(spacing: 6) { OfflineStatusPill(); MDTStatusPill(); Spacer() }
                    greeting
                    statRow
                    quickActions
                    panicButton
                    if let status { StatusLine(text: status) }
                }
                .padding(12)
            }
            .background(Theme.base)
            .navigationTitle("HOME")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await refresh() }
            .task {
                await refresh(); loading = false
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(15))
                    await refresh()
                }
            }
            .alert("SEND PANIC ALARM?", isPresented: $confirmPanic) {
                Button("SEND PANIC", role: .destructive) { Task { await panic() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This creates a Priority-1 OFFICER ASSIST call on the dispatch board.")
            }
        }
    }

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(greetingPrefix + ", \(officerName)")
                .font(.system(size: 18, weight: .semibold)).foregroundStyle(.white)
            HStack(spacing: 6) {
                Circle().fill(onShift ? Theme.green : Theme.neutral).frame(width: 8, height: 8)
                Text(onShift
                     ? "ON DUTY · \(callSign ?? "—") · \(FieldFormat.value("status", unitStatus))"
                     : "OFF DUTY")
                    .font(.system(size: 11)).foregroundStyle(Theme.neutral)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeCard()
    }

    private var statRow: some View {
        HStack(spacing: 8) {
            stat("\(activeCalls)", "Active Calls", Theme.gold)
            stat("\(unread)", "Unread", unread > 0 ? Theme.orange : Theme.neutral)
            stat(myCallNumber ?? "—", "My Call", myCallNumber != nil ? Theme.green : Theme.neutral)
        }
    }

    private func stat(_ value: String, _ label: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.system(size: 20, weight: .bold)).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.5)
            Text(label.uppercased()).font(.system(size: 8, weight: .semibold)).foregroundStyle(Theme.neutral)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 10).themeCard()
    }

    private var quickActions: some View {
        VStack(spacing: 8) {
            SectionHeader(title: "Quick Actions")
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                tile("Workflows", "square.stack.3d.up.fill") { WorkflowHubView() }
                tile("Calls", "list.bullet.rectangle.fill") { CallsQueueView() }
                tile("Alerts", "bell.badge.fill", badge: unread) { NotificationsView() }
                tile("Scan ID", "qrcode.viewfinder") { IDScanView() }
                tile("Lookup", "magnifyingglass") { PersonSearchView() }
                tile("Units Map", "map.fill") { UnitsMapView() }
                tile("My ID", "person.text.rectangle.fill") { WalletIDView() }
            }
        }
    }

    private func tile<D: View>(_ title: String, _ icon: String, badge: Int = 0,
                               @ViewBuilder _ dest: @escaping () -> D) -> some View {
        NavigationLink { dest() } label: {
            VStack(spacing: 6) {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: icon).font(.system(size: 22)).foregroundStyle(Theme.gold)
                        .frame(maxWidth: .infinity)
                    if badge > 0 {
                        Text("\(badge)").font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
                            .padding(4).background(Theme.red).clipShape(Circle()).offset(x: 6, y: -6)
                    }
                }
                Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 16).themeCard()
        }
        .buttonStyle(.plain)
    }

    private var panicButton: some View {
        Button { confirmPanic = true } label: {
            Text("⚠ PANIC")
                .font(.system(size: 16, weight: .heavy))
                .frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(Theme.red).foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
        .padding(.top, 4)
    }

    private var greetingPrefix: String {
        let h = Calendar.current.component(.hour, from: Date())
        switch h { case 5..<12: return "Good morning"; case 12..<17: return "Good afternoon"; default: return "Good evening" }
    }

    // ── Networking ──────────────────────────────────────────
    private func client() async -> RMPGAPIClient? {
        var c = AppConfig.apiClient()
        if c.jwt == nil,
           let u = KeychainStore.load(key: "rmpgUser"), let p = KeychainStore.load(key: "rmpgPass"),
           !u.isEmpty, let t = try? await c.login(username: u, password: p) {
            KeychainStore.save(t, key: "rmpgJWT"); c.jwt = t
        }
        return c.jwt == nil ? nil : c
    }

    private func authed(_ work: (RMPGAPIClient) async throws -> Void) async {
        guard let c = await client() else { status = "✗ Set RMPG credentials in Settings"; return }
        do { try await work(c) } catch { status = "✗ \(error.localizedDescription)" }
    }

    private func rowCount(_ any: Any?) -> Int {
        if let arr = any as? [[String: Any]] { return arr.count }
        if let obj = any as? [String: Any] {
            for k in ["results", "calls", "data", "rows"] { if let arr = obj[k] as? [[String: Any]] { return arr.count } }
        }
        return 0
    }

    private func intField(_ any: Any?, _ keys: [String]) -> Int {
        if let n = any as? Int { return n }
        if let obj = any as? [String: Any] {
            for k in keys { if let n = obj[k] as? Int { return n } }
        }
        return 0
    }

    @MainActor
    private func refresh() async {
        await authed { c in
            if let duty = try await c.requestJSON("GET", "api/dispatch/duty/me") as? [String: Any] {
                onShift = duty["on_shift"] as? Bool ?? false
                if let unit = duty["unit"] as? [String: Any] {
                    callSign = unit["call_sign"] as? String
                    unitStatus = unit["status"] as? String ?? ""
                    if let cid = unit["current_call_id"] as? Int {
                        let call = try? await c.requestJSON("GET", "api/dispatch/calls/\(cid)") as? [String: Any]
                        myCallNumber = (call?["call_number"] as? String) ?? "#\(cid)"
                    } else { myCallNumber = nil }
                }
            }
            activeCalls = rowCount(try await c.requestJSON("GET", "api/dispatch/calls?status=active"))
            unread = intField(try await c.requestJSON("GET", "api/notifications/unread-count"),
                              ["count", "unread", "unread_count", "total"])
        }
    }

    @MainActor
    private func panic() async {
        Haptics.error()
        AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
        await authed { c in
            try await c.requestJSON("POST", "api/dispatch/panic", body: ["trigger_method": "ios_dashboard"])
            status = "✓ PANIC SENT — P1 officer assist on the board"
        }
    }
}
