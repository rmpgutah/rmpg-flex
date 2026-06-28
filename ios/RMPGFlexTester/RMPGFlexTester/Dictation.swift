import Foundation
import Speech
import AVFoundation

// On-device dictation. Wraps Speech + AVAudioEngine around the pure DictationState
// machine. requiresOnDeviceRecognition where supported keeps it private + offline.
@MainActor
final class Dictation: ObservableObject {
    @Published private(set) var state: DictationState = .idle
    @Published var transcript = ""

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    func requestAuth() {
        SFSpeechRecognizer.requestAuthorization { [weak self] auth in
            Task { @MainActor in
                if auth != .authorized { self?.state = self?.state.next(.denied) ?? .denied }
            }
        }
    }

    func start(seed: String) {
        guard state == .idle, let recognizer, recognizer.isAvailable else { return }
        transcript = seed
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        request = req
        let node = engine.inputNode
        node.installTap(onBus: 0, bufferSize: 1024, format: node.outputFormat(forBus: 0)) { buf, _ in
            req.append(buf)
        }
        try? AVAudioSession.sharedInstance().setCategory(.record, mode: .measurement, options: .duckOthers)
        try? AVAudioSession.sharedInstance().setActive(true, options: .notifyOthersOnDeactivation)
        engine.prepare(); try? engine.start()
        let base = seed.isEmpty ? "" : seed + " "
        task = recognizer.recognitionTask(with: req) { [weak self] result, _ in
            if let result { Task { @MainActor in self?.transcript = base + result.bestTranscription.formattedString } }
        }
        state = state.next(.start)
    }

    func stop() {
        engine.stop(); engine.inputNode.removeTap(onBus: 0)
        request?.endAudio(); task?.cancel(); task = nil; request = nil
        state = state.next(.stop)
    }
}
