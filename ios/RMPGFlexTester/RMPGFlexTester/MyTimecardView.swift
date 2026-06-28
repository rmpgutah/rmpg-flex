import SwiftUI

// Personal read-only timecard: hours this week + recent entries. Self-scoped
// via /dispatch/duty/timecard (the manager-gated /personnel/time is not used).
struct MyTimecardView: View {
    @State private var entries: [[String: Any]] = []
    @State private var loading = true
    @State private var status = ""

    private var hoursThisWeek: Double { TimecardSummary.hoursThisWeek(entries) }

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                VStack(spacing: 2) {
                    Text(String(format: "%.1f", hoursThisWeek))
                        .font(Theme.Typography.display).fontWeight(.bold).foregroundStyle(Theme.gold)
                    Text("HOURS — LAST 7 DAYS").font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.neutral)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 14).themeCard()

                SectionHeader(title: "Recent Entries")
                if loading {
                    ProgressView().tint(Theme.gold).padding(.top, 20)
                } else if entries.isEmpty {
                    EmptyState(icon: "clock.badge.xmark", title: "No time entries.").padding(.top, 16)
                } else {
                    ForEach(entries.indices, id: \.self) { i in row(entries[i]) }
                }
                if !status.isEmpty { StatusLine(text: status) }
            }
            .padding(12)
        }
        .background(Theme.base)
        .navigationTitle("MY TIMECARD")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load(); loading = false }
    }

    private func row(_ e: [String: Any]) -> some View {
        let inS = (e["clock_in"] as? String).map { String($0.prefix(16)).replacingOccurrences(of: "T", with: " ") } ?? "—"
        let outS = (e["clock_out"] as? String).map { String($0.prefix(16)).replacingOccurrences(of: "T", with: " ") } ?? "OPEN"
        let hrs = (e["total_hours"] as? Double) ?? (e["total_hours"] as? Int).map(Double.init) ?? 0
        return HStack {
            VStack(alignment: .leading, spacing: 1) {
                Text("\(inS) → \(outS)").font(Theme.Typography.mono).foregroundStyle(.white)
                Text((e["status"] as? String ?? "").uppercased()).font(.system(size: 9)).foregroundStyle(Theme.neutral)
            }
            Spacer()
            Text(outS == "OPEN" ? "—" : String(format: "%.2f h", hrs))
                .font(Theme.Typography.caption).fontWeight(.semibold).foregroundStyle(outS == "OPEN" ? Theme.green : Theme.gold)
        }
        .themeCard()
    }

    @MainActor
    private func load() async {
        guard let c = await ShiftNet.client() else { status = "✗ Set credentials in Settings"; return }
        if let res = try? await c.requestJSON("GET", "api/dispatch/duty/timecard") as? [String: Any],
           let rows = res["entries"] as? [[String: Any]] {
            entries = rows
            status = ""
        } else {
            status = "Could not load timecard"
        }
    }
}
