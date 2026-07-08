import SwiftUI

#if os(iOS)
import UIKit

/// Thin wrapper over `UIImagePickerController`'s live camera (not the photo
/// library) — chain-of-custody requires the ORIGINAL captured frame, not a
/// photo the officer picked after the fact.
struct EvidenceCameraCapture: UIViewControllerRepresentable {
    let onCapture: (Data) -> Void
    let onCancel: () -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        picker.cameraCaptureMode = .photo
        picker.allowsEditing = false
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: EvidenceCameraCapture
        init(_ parent: EvidenceCameraCapture) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            // .originalImage is the unedited capture — the frame we hash.
            if let image = info[.originalImage] as? UIImage, let data = image.jpegData(compressionQuality: 0.92) {
                parent.onCapture(data)
            } else {
                parent.onCancel()
            }
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.onCancel()
        }
    }
}
#endif
