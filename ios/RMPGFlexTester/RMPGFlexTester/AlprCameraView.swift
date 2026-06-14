import SwiftUI
import UIKit

// Live continuous ALPR camera. A real AVFoundation preview (reusing CameraModel
// / CameraPreview from EvidenceCameraView) with a plate-aim reticle, one-tap
// capture, and a PATROL SCAN mode that auto-captures every few seconds. Each
// frame goes to POST /api/alpr/capture; reads accumulate into a de-duplicated
// running plate log (AlprScanLog) with critical-first ordering. A new critical
// hit fires a haptic + pushes the plate to the in-car MDT. Backend + parsing are
// the existing alpr.ts / AlprResultParse.
struct AlprCameraView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var cam = CameraModel()
    @State private var entries: [AlprLogEntry] = []
    @State private var patrolMode = false
    @State private var scanning = false
    @State private var attachToCall = true
    @State private var status: String?
    @State private var patrolTask: Task<Void, Never>?

    private var criticalCount: Int { AlprScanLog.criticalCount(entries) }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            CameraPreview(session: cam.session).ignoresSafeArea()
            RoundedRectangle(cornerRadius: 6)
                .stroke(criticalCount > 0 ? Theme.red : Theme.gold.opacity(0.8), lineWidth: 2)
                .frame(width: 280, height: 92)

            VStack(spacing: 0) {
                topBar
                Spacer()
                if let status {
                    Text(status).font(.system(size: 12, weight: .semibold, design: .monospaced))
                        .foregroundStyle(status.hasPrefix("⚠") ? Theme.red : (status.hasPrefix("✗") ? Theme.red : .white))
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(.black.opacity(0.5)).clipShape(Capsule())
                }
                if !entries.isEmpty { logStrip }
                controls
            }
        }
        .onAppear {
            cam.onPhoto = { raw in Task { await scan(raw) } }
            cam.configure()
        }
        .onDisappear { patrolTask?.cancel(); cam.stop() }
    }

    private var topBar: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text("ALPR").font(.system(size: 14, weight: .heavy)).foregroundStyle(Theme.gold)
                Text("\(entries.count) plate\(entries.count == 1 ? "" : "s")"
                     + (criticalCount > 0 ? " · \(criticalCount) HIT" : ""))
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(criticalCount > 0 ? Theme.red : .white)
            }
            .padding(8).background(.black.opacity(0.45)).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            Spacer()
            Button { cam.toggleTorch() } label: {
                Image(systemName: cam.torchOn ? "bolt.fill" : "bolt.slash.fill")
                    .font(.system(size: 18)).foregroundStyle(cam.torchOn ? Theme.gold : .white)
                    .padding(11).background(.black.opacity(0.45)).clipShape(Circle())
            }
            Button { patrolTask?.cancel(); cam.stop(); dismiss() } label: {
                Text("Done").font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(.black.opacity(0.45)).clipShape(Capsule())
            }
        }
        .padding()
    }

    private var logStrip: some View {
        ScrollView {
            VStack(spacing: 4) {
                ForEach(AlprScanLog.sorted(entries)) { e in
                    let crit = !e.vehicle.criticalHits.isEmpty
                    HStack(spacing: 8) {
                        Text(e.vehicle.plate ?? "—").font(.system(size: 15, weight: .bold)).tracking(1.5)
                            .foregroundStyle(crit ? .white : Theme.gold)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(e.vehicle.descriptor).font(.system(size: 10)).foregroundStyle(.white).lineLimit(1)
                            if crit {
                                Text("⚠ " + e.vehicle.criticalHits.joined(separator: " · "))
                                    .font(.system(size: 10, weight: .bold)).foregroundStyle(.white).lineLimit(1)
                            }
                        }
                        Spacer()
                        if e.seenCount > 1 {
                            Text("×\(e.seenCount)").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.neutral)
                        }
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background((crit ? Theme.red : Color.black).opacity(crit ? 0.85 : 0.5))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                }
            }
            .padding(.horizontal)
        }
        .frame(maxHeight: 200)
    }

    private var controls: some View {
        HStack(alignment: .center) {
            Toggle(isOn: Binding(get: { attachToCall }, set: { attachToCall = $0 })) {
                Text("Link to call").font(.system(size: 10)).foregroundStyle(.white)
            }
            .toggleStyle(.button).tint(Theme.gold).frame(width: 96)
            Spacer()
            Button { cam.capture() } label: {
                Circle().fill(scanning ? Theme.neutral : .white).frame(width: 70, height: 70)
                    .overlay(Circle().stroke(Theme.gold, lineWidth: 4).padding(3))
                    .overlay(scanning ? ProgressView().tint(.black) : nil)
            }
            .disabled(scanning)
            Spacer()
            Button { togglePatrol() } label: {
                VStack(spacing: 2) {
                    Image(systemName: patrolMode ? "stop.circle.fill" : "antenna.radiowaves.left.and.right")
                        .font(.system(size: 22))
                    Text(patrolMode ? "STOP" : "PATROL").font(.system(size: 8, weight: .bold))
                }
                .foregroundStyle(patrolMode ? Theme.red : Theme.gold).frame(width: 96)
            }
        }
        .padding()
    }

    private func togglePatrol() {
        patrolMode.toggle()
        Haptics.tap()
        if patrolMode {
            status = "Patrol scan on — auto-reading plates"
            patrolTask = Task {
                while patrolMode && !Task.isCancelled {
                    if !scanning { await MainActor.run { cam.capture() } }
                    try? await Task.sleep(for: .seconds(3.5))
                }
            }
        } else {
            patrolTask?.cancel()
            status = nil
        }
    }

    @MainActor
    private func scan(_ raw: UIImage) async {
        guard !scanning else { return }
        guard let jpeg = raw.jpegData(compressionQuality: 0.85), jpeg.count <= 12 * 1024 * 1024 else { return }
        scanning = true; defer { scanning = false }
        guard let client = await authedClient() else { status = "✗ Set RMPG credentials in Settings"; return }

        var fields: [String: String] = ["capture_reason": patrolMode ? "patrol_alpr" : "on_scene_alpr"]
        if let loc = LocationManager.shared.last {
            fields["lat"] = "\(loc.coordinate.latitude)"; fields["lng"] = "\(loc.coordinate.longitude)"
        }
        if attachToCall,
           let state = try? await client.requestJSON("GET", "api/dispatch/duty/me") as? [String: Any],
           let callId = (state["unit"] as? [String: Any])?["current_call_id"] as? Int {
            fields["call_id"] = "\(callId)"
        }

        do {
            let json = try await MultipartUpload.upload(client, path: "api/alpr/capture", fields: fields, jpeg: jpeg)
            let summary = AlprResultParse.summary(from: json)
            let before = criticalCount
            entries = AlprScanLog.merge(entries, summary)
            if criticalCount > before {
                Haptics.error()
                if let hit = summary.vehicles.first(where: { !$0.criticalHits.isEmpty }) {
                    _ = await MDTLink.shared.send(type: "alpr_hit",
                        payload: ["plate": hit.plate ?? "", "detail": hit.criticalHits.joined(separator: "; ")])
                }
                status = "⚠ HIT — \(summary.criticalHits.first ?? summary.vehicles.first(where: { !$0.criticalHits.isEmpty })?.criticalHits.first ?? "critical")"
            } else if summary.vehicleCount > 0 {
                status = "✓ \(summary.vehicleCount) read"
            }
        } catch {
            // 503 here = ALPR not configured on the server (no provider key).
            status = "✗ \(error.localizedDescription)"
        }
    }
}
