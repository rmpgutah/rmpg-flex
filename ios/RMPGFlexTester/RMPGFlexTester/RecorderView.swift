// Interaction Recorder tab (native iOS) — background-capable audio
// capture that continues with the screen locked / app pocketed, uploading
// 30s segments to the same /api/intel/recordings pipeline as the web app.
import SwiftUI
import CoreLocation

struct RecorderView: View {
    @StateObject private var location = LocationManager.shared
    @StateObject private var recorder = AudioRecorder(client: AppConfig.apiClient())
    @State private var note = ""
    @State private var locText = ""
    @State private var recent: [[String: Any]] = []
    @State private var loading = false

    private func fmt(_ s: Int) -> String { String(format: "%02d:%02d", s / 60, s % 60) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    Text("Records with the screen locked or the app pocketed. Each 30s is uploaded immediately — a crash loses almost nothing.")
                        .font(Theme.Typography.caption).foregroundColor(Theme.neutral)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8).background(Theme.raised).overlay(border)

                    if let err = recorder.error {
                        Text(err).font(Theme.Typography.caption).foregroundColor(Theme.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(8).background(Theme.raised).overlay(border)
                    }

                    recorderCard
                    recentCard
                }.padding(12)
            }
            .background(Theme.base)
            .navigationTitle("Interaction Recorder")
            .task { await prepare(); await loadRecent() }
        }
        .tint(Theme.gold)
    }

    private var recorderCard: some View {
        VStack(spacing: 12) {
            if recorder.isRecording {
                HStack(spacing: 8) {
                    Circle().fill(Theme.red).frame(width: 12, height: 12)
                    Text(fmt(recorder.elapsed)).font(Theme.Typography.monoLarge)
                        .foregroundColor(Theme.red)
                }
                Text("\(recorder.segmentsUploaded) segment(s) saved").font(Theme.Typography.caption).foregroundColor(Theme.neutral)
                Button { Task { await recorder.stop(); locText = ""; note = ""; await loadRecent() } } label: {
                    Label("STOP", systemImage: "stop.fill").font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Theme.red).padding(.horizontal, 24).padding(.vertical, 10)
                        .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.red))
                }
            } else {
                TextField("Location (optional)", text: $locText)
                    .textFieldStyle(.plain).font(.system(size: 12)).foregroundColor(.white)
                    .padding(8).background(Theme.sunken).overlay(border)
                TextField("Notes (optional)", text: $note)
                    .textFieldStyle(.plain).font(.system(size: 12)).foregroundColor(.white)
                    .padding(8).background(Theme.sunken).overlay(border)
                Button {
                    Task {
                        await prepare()
                        let c = location.last?.coordinate
                        await recorder.start(location: locText.isEmpty ? nil : locText,
                                             notes: note.isEmpty ? nil : note,
                                             lat: c?.latitude, lng: c?.longitude)
                    }
                } label: {
                    Label("START RECORDING", systemImage: "mic.fill").font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Theme.gold).padding(.horizontal, 28).padding(.vertical, 12)
                        .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.gold))
                }
            }
        }
        .frame(maxWidth: .infinity).padding(16).background(Theme.raised).overlay(border)
    }

    private var recentCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("RECORDINGS").font(.system(size: 9, weight: .semibold)).foregroundColor(Theme.gold)
                .padding(.horizontal, 8).padding(.vertical, 3)
            if recent.isEmpty {
                Text(loading ? "Loading…" : "None yet.").font(Theme.Typography.caption).foregroundColor(Theme.neutral).padding(8)
            }
            ForEach(Array(recent.enumerated()), id: \.offset) { _, r in
                HStack(spacing: 8) {
                    Text(String((r["started_at"] as? String ?? "").prefix(16).dropFirst(5)))
                        .font(Theme.Typography.caption).foregroundColor(.white)
                    Spacer()
                    Text("\(r["duration_sec"] as? Int ?? 0)s · \(r["chunk_count"] as? Int ?? 0) seg")
                        .font(.system(size: 10)).foregroundColor(Theme.neutral)
                }.padding(.horizontal, 8).padding(.vertical, 3)
                Divider().background(Theme.border)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).background(Theme.raised).overlay(border)
    }

    private var border: some View {
        RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border)
    }

    private func prepare() async {
        location.start()
        if let c = await authedClient() { recorder.updateToken(c.jwt) }
    }

    private func loadRecent() async {
        loading = true; defer { loading = false }
        guard let c = await authedClient() else { return }
        if let arr = try? await c.requestJSON("GET", "api/intel/recordings?limit=15") as? [[String: Any]] {
            recent = arr
        }
    }

    private func authedClient() async -> RMPGAPIClient? {
        var client = AppConfig.apiClient()
        if client.jwt == nil,
           let user = KeychainStore.load(key: "rmpgUser"),
           let pass = KeychainStore.load(key: "rmpgPass"), !user.isEmpty,
           let token = try? await client.login(username: user, password: pass) {
            KeychainStore.save(token, key: "rmpgJWT")
            client.jwt = token
        }
        return client.jwt == nil ? nil : client
    }
}
