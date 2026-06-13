import SwiftUI

// Daily Activity Report — the mobile review-and-sign surface. Auto-compiles the
// officer's shift from RMPG's captured activity (POST /api/dar/auto-populate),
// shows the timeline to verify, lets the officer add notable events + safety
// concerns by voice, then signs/files it. The "surpass TrackTik" workflow: the
// guard reviews what the system already logged instead of typing every line.
struct DailyActivityReportView: View {
    @State private var calls: [[String: Any]] = []
    @State private var incidents: [[String: Any]] = []
    @State private var citations: [[String: Any]] = []
    @State private var patrols: [[String: Any]] = []
    @State private var values: [String: FieldValue] = [:]
    @State private var loading = true
    @State private var submitting = false
    @State private var filed = false
    @State private var status: String?

    private var today: String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date())
    }
    private var totalActivity: Int { calls.count + incidents.count + citations.count + patrols.count }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                header
                if loading {
                    ProgressView("Compiling your shift…").tint(Theme.gold).padding(.top, 20)
                } else {
                    section("CALLS HANDLED", calls) { c in
                        line("\(c["call_number"] ?? "—")", FieldFormat.value("incident_type", c["incident_type"]), c["created_at"])
                    }
                    section("INCIDENTS FILED", incidents) { i in
                        line("\(i["incident_number"] ?? "—")", FieldFormat.value("incident_type", i["incident_type"]), i["created_at"])
                    }
                    section("CITATIONS ISSUED", citations) { c in
                        line("\(c["citation_number"] ?? "—")", (c["violation_description"] as? String) ?? "", c["violation_date"])
                    }
                    section("PATROL SCANS", patrols) { p in
                        line((p["checkpoint"] as? String) ?? "Checkpoint", FieldFormat.value("status", p["status"]), p["scanned_at"])
                    }
                    if totalActivity == 0 {
                        Text("No auto-captured activity for today yet — file your reports and patrol scans, then refresh.")
                            .font(.system(size: 12)).foregroundStyle(Theme.neutral)
                    }

                    SectionHeader(title: "Notable events")
                    DictationBar(field: WorkflowField(key: "notable_events", type: .dictatableNarrative, label: "Notable events"), values: $values)
                    SectionHeader(title: "Safety concerns")
                    DictationBar(field: WorkflowField(key: "safety_concerns", type: .dictatableNarrative, label: "Safety concerns"), values: $values)

                    submitButton
                }
                if let status { StatusLine(text: status) }
            }
            .padding(12)
        }
        .background(Theme.base)
        .navigationTitle("DAILY ACTIVITY REPORT")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await autoCompile() }
        .task { await autoCompile() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(today).font(.system(size: 14, weight: .semibold, design: .monospaced)).foregroundStyle(.white)
            Text(loading ? "Auto-compiling from your shift activity…"
                 : "\(totalActivity) auto-captured \(totalActivity == 1 ? "activity" : "activities") · review + sign")
                .font(.system(size: 11)).foregroundStyle(Theme.gold)
        }
        .frame(maxWidth: .infinity, alignment: .leading).themeCard()
    }

    @ViewBuilder
    private func section(_ title: String, _ rows: [[String: Any]],
                         @ViewBuilder row: @escaping ([String: Any]) -> some View) -> some View {
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(title) (\(rows.count))").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.gold)
                ForEach(Array(rows.enumerated()), id: \.offset) { _, r in row(r) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
    }

    private func line(_ primary: String, _ secondary: String, _ when: Any?) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 0) {
                Text(primary).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                if !secondary.isEmpty { Text(secondary).font(.system(size: 10)).foregroundStyle(Theme.neutral) }
            }
            Spacer()
            if let t = FieldFormat.prettyDate("\(when ?? "")") {
                Text(t).font(.system(size: 9, design: .monospaced)).foregroundStyle(Theme.neutral)
            }
        }
    }

    private var submitButton: some View {
        Button { Task { await submit() } } label: {
            Text(filed ? "✓ FILED" : (submitting ? "FILING…" : "SIGN & FILE DAR"))
        }
        .buttonStyle(GoldButtonStyle()).disabled(submitting || filed).padding(.top, 4)
    }

    @MainActor private func autoCompile() async {
        guard let officerId = JWTClaims.current()?.userId else { status = "✗ Not logged in"; loading = false; return }
        var compiled: (c: [[String: Any]], i: [[String: Any]], ci: [[String: Any]], p: [[String: Any]])?
        _ = await authedRetrying { client in
            if let res = try await client.requestJSON("POST", "api/dar/auto-populate",
                    body: ["officer_id": officerId, "shift_date": today]) as? [String: Any],
               let data = res["data"] as? [String: Any] {
                compiled = (data["calls"] as? [[String: Any]] ?? [], data["incidents"] as? [[String: Any]] ?? [],
                            data["citations"] as? [[String: Any]] ?? [], data["patrols"] as? [[String: Any]] ?? [])
            }
        }
        if let compiled { calls = compiled.c; incidents = compiled.i; citations = compiled.ci; patrols = compiled.p }
        loading = false
    }

    @MainActor private func submit() async {
        submitting = true; defer { submitting = false }
        let body: [String: Any] = [
            "shift_date": today,
            "calls_handled": calls, "incidents_created": incidents,
            "citations_issued": citations, "patrols_completed": patrols,
            "notable_events": str("notable_events"), "safety_concerns": str("safety_concerns"),
        ]
        let err = await authedRetrying { client in
            let res = try await client.requestJSON("POST", "api/dar", body: body)
            if let id = ((res as? [String: Any])?["data"] as? [String: Any])?["id"] as? Int {
                try await client.requestJSON("PUT", "api/dar/\(id)/submit", body: [:])
            }
        }
        if let err { status = "✗ \(err.localizedDescription)" }
        else { filed = true; status = "✓ DAR filed for \(today)"; Haptics.success() }
    }

    private func str(_ key: String) -> String {
        if case .string(let s)? = values[key] { return s }
        return ""
    }
}
