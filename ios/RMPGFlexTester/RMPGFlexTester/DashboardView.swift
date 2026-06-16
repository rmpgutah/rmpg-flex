import SwiftUI
import AudioToolbox

// DashboardView — the post-login home. State-aware: shows a running shift timer
// when on duty, a live-timer active-call card when on a call, a contextual
// primary action (Start Shift / Open Call), connectivity + GPS pills, and quick
// tiles. Counts come from the app-wide LiveCounts so they match the tab badges.
struct DashboardView: View {
    @ObservedObject private var counts = LiveCounts.shared
    @Environment(\.scenePhase) private var scenePhase

    @State private var onShift = false
    @State private var callSign: String?
    @State private var unitStatus = ""
    @State private var myCallNumber: String?
    @State private var shiftClockIn: Date?
    @State private var activeCallStartedAt: Date?
    @State private var loading = true
    @State private var status: String?
    @State private var confirmPanic = false
    @State private var showCommand = false

    private var officerName: String { JWTClaims.current()?.name ?? "Officer" }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    HStack(spacing: 6) { OfflineStatusPill(); MDTStatusPill(); GPSStatusPill(); Spacer() }
                    commandBar
                    greeting
                    contextualBanner
                    statRow
                    quickActions
                    if let status { StatusLine(text: status) }
                }
                .padding(12)
            }
            .background(Theme.base)
            .safeAreaInset(edge: .bottom) {
                ResponderActionBar(
                    currentStatus: "",
                    statuses: [],
                    showStatus: false,
                    onSelectStatus: { _ in },
                    onPanic: { confirmPanic = true })
            }
            .navigationTitle("HOME")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await refresh(); await counts.refresh() }
            .task {
                await refresh(); loading = false
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(15))
                    await refresh()
                }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await refresh(); await counts.refresh() } }
            }
            .alert("SEND PANIC ALARM?", isPresented: $confirmPanic) {
                Button("SEND PANIC", role: .destructive) { Task { await panic() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This creates a Priority-1 OFFICER ASSIST call on the dispatch board.")
            }
            .sheet(isPresented: $showCommand) { CommandSearchView() }
        }
    }

    private var commandBar: some View {
        Button { showCommand = true } label: {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundStyle(Theme.gold)
                Text("Search anyone · plate · call · warrant…")
                    .font(.system(size: 12)).foregroundStyle(Theme.neutral)
                Spacer()
                Image(systemName: "command").font(.system(size: 12)).foregroundStyle(Theme.neutral)
            }
            .padding(10).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(greetingPrefix + ", \(officerName)")
                .font(Theme.Typography.title).fontWeight(.semibold).foregroundStyle(.white)
            HStack(spacing: 6) {
                Circle().fill(onShift ? Theme.green : Theme.neutral).frame(width: 8, height: 8)
                Text(onShift
                     ? "ON DUTY · \(callSign ?? "—") · \(FieldFormat.value("status", unitStatus))"
                     : "OFF DUTY")
                    .font(.system(size: 11)).foregroundStyle(Theme.neutral)
                if onShift, let start = shiftClockIn {
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        Text("· ⏱ \(ElapsedClock.elapsed(since: start, now: ctx.date))")
                            .font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.gold)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeCard()
    }

    // State-aware primary action: off duty → Start Shift (→ Field Ops); on a call
    // → a live-timer active-call card (→ Calls Queue). Idle on duty → nothing.
    @ViewBuilder private var contextualBanner: some View {
        if !onShift {
            NavigationLink { FieldOpsView() } label: {
                HStack(spacing: 8) {
                    Image(systemName: "play.circle.fill").font(.system(size: 18)).foregroundStyle(.black)
                    Text("START SHIFT").font(.system(size: 14, weight: .heavy)).foregroundStyle(.black)
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(.black)
                }
                .padding(.horizontal, 12).padding(.vertical, 12)
                .background(Theme.gold).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            }
            .buttonStyle(.plain)
        } else if let call = myCallNumber {
            NavigationLink { CallsQueueView() } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("MY ACTIVE CALL").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.neutral)
                        Spacer()
                        if let s = activeCallStartedAt {
                            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                                Text("⏱ \(ElapsedClock.elapsed(since: s, now: ctx.date))")
                                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.green)
                            }
                        }
                    }
                    HStack {
                        Text(call).font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                        Spacer()
                        Text("OPEN").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.gold)
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.neutral)
                    }
                }
                .themeCard()
            }
            .buttonStyle(.plain)
        }
    }

    private var statRow: some View {
        HStack(spacing: 8) {
            stat("\(counts.activeCalls)", "Active Calls", Theme.gold)
            stat("\(counts.unread)", "Unread", counts.unread > 0 ? Theme.orange : Theme.neutral)
            stat(myCallNumber ?? "—", "My Call", myCallNumber != nil ? Theme.green : Theme.neutral)
        }
    }

    private func stat(_ value: String, _ label: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value).font(Theme.Typography.title).fontWeight(.bold).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.5)
            Text(label.uppercased()).font(.system(size: 8, weight: .semibold)).foregroundStyle(Theme.neutral)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 10).themeCard()
    }

    private var quickActions: some View {
        VStack(spacing: 8) {
            SectionHeader(title: "Quick Actions")
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                tile("Workflows", "square.stack.3d.up.fill") { WorkflowHubView() }
                tile("Calls", "list.bullet.rectangle.fill", badge: counts.activeCalls) { CallsQueueView() }
                tile("Alerts", "bell.badge.fill", badge: counts.unread) { NotificationsView() }
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

    private var greetingPrefix: String {
        let h = Calendar.current.component(.hour, from: Date())
        switch h { case 5..<12: return "Good morning"; case 12..<17: return "Good afternoon"; default: return "Good evening" }
    }

    // ── Networking ──────────────────────────────────────────
    private func authed(_ work: (RMPGAPIClient) async throws -> Void) async {
        guard let c = await authedClient() else { status = "✗ Set RMPG credentials in Settings"; return }
        do { try await work(c) } catch { status = "✗ \(error.localizedDescription)" }
    }

    @MainActor
    private func refresh() async {
        await authed { c in
            if let duty = try await c.requestJSON("GET", "api/dispatch/duty/me") as? [String: Any] {
                onShift = duty["on_shift"] as? Bool ?? false
                shiftClockIn = ElapsedClock.parseUTC((duty["time_entry"] as? [String: Any])?["clock_in"] as? String)
                if let unit = duty["unit"] as? [String: Any] {
                    callSign = unit["call_sign"] as? String
                    unitStatus = unit["status"] as? String ?? ""
                    if let cid = unit["current_call_id"] as? Int {
                        let call = try? await c.requestJSON("GET", "api/dispatch/calls/\(cid)") as? [String: Any]
                        myCallNumber = (call?["call_number"] as? String) ?? "#\(cid)"
                        activeCallStartedAt = ElapsedClock.parseUTC(
                            (call?["created_at"] as? String) ?? (call?["received_at"] as? String) ?? (call?["dispatched_at"] as? String))
                    } else { myCallNumber = nil; activeCallStartedAt = nil }
                } else { callSign = nil; unitStatus = ""; myCallNumber = nil; activeCallStartedAt = nil }
            }
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
