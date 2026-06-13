import SwiftUI

// Field dossier for a known subject — composes the RECORDS + INTEL backends
// the desktop uses: person system-history (warrants / incidents / CAD calls /
// citations) and the Wave-1 intel cross-hit screen (watchlist, jail bookings)
// into one phone screen the officer can read at the car window.
struct SubjectRecordsView: View {
    let personId: Int
    let displayName: String

    @Environment(\.dismiss) private var dismiss
    @State private var loading = true
    @State private var error: String?
    @State private var summary: [String: Int] = [:]
    @State private var hits: [[String: Any]] = []
    @State private var warrants: [[String: Any]] = []
    @State private var incidents: [[String: Any]] = []
    @State private var calls: [[String: Any]] = []
    @State private var citations: [[String: Any]] = []

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if loading { ProgressView("Pulling records…").tint(Theme.gold) }
                    if let error {
                        Text("✗ \(error)").font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(Theme.red)
                    }

                    // Intel cross-hits first — highest signal.
                    ForEach(Array(hits.enumerated()), id: \.offset) { _, hit in
                        let severity = hit["severity"] as? String ?? "info"
                        let detail = hit["detail"] as? String ?? hit["kind"] as? String ?? "hit"
                        Text("\(severity == "critical" ? "⚠" : "ℹ") \(detail)")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(severity == "critical" ? .black : Theme.gold)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(8)
                            .background(severity == "critical" ? Theme.red : Theme.raised)
                    }

                    if !summary.isEmpty {
                        HStack(spacing: 6) {
                            chip("WARRANTS", summary["total_warrants"], hot: (summary["active_warrants"] ?? 0) > 0)
                            chip("INCIDENTS", summary["total_incidents"], hot: false)
                            chip("CALLS", summary["total_calls"], hot: false)
                            chip("CITATIONS", summary["total_citations"], hot: (summary["active_citations"] ?? 0) > 0)
                        }
                    }

                    section("WARRANTS", warrants) { w in
                        line(primary: "\(w["warrant_number"] ?? "—")  \(w["status"] ?? "")",
                             secondary: w["description"] as? String ?? "",
                             hot: (w["status"] as? String) == "active")
                    }
                    section("RECENT INCIDENTS", incidents) { i in
                        line(primary: "\(i["incident_number"] ?? "—")  \(i["incident_type"] ?? "")",
                             secondary: [i["created_at"] as? String, i["location_address"] as? String]
                                .compactMap { $0 }.joined(separator: " · "),
                             hot: false)
                    }
                    section("RECENT CAD CALLS", calls) { c in
                        line(primary: "\(c["call_number"] ?? "—")  \(c["incident_type"] ?? "")",
                             secondary: [c["created_at"] as? String, c["location_address"] as? String]
                                .compactMap { $0 }.joined(separator: " · "),
                             hot: false)
                    }
                    section("CITATIONS", citations) { c in
                        line(primary: "\(c["citation_number"] ?? "—")  \(c["status"] ?? "")",
                             secondary: c["violation_description"] as? String ?? "",
                             hot: false)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
            }
            .background(Theme.base)
            .navigationTitle(displayName.isEmpty ? "SUBJECT RECORDS" : displayName.uppercased())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
            .task { await load() }
        }
    }

    private func chip(_ label: String, _ n: Int?, hot: Bool) -> some View {
        VStack(spacing: 1) {
            Text("\(n ?? 0)").font(.system(size: 15, weight: .bold))
                .foregroundStyle(hot ? .black : .white)
            Text(label).font(.system(size: 8, weight: .semibold))
                .foregroundStyle(hot ? .black : Theme.neutral)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 6)
        .background(hot ? Theme.red : Theme.raised)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }

    @ViewBuilder
    private func section(_ title: String, _ rows: [[String: Any]],
                         @ViewBuilder row: @escaping ([String: Any]) -> some View) -> some View {
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.gold)
                ForEach(Array(rows.prefix(10).enumerated()), id: \.offset) { _, r in row(r) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8).background(Theme.raised)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
    }

    private func line(primary: String, secondary: String, hot: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(primary).font(.system(size: 12, weight: hot ? .bold : .regular))
                .foregroundStyle(hot ? Theme.red : .white)
            if !secondary.isEmpty {
                Text(secondary).font(.system(size: 10)).foregroundStyle(Theme.neutral)
            }
        }
    }

    @MainActor
    private func load() async {
        guard let client = await ShiftNet.client(), client.jwt != nil else {
            loading = false; error = "Not logged in — set RMPG credentials in Settings"; return
        }
        async let historyReq = try? client.requestJSON("GET", "api/records/persons/\(personId)/system-history")
        async let screenReq = try? client.requestJSON("POST", "api/intel/screen",
                                                      body: ["entity_type": "person", "entity_id": personId])
        let (history, screen) = await (historyReq, screenReq)
        if let h = history as? [String: Any] {
            warrants = h["warrants"] as? [[String: Any]] ?? []
            incidents = h["incidents"] as? [[String: Any]] ?? []
            calls = h["calls"] as? [[String: Any]] ?? []
            citations = h["citations"] as? [[String: Any]] ?? []
            summary = (h["summary"] as? [String: Any])?.compactMapValues { $0 as? Int } ?? [:]
        } else {
            error = "Records history unavailable"
        }
        hits = (screen as? [String: Any])?["hits"] as? [[String: Any]] ?? []
        loading = false
    }
}
