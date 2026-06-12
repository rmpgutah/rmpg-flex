import SwiftUI
import UIKit

// Evidence photo: camera capture → multipart POST /api/field-photos (R2-backed),
// GPS + notes attached, optional link to the unit's current call.
struct CameraPicker: UIViewControllerRepresentable {
    let onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }
        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
            parent.dismiss()
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}

struct FieldPhotoSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var notes = ""
    @State private var attachToCall = true
    @State private var showCamera = true
    @State private var uploading = false
    @State private var status: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 10) {
                if let image {
                    Image(uiImage: image)
                        .resizable().scaledToFit().frame(maxHeight: 280)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    TextField("Notes (location context, item, subject…)", text: $notes, axis: .vertical)
                        .lineLimit(3...5)
                        .padding(8).background(Theme.raised)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    Toggle("Attach to my current call", isOn: $attachToCall)
                        .font(.system(size: 12)).tint(Theme.gold)
                    Button(uploading ? "UPLOADING…" : "UPLOAD EVIDENCE PHOTO") {
                        Task { await upload(image) }
                    }
                    .font(.system(size: 13, weight: .bold))
                    .frame(maxWidth: .infinity).padding(.vertical, 10)
                    .background(Theme.gold).foregroundStyle(.black)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    .disabled(uploading)
                    Button("Retake") { showCamera = true }
                        .font(.system(size: 12)).foregroundStyle(Theme.neutral)
                }
                if let status {
                    Text(status).font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(status.hasPrefix("✓") ? Theme.gold : Theme.red)
                }
                Spacer()
            }
            .padding(12)
            .background(Theme.base)
            .navigationTitle("FIELD PHOTO")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showCamera) {
                CameraPicker { image = $0 }
                    .ignoresSafeArea()
            }
        }
    }

    @MainActor
    private func upload(_ image: UIImage) async {
        guard let jpeg = image.jpegData(compressionQuality: 0.8) else { return }
        guard jpeg.count <= 12 * 1024 * 1024 else { status = "✗ Photo too large"; return }
        uploading = true; defer { uploading = false }

        var client = AppConfig.apiClient()
        if client.jwt == nil,
           let u = KeychainStore.load(key: "rmpgUser"),
           let p = KeychainStore.load(key: "rmpgPass"),
           let t = try? await client.login(username: u, password: p) {
            KeychainStore.save(t, key: "rmpgJWT"); client.jwt = t
        }
        guard let jwt = client.jwt else { status = "✗ Set RMPG credentials in Settings"; return }

        var fields: [String: String] = ["notes": notes]
        if let loc = LocationManager.shared.last {
            fields["lat"] = "\(loc.coordinate.latitude)"
            fields["lng"] = "\(loc.coordinate.longitude)"
        }
        if attachToCall,
           let state = try? await client.requestJSON("GET", "api/dispatch/duty/me") as? [String: Any],
           let callId = (state["unit"] as? [String: Any])?["current_call_id"] as? Int {
            fields["call_id"] = "\(callId)"
        }

        // Multipart body
        let boundary = "rmpg-\(UUID().uuidString)"
        var body = Data()
        for (key, value) in fields where !value.isEmpty {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(key)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"field.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(jpeg)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        var req = URLRequest(url: client.baseURL.appendingPathComponent("api/field-photos"))
        req.httpMethod = "POST"
        req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body

        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if (200..<300).contains(code) {
                status = "✓ Photo uploaded\(fields["call_id"] != nil ? " + attached to call" : "") — visible on desktop"
            } else {
                status = "✗ HTTP \(code): \(String(data: data, encoding: .utf8)?.prefix(120) ?? "")"
            }
        } catch {
            status = "✗ \(error.localizedDescription)"
        }
    }
}

// BOLO composer → POST /api/dispatch/bolos {type,title,description,priority}.
struct BoloComposer: View {
    @Environment(\.dismiss) private var dismiss
    @State private var type = "person"
    @State private var priority = "P3"
    @State private var title = ""
    @State private var description = ""
    @State private var status: String?

    var body: some View {
        NavigationStack {
            Form {
                Picker("Type", selection: $type) {
                    Text("Person").tag("person"); Text("Vehicle").tag("vehicle"); Text("Other").tag("other")
                }
                Picker("Priority", selection: $priority) {
                    ForEach(["P1", "P2", "P3", "P4"], id: \.self) { Text($0).tag($0) }
                }
                TextField("Title (e.g. WMA red hoodie, NB on Main)", text: $title)
                TextField("Description / last seen / direction", text: $description, axis: .vertical)
                    .lineLimit(3...6)
                Button("ISSUE BOLO") { Task { await submit() } }
                    .fontWeight(.semibold).disabled(title.isEmpty)
                if let status { Text(status).font(.system(size: 11, design: .monospaced)) }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle("NEW BOLO")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    @MainActor
    private func submit() async {
        var client = AppConfig.apiClient()
        if client.jwt == nil,
           let u = KeychainStore.load(key: "rmpgUser"),
           let p = KeychainStore.load(key: "rmpgPass"),
           let t = try? await client.login(username: u, password: p) {
            KeychainStore.save(t, key: "rmpgJWT"); client.jwt = t
        }
        do {
            try await client.requestJSON("POST", "api/dispatch/bolos", body: [
                "type": type, "title": title, "description": description, "priority": priority,
            ])
            status = "✓ BOLO issued — live on all consoles"
            try? await Task.sleep(for: .seconds(1))
            dismiss()
        } catch {
            status = "✗ \(error.localizedDescription)"
        }
    }
}
