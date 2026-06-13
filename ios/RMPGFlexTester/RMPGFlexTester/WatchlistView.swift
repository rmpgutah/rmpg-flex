import SwiftUI

// The officer's intel watchlist. Subjects watched here (added from the field
// dossier) get a HIGH-priority notification — surfaced in the Live Alerts feed —
// whenever new activity links to them, via the per-minute intel cron.
struct WatchlistView: View {
    @State private var rows: [[String: Any]] = []
    @State private var loading = true
    @State private var status: String?
    @State private var working = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 8) {
                    if loading && rows.isEmpty {
                        ProgressView().tint(Theme.gold).padding(.top, 30)
                    } else if rows.isEmpty {
                        VStack(spacing: 6) {
                            Image(systemName: "binoculars").font(.system(size: 26)).foregroundStyle(Theme.neutral)
                            Text("Nothing on your watchlist.").font(.system(size: 12)).foregroundStyle(Theme.neutral)
                            Text("Open a subject's record and tap Watch to get alerts on new activity.")
                                .font(.system(size: 10)).foregroundStyle(Theme.neutral)
                                .multilineTextAlignment(.center).padding(.horizontal, 24)
                        }.padding(.top, 28)
                    } else {
                        ForEach(rows.indices, id: \.self) { i in row(rows[i]) }
                    }
                    if let status { StatusLine(text: status) }
                }
                .padding(12)
            }
            .background(Theme.base)
            .navigationTitle("WATCHLIST")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await load() }
            .task { await load() }
        }
    }

    @ViewBuilder
    private func row(_ w: [String: Any]) -> some View {
        let type = (w["entity_type"] as? String) ?? "entity"
        let entityId = AlertsFeed.intValue(w["entity_id"]) ?? 0
        let reason = (w["reason"] as? String) ?? ""
        let lastAlert = FieldFormat.prettyDate("\(w["last_alert_at"] ?? "")") ?? ""
        let label = (w["label"] as? String) ?? (w["name"] as? String) ?? "\(type.capitalized) #\(entityId)"

        let inner = HStack(spacing: 10) {
            Image(systemName: type == "person" ? "person.fill" : "car.fill")
                .font(.system(size: 14)).foregroundStyle(Theme.orange).frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                Text(reason.isEmpty ? "Watching" : reason)
                    .font(.system(size: 10)).foregroundStyle(Theme.neutral).lineLimit(1)
                if !lastAlert.isEmpty {
                    Text("Last alert · \(lastAlert)").font(.system(size: 9)).foregroundStyle(Theme.neutral)
                }
            }
            Spacer()
            Button { Task { await remove(type: type, id: entityId) } } label: {
                Image(systemName: "bell.slash.fill").font(.system(size: 13)).foregroundStyle(Theme.red)
            }.disabled(working)
        }
        .themeCard()

        if type == "person", entityId > 0 {
            NavigationLink { SubjectRecordsView(personId: entityId, displayName: label) } label: { inner }
                .buttonStyle(.plain)
        } else {
            inner
        }
    }

    @MainActor private func load() async {
        let err = await authedRetrying { c in
            let json = try await c.requestJSON("GET", "api/intel/watchlist")
            rows = (json as? [[String: Any]]) ?? ((json as? [String: Any])?["results"] as? [[String: Any]]) ?? []
        }
        status = err.map { "✗ \($0.localizedDescription)" }
        loading = false
    }

    @MainActor private func remove(type: String, id: Int) async {
        working = true; defer { working = false }
        let err = await authedRetrying { c in
            _ = try await c.requestJSON("DELETE", "api/intel/watchlist/\(type)/\(id)")
        }
        if let err { status = "✗ \(err.localizedDescription)" }
        else { rows.removeAll { ($0["entity_type"] as? String) == type && AlertsFeed.intValue($0["entity_id"]) == id }; Haptics.tap() }
    }
}
