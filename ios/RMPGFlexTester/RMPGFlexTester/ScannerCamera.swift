import SwiftUI
import AVFoundation
import Vision

// Live camera preview that emits either PDF417/QR payloads (AVFoundation's
// built-in metadata detector) or passport/ID MRZ text (Vision OCR on video
// frames) — no third-party decoder needed on iOS.
struct ScannerCamera: UIViewRepresentable {
    enum Mode { case barcode, mrz }
    var mode: Mode = .barcode
    let onCode: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(mode: mode, onCode: onCode) }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        context.coordinator.configure(view: view)
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}

    static func dismantleUIView(_ uiView: PreviewView, coordinator: Coordinator) {
        coordinator.stop()
    }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate,
                             AVCaptureVideoDataOutputSampleBufferDelegate {
        private let session = AVCaptureSession()
        private let mode: Mode
        private let onCode: (String) -> Void
        private var lastEmit = Date.distantPast
        private var lastOcr = Date.distantPast

        init(mode: Mode, onCode: @escaping (String) -> Void) {
            self.mode = mode
            self.onCode = onCode
        }

        func configure(view: PreviewView) {
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                guard granted, let self else { return }
                DispatchQueue.main.async { self.start(view: view) }
            }
        }

        private func start(view: PreviewView) {
            guard let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input) else { return }
            session.beginConfiguration()
            session.addInput(input)
            switch mode {
            case .barcode:
                let output = AVCaptureMetadataOutput()
                guard session.canAddOutput(output) else { session.commitConfiguration(); return }
                session.addOutput(output)
                output.setMetadataObjectsDelegate(self, queue: .main)
                output.metadataObjectTypes = [.pdf417, .qr]
            case .mrz:
                let output = AVCaptureVideoDataOutput()
                output.alwaysDiscardsLateVideoFrames = true
                guard session.canAddOutput(output) else { session.commitConfiguration(); return }
                session.addOutput(output)
                output.setSampleBufferDelegate(self, queue: DispatchQueue(label: "rmpg.mrz.ocr"))
            }
            session.commitConfiguration()
            view.previewLayer.session = session
            view.previewLayer.videoGravity = .resizeAspectFill
            DispatchQueue.global(qos: .userInitiated).async { self.session.startRunning() }
        }

        func stop() {
            DispatchQueue.global(qos: .userInitiated).async { self.session.stopRunning() }
        }

        // ── Barcode path ────────────────────────────────────────
        func metadataOutput(_ output: AVCaptureMetadataOutput,
                            didOutput metadataObjects: [AVMetadataObject],
                            from connection: AVCaptureConnection) {
            // Debounce: PDF417 fires many frames per second once locked.
            guard Date().timeIntervalSince(lastEmit) > 2 else { return }
            for obj in metadataObjects {
                if let code = (obj as? AVMetadataMachineReadableCodeObject)?.stringValue {
                    lastEmit = Date()
                    onCode(code)
                    return
                }
            }
        }

        // ── MRZ OCR path ────────────────────────────────────────
        func captureOutput(_ output: AVCaptureOutput,
                           didOutput sampleBuffer: CMSampleBuffer,
                           from connection: AVCaptureConnection) {
            // OCR is expensive — run at most twice a second, and stop
            // re-emitting for 2s once a candidate MRZ is surfaced.
            let now = Date()
            guard now.timeIntervalSince(lastOcr) > 0.5,
                  now.timeIntervalSince(lastEmit) > 2,
                  let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
            lastOcr = now

            let request = VNRecognizeTextRequest { [weak self] req, _ in
                guard let self else { return }
                let lines = (req.results as? [VNRecognizedTextObservation])?
                    .compactMap { $0.topCandidates(1).first?.string } ?? []
                let text = lines.joined(separator: "\n")
                guard MrzParser.candidateLines(text).count >= 2 else { return }
                self.lastEmit = Date()
                DispatchQueue.main.async { self.onCode(text) }
            }
            // MRZ is OCR-B fixed-width; accurate mode + no language correction
            // (correction "fixes" filler '<' runs into words).
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = false
            try? VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .right)
                .perform([request])
        }
    }
}
