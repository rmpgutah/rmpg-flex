import SwiftUI
import UIKit

// The secure-evidence chain-of-custody log. Lists manifests filed to
// /api/evidence (each a tamper-evident capture: SHA-256 + classification +
// exhibit sequence), and lets the officer re-push any item to the in-car MDT or
// copy its full hash to verify against the fingerprint burned into the photo.
struct EvidenceLogView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var rows: [[String: Any]] = []
    @State private var loading = true
    @State private var status: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 8) {
                    if loading && rows.isEmpty {
                        ProgressView().tint(Theme.gold).padding(.top, 30)
                    } else if rows.isEmpty {
                        VStack(spacing: 6) {
                            Image(systemName: "shield.lefthalf.filled").font(.system(size: 26)).foregroundStyle(Theme.neutral)
                            Text("No evidence logged yet.").font(.system(size: 12)).foregroundStyle(Theme.neutral)
                            Text("Captures from the evidence camera file a tamper-evident manifest here.")
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
            .navigationTitle("EVIDENCE LOG")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private func intOf(_ any: Any?) -> Int {
        if let n = any as? Int { return n }
        if let d = any as? Double { return Int(d) }
        if let s = any as? String { return Int(s) ?? 0 }
        return 0
    }

    private func row(_ r: [String: Any]) -> some View {
        let cls = (r["classification"] as? String) ?? "EVIDENCE"
        let seq = intOf(r["sequence"])
        let sha = (r["sha256"] as? String) ?? ""
        let when = FieldFormat.prettyDate("\(r["captured_at"] ?? r["created_at"] ?? "")") ?? ""
        let caseRef = (r["case_ref"] as? String) ?? ""
        return HStack(spacing: 10) {
            VStack(spacing: 2) {
                Image(systemName: "checkmark.seal.fill").font(.system(size: 16)).foregroundStyle(Theme.gold)
                Text("EXH \(EvidenceManifest.sequenceLabel(seq))").font(.system(size: 8, weight: .bold)).foregroundStyle(Theme.neutral)
            }.frame(width: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(cls).font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.gold)
                Text("SHA256 \(EvidenceManifest.shortHash(sha))")
                    .font(.system(size: 10, design: .monospaced)).foregroundStyle(.white).lineLimit(1)
                Text([caseRef.isEmpty ? nil : caseRef, when.isEmpty ? nil : when]
                        .compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 9)).foregroundStyle(Theme.neutral).lineLimit(1)
            }
            Spacer()
            Menu {
                Button { Task { await pushMDT(r) } } label: { Label("Send to in-car MDT", systemImage: "car.fill") }
                Button { UIPasteboard.general.string = sha; Haptics.tap() } label: { Label("Copy full hash", systemImage: "doc.on.doc") }
            } label: { Image(systemName: "ellipsis.circle").font(.system(size: 16)).foregroundStyle(Theme.neutral) }
        }
        .themeCard()
    }

    @MainActor private func load() async {
        let err = await authedRetrying { c in
            let json = try await c.requestJSON("GET", "api/evidence?limit=100")
            rows = (json as? [[String: Any]])
                ?? ((json as? [String: Any])?["data"] as? [[String: Any]])
                ?? ((json as? [String: Any])?["results"] as? [[String: Any]]) ?? []
        }
        status = err.map { "✗ \($0.localizedDescription)" }
        loading = false
    }

    @MainActor private func pushMDT(_ r: [String: Any]) async {
        let ok = await MDTLink.shared.send(type: "evidence", payload: r)
        status = ok ? "✓ Sent to in-car MDT" : "✗ MDT send failed"
    }
}
