import SwiftUI
import UIKit

/// Camera/gallery capture for proof-of-service photos. Plain
/// UIImagePickerController is enough here — unlike ID scanning, evidence
/// photos don't need VisionKit's edge detection/multi-page flow.
struct ServePhotoPicker: UIViewControllerRepresentable {
    enum Source { case camera, library }
    let source: Source
    let onCapture: (UIImage) -> Void
    let onCancel: () -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.delegate = context.coordinator
        picker.sourceType = (source == .camera && UIImagePickerController.isSourceTypeAvailable(.camera)) ? .camera : .photoLibrary
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onCapture: onCapture, onCancel: onCancel) }

    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onCapture: (UIImage) -> Void
        let onCancel: () -> Void
        init(onCapture: @escaping (UIImage) -> Void, onCancel: @escaping () -> Void) {
            self.onCapture = onCapture
            self.onCancel = onCancel
        }
        // Dismissal is owned by the SwiftUI .sheet(isPresented:) binding at the
        // call site — a same-class bug (double-dismiss race) to the one fixed
        // in CoreIDScan's DocumentScanner earlier this session.
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { onCapture(image) } else { onCancel() }
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onCancel() }
    }
}
