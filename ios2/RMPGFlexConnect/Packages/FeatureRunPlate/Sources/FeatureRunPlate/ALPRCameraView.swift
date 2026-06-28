import SwiftUI
import AVFoundation

public struct ALPRCameraView: UIViewControllerRepresentable {
    public let onCapture: (String) -> Void
    public let onError: (Error) -> Void

    public init(onCapture: @escaping (String) -> Void, onError: @escaping (Error) -> Void) {
        self.onCapture = onCapture
        self.onError = onError
    }

    public func makeUIViewController(context: Context) -> ALPRCameraViewController {
        let vc = ALPRCameraViewController()
        vc.onCapture = onCapture
        vc.onError = onError
        return vc
    }

    public func updateUIViewController(_ uiViewController: ALPRCameraViewController, context: Context) {}
}

public class ALPRCameraViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private var captureSession: AVCaptureSession?
    var onCapture: ((String) -> Void)?
    var onError: ((Error) -> Void)?

    public override func viewDidLoad() {
        super.viewDidLoad()
        let session = AVCaptureSession()
        guard let videoDevice = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: videoDevice) else {
            onError?(ALPRError.cameraUnavailable)
            return
        }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
        output.metadataObjectTypes = [.qr, .pdf417, .aztec]
        captureSession = session
        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.frame = view.bounds
        preview.videoGravity = .resizeAspectFill
        view.layer.addSublayer(preview)
        DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
    }

    public func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let obj = metadataObjects.first as? AVMetadataMachineReadableCodeObject, let string = obj.stringValue else { return }
        captureSession?.stopRunning()
        onCapture?(string)
    }
}

public enum ALPRError: Error, LocalizedError {
    case cameraUnavailable
    case noPlateDetected

    public var errorDescription: String? {
        switch self {
        case .cameraUnavailable: return "Camera is unavailable"
        case .noPlateDetected: return "No plate detected"
        }
    }
}
