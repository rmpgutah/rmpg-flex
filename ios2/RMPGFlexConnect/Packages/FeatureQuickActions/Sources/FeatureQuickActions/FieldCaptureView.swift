import SwiftUI
import PhotosUI
import DesignSystem
import CoreAPI
import CoreAuth

// Shared view for "Quick Capture" (ALPR plate scan) and "Field Camera" (field photo log).
// mode=alpr → POSTs to /api/alpr/capture; mode=photo → POSTs to /api/field-photos
@MainActor
struct FieldCaptureView: View {
    enum CaptureMode { case alpr, photo }

    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @State private var pickerItem: PhotosPickerItem?
    @State private var imageData: Data?
    @State private var previewImage: Image?
    @State private var notes = ""
    @State private var isBusy = false
    @State private var error: String?
    @State private var result: CaptureResult?

    let mode: CaptureMode
    let apiClient: APIClient

    private var title: String { mode == .alpr ? "PLATE SCAN" : "FIELD PHOTO" }
    private var actionLabel: String { mode == .alpr ? "SCAN PLATE" : "UPLOAD PHOTO" }
    private var icon: String { mode == .alpr ? "car.rear.and.lane.departure.warning.fill" : "camera.fill" }

    var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()
                if let result {
                    resultView(result)
                } else {
                    captureForm
                }
            }
            .navigationTitle(title)
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .toolbar {
                ToolbarItem(placement: RmpgToolbarPlacement.trailing.placement) {
                    Button("Cancel") { dismiss() }
                        .font(.caption.weight(.semibold)).foregroundStyle(theme.colors.textMuted)
                }
            }
        }
    }

    private var captureForm: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Photo picker area
                PhotosPicker(selection: $pickerItem, matching: .images) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(theme.colors.surfaceRaised)
                            .frame(height: 200)
                            .overlay(RoundedRectangle(cornerRadius: 8)
                                .strokeBorder(theme.colors.surfaceMuted, lineWidth: 1))
                        if let previewImage {
                            previewImage.resizable().scaledToFill()
                                .frame(height: 200)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        } else {
                            VStack(spacing: 8) {
                                Image(systemName: icon).font(.system(size: 40))
                                    .foregroundStyle(theme.colors.brandGold)
                                Text("TAP TO SELECT PHOTO").font(.caption.weight(.semibold)).tracking(1)
                                    .foregroundStyle(theme.colors.textMuted)
                                Text("Camera roll · Library").font(.caption2).foregroundStyle(theme.colors.textMuted)
                            }
                        }
                    }
                }
                .onChange(of: pickerItem) { _, item in
                    guard let item else { return }
                    Task {
                        if let data = try? await item.loadTransferable(type: Data.self) {
                            imageData = data
                            #if os(iOS)
                            if let uiImg = UIImage(data: data) {
                                previewImage = Image(uiImage: uiImg)
                            }
                            #else
                            if let nsImg = NSImage(data: data) {
                                previewImage = Image(nsImage: nsImg)
                            }
                            #endif
                        }
                    }
                }

                if mode == .photo {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("NOTES").font(.caption2.weight(.semibold)).tracking(0.5)
                            .foregroundStyle(theme.colors.textMuted)
                        TextEditor(text: $notes)
                            .frame(minHeight: 70).padding(8)
                            .background(theme.colors.surfaceMuted)
                            .foregroundStyle(theme.colors.textPrimary).font(.body)
                            .clipShape(RoundedRectangle(cornerRadius: 2))
                    }
                }

                if let error {
                    Text(error).font(.caption).foregroundStyle(theme.colors.critical)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button { Task { await upload() } } label: {
                    Group {
                        if isBusy { ProgressView().tint(theme.colors.surfaceBase) }
                        else { Text(actionLabel).font(.headline).tracking(1) }
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(imageData != nil ? theme.colors.brandGold : theme.colors.surfaceMuted)
                    .foregroundStyle(imageData != nil ? theme.colors.surfaceBase : theme.colors.textMuted)
                    .clipShape(RoundedRectangle(cornerRadius: 2))
                }
                .disabled(imageData == nil || isBusy)
            }
            .padding(16)
        }
    }

    private func resultView(_ r: CaptureResult) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 64)).foregroundStyle(theme.colors.success)
            Text(mode == .alpr ? "SCAN COMPLETE" : "PHOTO UPLOADED")
                .font(.title3.weight(.bold)).tracking(2).foregroundStyle(theme.colors.textPrimary)

            if let plate = r.plate, !plate.isEmpty {
                VStack(spacing: 4) {
                    Text("PLATE DETECTED").font(.caption2.weight(.bold)).tracking(1).foregroundStyle(theme.colors.textMuted)
                    Text(plate).font(.title2.weight(.black).monospacedDigit()).foregroundStyle(theme.colors.brandGold)
                    if let conf = r.confidence {
                        Text(String(format: "%.0f%% confidence", conf * 100))
                            .font(.caption2).foregroundStyle(theme.colors.textMuted)
                    }
                }
                .padding(16).background(theme.colors.surfaceRaised)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            } else if mode == .alpr {
                Text("No plate detected in frame.").font(.caption).foregroundStyle(theme.colors.textMuted)
            }

            if let id = r.id {
                Text("Ref #\(id)").font(.caption2).foregroundStyle(theme.colors.textMuted)
            }

            Button("Done") { dismiss() }
                .font(.headline).tracking(1).frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(theme.colors.brandGold).foregroundStyle(theme.colors.surfaceBase)
                .clipShape(RoundedRectangle(cornerRadius: 2))
                .padding(.horizontal, 32).padding(.top, 8)
        }
        .padding(32)
    }

    private func upload() async {
        guard let data = imageData else { return }
        isBusy = true; error = nil
        do {
            let token = KeychainStore.get(AuthSession.tokenKey) ?? ""
            let baseURL = URL(string: "https://api.rmpgutah.us")!
            let path = mode == .alpr ? "api/alpr/capture" : "api/field-photos"
            let url = baseURL.appendingPathComponent(path)
            let boundary = "----Boundary\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"

            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }

            var body = Data()
            let fieldName = mode == .alpr ? "photo" : "photo"
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(fieldName)\"; filename=\"photo.jpg\"\r\n".data(using: .utf8)!)
            body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
            // Compress to JPEG for upload
            #if os(iOS)
            let jpegData = UIImage(data: data)?.jpegData(compressionQuality: 0.7) ?? data
            #else
            let jpegData = data
            #endif
            body.append(jpegData)
            body.append("\r\n".data(using: .utf8)!)
            if !notes.isEmpty {
                body.append("--\(boundary)\r\n".data(using: .utf8)!)
                body.append("Content-Disposition: form-data; name=\"notes\"\r\n\r\n".data(using: .utf8)!)
                body.append(notes.data(using: .utf8)!)
                body.append("\r\n".data(using: .utf8)!)
            }
            body.append("--\(boundary)--\r\n".data(using: .utf8)!)
            req.httpBody = body

            let (respData, _) = try await URLSession.shared.data(for: req)
            let decoded = try JSONDecoder().decode(CaptureResponse.self, from: respData)
            result = CaptureResult(
                id: decoded.id ?? decoded.capture_id,
                plate: decoded.vehicles?.first?.plate ?? decoded.plate,
                confidence: decoded.vehicles?.first?.confidence
            )
        } catch {
            self.error = error.localizedDescription
        }
        isBusy = false
    }
}

private struct CaptureResult {
    let id: Int?
    let plate: String?
    let confidence: Double?
}

private struct CaptureResponse: Decodable {
    let id: Int?
    let capture_id: Int?
    let plate: String?
    let vehicles: [VehicleHit]?

    struct VehicleHit: Decodable {
        let plate: String?
        let confidence: Double?
    }
}
