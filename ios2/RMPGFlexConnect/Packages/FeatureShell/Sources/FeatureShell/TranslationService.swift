import SwiftUI
import Translation

@available(iOS 18.0, *)
public struct TranslationBannerModifier: ViewModifier {
    @State private var showTranslation = false
    let sourceText: String
    let targetLanguage: String

    public func body(content: Content) -> some View {
        content
            .translationPresentation(isPresented: $showTranslation, text: sourceText)
            .onTapGesture { showTranslation = true }
    }
}

@MainActor
public class TranslationService: ObservableObject {
    @Published var translatedText: String?
    @Published var isTranslating = false

    public func translate(_ text: String, to target: String = "es") async {
        isTranslating = true
        translatedText = nil
        defer { isTranslating = false }
        guard #available(iOS 18.0, *) else {
            translatedText = "Translation requires iOS 18+"
            return
        }
        let session = TranslationSession()
        do {
            let response = try await session.translate(text)
            translatedText = response
        } catch {
            translatedText = "Translation failed"
        }
    }
}

public struct TranslationView: View {
    @StateObject private var service = TranslationService()
    let textToTranslate: String

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
                Task { await service.translate(textToTranslate) }
            }
            .buttonStyle(.bordered)
            .disabled(service.isTranslating)

            if let translated = service.translatedText {
                Text(translated).font(.body)
                    .padding()
                    .background(Color.green.opacity(0.1))
                    .cornerRadius(2)
            }

            if service.isTranslating {
                ProgressView()
            }
        }
        .padding()
    }
}
