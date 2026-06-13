import SwiftUI
import AVFoundation
import UIKit
import CryptoKit

// Advanced evidence camera: live AVFoundation preview with a torch toggle, a live
// preview of the metadata stamp that will be burned in, multi-shot capture, and a
// burned-in overlay on every frame. Returns the burned UIImages.
final class CameraModel: NSObject, ObservableObject, AVCapturePhotoCaptureDelegate {
    let session = AVCaptureSession()
    private let output = AVCapturePhotoOutput()
    private var device: AVCaptureDevice?
    private let queue = DispatchQueue(label: "rmpg.camera")

    @Published var torchOn = false
    @Published var ready = false
    var onPhoto: ((UIImage) -> Void)?

    func configure() {
        queue.async {
            self.session.beginConfiguration()
            self.session.sessionPreset = .photo
            if let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
               let input = try? AVCaptureDeviceInput(device: dev), self.session.canAddInput(input) {
                self.session.addInput(input); self.device = dev
            }
            if self.session.canAddOutput(self.output) { self.session.addOutput(self.output) }
            self.session.commitConfiguration()
            self.session.startRunning()
            DispatchQueue.main.async { self.ready = true }
        }
    }

    func stop() { queue.async { if self.session.isRunning { self.session.stopRunning() } } }

    func capture() {
        let settings = AVCapturePhotoSettings()
        if let device, device.hasFlash { settings.flashMode = torchOn ? .on : .off }
        queue.async { self.output.capturePhoto(with: settings, delegate: self) }
    }

    func toggleTorch() {
        guard let device, device.hasTorch else { return }
        queue.async {
            try? device.lockForConfiguration()
            let on = !device.isTorchActive
            device.torchMode = on ? .on : .off
            device.unlockForConfiguration()
            DispatchQueue.main.async { self.torchOn = on }
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        guard let data = photo.fileDataRepresentation(), let img = UIImage(data: data) else { return }
        DispatchQueue.main.async { self.onPhoto?(img) }
    }
}

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView()
        v.videoPreviewLayer.session = session
        v.videoPreviewLayer.videoGravity = .resizeAspectFill
        return v
    }
    func updateUIView(_ uiView: PreviewView, context: Context) {}
    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var videoPreviewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}

struct EvidenceCameraView: View {
    var caseRef: String = ""
    var onDone: ([UIImage]) -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var cam = CameraModel()
    @State private var shots: [UIImage] = []
    @State private var stamp = BurnFields(timestamp: "")
    @State private var classification: EvidenceClassification = .leSensitive
    @State private var seq = 0
    @State private var logStatus: String?
    @State private var showLog = false

    /// Short, stable per-device id for the burn + manifest.
    private static let deviceId = String((UIDevice.current.identifierForVendor?.uuidString ?? "UNKNWN")
        .replacingOccurrences(of: "-", with: "").prefix(4)).uppercased()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            CameraPreview(session: cam.session).ignoresSafeArea()
            VStack {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(PhotoBurnLines.lines(stamp), id: \.self) {
                            Text($0).font(.system(size: 11, design: .monospaced)).foregroundStyle(.white)
                        }
                    }
                    .padding(8).background(.black.opacity(0.45))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    Spacer()
                    VStack(spacing: 8) {
                        Button { cam.toggleTorch() } label: {
                            Image(systemName: cam.torchOn ? "bolt.fill" : "bolt.slash.fill")
                                .font(.system(size: 20)).foregroundStyle(cam.torchOn ? Theme.gold : .white)
                                .padding(12).background(.black.opacity(0.45)).clipShape(Circle())
                        }
                        Button { showLog = true } label: {
                            Image(systemName: "list.bullet.rectangle.portrait")
                                .font(.system(size: 18)).foregroundStyle(.white)
                                .padding(12).background(.black.opacity(0.45)).clipShape(Circle())
                        }
                    }
                }
                .padding()

                // Classification selector — sets the top banner + manifest class.
                Menu {
                    ForEach(EvidenceClassification.allCases, id: \.self) { c in
                        Button(c.short) { classification = c; rebuildStamp() }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "lock.shield.fill")
                        Text(classification.rawValue).font(.system(size: 11, weight: .bold))
                        Image(systemName: "chevron.down").font(.system(size: 9))
                    }
                    .foregroundStyle(.black).padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Theme.gold).clipShape(Capsule())
                }

                if let logStatus {
                    Text(logStatus).font(.system(size: 10, design: .monospaced)).foregroundStyle(.white)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(.black.opacity(0.5)).clipShape(Capsule())
                }

                Spacer()

                if !shots.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(shots.indices, id: \.self) { i in
                                Image(uiImage: shots[i]).resizable().scaledToFill()
                                    .frame(width: 52, height: 52).clipped()
                                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                            }
                        }.padding(.horizontal)
                    }
                }

                HStack {
                    Button("Cancel") { cam.stop(); dismiss() }
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                    Spacer()
                    Button { cam.capture() } label: {
                        Circle().fill(.white).frame(width: 70, height: 70)
                            .overlay(Circle().stroke(Theme.gold, lineWidth: 4).padding(3))
                    }
                    Spacer()
                    Button("Use \(shots.count)") { cam.stop(); onDone(shots); dismiss() }
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(shots.isEmpty ? Theme.neutral : Theme.gold)
                        .disabled(shots.isEmpty)
                }
                .padding()
            }
        }
        .sheet(isPresented: $showLog) { EvidenceLogView() }
        .onAppear {
            rebuildStamp()
            cam.onPhoto = { raw in handleCapture(raw) }
            cam.configure()
        }
        .onDisappear { cam.stop() }
    }

    /// Refresh the on-screen preview stamp (classification + next sequence).
    private func rebuildStamp() {
        var f = BurnFields.current(caseRef: caseRef)
        f.classification = classification.rawValue
        f.sequence = EvidenceManifest.sequenceLabel(seq + 1)
        f.deviceId = Self.deviceId
        stamp = f
    }

    /// Secure capture: hash the original frame, burn the fingerprint + metadata
    /// in, and file the chain-of-custody manifest (D1 + MDT) — best-effort, so a
    /// failed upload never loses the photo.
    private func handleCapture(_ raw: UIImage) {
        let data = raw.jpegData(compressionQuality: 0.9) ?? Data()
        let hex = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        seq += 1
        let loc = LocationManager.shared.last
        var f = BurnFields.current(caseRef: caseRef)
        f.classification = classification.rawValue
        f.sequence = EvidenceManifest.sequenceLabel(seq)
        f.sha256 = EvidenceManifest.shortHash(hex)
        f.deviceId = Self.deviceId
        shots.append(PhotoBurn.burn(raw, fields: f))
        rebuildStamp()

        let manifest = EvidenceManifest(
            sha256: hex, classification: classification, sequence: seq,
            officer: JWTClaims.current()?.name ?? "", caseRef: caseRef,
            lat: loc?.coordinate.latitude, lng: loc?.coordinate.longitude,
            capturedAt: ISO8601DateFormatter().string(from: Date()), deviceId: Self.deviceId)
        Task { await fileManifest(manifest) }
    }

    @MainActor
    private func fileManifest(_ m: EvidenceManifest) async {
        let err = await authedRetrying { c in
            _ = try await c.requestJSON("POST", "api/evidence", body: m.body())
        }
        logStatus = err == nil ? "✓ Logged \(m.summary)" : "⚠ Saved · manifest will sync"
        _ = await MDTLink.shared.send(type: "evidence", payload: m.body())
        Haptics.tap()
    }
}
