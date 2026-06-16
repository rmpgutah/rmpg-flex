import SwiftUI
import UIKit

// On-scene ALPR: camera capture → POST /api/alpr/capture. The photo attaches to
// the officer's current call (field_photos), every vehicle in the frame is read,
// and a vehicles_records row is created/linked to the call per plate. Mirrors
// FieldPhotoSheet's auth + call-resolution; renders the per-vehicle result.
struct AlprScanSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var showCamera = true
    @State private var scanning = false
    @State private var status: String?
    @State private var summary: AlprScanSummary?
    @State private var attachToCall = true

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    if let image {
                        Image(uiImage: image)
                            .resizable().scaledToFit().frame(maxHeight: 240)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    }

                    if summary == nil {
                        Toggle("Attach to my current call", isOn: $attachToCall)
                            .font(Theme.Typography.caption).tint(Theme.gold)
                        if image != nil {
                            Button(scanning ? "SCANNING…" : "SCAN VEHICLES") { Task { await scan() } }
                                .font(Theme.Typography.body).fontWeight(.bold)
                                .frame(maxWidth: .infinity).padding(.vertical, 10)
                                .background(Theme.gold).foregroundStyle(.black)
                                .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                                .disabled(scanning)
                            Button("Retake") { showCamera = true }
                                .font(Theme.Typography.caption).foregroundStyle(Theme.neutral)
                        }
                    }

                    if let summary { resultView(summary) }

                    if let status {
                        Text(status).font(Theme.Typography.mono)
                            .foregroundStyle(status.hasPrefix("✓") ? Theme.gold : Theme.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    Spacer(minLength: 0)
                }
                .padding(Theme.Spacing.lg)
            }
            .background(Theme.base)
            .navigationTitle("SCAN VEHICLES")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showCamera) {
                CameraPicker { image = $0; summary = nil; status = nil }
                    .ignoresSafeArea()
            }
        }
    }

    @ViewBuilder
    private func resultView(_ s: AlprScanSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(s.vehicleCount) vehicle(s) · \(s.createdCount) new record(s)")
                .font(Theme.Typography.caption).fontWeight(.bold).foregroundStyle(Theme.gold)

            ForEach(s.criticalHits, id: \.self) { h in
                Text("⚠ \(h)")
                    .font(Theme.Typography.caption).fontWeight(.semibold).foregroundStyle(Theme.red)
                    .padding(Theme.Spacing.md).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.red.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            }

            if s.vehicleCount == 0 {
                EmptyState(icon: "car",
                           title: "No readable plate found",
                           subtitle: "The photo was still saved to the call.")
            }

            ForEach(Array(s.vehicles.enumerated()), id: \.offset) { _, v in
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(v.plate ?? "—").font(Theme.Typography.headline).fontWeight(.bold)
                            .tracking(2)
                        Spacer()
                        Text(v.recordCreated ? "NEW RECORD" : "LINKED")
                            .font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.neutral)
                    }
                    Text(v.descriptor + (v.confidence.map { " · \(Int($0 * 100))%" } ?? ""))
                        .font(Theme.Typography.caption).foregroundStyle(Theme.neutral)
                    ForEach(v.criticalHits, id: \.self) { hit in
                        Text("⚠ \(hit)").font(Theme.Typography.caption).fontWeight(.semibold).foregroundStyle(Theme.red)
                    }
                }
                .padding(Theme.Spacing.md).frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.raised)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            }

            Button("DONE") { dismiss() }
                .font(Theme.Typography.caption).fontWeight(.bold).foregroundStyle(Theme.gold)
                .frame(maxWidth: .infinity).padding(.vertical, 8)
        }
    }

    @MainActor
    private func scan() async {
        guard let image, let jpeg = image.jpegData(compressionQuality: 0.85) else { return }
        guard jpeg.count <= 12 * 1024 * 1024 else { status = "✗ Photo too large"; return }
        scanning = true; defer { scanning = false }

        var client = AppConfig.apiClient()
        if client.jwt == nil,
           let u = KeychainStore.load(key: "rmpgUser"),
           let p = KeychainStore.load(key: "rmpgPass"),
           let t = try? await client.login(username: u, password: p) {
            KeychainStore.save(t, key: "rmpgJWT"); client.jwt = t
        }
        guard client.jwt != nil else { status = "✗ Set RMPG credentials in Settings"; return }

        var fields: [String: String] = ["capture_reason": "on_scene_alpr"]
        if let loc = LocationManager.shared.last {
            fields["lat"] = "\(loc.coordinate.latitude)"
            fields["lng"] = "\(loc.coordinate.longitude)"
        }
        if attachToCall,
           let state = try? await client.requestJSON("GET", "api/dispatch/duty/me") as? [String: Any],
           let callId = (state["unit"] as? [String: Any])?["current_call_id"] as? Int {
            fields["call_id"] = "\(callId)"
        }

        do {
            let json = try await MultipartUpload.upload(client, path: "api/alpr/capture", fields: fields, jpeg: jpeg)
            let s = AlprResultParse.summary(from: json)
            summary = s
            let linked = fields["call_id"] != nil
            status = s.vehicleCount > 0
                ? "✓ \(s.vehicleCount) vehicle(s) processed\(linked ? " + linked to call" : "")"
                : "✓ No readable plate — photo saved\(linked ? " to call" : "")"
        } catch {
            // 503 here = ALPR not configured on the server (no ROBOFLOW_API_KEY).
            status = "✗ \(error.localizedDescription)"
        }
    }
}
