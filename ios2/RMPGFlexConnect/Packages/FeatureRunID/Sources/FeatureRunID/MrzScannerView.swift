import SwiftUI
import AVFoundation
import Vision

#if os(iOS)
public struct MrzScannerView: UIViewControllerRepresentable {
    public let onScan: (MrzResult) -> Void
    public let onError: (Error) -> Void

    public init(onScan: @escaping (MrzResult) -> Void, onError: @escaping (Error) -> Void) {
        self.onScan = onScan
        self.onError = onError
    }

    public func makeUIViewController(context: Context) -> MrzScannerViewController {
        let vc = MrzScannerViewController()
        vc.onScan = onScan
        vc.onError = onError
        return vc
    }

    public func updateUIViewController(_ uiViewController: MrzScannerViewController, context: Context) {}
}

public class MrzScannerViewController: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate {
    private var captureSession: AVCaptureSession?
    var onScan: ((MrzResult) -> Void)?
    var onError: ((Error) -> Void)?
    private var lastScanAttempt: Date?

    public override func viewDidLoad() {
        super.viewDidLoad()
        let session = AVCaptureSession()
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device) else {
            onError?(MrzError.cameraUnavailable)
            return
        }
        session.addInput(input)
        let output = AVCaptureVideoDataOutput()
        output.setSampleBufferDelegate(self, queue: DispatchQueue(label: "mrz-scan"))
        session.addOutput(output)
        captureSession = session
        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.frame = view.bounds
        preview.videoGravity = .resizeAspectFill
        view.layer.addSublayer(preview)
        DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
    }

    public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let now = Date()
        if let last = lastScanAttempt, now.timeIntervalSince(last) < 2 { return }
        lastScanAttempt = now
        let ciImage = CIImage(cvPixelBuffer: buffer)
        let context = CIContext()
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else { return }
        let requestHandler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        let request = VNRecognizeTextRequest { [weak self] request, error in
            guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
            let text = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
            guard !text.isEmpty, let result = MrzParser.parse(text) else { return }
            self?.captureSession?.stopRunning()
            DispatchQueue.main.async { self?.onScan?(result) }
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        try? requestHandler.perform([request])
    }
}

#endif

public enum MrzError: Error, LocalizedError {
    case cameraUnavailable

    public var errorDescription: String? {
        switch self {
        case .cameraUnavailable: return "Camera is unavailable"
        }
    }
}
