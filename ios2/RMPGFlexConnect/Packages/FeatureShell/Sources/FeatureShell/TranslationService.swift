import SwiftUI
import Translation

@available(iOS 18.0, macOS 14.4, *)
public struct TranslationBannerModifier: ViewModifier {
    @State private var showTranslation = false
    let sourceText: String

    public func body(content: Content) -> some View {
        content
            .translationPresentation(isPresented: $showTranslation, text: sourceText)
            .onTapGesture { showTranslation = true }
    }
}

@MainActor
@available(iOS 18.0, macOS 14.4, *)
public struct TranslationView: View {
    let textToTranslate: String
    @State private var showTranslation = false

    public init(textToTranslate: String) {
        self.textToTranslate = textToTranslate
    }

    public var body: some View {
        VStack(spacing: 12) {
            Text(textToTranslate).font(.body)
                .padding()
                .background(Color.gray.opacity(0.1))
                .cornerRadius(2)

            Button("Translate to Spanish") {
                showTranslation = true
            }
            .buttonStyle(.bordered)

            Text("Translation will appear in a popover")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding()
        .translationPresentation(isPresented: $showTranslation, text: textToTranslate)
    }
}
