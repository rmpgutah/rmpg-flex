import SwiftUI
import UIKit

// End-of-shift summary — rolls the officer's shift (DAR auto-populate: calls /
// incidents / citations / patrols) together with fleet fuel + inspections and
// the ALPR read count into one screen + a DAR-ready narrative. Copy it into the
// DAR or hand it to dispatch over MDT. Aggregation is in ShiftSummary.swift.
struct ShiftSummaryView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var stats = ShiftStats()
    @State private var loading = true
    @State private var status: String?

    private var today: String { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date()) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    if loading {
                        ProgressView().tint(Theme.gold).padding(.top, 30)
                    } else {
                        grid
                        narrativeCard
                        actions
                    }
                    if let status { StatusLine(text: status) }
                }
                .padding(12)
            }
            .background(Theme.base)
            .navigationTitle("SHIFT SUMMARY")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private var grid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 8) {
            tile("\(stats.calls)", "CALLS", Theme.gold)
            tile("\(stats.incidents)", "INCIDENTS", Theme.gold)
            tile("\(stats.citations)", "CITATIONS", Theme.gold)
            tile("\(stats.patrols)", "PATROLS", Theme.gold)
            tile("\(stats.alprReads)", "ALPR READS", Theme.gold)
            tile(stats.milesDriven > 0 ? "\(stats.milesDriven)" : "—", "MILES", Theme.green)
            tile(stats.fuelGallons > 0 ? String(format: "%.1f", stats.fuelGallons) : "—", "GAL FUEL", Theme.green)
            tile("\(stats.inspectionsLogged)", "INSPECTIONS", stats.inspectionDefects > 0 ? Theme.orange : Theme.green)
            tile("\(stats.inspectionDefects)", "DEFECTS", stats.inspectionDefects > 0 ? Theme.red : Theme.neutral)
        }
    }

    private func tile(_ v: String, _ l: String, _ c: Color) -> some View {
        VStack(spacing: 2) {
            Text(v).font(Theme.Typography.title).fontWeight(.bold).foregroundStyle(c).lineLimit(1).minimumScaleFactor(0.5)
            Text(l).font(.system(size: 8, weight: .semibold)).foregroundStyle(Theme.neutral)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 10).themeCard()
    }

    private var narrativeCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionHeader(title: "Narrative")
            Text(ShiftSummary.narrative(stats))
                .font(Theme.Typography.mono).foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .themeCard()
    }

    private var actions: some View {
        HStack(spacing: 8) {
            Button {
                UIPasteboard.general.string = ShiftSummary.narrative(stats); Haptics.success(); status = "✓ Copied — paste into the DAR"
            } label: { Label("Copy", systemImage: "doc.on.doc").frame(maxWidth: .infinity) }
                .buttonStyle(RaisedButtonStyle())
            Button { Task { await sendMDT() } } label: {
                Label("To MDT", systemImage: "car.fill").frame(maxWidth: .infinity)
            }.buttonStyle(RaisedButtonStyle())
        }
    }

    @MainActor private func load() async {
        loading = true; defer { loading = false }
        guard let officer = JWTClaims.current()?.userId else { status = "✗ Not logged in"; return }
        var ap: [String: Any] = [:]
        var fuel: [[String: Any]] = []
        var insp: [[String: Any]] = []
        var alpr = 0
        let err = await authedRetrying { c in
            ap = (try await c.requestJSON("POST", "api/dar/auto-populate",
                                          body: ["officer_id": officer, "shift_date": today]) as? [String: Any]) ?? [:]
            if let duty = try? await c.requestJSON("GET", "api/dispatch/duty/me") as? [String: Any],
               let vid = (duty["vehicle"] as? [String: Any])?["id"] as? Int {
                if let f = try? await c.requestJSON("GET", "api/fleet/\(vid)/fuel") { fuel = rows(f).filter(isToday) }
                if let i = try? await c.requestJSON("GET", "api/fleet/\(vid)/inspections") { insp = rows(i).filter(isToday) }
            }
            // ALPR read count is best-effort — the endpoint may not exist on every build.
            if let a = try? await c.requestJSON("GET", "api/alpr/recent?limit=200") { alpr = rows(a).filter(isToday).count }
        }
        if let err { status = "✗ \(err.localizedDescription)"; return }
        stats = ShiftSummary.compile(autoPopulate: ap, fuelLogs: fuel, inspections: insp, alprReads: alpr)
        status = nil
    }

    @MainActor private func sendMDT() async {
        let ok = await MDTLink.shared.send(type: "shift_summary",
            payload: ["summary": ShiftSummary.narrative(stats), "calls": stats.calls, "miles": stats.milesDriven])
        status = ok ? "✓ Summary sent to in-car MDT" : "✗ MDT send failed"
    }

    private func rows(_ any: Any?) -> [[String: Any]] {
        if let arr = any as? [[String: Any]] { return arr }
        if let obj = any as? [String: Any] {
            for k in ["data", "results", "rows", "items"] { if let arr = obj[k] as? [[String: Any]] { return arr } }
        }
        return []
    }

    private func isToday(_ r: [String: Any]) -> Bool {
        for k in ["inspection_date", "performed_at", "fuel_date", "created_at", "captured_at", "date"] {
            if let s = r[k] as? String, s.hasPrefix(today) { return true }
        }
        return false
    }
}
