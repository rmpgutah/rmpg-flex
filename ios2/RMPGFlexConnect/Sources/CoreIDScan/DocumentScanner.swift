import SwiftUI
import Vision
import VisionKit
import AVFoundation


@MainActor
public final class DocumentScannerViewModel: ObservableObject {
    @Published public var scannedID: ScannedID?
    @Published public var isScanning = false
    @Published public var scanError: String?
    @Published public var frontImage: UIImage?
    @Published public var backImage: UIImage?
    @Published public var autoSubmitted = false

    /// Called once, automatically, when a scan resolves with high-confidence
    /// structured data (a real PDF417/MRZ read) — no manual button tap needed.
    /// This is what pushes the result to the vehicle MDT / CAD records.
    public var onAutoSubmit: ((ScannedID) -> Void)?

    public init() {}

    /// Consumes every page from one VisionKit document-camera session (or a
    /// single gallery-picked image). The front and back photos are stored as
    /// plain images only — all field data comes exclusively from the PDF417
    /// barcode on the back of US/CA driver's licenses & state IDs. There is
    /// intentionally no OCR/MRZ fallback: an OCR guess at printed text is far
    /// less reliable than the barcode's structured AAMVA record, and silently
    /// populating a CAD/MDT record from a misread guess is worse than
    /// reporting "no barcode found" and asking the officer to rescan.
    public func scanPages(_ images: [UIImage]) {
        guard let front = images.first else { return }
        isScanning = true
        scanError = nil
        autoSubmitted = false
        frontImage = front
        backImage = images.count > 1 ? images[1] : nil

        let barcodeCandidates = [backImage, front].compactMap { $0 }
        tryBarcodes(barcodeCandidates)
    }

    private func tryBarcodes(_ remaining: [UIImage]) {
        guard let image = remaining.first, let cgImage = image.cgImage else {
            scanError = "No PDF417 barcode found. Capture the BACK of the ID (where the barcode is printed), well-lit and filling the frame."
            isScanning = false
            return
        }

        let barcodeRequest = VNDetectBarcodesRequest { [weak self] request, _ in
            guard let self else { return }
            let payload = (request.results as? [VNBarcodeObservation])?
                .first { $0.symbology == .pdf417 }?
                .payloadStringValue
            if let payload, let scanned = AAMVAParser.parse(payload) {
                Task { @MainActor in self.finish(with: scanned) }
            } else {
                Task { @MainActor in
                    self.tryBarcodes(Array(remaining.dropFirst()))
                }
            }
        }
        // Restrict to PDF417 (the only symbology AAMVA licenses/state IDs use)
        // instead of Vision's default all-symbology search — this both speeds
        // up detection and avoids false-positive matches on other barcode
        // types competing for the same detector pass.
        barcodeRequest.symbologies = [.pdf417]

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do {
            try handler.perform([barcodeRequest])
        } catch {
            tryBarcodes(Array(remaining.dropFirst()))
        }
    }

    private func finish(with id: ScannedID) {
        scannedID = id
        isScanning = false
        // A structured PDF417/AAMVA read is high-confidence enough to act on
        // automatically — no extra manual tap required for the officer.
        if id.confidence >= 0.6, let onAutoSubmit, !autoSubmitted {
            autoSubmitted = true
            onAutoSubmit(id)
        }
    }

    public func reset() {
        scannedID = nil
        scanError = nil
        frontImage = nil
        backImage = nil
        isScanning = false
        autoSubmitted = false
    }

    /// Handles a payload decoded LIVE off the camera feed by
    /// `LiveBarcodeScannerView` — this is the "immediate result" path: no
    /// manual capture/save step, the barcode is parsed the instant
    /// `AVCaptureMetadataOutput` reads it off the live video, unlike the
    /// old flow where a still photo had to be captured and Save tapped
    /// before Vision ever ran a detection pass on it.
    public func handleLiveBarcode(_ payload: String) {
        isScanning = true
        scanError = nil
        autoSubmitted = false
        if let scanned = AAMVAParser.parse(payload) {
            finish(with: scanned)
        } else {
            scanError = "Barcode read but isn't a recognized AAMVA driver's license/state ID format."
            isScanning = false
        }
    }

    /// Handles a passport/passport-card MRZ already checksum-validated and
    /// parsed LIVE off the camera feed by `LiveBarcodeScannerView`'s
    /// throttled OCR pass — the same live-scanner session that detects
    /// PDF417 barcodes also detects MRZ, no separate mode to pick.
    public func handleLiveMRZ(_ scanned: ScannedID) {
        isScanning = true
        scanError = nil
        autoSubmitted = false
        finish(with: scanned)
    }

    /// The record-keeping still photo arrives slightly after the instant
    /// barcode result — attach it once it's ready without blocking anything.
    public func attachCapturedImage(_ image: UIImage) {
        backImage = image
    }

    /// Reads a passport book (TD3, 2-line MRZ) or passport card / ID card
    /// (TD1, 3-line MRZ) via its Machine Readable Zone. Unlike the removed
    /// OCR-guess fallback for driver's licenses, this is NOT a guess: MRZ
    /// text is checksum-validated per ICAO 9303 (MRZParser verifies the
    /// document-number/DOB/expiry check digits), the same way the PDF417
    /// barcode is authoritative for a DL — passports simply have no barcode
    /// at all, so the MRZ is the only machine-readable source available.
    public func scanPassportMRZ(_ image: UIImage) {
        isScanning = true
        scanError = nil
        autoSubmitted = false
        frontImage = image

        guard let cgImage = image.cgImage else {
            scanError = "Could not process image"
            isScanning = false
            return
        }

        let request = VNRecognizeTextRequest { [weak self] request, _ in
            guard let self else { return }
            let lines = (request.results as? [VNRecognizedTextObservation])?
                .compactMap { $0.topCandidates(1).first?.string } ?? []
            let text = lines.joined(separator: "\n")
            Task { @MainActor in
                if MRZParser.looksLikePassport(text), let scanned = MRZParser.parseMRZ(text) {
                    self.finish(with: scanned)
                } else {
                    self.scanError = "No valid MRZ found. Capture the bottom of the passport photo page (2 or 3 lines of machine-readable text), well-lit and flat."
                    self.isScanning = false
                }
            }
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false // MRZ isn't natural-language text
        request.recognitionLanguages = ["en-US"]

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do {
            try handler.perform([request])
        } catch {
            scanError = "MRZ scan failed: \(error.localizedDescription)"
            isScanning = false
        }
    }
}

public struct DocumentScannerView: View {
    @StateObject private var vm = DocumentScannerViewModel()
    @StateObject private var nfcReader = NFCIDReader()
    @State private var showCamera = false
    @State private var showGallery = false
    @State private var showPassportCamera = false

    let onScanComplete: (ScannedID) -> Void

    public init(onScanComplete: @escaping (ScannedID) -> Void) {
        self.onScanComplete = onScanComplete
    }

    public var body: some View {
        ZStack {
            Color(hex: "0a0a0a").ignoresSafeArea()

            VStack(spacing: 0) {
                headerBar
                Divider().background(Color(hex: "222222"))

                if vm.isScanning {
                    scanningView
                } else if let id = vm.scannedID {
                    scannedResult(id: id)
                } else {
                    capturePrompt
                }

                if let error = vm.scanError ?? nfcReader.scanError {
                    Text(error)
                        .font(.system(size: 11))
                        .foregroundColor(Color(hex: "ef4444"))
                        .padding()
                }
            }
        }
        .onAppear {
            // Auto-scan on capture, auto-push on a high-confidence read — no
            // manual button tap required once both sides are photographed.
            vm.onAutoSubmit = onScanComplete
        }
        .fullScreenCover(isPresented: $showCamera) {
            // A standard live barcode scanner — the instant a PDF417 is
            // decoded off the live camera feed, the result is ready. Falls
            // back to the gallery on hardware with no camera (e.g. Simulator).
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                LiveBarcodeScannerView(
                    onDetect: { payload in
                        vm.handleLiveBarcode(payload)
                        showCamera = false
                    },
                    onMRZDetect: { scanned in
                        vm.handleLiveMRZ(scanned)
                        showCamera = false
                    },
                    onPhotoCaptured: { image in
                        vm.attachCapturedImage(image)
                    },
                    onCancel: { showCamera = false },
                    onError: { message in
                        vm.scanError = message
                        showCamera = false
                    }
                )
                .ignoresSafeArea()
            } else {
                GalleryPickerView { image in
                    vm.scanPages([image])
                    showCamera = false
                }
            }
        }
        .sheet(isPresented: $showGallery) {
            GalleryPickerView { image in
                vm.scanPages([image])
                showGallery = false
            }
        }
        .sheet(isPresented: $showPassportCamera) {
            GalleryPickerView(onCapture: { image in
                vm.scanPassportMRZ(image)
                showPassportCamera = false
            }, sourceType: .camera)
        }
    }

    private var headerBar: some View {
        HStack {
            Text("ID SCANNER".uppercased())
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(Color(hex: "d4a017"))
                .tracking(2)
            Spacer()
            Text(vm.scannedID?.documentType.rawValue.replacingOccurrences(of: "_", with: " ").uppercased() ?? "READY")
                .font(.system(size: 9))
                .foregroundColor(Color(hex: "666666"))
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(Color(hex: "141414"))
    }

    private var capturePrompt: some View {
        VStack(spacing: 24) {
            Spacer()
            ZStack {
                RoundedRectangle(cornerRadius: 4)
                    .stroke(Color(hex: "d4a017"), style: StrokeStyle(lineWidth: 2, dash: [8, 4]))
                    .frame(width: 280, height: 180)
                VStack(spacing: 8) {
                    Image(systemName: "person.text.rectangle")
                        .font(.system(size: 40)).foregroundColor(Color(hex: "d4a017").opacity(0.6))
                    Text("Position ID in frame")
                        .font(.system(size: 11)).foregroundColor(Color(hex: "888888"))
                }
            }

            VStack(spacing: 12) {
                Button {
                    vm.reset()
                    showCamera = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "barcode.viewfinder").font(.system(size: 14))
                        Text("SCAN ID (LIVE)").font(.system(size: 13, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(Color(hex: "d4a017")).foregroundColor(.black).cornerRadius(2)
                }

                Button {
                    vm.reset()
                    showPassportCamera = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "book.closed.fill").font(.system(size: 14))
                        Text("PASSPORT MRZ (STILL PHOTO)").font(.system(size: 13, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(Color(hex: "141414")).foregroundColor(Color(hex: "888888")).cornerRadius(2)
                    .overlay(RoundedRectangle(cornerRadius: 2).stroke(Color(hex: "222222"), lineWidth: 1))
                }

                Button {
                    showGallery = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "photo.on.rectangle").font(.system(size: 14))
                        Text("CHOOSE FROM GALLERY").font(.system(size: 13, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(Color(hex: "141414")).foregroundColor(Color(hex: "888888")).cornerRadius(2)
                    .overlay(RoundedRectangle(cornerRadius: 2).stroke(Color(hex: "222222"), lineWidth: 1))
                }

                Button {
                    nfcReader.scanError = nil
                    nfcReader.startScanning()
                } label: {
                    HStack(spacing: 8) {
                        if nfcReader.isScanning {
                            ProgressView().tint(Color(hex: "888888"))
                        } else {
                            Image(systemName: "wave.3.right").font(.system(size: 14))
                        }
                        Text(nfcReader.isScanning ? "HOLD NEAR CHIP…" : "TAP TO SCAN (NFC)").font(.system(size: 13, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(Color(hex: "141414")).foregroundColor(Color(hex: "888888")).cornerRadius(2)
                    .overlay(RoundedRectangle(cornerRadius: 2).stroke(Color(hex: "222222"), lineWidth: 1))
                }
                .disabled(nfcReader.isScanning)
            }
            .padding(.horizontal, 32)

            Text("DL/State ID: point at the back barcode for an instant read. Passport/passport card: use MRZ scan on the photo page.")
                .font(.system(size: 10)).foregroundColor(Color(hex: "555555")).multilineTextAlignment(.center)
            Spacer()
        }
    }

    private var scanningView: some View {
        VStack(spacing: 16) {
            Spacer()
            HStack(spacing: 12) {
                if let img = vm.frontImage {
                    Image(uiImage: img)
                        .resizable().scaledToFit()
                        .frame(maxWidth: 130, maxHeight: 160)
                        .cornerRadius(4)
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(hex: "d4a017").opacity(0.4), lineWidth: 2))
                }
                if let img = vm.backImage {
                    Image(uiImage: img)
                        .resizable().scaledToFit()
                        .frame(maxWidth: 130, maxHeight: 160)
                        .cornerRadius(4)
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(hex: "d4a017").opacity(0.4), lineWidth: 2))
                }
            }
            ProgressView().tint(Color(hex: "d4a017"))
            Text("Reading document...").font(.system(size: 12)).foregroundColor(Color(hex: "888888"))
            Spacer()
        }
    }

    private func scannedResult(id: ScannedID) -> some View {
        ScrollView {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    if let img = vm.frontImage {
                        Image(uiImage: img)
                            .resizable().scaledToFit()
                            .frame(maxWidth: 140, maxHeight: 100)
                            .cornerRadius(2)
                    }
                    if let img = vm.backImage {
                        Image(uiImage: img)
                            .resizable().scaledToFit()
                            .frame(maxWidth: 140, maxHeight: 100)
                            .cornerRadius(2)
                    }
                }
                .padding(.vertical, 12)

                VStack(spacing: 0) {
                    resultRow("Name", id.displayName)
                    Divider().background(Color(hex: "1a1a1a"))
                    if let dob = id.dateOfBirth { resultRow("DOB", dob); Divider().background(Color(hex: "1a1a1a")) }
                    if let addr = id.address { resultRow("Address", addr); Divider().background(Color(hex: "1a1a1a")) }
                    if let city = id.city { resultRow("City", city); Divider().background(Color(hex: "1a1a1a")) }
                    if let state = id.state { resultRow("State", state); Divider().background(Color(hex: "1a1a1a")) }
                    if let dl = id.documentNumber { resultRow(id.documentType == .passport ? "Passport #" : "DL/ID #", dl); Divider().background(Color(hex: "1a1a1a")) }
                    if let exp = id.expirationDate { resultRow("Expires", exp); Divider().background(Color(hex: "1a1a1a")) }
                    if let gender = id.gender { resultRow("Sex", gender); Divider().background(Color(hex: "1a1a1a")) }
                    if let eyes = id.eyeColor { resultRow("Eyes", eyes); Divider().background(Color(hex: "1a1a1a")) }
                    if let h = id.height { resultRow("Height", h); Divider().background(Color(hex: "1a1a1a")) }
                    if let w = id.weight { resultRow("Weight", "\(w) lbs") }
                }
                .background(Color(hex: "141414")).cornerRadius(2).padding(.horizontal, 16)

                Text("Confidence: \(Int(id.confidence * 100))%")
                    .font(.system(size: 10)).foregroundColor(Color(hex: "555555")).padding(.top, 8)

                if vm.autoSubmitted {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.circle.fill")
                        Text("SENT TO VEHICLE MDT & CAD").font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundColor(Color(hex: "22c55e"))
                    .padding(.top, 6)
                }

                VStack(spacing: 8) {
                    Button {
                        onScanComplete(id)
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "arrow.up.doc.fill").font(.system(size: 14))
                            Text(vm.autoSubmitted ? "RE-SEND TO CAD" : "PUSH TO CAD").font(.system(size: 13, weight: .semibold))
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Color(hex: "d4a017")).foregroundColor(.black).cornerRadius(2)
                    }

                    HStack(spacing: 16) {
                        Button { vm.reset() } label: {
                            Text("Re-scan").font(.system(size: 12)).foregroundColor(Color(hex: "888888"))
                        }
                        Button {
                            onScanComplete(id)
                        } label: {
                            Text("Search Records").font(.system(size: 12)).foregroundColor(Color(hex: "d4a017"))
                        }
                    }
                }
                .padding(.horizontal, 32).padding(.top, 12)
            }
        }
    }

    private func resultRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.system(size: 10)).foregroundColor(Color(hex: "666666")).frame(width: 80, alignment: .leading)
            Text(value).font(.system(size: 11, weight: .medium)).foregroundColor(.white)
            Spacer()
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
    }
}

struct GalleryPickerView: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void
    var sourceType: UIImagePickerController.SourceType = .photoLibrary

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = UIImagePickerController.isSourceTypeAvailable(sourceType) ? sourceType : .photoLibrary
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onCapture: onCapture) }

    // Dismissal is owned by the SwiftUI `.sheet(isPresented:)` binding via the
    // onCapture callback flipping the flag — calling picker.dismiss here too
    // raced with it and could tear down the parent scanner sheet instead.
    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onCapture: (UIImage) -> Void
        init(onCapture: @escaping (UIImage) -> Void) { self.onCapture = onCapture }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { onCapture(image) }
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { picker.dismiss(animated: true) }
    }
}
