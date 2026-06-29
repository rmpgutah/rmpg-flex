import SwiftUI
import Vision
import AVFoundation
import DesignSystem

@MainActor
public final class DocumentScannerViewModel: ObservableObject {
    @Published public var scannedID: ScannedID?
    @Published public var isScanning = false
    @Published public var scanError: String?
    @Published public var capturedImage: UIImage?

    public init() {}

    public func scanImage(_ image: UIImage) {
        isScanning = true
        scanError = nil
        capturedImage = image

        guard let cgImage = image.cgImage else {
            scanError = "Could not process image"; isScanning = false; return
        }

        let request = VNRecognizeTextRequest { [weak self] request, error in
            guard let self, let observations = request.results as? [VNRecognizedTextObservation] else {
                Task { @MainActor in self?.scanError = error?.localizedDescription ?? "No text found"; self?.isScanning = false }
                return
            }

            let lines = observations.compactMap { obs -> String? in
                obs.topCandidates(1).first?.string
            }

            self.parseAndSet(lines: lines)
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["en-US"]

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do {
            try handler.perform([request])
        } catch {
            scanError = error.localizedDescription
            isScanning = false
        }
    }

    private func parseAndSet(lines: [String]) {
        let text = lines.joined(separator: "\n")

        if MRZParser.looksLikePassport(text) {
            if let id = MRZParser.parseMRZ(text) { scannedID = id; isScanning = false; return }
        }

        let scanned = DLParser.parse(lines: lines)
        if scanned.confidence > 0.1 {
            scannedID = scanned
        } else {
            scanError = "Could not identify document. Ensure the ID fills the frame and is well-lit."
        }
        isScanning = false
    }

    public func reset() {
        scannedID = nil
        scanError = nil
        capturedImage = nil
        isScanning = false
    }
}

public struct DocumentScannerView: View {
    @StateObject private var vm = DocumentScannerViewModel()
    @State private var showCamera = false
    @State private var showGallery = false

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

                if let error = vm.scanError {
                    Text(error)
                        .font(.system(size: 11))
                        .foregroundColor(Color(hex: "ef4444"))
                        .padding()
                }
            }
        }
        .sheet(isPresented: $showCamera) {
            CameraCaptureView { image in
                vm.scanImage(image)
                showCamera = false
            }
        }
        .sheet(isPresented: $showGallery) {
            GalleryPickerView { image in
                vm.scanImage(image)
                showGallery = false
            }
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
                    showCamera = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "camera.fill").font(.system(size: 14))
                        Text("SCAN WITH CAMERA").font(.system(size: 13, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(Color(hex: "d4a017")).foregroundColor(.black).cornerRadius(2)
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
            }
            .padding(.horizontal, 32)

            Text("Supports: Driver's License, State ID, Passport, Military ID")
                .font(.system(size: 10)).foregroundColor(Color(hex: "555555"))
            Spacer()
        }
    }

    private var scanningView: some View {
        VStack(spacing: 16) {
            Spacer()
            if let img = vm.capturedImage {
                Image(uiImage: img)
                    .resizable().scaledToFit()
                    .frame(maxWidth: 280, maxHeight: 180)
                    .cornerRadius(4)
                    .overlay(
                        RoundedRectangle(cornerRadius: 4)
                            .stroke(Color(hex: "d4a017").opacity(0.4), lineWidth: 2)
                    )
            }
            ProgressView().tint(Color(hex: "d4a017"))
            Text("Reading document...").font(.system(size: 12)).foregroundColor(Color(hex: "888888"))
            Spacer()
        }
    }

    private func scannedResult(id: ScannedID) -> some View {
        ScrollView {
            VStack(spacing: 0) {
                if let img = vm.capturedImage {
                    Image(uiImage: img)
                        .resizable().scaledToFit()
                        .frame(maxWidth: 200, maxHeight: 130)
                        .cornerRadius(2)
                        .padding(.vertical, 12)
                }

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

                VStack(spacing: 8) {
                    Button {
                        onScanComplete(id)
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "arrow.up.doc.fill").font(.system(size: 14))
                            Text("PUSH TO CAD").font(.system(size: 13, weight: .semibold))
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

struct CameraCaptureView: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onCapture: onCapture) }

    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onCapture: (UIImage) -> Void
        init(onCapture: @escaping (UIImage) -> Void) { self.onCapture = onCapture }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { onCapture(image) }
            picker.dismiss(animated: true)
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { picker.dismiss(animated: true) }
    }
}

struct GalleryPickerView: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .photoLibrary
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onCapture: onCapture) }

    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onCapture: (UIImage) -> Void
        init(onCapture: @escaping (UIImage) -> Void) { self.onCapture = onCapture }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { onCapture(image) }
            picker.dismiss(animated: true)
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { picker.dismiss(animated: true) }
    }
}
