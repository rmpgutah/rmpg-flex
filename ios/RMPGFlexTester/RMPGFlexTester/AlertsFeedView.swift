import SwiftUI

// Live Alerts — the Situational Awareness feed. Aggregates active dispatch calls,
// notifications (incl. watchlist cron hits), and active BOLOs into one
// severity-ranked stream. The officer's own assigned call and any unread item
// float to the top; flagged/person items deep-link into the caution dossier.
// Ranking/merge/parse all live in AlertsFeed.swift (unit-tested).
struct AlertsFeedView: View {
    @State private var items: [AlertItem] = []
    @State private var loading = true
    @State private var status: String?
    @State private var now: Double = Date().timeIntervalSince1970

    private var unreadCount: Int { items.filter(\.unread).count }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 8) {
                    if loading && items.isEmpty {
                        ProgressView().tint(Theme.gold).padding(.top, 30)
                    } else if items.isEmpty {
                        Text("No active alerts.").font(.system(size: 12)).foregroundStyle(Theme.neutral).padding(.top, 24)
                    } else {
                        ForEach(items) { row($0) }
                    }
                    if let status { StatusLine(text: status) }
                }
                .padding(12)
            }
            .background(Theme.base)
            .navigationTitle(unreadCount > 0 ? "LIVE ALERTS (\(unreadCount))" : "LIVE ALERTS")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await refresh() }
            .task {
                await refresh(); loading = false
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(15))
                    now = Date().timeIntervalSince1970
                    await refresh()
                }
            }
        }
    }

    @ViewBuilder
    private func row(_ a: AlertItem) -> some View {
        if let pid = a.personId {
            NavigationLink { SubjectRecordsView(personId: pid, displayName: a.title) } label: { card(a) }
                .buttonStyle(.plain)
        } else {
            card(a)
        }
    }

    private func card(_ a: AlertItem) -> some View {
        HStack(spacing: 0) {
            Rectangle().fill(tone(a.severity)).frame(width: 3)
            HStack(spacing: 10) {
                Image(systemName: a.kind.icon).font(.system(size: 15)).foregroundStyle(tone(a.severity)).frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(a.title).font(.system(size: 13, weight: a.unread ? .bold : .semibold))
                            .foregroundStyle(.white).lineLimit(1)
                        if a.unread { Circle().fill(Theme.gold).frame(width: 6, height: 6) }
                    }
                    if !a.subtitle.isEmpty {
                        Text(a.subtitle).font(.system(size: 10)).foregroundStyle(Theme.neutral).lineLimit(2)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(a.kind.rawValue.uppercased()).font(.system(size: 7, weight: .bold)).foregroundStyle(Theme.neutral)
                    let rt = AlertsFeed.relativeTime(epoch: a.epoch, now: now)
                    if !rt.isEmpty { Text(rt).font(.system(size: 9)).foregroundStyle(Theme.neutral) }
                }
                if a.personId != nil {
                    Image(systemName: "chevron.right").font(.system(size: 10)).foregroundStyle(Theme.neutral)
                }
            }
            .padding(10)
        }
        .background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }

    private func tone(_ s: AlertSeverity) -> Color {
        switch s { case .critical: return Theme.red; case .high: return Theme.orange; case .normal: return Theme.gold }
    }

    @MainActor
    private func refresh() async {
        var calls: [[String: Any]] = [], notes: [[String: Any]] = [], bolos: [[String: Any]] = []
        var myCallId: Int?
        let err = await authedRetrying { c in
            // Fan out concurrently. `calls` is the primary (its 401 drives the
            // relogin retry); the rest degrade to [] so one dead endpoint never
            // blanks the whole feed.
            async let dutyR = c.requestJSON("GET", "api/dispatch/duty/me")
            async let callsR = c.requestJSON("GET", "api/dispatch/calls?status=active")
            async let notesR = c.requestJSON("GET", "api/notifications?per_page=50")
            async let bolosR = c.requestJSON("GET", "api/dispatch/bolos/active")
            let callsAny = try await callsR
            let duty = try? await dutyR
            let notesAny = try? await notesR
            let bolosAny = try? await bolosR
            if let unit = (duty as? [String: Any])?["unit"] as? [String: Any] {
                myCallId = unit["current_call_id"] as? Int
            }
            calls = rows(callsAny); notes = rows(notesAny); bolos = rows(bolosAny)
        }
        if let err { status = "✗ \(err.localizedDescription)"; return }
        status = nil
        items = AlertsFeed.merge([
            AlertsFeed.fromCalls(calls, myCallId: myCallId),
            AlertsFeed.fromNotifications(notes),
            AlertsFeed.fromBolos(bolos),
        ])
    }

    private func rows(_ any: Any?) -> [[String: Any]] {
        if let arr = any as? [[String: Any]] { return arr }
        if let obj = any as? [String: Any] {
            for k in ["results", "calls", "data", "rows", "notifications", "bolos"] {
                if let arr = obj[k] as? [[String: Any]] { return arr }
            }
        }
        return []
    }
}
