import SwiftUI
import AVFoundation
import AudioToolbox
import Vision

/// A live, standard-barcode-scanner-style camera view that detects BOTH at
/// once, off the same continuous feed:
///  - PDF417 barcodes (US/CA driver's licenses & state IDs) via
///    `AVCaptureMetadataOutput`, decoded in hardware/on the video pipeline.
///  - Passport books (TD3, 2-line MRZ) and passport cards / ID cards (TD1,
///    3-line MRZ) via a throttled `VNRecognizeTextRequest` pass over sampled
///    frames from `AVCaptureVideoDataOutput`, checked against
///    `MRZParser.looksLikePassport`/`parseMRZ` — the same checksum-validated
///    path the still-photo passport flow uses, just run continuously instead
///    of waiting for a manual capture.
/// Whichever fires first wins — there's no mode switch the officer has to
/// pick; point the camera at a barcode OR an MRZ and it reads either. This
/// is a fundamentally different mechanism from the old VisionKit document
/// capture → still JPEG → detection-run-afterward flow, which required a
/// manual "Save" tap before any decoding happened at all. A haptic + a
/// system shutter-style sound fire on detection for standard-scanner feel.
struct LiveBarcodeScannerView: UIViewControllerRepresentable {
    /// Fires the instant a PDF417 is decoded — this is the "immediate result."
    let onDetect: (String) -> Void
    /// Fires the instant a passport/passport-card MRZ is read and checksum-validated.
    var onMRZDetect: (ScannedID) -> Void = { _ in }
    /// Fires separately, slightly after `onDetect`/`onMRZDetect`, once the
    /// record-keeping still photo finishes processing. Never blocks either.
    let onPhotoCaptured: (UIImage) -> Void
    let onCancel: () -> Void
    /// Fires when the camera can't be started at all (permission denied/
    /// restricted, or no capture device) — lets the caller surface a real
    /// message instead of a silently blank/frozen preview.
    var onError: (String) -> Void = { _ in }

    func makeUIViewController(context: Context) -> LiveBarcodeScannerController {
        LiveBarcodeScannerController(onDetect: onDetect, onMRZDetect: onMRZDetect, onPhotoCaptured: onPhotoCaptured, onCancel: onCancel, onError: onError)
    }

    func updateUIViewController(_ uiViewController: LiveBarcodeScannerController, context: Context) {}
}

final class LiveBarcodeScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate, AVCapturePhotoCaptureDelegate, AVCaptureVideoDataOutputSampleBufferDelegate {
    private let onDetect: (String) -> Void
    private let onMRZDetect: (ScannedID) -> Void
    private let onPhotoCaptured: (UIImage) -> Void
    private let onCancel: () -> Void
    private let onError: (String) -> Void

    private let session = AVCaptureSession()
    private let photoOutput = AVCapturePhotoOutput()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let videoQueue = DispatchQueue(label: "com.rmpg.flex.livescanner.video")
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var hasDetected = false
    /// Throttles the MRZ OCR pass — running Vision text recognition on
    /// every single frame (~30/sec) would burn the CPU/GPU and battery for
    /// no benefit; one in-flight pass at a time, dropping frames until it
    /// completes, is plenty responsive for a document held steady in frame.
    private var isProcessingMRZFrame = false

    init(onDetect: @escaping (String) -> Void, onMRZDetect: @escaping (ScannedID) -> Void = { _ in }, onPhotoCaptured: @escaping (UIImage) -> Void, onCancel: @escaping () -> Void, onError: @escaping (String) -> Void = { _ in }) {
        self.onDetect = onDetect
        self.onMRZDetect = onMRZDetect
        self.onPhotoCaptured = onPhotoCaptured
        self.onCancel = onCancel
        self.onError = onError
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        addOverlay()
        addCancelButton()
        requestAccessThenConfigure()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !session.isRunning, session.inputs.isEmpty == false {
            DispatchQueue.global(qos: .userInitiated).async { [session] in session.startRunning() }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if session.isRunning { session.stopRunning() }
    }

    /// AVCaptureSession never prompts for camera permission on its own the
    /// way VNDocumentCameraViewController/UIImagePickerController do — this
    /// controller is the one camera path in the app that owns its own
    /// AVCaptureSession, and it had NO permission check at all. On a fresh
    /// install (or after a prior denial), `configureSession()` would run,
    /// silently fail to add a usable input, and the officer would just see a
    /// black/frozen preview with zero indication of what went wrong — which
    /// reads exactly like "the scanner doesn't work."
    private func requestAccessThenConfigure() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        self?.configureSession()
                    } else {
                        self?.onError("Camera access was denied. Enable it in Settings > RMPG Flex Connect > Camera.")
                    }
                }
            }
        case .denied, .restricted:
            onError("Camera access is disabled for this app. Enable it in Settings > RMPG Flex Connect > Camera.")
        @unknown default:
            onError("Camera unavailable.")
        }
    }

    private func configureSession() {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            onError("No camera available on this device.")
            return
        }
        guard let input = try? AVCaptureDeviceInput(device: device) else {
            onError("Could not access the camera.")
            return
        }
        session.beginConfiguration()
        if session.canSetSessionPreset(.hd1920x1080) {
            session.sessionPreset = .hd1920x1080
        } else {
            session.sessionPreset = .high
        }
        if session.canAddInput(input) { session.addInput(input) }

        let metadataOutput = AVCaptureMetadataOutput()
        if session.canAddOutput(metadataOutput) {
            session.addOutput(metadataOutput)
            metadataOutput.setMetadataObjectsDelegate(self, queue: .main)
            // PDF417 only — the sole symbology AAMVA licenses/state IDs use.
            // Narrowing the symbology list (rather than accepting every type
            // AVFoundation supports) reduces false-trigger risk from
            // unrelated barcodes/QR codes in frame.
            metadataOutput.metadataObjectTypes = [.pdf417]
        }

        if session.canAddOutput(photoOutput) { session.addOutput(photoOutput) }

        // Second output on the same feed for the MRZ path — independent of
        // the metadata (barcode) output above, so both run concurrently off
        // one camera session rather than needing a mode switch.
        videoOutput.setSampleBufferDelegate(self, queue: videoQueue)
        videoOutput.alwaysDiscardsLateVideoFrames = true
        if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }

        session.commitConfiguration()

        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.insertSublayer(layer, at: 0)
        previewLayer = layer

        // Autofocus at a fixed point-of-interest near the center where the
        // targeting rectangle sits — PDF417 barcodes are small and dense,
        // so continuous center-weighted autofocus reads them faster than
        // the default whole-frame focus behavior.
        try? device.lockForConfiguration()
        if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
        if device.isFocusPointOfInterestSupported { device.focusPointOfInterest = CGPoint(x: 0.5, y: 0.5) }
        if device.isAutoFocusRangeRestrictionSupported {
            device.autoFocusRangeRestriction = .near
        }
        device.unlockForConfiguration()

        // Permission is requested asynchronously, so `viewDidAppear` may
        // already have run (and skipped starting, since there was no input
        // yet) by the time configuration finishes here — start explicitly
        // rather than depending on that race resolving favorably.
        if !session.isRunning {
            DispatchQueue.global(qos: .userInitiated).async { [session] in session.startRunning() }
        }
    }

    private func addOverlay() {
        let box = UIView()
        box.layer.borderColor = UIColor(red: 0.831, green: 0.627, blue: 0.09, alpha: 1).cgColor
        box.layer.borderWidth = 2
        box.layer.cornerRadius = 4
        box.backgroundColor = .clear
        box.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(box)
        NSLayoutConstraint.activate([
            box.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            box.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            box.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.85),
            box.heightAnchor.constraint(equalToConstant: 140),
        ])

        let label = UILabel()
        label.text = "Align barcode within frame"
        label.textColor = .white
        label.font = .systemFont(ofSize: 12, weight: .medium)
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.topAnchor.constraint(equalTo: box.bottomAnchor, constant: 16),
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
        ])
    }

    private func addCancelButton() {
        let button = UIButton(type: .system)
        button.setTitle("Cancel", for: .normal)
        button.setTitleColor(.white, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        button.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        button.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(button)
        NSLayoutConstraint.activate([
            button.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            button.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
        ])
    }

    @objc private func cancelTapped() { onCancel() }

    // The metadata delegate queue is `.main` (set in configureSession), and
    // photo-capture delegate callbacks arrive on an AVFoundation-internal
    // queue — both are marked `nonisolated` and hop to the MainActor inside,
    // since this UIViewController subclass (and its state like `hasDetected`)
    // is MainActor-isolated by default under Swift 6 strict concurrency.
    nonisolated func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        // Extract the one Sendable value (the decoded string) here, on
        // whatever queue this delegate call arrived on — AVMetadataObject
        // itself isn't Sendable, so the array can't cross into the
        // MainActor Task below; only the payload string does.
        guard let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              object.type == .pdf417 else { return }
        // AAMVA headers contain 0x1E (RS). AVFoundation UTF-8-decodes PDF417,
        // so stringValue is often nil even when the barcode was found. Still
        // take a non-empty string when present; Vision on the video feed
        // recovers the latin-1 payload when this is empty.
        guard let payload = object.stringValue, payload.count > 20 else { return }

        Task { @MainActor in
            guard markDetectedAndCaptureRecordPhoto() else { return }
            // Hand back the decoded payload immediately — don't wait on the
            // photo capture (which is only for the record image) to deliver
            // the actual barcode data the caller needs right now.
            onDetect(payload)
        }
    }

    nonisolated func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        guard let data = photo.fileDataRepresentation(), let image = UIImage(data: data) else { return }
        Task { @MainActor in
            onPhotoCaptured(image)
        }
    }

    /// Sampled frames from the video-data output. PDF417 is tried first via
    /// Vision (recovers AAMVA payloads AVFoundation left as nil stringValue),
    /// then the MRZ OCR pass. Runs on `videoQueue`, not `.main`.
    nonisolated func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let context = CIContext()
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else { return }

        Task { @MainActor in
            guard !hasDetected, !isProcessingMRZFrame else { return }
            isProcessingMRZFrame = true
            runBarcodeThenMRZ(on: cgImage)
        }
    }

    @MainActor
    private func runBarcodeThenMRZ(on cgImage: CGImage) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let barcodeRequest = VNDetectBarcodesRequest()
            barcodeRequest.symbologies = [.pdf417]
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            try? handler.perform([barcodeRequest])
            let payload = (barcodeRequest.results as? [VNBarcodeObservation])?
                .first(where: { $0.symbology == .pdf417 })?
                .payloadStringValue
            if let payload, payload.count > 20 {
                Task { @MainActor in
                    guard let self else { return }
                    self.isProcessingMRZFrame = false
                    guard self.markDetectedAndCaptureRecordPhoto() else { return }
                    self.onDetect(payload)
                }
                return
            }
            Task { @MainActor in
                self?.runMRZPass(on: cgImage)
            }
        }
    }

    @MainActor
    private func runMRZPass(on cgImage: CGImage) {
        let request = VNRecognizeTextRequest { [weak self] request, _ in
            guard let self else { return }
            let lines = (request.results as? [VNRecognizedTextObservation])?
                .compactMap { $0.topCandidates(1).first?.string } ?? []
            let text = lines.joined(separator: "\n")
            Task { @MainActor in
                self.isProcessingMRZFrame = false
                guard !self.hasDetected else { return }
                guard MRZParser.looksLikePassport(text), let scanned = MRZParser.parseMRZ(text) else { return }
                guard self.markDetectedAndCaptureRecordPhoto() else { return }
                self.onMRZDetect(scanned)
            }
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false // MRZ isn't natural-language text
        request.recognitionLanguages = ["en-US"]

        // Vision request execution itself is synchronous CPU work — hop off
        // MainActor to run it so a slow pass doesn't stall the UI, then hop
        // back via the completion handler above (which already does).
        DispatchQueue.global(qos: .userInitiated).async {
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            try? handler.perform([request])
        }
    }

    /// Shared "we found something" transition for both the barcode and MRZ
    /// paths — de-dupes so only the first detector to succeed wins, fires
    /// the standard-scanner haptic/sound, and kicks off the record photo.
    /// Returns false if something else already won this scan session.
    @MainActor
    @discardableResult
    private func markDetectedAndCaptureRecordPhoto() -> Bool {
        guard !hasDetected else { return false }
        hasDetected = true
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        AudioServicesPlaySystemSound(1108) // standard camera-shutter system sound
        let settings = AVCapturePhotoSettings()
        photoOutput.capturePhoto(with: settings, delegate: self)
        return true
    }
}
