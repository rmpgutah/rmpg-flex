import SwiftUI



/// Field-officer attempt logging: pick an outcome, optionally attach a photo
/// and/or signature, auto-tag with GPS + timestamp, submit. Photos upload
/// individually as soon as they're captured (each returns an attachment id
/// immediately usable in the attempt payload) rather than batching at submit,
/// so a slow/failed upload surfaces before the officer taps submit.
struct LogAttemptSheet: View {
    let job: ServeJob
    let api: ServeAPI
    let onComplete: () -> Void

    @State private var result: ServeAttemptResult = .served
    @State private var notes = ""
    @State private var photoIds: [Int] = []
    @State private var photoThumbnails: [UIImage] = []
    @State private var signatureBase64: String?
    @State private var showCamera = false
    @State private var showGallery = false
    @State private var showSignaturePad = false
    @State private var isUploading = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var arrivedAtIso: String = ISO8601DateFormatter().string(from: Date())
    @Environment(\.dismiss) private var dismiss

    private let location = OneShotLocation()

    var body: some View {
        NavigationStack {
            ZStack {
                RMPGTheme.baseBlack.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("OUTCOME".uppercased())
                            .font(.system(size: 10, weight: .semibold)).foregroundColor(RMPGTheme.textMuted).tracking(1)

                        VStack(spacing: 0) {
                            ForEach(ServeAttemptResult.allCases, id: \.self) { option in
                                Button {
                                    result = option
                                } label: {
                                    HStack {
                                        Text(option.label).font(.system(size: 13)).foregroundColor(RMPGTheme.textPrimary)
                                        Spacer()
                                        if result == option {
                                            Image(systemName: "checkmark.circle.fill").foregroundColor(RMPGTheme.brandGold)
                                        }
                                    }
                                    .padding(.horizontal, 12).padding(.vertical, 10)
                                }
                                if option != ServeAttemptResult.allCases.last {
                                    Divider().background(RMPGTheme.borderSubtle)
                                }
                            }
                        }
                        .background(RMPGTheme.raisedSurface).cornerRadius(2)

                        Text("NOTES".uppercased())
                            .font(.system(size: 10, weight: .semibold)).foregroundColor(RMPGTheme.textMuted).tracking(1)
                        TextEditor(text: $notes)
                            .frame(height: 80)
                            .padding(6)
                            .scrollContentBackground(.hidden)
                            .background(RMPGTheme.raisedSurface)
                            .foregroundColor(RMPGTheme.textPrimary)
                            .cornerRadius(2)

                        Text("EVIDENCE".uppercased())
                            .font(.system(size: 10, weight: .semibold)).foregroundColor(RMPGTheme.textMuted).tracking(1)

                        if !photoThumbnails.isEmpty {
                            ScrollView(.horizontal) {
                                HStack(spacing: 8) {
                                    ForEach(photoThumbnails.indices, id: \.self) { i in
                                        Image(uiImage: photoThumbnails[i])
                                            .resizable().scaledToFill()
                                            .frame(width: 70, height: 70)
                                            .clipped().cornerRadius(2)
                                    }
                                }
                            }
                        }

                        HStack(spacing: 8) {
                            evidenceButton(icon: "camera.fill", label: isUploading ? "Uploading…" : "Photo") {
                                showCamera = true
                            }
                            .disabled(isUploading)

                            evidenceButton(icon: "photo.on.rectangle", label: "Gallery") {
                                showGallery = true
                            }
                            .disabled(isUploading)

                            evidenceButton(icon: signatureBase64 == nil ? "signature" : "checkmark.seal.fill", label: signatureBase64 == nil ? "Signature" : "Signed") {
                                showSignaturePad = true
                            }
                        }

                        if let error = errorMessage {
                            Text(error).font(.system(size: 11)).foregroundColor(RMPGTheme.statusRed)
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle("Log Attempt")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        Task { await submit() }
                    } label: {
                        if isSubmitting { ProgressView().tint(RMPGTheme.brandGold) }
                        else { Text("Submit").fontWeight(.semibold) }
                    }
                    .disabled(isSubmitting)
                }
            }
        }
        .sheet(isPresented: $showCamera) {
            ServePhotoPicker(source: .camera) { image in
                showCamera = false
                Task { await upload(image) }
            } onCancel: { showCamera = false }
        }
        .sheet(isPresented: $showGallery) {
            ServePhotoPicker(source: .library) { image in
                showGallery = false
                Task { await upload(image) }
            } onCancel: { showGallery = false }
        }
        .sheet(isPresented: $showSignaturePad) {
            SignaturePadView(onCapture: { base64 in
                signatureBase64 = base64
                showSignaturePad = false
            }, onCancel: { showSignaturePad = false })
        }
    }

    private func evidenceButton(icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 16))
                Text(label).font(.system(size: 10))
            }
            .frame(maxWidth: .infinity).padding(.vertical, 10)
            .background(RMPGTheme.raisedSurface).foregroundColor(RMPGTheme.textSecondary).cornerRadius(2)
        }
    }

    private func upload(_ image: UIImage) async {
        isUploading = true
        errorMessage = nil
        do {
            let id = try await api.uploadPhoto(jobId: job.id, image: image)
            photoIds.append(id)
            photoThumbnails.append(image)
        } catch {
            errorMessage = "Photo upload failed: \(error.localizedDescription)"
        }
        isUploading = false
    }

    private func submit() async {
        isSubmitting = true
        errorMessage = nil
        let coordinate = await location.currentCoordinate()
        let request = ServeAttemptRequest(
            result: result,
            notes: notes.isEmpty ? nil : notes,
            latitude: coordinate?.latitude,
            longitude: coordinate?.longitude,
            photoIds: photoIds,
            signatureData: signatureBase64,
            attemptAt: ISO8601DateFormatter().string(from: Date()),
            arrivedAt: arrivedAtIso
        )
        do {
            try await api.logAttempt(jobId: job.id, request)
            isSubmitting = false
            onComplete()
            dismiss()
        } catch {
            isSubmitting = false
            errorMessage = "Submit failed: \(error.localizedDescription)"
        }
    }
}
