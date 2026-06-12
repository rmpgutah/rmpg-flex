import SwiftUI
import AVFoundation

// Live camera preview that emits PDF417 (DL barcode) payloads via AVFoundation's
// built-in metadata detector — no third-party decoder needed on iOS.
struct ScannerCamera: UIViewRepresentable {
    let onCode: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

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

    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        private let session = AVCaptureSession()
        private let onCode: (String) -> Void
        private var lastEmit = Date.distantPast

        init(onCode: @escaping (String) -> Void) { self.onCode = onCode }

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
            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { session.commitConfiguration(); return }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.pdf417, .qr]
            session.commitConfiguration()
            view.previewLayer.session = session
            view.previewLayer.videoGravity = .resizeAspectFill
            DispatchQueue.global(qos: .userInitiated).async { self.session.startRunning() }
        }

        func stop() {
            DispatchQueue.global(qos: .userInitiated).async { self.session.stopRunning() }
        }

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
    }
}
